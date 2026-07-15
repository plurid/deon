package deon

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// Resources over HTTP, bound to 127.0.0.1 always. Specification 15 requires that tests resolve
// resources through injected or local resolvers and never through a public network service — a suite
// that reaches the internet is one that fails when the internet does and tells you nothing about the
// language either way. This is the one test that drives the real HTTP path; everything else supplies
// its resources in memory.

type seenRequest struct {
	mu            sync.Mutex
	count         map[string]int
	path          string
	accept        string
	authorization string
}

func (s *seenRequest) record(r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.count == nil {
		s.count = map[string]int{}
	}
	s.count[r.URL.Path]++
	s.path = r.URL.Path
	s.accept = r.Header.Get("Accept")
	s.authorization = r.Header.Get("Authorization")
}

func (s *seenRequest) reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.count = map[string]int{}
	s.path = ""
	s.accept = ""
	s.authorization = ""
}

var networkRoutes = map[string]struct {
	body   string
	status int
}{
	"/child.deon":    {"{ name imported }", 200},
	"/data.json":     {`{"a": 1.50}`, 200},
	"/private.deon":  {"{ name secret }", 200},
	"/missing.deon":  {"gone", 404},
	"/text.txt":      {"raw text", 200},
	"/dir/main.deon": {"import s from ./sub\n{ #s.inner }", 200},
	"/dir/sub.deon":  {"{ inner nested }", 200},
}

func newServer(seen *seenRequest) *httptest.Server {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen.record(r)
		route, ok := networkRoutes[r.URL.Path]
		if !ok {
			route.status = 404
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(route.status)
		w.Write([]byte(route.body))
	})
	return httptest.NewServer(handler)
}

func allowNetwork() ParseOptions {
	return ParseOptions{AllowNetwork: true}
}

// #region the gate
func TestNetworkDeniedByDefaultOpensNoSocket(t *testing.T) {
	seen := &seenRequest{}
	server := newServer(seen)
	defer server.Close()

	_, err := Parse("import c from " + server.URL + "/child.deon\n{ #c }")
	deonErr, ok := err.(*Error)
	if !ok || deonErr.Code != CapabilityDenied {
		t.Fatalf("expected DEON_CAPABILITY_DENIED, got %v", err)
	}
	// The gate is before the request: a denial that opened a socket first would look the same from the
	// outside and would not be the same thing.
	if len(seen.count) != 0 {
		t.Errorf("a denied document reached the network: %v", seen.count)
	}
}

func TestImportOverHTTP(t *testing.T) {
	seen := &seenRequest{}
	server := newServer(seen)
	defer server.Close()

	value, err := ParseWith("import c from "+server.URL+"/child.deon\n{ #c.name }", allowNetwork())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := value.(*Map); mustGet(got, "name") != "imported" {
		t.Errorf("expected name=imported, got %v", value)
	}
	if seen.accept != "text/plain,application/json,application/deon" {
		t.Errorf("import asked for %q", seen.accept)
	}
}

func TestInjectionAsksForAnything(t *testing.T) {
	seen := &seenRequest{}
	server := newServer(seen)
	defer server.Close()

	value, err := ParseWith("inject t from "+server.URL+"/text.txt\n{ #t }", allowNetwork())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if mustGet(value.(*Map), "t") != "raw text" {
		t.Errorf("expected t='raw text', got %v", value)
	}
	if seen.accept != "*/*" {
		t.Errorf("injection asked for %q", seen.accept)
	}
}

func TestJSONOverHTTPKeepsNumberSpelling(t *testing.T) {
	seen := &seenRequest{}
	server := newServer(seen)
	defer server.Close()

	value, err := ParseWith("import d from "+server.URL+"/data.json\n{ ...#d }", allowNetwork())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if mustGet(value.(*Map), "a") != "1.50" {
		t.Errorf("expected a='1.50' (source spelling), got %v", value)
	}
}

func TestRelativeImportResolvesAgainstItsURL(t *testing.T) {
	seen := &seenRequest{}
	server := newServer(seen)
	defer server.Close()

	// main.deon imports ./sub relative to its own URL; its root is { inner nested }, so the outer
	// document resolves to { m: { inner: "nested" } } only if that relative import found its sibling.
	value, err := ParseWith("import m from "+server.URL+"/dir/main.deon\n{ #m }", allowNetwork())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	outer, ok := value.(*Map)
	if !ok {
		t.Fatalf("expected a map, got %v", value)
	}
	inner, _ := outer.Get("m")
	innerMap, ok := inner.(*Map)
	if !ok || mustGet(innerMap, "inner") != "nested" {
		t.Errorf("expected the relative sub-import to resolve to 'nested', got %v", value)
	}
}

// #endregion the gate

// #region credentials
func TestWithTokenIsSentAsBearer(t *testing.T) {
	seen := &seenRequest{}
	server := newServer(seen)
	defer server.Close()

	_, err := ParseWith("t s3cret\nimport c from "+server.URL+"/private.deon with #t\n{ #c }", allowNetwork())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if seen.authorization != "Bearer s3cret" {
		t.Errorf("expected 'Bearer s3cret', got %q", seen.authorization)
	}
}

