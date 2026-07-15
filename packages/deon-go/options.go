package deon

// DefaultSourceName is what a document is called when the caller does not name it.
const DefaultSourceName = "<memory>"

// ParseOptions are the capabilities and the surroundings of a parse.
//
// Everything is denied by default (specification 9): calling a parser on a piece of text grants
// neither the filesystem nor the network, because a document handed to a library came from somewhere
// unknown. Each capability is an explicit decision.
type ParseOptions struct {
	// SourceName is what the document is called in a diagnostic, and what a relative target resolves
	// against.
	SourceName string

	// Filebase is the directory a relative target resolves against, when it is not the one holding
	// the source.
	Filebase string

	// Resources handed to the evaluator directly, keyed by target. Consulted before any loader, so a
	// document that imports can be evaluated while reaching nothing at all — how the conformance suite
	// runs, and how an editor reads a document it has open but has not saved.
	Resources map[string]string

	// AbsolutePaths maps a logical absolute target onto the host path that holds it (specification 9).
	// Exact keys win; among /prefix/* wildcards the longest wins. It is a property of the target
	// rather than of whoever resolves it.
	AbsolutePaths map[string]string

	// Environment is what a #$NAME reads. It defaults to empty and is never filled in from the process
	// environment: a library that read the ambient environment would make a document mean one thing on
	// one machine and another on the next. The CLI reads the environment and passes it in.
	Environment map[string]string

	// Authorization is a bearer token per exact lowercase hostname — no port, no path, no wildcard.
	Authorization map[string]string

	// Token is the credential parse-link fetches with, and half of a cache identifier. It is not what
	// an importer sends; that comes from a declaration's `with` or from Authorization.
	Token string

	AllowFilesystem bool
	AllowNetwork    bool

	// DatasignFiles are the .datasign contracts that type the parsed data, and DatasignMap the root
	// keys each type applies to (specification 14.1). Both are needed: an empty map is the identity,
	// and reading a contract without one to apply would be reading a file for nothing.
	DatasignFiles []string
	DatasignMap   map[string]string
}

func (o *ParseOptions) sourceName() string {
	if o.SourceName == "" {
		return DefaultSourceName
	}
	return o.SourceName
}

// StringifyOptions decide how a value is written (specification 12). The zero value is the readable
// default: four spaces, inline values, no generated header or comments.
type StringifyOptions struct {
	Canonical          bool
	Readable           bool
	Indentation        int
	Leaflinks          bool
	LeaflinkLevel      int
	LeaflinkShortening bool
	GeneratedHeader    bool
	GeneratedComments  bool

	set bool
}

// DefaultStringifyOptions returns the readable defaults. Because the zero StringifyOptions cannot
// tell "the caller wants Readable false" from "the caller passed nothing", callers build from here.
func DefaultStringifyOptions() StringifyOptions {
	return StringifyOptions{
		Readable:           true,
		Indentation:        4,
		LeaflinkLevel:      1,
		LeaflinkShortening: true,
		set:                true,
	}
}

func (o StringifyOptions) resolved() StringifyOptions {
	if !o.set && !o.Canonical && !o.Readable && o.Indentation == 0 {
		return DefaultStringifyOptions()
	}
	if o.Indentation == 0 {
		o.Indentation = 4
	}
	return o
}
