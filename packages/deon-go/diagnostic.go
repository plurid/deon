package deon

import "fmt"

// Code is one of the fifteen diagnostic codes, and there are no others (spec/diagnostics.md). The
// catalogue is normative and closed; each string is the wire name that appears in a fixture, a tool's
// output, and a host's log, so it must not drift.
type Code string

const (
	LexUnterminated      Code = "DEON_LEX_UNTERMINATED"
	LexInvalid           Code = "DEON_LEX_INVALID"
	ParseExpected        Code = "DEON_PARSE_EXPECTED"
	ParseRoot            Code = "DEON_PARSE_ROOT"
	DuplicateDeclaration Code = "DEON_DUPLICATE_DECLARATION"
	UnresolvedLink       Code = "DEON_UNRESOLVED_LINK"
	Cycle                Code = "DEON_CYCLE"
	StructureArity       Code = "DEON_STRUCTURE_ARITY"
	EntityArgument       Code = "DEON_ENTITY_ARGUMENT"
	TypeMismatch         Code = "DEON_TYPE_MISMATCH"
	CapabilityDenied     Code = "DEON_CAPABILITY_DENIED"
	ResourceIO           Code = "DEON_RESOURCE_IO"
	ResourceFormat       Code = "DEON_RESOURCE_FORMAT"
	LintDuplicateKey     Code = "DEON_LINT_DUPLICATE_KEY"
	LimitExceeded        Code = "DEON_LIMIT_EXCEEDED"
)

// Every code is an error except the one that is advice.
func severityOf(code Code) string {
	if code == LintDuplicateKey {
		return "warning"
	}
	return "error"
}

// Span is where a diagnostic points.
//
// Start and End are UTF-8 byte offsets, for a host that wants to slice the source. Line and Column
// are one-based and counted in Unicode code points, for a host that wants to show it. The two are
// different numbers, and conflating them is the classic way to underline the wrong character: ключ is
// four code points and eight bytes. Both index the normalized source, with CRLF already folded to LF.
type Span struct {
	Source    string
	Start     int
	End       int
	Line      int
	Column    int
	EndLine   int
	EndColumn int
}

// headSpan points at the beginning of a document, for a diagnostic about the document as a whole
// rather than about anything written inside it.
func headSpan(source string) Span {
	return Span{Source: source, Line: 1, Column: 1, EndLine: 1, EndColumn: 1}
}

// Diagnostic is one reported fault.
type Diagnostic struct {
	Code     Code
	Message  string
	Span     Span
	Severity string
	// Related are secondary positions the reader is sent to beyond the primary Span — the first
	// declaration a duplicate collides with, say (spec/diagnostics.md). Empty for most faults.
	Related []Span
}

func diagnosticOf(code Code, message string, span Span, related ...Span) Diagnostic {
	return Diagnostic{Code: code, Message: message, Span: span, Severity: severityOf(code), Related: related}
}

// Error is what crosses the public boundary when a document is bad. Evaluation is atomic: the first
// error ends it and carries its diagnostics out. Nothing else — no host panic, no I/O error, no JSON
// decoder complaint — reaches a caller, because those are the host leaking through and each is a bug
// here rather than a fact about the document.
type Error struct {
	Code        Code
	Message     string
	Diagnostics []Diagnostic
}

func newError(code Code, message string, span Span, related ...Span) *Error {
	return &Error{
		Code:        code,
		Message:     message,
		Diagnostics: []Diagnostic{diagnosticOf(code, message, span, related...)},
	}
}

func (e *Error) Error() string {
	span := e.Diagnostics[0].Span
	return fmt.Sprintf("%s:%d:%d %s %s", span.Source, span.Line, span.Column, e.Code, e.Message)
}

// fail raises a diagnostic as a panic carrying an *Error. The parser and the interpreter are deeply
// recursive, and threading an error return through every frame would drown the grammar in plumbing;
// so the raise is a panic and every public entry point recovers it into a returned error. Nothing
// but an *Error is ever raised this way, and recoverError re-panics anything that is not one, so a
// genuine host panic is never swallowed.
func fail(code Code, message string, span Span, related ...Span) {
	panic(newError(code, message, span, related...))
}

// recoverError turns a raised *Error back into a returned one. It is deferred at every public
// boundary: recover(), and if what was recovered is an *Error, store it; otherwise re-panic, because
// a nil-dereference is a bug in this package and must not masquerade as a bad document.
func recoverError(err *error) {
	if raised := recover(); raised != nil {
		if deonErr, ok := raised.(*Error); ok {
			*err = deonErr
			return
		}
		panic(raised)
	}
}
