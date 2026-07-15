package deon

import (
	"net/url"
	"os"
	"path"
	"strings"
	"unicode/utf8"
)

// Where a resource comes from, and whether it may be reached at all (specification 9). Nothing is
// granted by default: a target is refused *before* a request is made, not after one comes back, which
// is the whole difference between a decision and an accident. Two failures must never be confused —
// DEON_CAPABILITY_DENIED is a policy, DEON_RESOURCE_IO is the world.

type fetched struct {
	data       string
	filetype   string // the extension an import is read as; empty for an injection
	filebase   string // what a relative target inside the loaded document resolves against
	resourceID string // the canonical identity, which the cycle check compares
}

func isURL(target string) bool {
	parsed, err := url.Parse(target)
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https")
}

func extensionOf(target string) string {
	if isURL(target) {
		if parsed, err := url.Parse(target); err == nil {
			return path.Ext(parsed.Path)
		}
	}
	return path.Ext(target)
}

func directoryOf(target string) string {
	if isURL(target) {
		if parsed, err := url.Parse(target); err == nil {
			parsed.Path = path.Dir(parsed.Path) + "/"
			return parsed.String()
		}
	}
	return path.Dir(target)
}

// resolveTarget turns a target as written into the target it names (specification 9). A relative
// filesystem target resolves against the document's filebase; a relative URL against the document's
// URL. The absolutePaths mapping is applied last.
func (in *interpreter) resolveTarget(target string) string {
	resolved := target

	switch {
	case isURL(target):
		// already absolute
	case strings.HasPrefix(target, "/"):
		// a logical absolute path, left for the absolutePaths mapping
	case in.options.Filebase != "" && isURL(in.options.Filebase):
		base := in.options.Filebase
		if !strings.HasSuffix(base, "/") {
			base += "/"
		}
		if ref, err := url.Parse(target); err == nil {
			if root, err := url.Parse(base); err == nil {
				resolved = root.ResolveReference(ref).String()
			}
		}
	default:
		resolved = path.Join(in.options.Filebase, target)
	}

	return in.mapAbsolute(resolved)
}

// mapAbsolute applies the absolutePaths option: exact keys win before wildcards; among /prefix/*
// wildcards the longest prefix wins, and the unmatched suffix is appended to the mapped directory.
func (in *interpreter) mapAbsolute(target string) string {
	paths := in.options.AbsolutePaths
	if len(paths) == 0 {
		return target
	}
	if mapped, ok := paths[target]; ok {
		return mapped
	}

	best := ""
	for key := range paths {
		if !strings.HasSuffix(key, "/*") {
			continue
		}
		prefix := key[:len(key)-1] // keep the trailing slash
		if strings.HasPrefix(target, prefix) && len(prefix) > len(best) {
			best = prefix
		}
	}
	if best == "" {
		return target
	}
	mapped := paths[best+"*"]
	remainder := target[len(best):]
	return strings.TrimRight(mapped, "/") + "/" + remainder
}

// load fetches a resource, gating on the capability it needs. In-memory resources supplied to the
// evaluator are consulted first, so a document handed its own resources reaches neither a disk nor a
// network to find them.
func (in *interpreter) load(target, kind string, span Span) fetched {
	filetype := ""
	if kind == "import" {
		filetype = extensionOf(target)
	}

	if data, ok := in.options.Resources[target]; ok {
		return fetched{data: data, filetype: filetype, filebase: directoryOf(target), resourceID: target}
	}

	if isURL(target) {
		if !in.options.AllowNetwork {
			fail(CapabilityDenied,
				"The resource '"+target+"' was not permitted: network access is not allowed.", span)
		}
		data := in.fetchOverNetwork(target, kind, span)
		return fetched{data: data, filetype: filetype, filebase: directoryOf(target), resourceID: target}
	}

	if !in.options.AllowFilesystem {
		fail(CapabilityDenied,
			"The resource '"+target+"' was not permitted: filesystem access is not allowed.", span)
	}

	bytes, err := os.ReadFile(target)
	if err != nil {
		fail(ResourceIO, "Unable to read resource '"+target+"'.", span)
	}
	if !isValidUTF8(string(bytes)) {
		fail(ResourceFormat, "The resource '"+target+"' is not valid UTF-8.", span)
	}
	return fetched{data: string(bytes), filetype: filetype, filebase: directoryOf(target), resourceID: target}
}