func TestAuthorizationMapUsedWhenDeclarationSaysNothing(t *testing.T) {
	seen := &seenRequest{}
	server := newServer(seen)
	defer server.Close()

	options := allowNetwork()
	options.Authorization = map[string]string{"127.0.0.1": "from-the-map"}
	_, err := ParseWith("import c from "+server.URL+"/private.deon\n{ #c }", options)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if seen.authorization != "Bearer from-the-map" {
		t.Errorf("expected 'Bearer from-the-map', got %q", seen.authorization)
	}
}

func TestDeclarationWinsOverTheMap(t *testing.T) {
	seen := &seenRequest{}
	server := newServer(seen)
	defer server.Close()

	options := allowNetwork()
	options.Authorization = map[string]string{"127.0.0.1": "theirs"}
	_, err := ParseWith("t mine\nimport c from "+server.URL+"/private.deon with #t\n{ #c }", options)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if seen.authorization != "Bearer mine" {
		t.Errorf("expected 'Bearer mine', got %q", seen.authorization)
	}
}

func TestEmptyTokenSendsNoHeader(t *testing.T) {
	seen := &seenRequest{}
	server := newServer(seen)
	defer server.Close()

	// `Bearer ` is a credential-shaped nothing, and a server would be right to reject it.
	_, err := ParseWith("t ''\nimport c from "+server.URL+"/private.deon with #t\n{ #c }", allowNetwork())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if seen.authorization != "" {
		t.Errorf("expected no Authorization header, got %q", seen.authorization)
	}
}

// #endregion credentials

func TestNonSuccessIsIOFailureNotDenial(t *testing.T) {
	seen := &seenRequest{}
	server := newServer(seen)
	defer server.Close()

	// It was allowed, and it failed — a different thing from never having been allowed.
	_, err := ParseWith("import c from "+server.URL+"/missing.deon\n{ #c }", allowNetwork())
	deonErr, ok := err.(*Error)
	if !ok || deonErr.Code != ResourceIO {
		t.Fatalf("expected DEON_RESOURCE_IO, got %v", err)
	}
}

// #region parse_link
func TestParseLinkDeniedBeforeAnyRequest(t *testing.T) {
	seen := &seenRequest{}
	server := newServer(seen)
	defer server.Close()

	_, err := ParseLink(server.URL+"/child.deon", ParseOptions{})
	deonErr, ok := err.(*Error)
	if !ok || deonErr.Code != CapabilityDenied {
		t.Fatalf("expected DEON_CAPABILITY_DENIED, got %v", err)
	}
	if len(seen.count) != 0 {
		t.Errorf("parse-link reached the network before the gate: %v", seen.count)
	}
}

func TestParseLinkAsksForDeonAndNothingElse(t *testing.T) {
	seen := &seenRequest{}
	server := newServer(seen)
	defer server.Close()

	value, err := ParseLink(server.URL+"/child.deon", allowNetwork())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if mustGet(value.(*Map), "name") != "imported" {
		t.Errorf("expected name=imported, got %v", value)
	}
	if seen.accept != "application/deon" {
		t.Errorf("parse-link asked for %q", seen.accept)
	}
}

// #endregion parse_link

// #region cache
func TestCacheKeyNeverHoldsTheTokenOrTheName(t *testing.T) {
	key := cacheKey("https://example.com/a.deon", "super-secret")
	if strings.Contains(key, "super-secret") || strings.Contains(key, "example.com") {
		t.Errorf("the cache key leaked its inputs: %s", key)
	}
}

func TestCacheKeyDiffersByToken(t *testing.T) {
	// Not a cache miss — a data leak, if it were not. A document fetched under one credential must
	// never be served to the holder of another.
	if cacheKey("https://example.com/a.deon", "alice") == cacheKey("https://example.com/a.deon", "bob") {
		t.Error("two credentials produced the same cache key")
	}
}

func TestCacheKeySeparatorIsUnambiguous(t *testing.T) {
	// The NUL cannot occur in either half, so ("ab", "c") and ("a", "bc") cannot collide.
	if cacheKey("ab", "c") == cacheKey("a", "bc") {
		t.Error("the cache key separator can be spelled two ways")
	}
}

func TestCacheServesTheSecondFetchWithoutARequest(t *testing.T) {
	seen := &seenRequest{}
	server := newServer(seen)
	defer server.Close()

	options := allowNetwork()
	options.Cache = true
	options.CacheDirectory = t.TempDir()

	document := "import c from " + server.URL + "/child.deon\n{ #c.name }"

	first, err := ParseWith(document, options)
	if err != nil {
		t.Fatalf("first fetch: %v", err)
	}
	second, err := ParseWith(document, options)
	if err != nil {
		t.Fatalf("second fetch: %v", err)
	}

	if mustGet(first.(*Map), "name") != "imported" || mustGet(second.(*Map), "name") != "imported" {
		t.Fatalf("cached value differs from the fetched one")
	}
	if got := seen.count["/child.deon"]; got != 1 {
		t.Errorf("expected exactly one request, the second served from cache; made %d", got)
	}
}

// #endregion cache

func mustGet(m *Map, key string) string {
	value, _ := m.Get(key)
	s, _ := value.(string)
	return s
}
