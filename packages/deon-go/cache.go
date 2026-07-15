package deon

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// The response cache. Two requirements of specification 9, and they are the reason this is not a map
// keyed by URL:
//
//	Tokens MUST NOT appear in diagnostics or cache identifiers in plain text.
//	Authenticated cache entries MUST be separated by a digest of the credential.
//
// So an entry is keyed by sha256(name + NUL + token). The digest keeps the credential out of the
// filename, and folding the token into the key is what stops a document fetched under one credential
// from being served to the holder of another — which is not a cache miss, it is a data leak.
//
// A cache entry is itself a canonical Deon document. That is a small piece of dogfooding with a real
// edge: the format has to survive a round trip, so it is made to, on every write and every read.

const (
	defaultCacheDuration  = 3_600_000 // one hour, in milliseconds
	defaultCacheDirectory = "~/.deon-cache"
)

// cacheKey is the identity of a cached response. The NUL is a separator that cannot occur in either
// half, so no pair of (name, token) can be spelled two ways and collide: without it, a name ending in
// a token's prefix would hash to the same place.
func cacheKey(name, token string) string {
	digest := sha256.New()
	digest.Write([]byte(name))
	digest.Write([]byte{0})
	digest.Write([]byte(token))
	return hex.EncodeToString(digest.Sum(nil))
}

func nowMilliseconds() int64 {
	return time.Now().UnixMilli()
}

func cacheDurationOf(options *ParseOptions) int {
	if options.CacheDuration > 0 {
		return options.CacheDuration
	}
	return defaultCacheDuration
}

// cacheEntryPath is where a response is written, or false when caching is off.
func cacheEntryPath(name, token string, options *ParseOptions) (string, bool) {
	if !options.Cache {
		return "", false
	}
	directory := options.CacheDirectory
	if directory == "" {
		directory = defaultCacheDirectory
	}
	directory = expandUser(directory)
	return filepath.Join(directory, cacheKey(name, token)), true
}

// expandUser resolves a leading ~ to the caller's home directory, leaving everything else alone.
func expandUser(path string) string {
	if path == "~" || len(path) >= 2 && path[:2] == "~/" {
		if home, err := os.UserHomeDir(); err == nil {
			if path == "~" {
				return home
			}
			return filepath.Join(home, path[2:])
		}
	}
	return path
}

// cacheRead returns a cached response, if there is one and it has not expired. Every failure is
// silent: a cache that raised would turn a performance decision into a correctness one, and a document
// that parsed yesterday would stop parsing because of a file nobody meant to be load-bearing.
func cacheRead(name, token string, options *ParseOptions) (Value, bool) {
	path, ok := cacheEntryPath(name, token, options)
	if !ok {
		return nil, false
	}
	source, err := os.ReadFile(path)
	if err != nil {
		return nil, false
	}
	entry, err := Parse(string(source))
	if err != nil {
		return nil, false
	}
	entryMap, ok := entry.(*Map)
	if !ok {
		return nil, false
	}

	cachedAt, ok1 := cacheInt(entryMap, "cachedAt")
	duration, ok2 := cacheInt(entryMap, "cacheDuration")
	if !ok1 || !ok2 {
		return nil, false
	}
	if cachedAt+duration < nowMilliseconds() {
		// Expired, so it is gone. Leaving it would mean reading and re-deciding it every time.
		_ = os.Remove(path)
		return nil, false
	}

	data, _ := entryMap.Get("data")
	return data, true
}

// cacheWrite stores a response as a canonical Deon entry. Silent on failure, for the same reason.
func cacheWrite(name, token string, value Value, options *ParseOptions) {
	path, ok := cacheEntryPath(name, token, options)
	if !ok {
		return
	}
	entry := NewMap()
	entry.Set("cachedAt", strconv.FormatInt(nowMilliseconds(), 10))
	entry.Set("cacheDuration", strconv.Itoa(cacheDurationOf(options)))
	entry.Set("data", value)

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	_ = os.WriteFile(path, []byte(canonical(entry)), 0o644)
}

func cacheInt(m *Map, key string) (int64, bool) {
	value, ok := m.Get(key)
	if !ok {
		return 0, false
	}
	text, ok := value.(string)
	if !ok {
		return 0, false
	}
	n, err := strconv.ParseInt(text, 10, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}
