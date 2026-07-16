package deon

import (
	"os"
	"path/filepath"
	"sort"
	"unicode/utf8"
)

// Version is the release of the specification this implementation tracks. Every implementation moves
// in lockstep against a single specification version, so the four print the same string.
const Version = "0.0.0-11"

// The public surface. Everything is synchronous: Go's file and network reads block, so a caller who
// wants a parse off the current goroutine already has the way to say so — `go`, a channel, an
// errgroup — and an asynchronous API would buy nothing and cost a second evaluator.

// Parse reads a document, granted nothing. A document that imports is denied, because nothing said it
// might — which is a diagnostic, with a code and a position, rather than a surprise. That is the
// default, and it is the safe way to be wrong.
func Parse(source string) (Value, error) {
	return ParseWith(source, ParseOptions{})
}

// ParseWith reads a document with the capabilities and surroundings the caller decides.
func ParseWith(source string, options ParseOptions) (value Value, err error) {
	defer recoverError(&err)

	doc, parseErr := parseSyntax(source, options.sourceName())
	if parseErr != nil {
		return nil, parseErr
	}

	options.SourceName = options.sourceName()
	root := newInterpreter(&options).run(doc)
	return sign(root, &options), nil
}

// ParseFile reads a file, which grants the filesystem to it and to what it imports. Naming a file is
// the grant: a caller who says "read this from my disk" has said the disk may be read. The network is
// a separate sentence, and it has not been said.
func ParseFile(pathname string, options ParseOptions) (Value, error) {
	data, err := os.ReadFile(pathname)
	if err != nil {
		return nil, newError(ResourceIO, "Unable to read '"+pathname+"'.", headSpan(pathname))
	}
	options.SourceName = pathname
	options.Filebase = filepath.Dir(pathname)
	options.AllowFilesystem = true
	return ParseWith(string(data), options)
}

// ReadFile reads a document as text, and turns a failure into a diagnostic rather than a host error.
// The file was named, so it was permitted; failing to read it is DEON_RESOURCE_IO, carrying a code
// and a position an editor can show, not an operating-system exception a caller would have to catch.
// Bytes that read but are not valid UTF-8 are a different fault: the read succeeded and the encoding
// is wrong, so that is DEON_RESOURCE_FORMAT, reported at the head of the document the same way.
func ReadFile(pathname string) (string, error) {
	data, err := os.ReadFile(pathname)
	if err != nil {
		return "", newError(ResourceIO, "Unable to read '"+pathname+"'.", headSpan(pathname))
	}
	if !utf8.ValidString(string(data)) {
		return "", newError(ResourceFormat, "The file '"+pathname+"' is not valid UTF-8.", headSpan(pathname))
	}
	return string(data), nil
}

// ReadJSON converts a JSON document into a Deon value, preserving each number's source spelling
// (specification 9.1). It is the seam the `convert` tool reaches through.
func ReadJSON(data, sourceName string) (value Value, err error) {
	defer recoverError(&err)
	return jsonToValue(data, headSpan(sourceName)), nil
}

// ParseLink fetches a Deon document from a URL and evaluates it. The network must be granted, and the
// target is refused before any request when it is not — a denial that opened a socket first would look
// the same from the outside and would not be the same thing (specification 9). The headers are
// deliberately not an importer's: a link is asked for as Deon and nothing else, because a caller who
// said ParseLink said what they expect to get.
func ParseLink(link string, options ParseOptions) (value Value, err error) {
	defer recoverError(&err)

	if !options.AllowNetwork {
		fail(CapabilityDenied, "'"+link+"' was not fetched: network access is not allowed.", headSpan(link))
	}

	interpreter := newInterpreter(&options)
	data := interpreter.fetchOverNetwork(link, "link", options.Token, headSpan(link))

	options.SourceName = link
	options.Filebase = directoryOf(link)
	return ParseWith(data, options)
}

// ParseSyntax parses a document into a syntax tree without evaluating it, reaching nothing and needing
// no capability. It is the seam an editor reaches through to read what a document declares.
func ParseSyntax(source, sourceName string) (err error) {
	_, err = parseSyntax(source, sourceName)
	return err
}

// Lint returns the diagnostics a document carries without throwing: what is legal and questionable,
// as opposed to what is wrong, which evaluation surfaces.
func Lint(source, sourceName string) []Diagnostic {
	doc, err := parseSyntax(source, sourceName)
	if err != nil {
		return nil
	}
	return lintDocument(doc)
}

// Entity is one thing a document declares, and what it would demand of a caller.
type Entity struct {
	Name       string
	Parameters []string
	Kind       string
}

// Entities reports what a document declares without evaluating it: it parses and reaches nothing, so
// it needs no capability. The parameters are not declared anywhere — they are the interpolation names
// an entity carries, which is a rule of the language (specification 10) rather than a convention.
func Entities(source, sourceName string) ([]Entity, error) {
	doc, err := parseSyntax(source, sourceName)
	if err != nil {
		return nil, err
	}

	found := []Entity{}
	for i := range doc.declarations {
		decl := &doc.declarations[i]
		if decl.kind != declLeaflink {
			found = append(found, Entity{Name: decl.name, Parameters: []string{}, Kind: "resource"})
			continue
		}
		found = append(found, Entity{
			Name:       decl.name,
			Parameters: sortedNames(interpolationNames(decl.value)),
			Kind:       nodeKind(decl.value),
		})
	}
	return found, nil
}

func nodeKind(n node) string {
	switch n.(type) {
	case *mapNode:
		return "map"
	case *listNode:
		return "list"
	case *structureNode:
		return "structure"
	case *linkNode:
		return "link"
	case *callNode:
		return "call"
	default:
		return "scalar"
	}
}

func sortedNames(set map[string]bool) []string {
	names := make([]string, 0, len(set))
	for name := range set {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// Canonical writes the one form of a value that every implementation agrees on, character for
// character (specification 13). A value built by hand that nests more deeply than the limit
// (specification 11.1) is refused with a diagnostic rather than a stack overflow.
func Canonical(value Value) (result string, err error) {
	defer recoverError(&err)
	return canonical(value), nil
}

// CanonicalSource evaluates a document and writes its canonical form.
func CanonicalSource(source string, options ParseOptions) (string, error) {
	value, err := ParseWith(source, options)
	if err != nil {
		return "", err
	}
	return canonical(value), nil
}

// Stringify writes a value with the given options (specification 12). A value built by hand that
// nests more deeply than the limit (specification 11.1) is refused with a diagnostic.
func Stringify(value Value, options StringifyOptions) (result string, err error) {
	defer recoverError(&err)
	return stringify(value, options.resolved()), nil
}

// Typed applies the conservative typer (specification 14). A value built by hand that nests more
// deeply than the limit (specification 11.1) is refused with a diagnostic rather than a stack
// overflow.
func Typed(value Value) (result any, err error) {
	defer recoverError(&err)
	return typed(value), nil
}
