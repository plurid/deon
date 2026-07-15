package deon

// The syntax tree. Parsing produces one of these; evaluation walks it. It is deliberately small: the
// specification (§3) says ordinary parsing returns only the root value, so nothing here preserves
// comments or layout beyond what a diagnostic needs.

type document struct {
	declarations []declaration
	root         node
	rootSpan     Span
}

// A declaration is an import, an injection, or a leaflink. They share one namespace (§3).
type declaration struct {
	kind          declarationKind
	name          string
	nameSpan      Span
	span          Span
	value         node   // leaflink only
	target        string // import / inject only
	authenticator node   // import / inject only, may be nil
}

type declarationKind int

const (
	declLeaflink declarationKind = iota
	declImport
	declInject
)

// node is a value in the tree.
type node interface {
	nodeSpan() Span
}

// stringPart is a piece of a string: literal text already escape-decoded, or one interpolation.
type stringPart struct {
	literal string
	interp  *reference // nil when the part is literal
}

type scalarNode struct {
	parts []stringPart
	span  Span
}

type mapNode struct {
	entries []mapEntry
	span    Span
}

type mapEntry struct {
	spread   *reference // when set, this entry is `...#ref`
	key      string
	keySpan  Span
	value    node
	hasValue bool
}

type listNode struct {
	items []listItem
	span  Span
}

type listItem struct {
	spread *reference // when set, this item is `...#ref`
	value  node
}

type structureNode struct {
	fields   []string
	rows     [][]node
	span     Span
	rowSpans []Span
}

type linkNode struct {
	ref  reference
	span Span
}

type callNode struct {
	ref      reference
	args     []callArg
	span     Span
	argsSpan Span // the opening '(' of the argument list, where an argument fault is reported
}

type callArg struct {
	name     string
	nameSpan Span
	value    node
}

type spreadNode struct {
	ref  reference
	span Span
}

// reference is what a link, spread, interpolation, or call names: a head, a chain of accesses, or the
// environment.
type reference struct {
	env    bool // #$NAME
	head   string
	access []accessSegment
	span   Span
}

type accessSegment struct {
	dot     bool
	name    string // for dot access, or a named bracket access
	index   int    // for a numeric bracket access
	byIndex bool
}

func (n *scalarNode) nodeSpan() Span    { return n.span }
func (n *mapNode) nodeSpan() Span       { return n.span }
func (n *listNode) nodeSpan() Span      { return n.span }
func (n *structureNode) nodeSpan() Span { return n.span }
func (n *linkNode) nodeSpan() Span      { return n.span }
func (n *callNode) nodeSpan() Span      { return n.span }
func (n *spreadNode) nodeSpan() Span    { return n.span }