// #region import and injection
func (in *interpreter) evalImport(decl *declaration) Value {
	token := in.resolveAuthenticator(decl)
	target := in.importTarget(in.resolveTarget(decl.target))

	f := in.load(target, "import", decl.span)
	_ = token

	if in.opened[f.resourceID] {
		// A resource that imports its way back to itself is a cycle, reported at the statement that
		// closed the loop (§11.2).
		fail(Cycle, "The resource '"+f.resourceID+"' imports itself.", decl.span)
	}
	in.opened[f.resourceID] = true
	defer delete(in.opened, f.resourceID)

	if f.filetype == ".json" {
		return in.jsonAtStatement(f.data, decl.span)
	}
	if f.filetype != "" && f.filetype != ".deon" {
		fail(ResourceFormat, "The import '"+decl.target+"' has an unsupported extension.", decl.span)
	}

	return in.importDeon(f, decl.span)
}

// importTarget appends the default extension: when an import target has no extension, `.deon` is
// appended (specification 9).
func (in *interpreter) importTarget(target string) string {
	if extensionOf(target) == "" {
		return target + ".deon"
	}
	return target
}

// importDeon parses and evaluates an imported Deon document, re-anchoring any diagnostic it raises to
// the importing statement (§11.2): the document a caller is holding is the importing one.
func (in *interpreter) importDeon(f fetched, at Span) Value {
	value, err := func() (v Value, err error) {
		defer recoverError(&err)
		doc := mustParse(f.data, f.resourceID)

		sub := newInterpreter(in.subOptions(f))
		sub.opened = in.opened
		return sub.run(doc), nil
	}()
	if err != nil {
		reanchor(err, at)
		panic(err)
	}
	return value
}

func (in *interpreter) evalInject(decl *declaration) Value {
	_ = in.resolveAuthenticator(decl)
	target := in.resolveTarget(decl.target)
	f := in.load(target, "inject", decl.span)
	return f.data
}

func (in *interpreter) subOptions(f fetched) *ParseOptions {
	sub := *in.options
	sub.SourceName = f.resourceID
	sub.Filebase = f.filebase
	return &sub
}

// resolveAuthenticator resolves an optional `with authenticator` to a string: a literal, an
// environment link, or a leaflink that resolves to a string.
func (in *interpreter) resolveAuthenticator(decl *declaration) string {
	if decl.authenticator == nil {
		return ""
	}
	value := in.eval(decl.authenticator)
	text, ok := value.(string)
	if !ok {
		// An authenticator that resolves to a map or list is the wrong shape, not a malformed resource:
		// nothing has been fetched yet. It is a type mismatch, reported at the importing statement.
		fail(TypeMismatch, "An authenticator must resolve to a string.", decl.span)
	}
	return text
}

// #endregion import and injection

// reanchor rewrites the primary span of a raised error to the importing statement, leaving the
// original location in the message for the import trace. A cycle keeps its own span.
func reanchor(err error, at Span) {
	deonErr, ok := err.(*Error)
	if !ok || len(deonErr.Diagnostics) == 0 {
		return
	}
	if deonErr.Code == Cycle {
		return
	}
	deonErr.Diagnostics[0].Span = at
}

func isValidUTF8(s string) bool { return utf8.ValidString(s) }

// mustParse parses a document and raises on failure, for use inside a boundary that will recover.
func mustParse(text, source string) *document {
	doc, err := parseSyntax(text, source)
	if err != nil {
		panic(err)
	}
	return doc
}

// jsonAtStatement converts imported JSON, re-anchoring a format fault to the importing statement.
func (in *interpreter) jsonAtStatement(data string, at Span) Value {
	value, err := func() (v Value, err error) {
		defer recoverError(&err)
		return jsonToValue(data, at), nil
	}()
	if err != nil {
		reanchor(err, at)
		panic(err)
	}
	return value
}

// fetchOverNetwork retrieves a resource over HTTP once the network has been granted. The conformance
// suite never reaches a public network (specification 15), so this exists for real use rather than for
// the fixtures, which supply their resources in memory.
func (in *interpreter) fetchOverNetwork(target, kind string, span Span) string {
	return httpGet(target, kind, in.tokenFor(target), span)
}

// tokenFor is the bearer credential for a host, from the authorization option keyed by exact
// lowercase hostname (specification 9).
func (in *interpreter) tokenFor(target string) string {
	parsed, err := url.Parse(target)
	if err != nil {
		return ""
	}
	if token, ok := in.options.Authorization[strings.ToLower(parsed.Hostname())]; ok {
		return token
	}
	return ""
}
