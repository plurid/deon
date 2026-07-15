package deon

import (
	"strconv"
	"strings"
)

// maxDepth is the nesting limit (specification 11.1). A value nests when it contains another; a
// document that nests more than 128 deep is refused with DEON_PARSE_EXPECTED at the opening token of
// the value that exceeds it. The root is depth 0 and its children are depth 1, so the check is
// against the number of *enclosing* values. 128 is far past any nesting a document has cause to hold,
// and the point of the limit is that a document is data from somewhere that does not wish the reader
// well: a parser that recursed as deeply as asked would exhaust the host stack and fail with no code
// and no position at all.
const maxDepth = 128

// parser is a scannerless recursive-descent parser over the rune stream. There is no separate token
// list: Deon is context-sensitive — a `#` begins a link at a value position and is ordinary text
// inside a word, a `.` navigates a reference and is ordinary inside an unquoted string — and a parser
// that knows its context decides those without a lexer having to guess.
type parser struct {
	runes  []rune
	bytes  []int // byte offset of rune i; bytes[len] is the total byte length, for an EOF span
	line   []int // 1-based line of rune i; line[len] carries the final position
	column []int // 1-based code-point column of rune i
	source string
	pos    int
	depth  int
}

func newParser(text, source string) *parser {
	// CRLF folds to LF before anything else (specification 4.1), so every offset and every string
	// this produces indexes the normalized source.
	normalized := strings.ReplaceAll(text, "\r\n", "\n")
	runes := []rune(normalized)

	p := &parser{
		runes:  runes,
		bytes:  make([]int, len(runes)+1),
		line:   make([]int, len(runes)+1),
		column: make([]int, len(runes)+1),
		source: source,
	}

	offset, ln, col := 0, 1, 1
	for i, r := range runes {
		p.bytes[i] = offset
		p.line[i] = ln
		p.column[i] = col

		offset += utf8Len(r)
		if r == '\n' {
			ln++
			col = 1
		} else {
			col++
		}
	}
	p.bytes[len(runes)] = offset
	p.line[len(runes)] = ln
	p.column[len(runes)] = col

	return p
}

func utf8Len(r rune) int {
	switch {
	case r < 0x80:
		return 1
	case r < 0x800:
		return 2
	case r < 0x10000:
		return 3
	default:
		return 4
	}
}

// #region cursor
func (p *parser) atEnd() bool { return p.pos >= len(p.runes) }

func (p *parser) peek() rune {
	if p.pos >= len(p.runes) {
		return 0
	}
	return p.runes[p.pos]
}

func (p *parser) peekAt(offset int) rune {
	i := p.pos + offset
	if i < 0 || i >= len(p.runes) {
		return 0
	}
	return p.runes[i]
}

func (p *parser) advance() rune {
	r := p.peek()
	p.pos++
	return r
}

func (p *parser) startsWith(prefix string) bool {
	for i, r := range []rune(prefix) {
		if p.peekAt(i) != r {
			return false
		}
	}
	return true
}

// point is a zero-width span at the cursor, for a diagnostic about a character rather than a range.
func (p *parser) point() Span {
	return p.spanAt(p.pos)
}

func (p *parser) spanAt(pos int) Span {
	if pos > len(p.runes) {
		pos = len(p.runes)
	}
	return Span{
		Source:    p.source,
		Start:     p.bytes[pos],
		End:       p.bytes[pos],
		Line:      p.line[pos],
		Column:    p.column[pos],
		EndLine:   p.line[pos],
		EndColumn: p.column[pos],
	}
}

func (p *parser) spanBetween(start, end int) Span {
	return Span{
		Source:    p.source,
		Start:     p.bytes[start],
		End:       p.bytes[end],
		Line:      p.line[start],
		Column:    p.column[start],
		EndLine:   p.line[end],
		EndColumn: p.column[end],
	}
}

// #endregion cursor

// #region character classes
func isSpace(r rune) bool { return r == ' ' || r == '\t' }

func isNewline(r rune) bool { return r == '\n' }

// delimiter reports whether a rune is one of the ten delimiters of section 4.3, which end an unquoted
// string wherever they occur and no surrounding text makes ordinary.
func isDelimiter(r rune) bool {
	switch r {
	case '{', '}', '[', ']', '(', ')', '<', '>', '\'', '`':
		return true
	}
	return false
}

// wordStop reports whether a rune ends an unquoted word: whitespace, a comma, a newline, a delimiter,
// or the end of input.
func (p *parser) wordStop(r rune) bool {
	return r == 0 || isSpace(r) || isNewline(r) || r == ',' || isDelimiter(r)
}

func isNameChar(r rune) bool {
	return r >= 'A' && r <= 'Z' ||
		r >= 'a' && r <= 'z' ||
		r >= '0' && r <= '9' ||
		r == '_' || r == '-'
}

func isDigit(r rune) bool { return r >= '0' && r <= '9' }

// #endregion character classes

// #region trivia
// skipInline consumes spaces, tabs, and comments, but not newlines or commas — used where a newline
// is significant as a separator.
func (p *parser) skipInline() {
	for {
		switch {
		case isSpace(p.peek()):
			p.advance()
		case p.startsWith("//"):
			p.consumeLineComment()
		case p.startsWith("/*"):
			p.consumeBlockComment()
		default:
			return
		}
	}
}

// skipTrivia consumes everything the grammar calls trivia: spaces, tabs, newlines, and comments.
func (p *parser) skipTrivia() {
	for {
		switch {
		case isSpace(p.peek()) || isNewline(p.peek()):
			p.advance()
		case p.startsWith("//"):
			p.consumeLineComment()
		case p.startsWith("/*"):
			p.consumeBlockComment()
		default:
			return
		}
	}
}

func (p *parser) consumeLineComment() {
	p.advance() // /
	p.advance() // /
	for !p.atEnd() && !isNewline(p.peek()) {
		p.advance()
	}
}

func (p *parser) consumeBlockComment() {
	start := p.pos
	p.advance() // /
	p.advance() // *
	for !p.atEnd() {
		if p.peek() == '*' && p.peekAt(1) == '/' {
			p.advance()
			p.advance()
			return
		}
		p.advance()
	}
	fail(LexUnterminated, "A block comment was opened and never closed.", p.spanAt(start))
}

// #endregion trivia

// parseSyntax parses a document into a syntax tree.
func parseSyntax(text, source string) (doc *document, err error) {
	defer recoverError(&err)
	p := newParser(text, source)
	doc = p.document()
	return doc, nil
}

// #region document
func (p *parser) document() *document {
	doc := &document{}
	rootSeen := false

	p.skipTrivia()
	for !p.atEnd() {
		start := p.pos
		if p.consumedKeyword("import") {
			doc.declarations = append(doc.declarations, p.resource(declImport, start))
		} else if p.consumedKeyword("inject") {
			doc.declarations = append(doc.declarations, p.resource(declInject, start))
		} else if p.peek() == '{' || p.peek() == '[' {
			if rootSeen {
				fail(ParseRoot, "A document has exactly one root, and this is a second.", p.point())
			}
			doc.rootSpan = p.point()
			doc.root = p.value()
			rootSeen = true
		} else {
			doc.declarations = append(doc.declarations, p.leaflink())
		}
		p.skipTrivia()
	}

	if !rootSeen {
		// The document ran out with no root value; the fault is at the end of what was read.
		fail(ParseRoot, "A document must have a root map or list, and this has neither.", p.point())
	}

	return doc
}

// consumedKeyword consumes a bare keyword only when it stands alone as a word followed by a space, so
// that a leaflink named `import-map` is not mistaken for an import statement.
func (p *parser) consumedKeyword(word string) bool {
	runes := []rune(word)
	for i, r := range runes {
		if p.peekAt(i) != r {
			return false
		}
	}
	// The character after the keyword must end the word, and be a space rather than a separator: a
	// keyword is always followed by `required-space`.
	if !isSpace(p.peekAt(len(runes))) {
		return false
	}
	p.pos += len(runes)
	p.skipInline()
	return true
}

func (p *parser) leaflink() declaration {
	start := p.pos
	name, nameSpan := p.name()
	p.requiredSpace()
	value := p.value()
	return declaration{
		kind:     declLeaflink,
		name:     name,
		nameSpan: nameSpan,
		span:     p.spanBetween(start, p.pos),
		value:    value,
	}
}

// resource parses an import or injection. start is the position of the leading keyword, so the
// statement span covers `import ...` from its first character — a resource diagnostic is reported
// against the statement, not against the target inside it (§9, §11.2).
func (p *parser) resource(kind declarationKind, start int) declaration {
	name, nameSpan := p.name()
	p.requiredSpace()
	if !p.consumedKeyword("from") {
		fail(ParseExpected, "An import or injection needs 'from' before its target.", p.point())
	}
	target := p.targetWord()

	decl := declaration{
		kind:     kind,
		name:     name,
		nameSpan: nameSpan,
		target:   target,
	}

	// An optional `with authenticator`.
	save := p.pos
	p.skipInline()
	if p.consumedKeyword("with") {
		decl.authenticator = p.value()
	} else {
		p.pos = save
	}

	decl.span = p.spanBetween(start, p.pos)
	return decl
}

// targetWord reads an import/inject target: an unquoted string or a single-quoted string.
func (p *parser) targetWord() string {
	p.skipInline()
	if p.peek() == '\'' {
		parts := p.singleString()
		return literalOf(parts)
	}
	start := p.pos
	var b strings.Builder
	for !p.wordStop(p.peek()) {
		b.WriteRune(p.advance())
	}
	if p.pos == start {
		fail(ParseExpected, "An import or injection needs a target.", p.point())
	}
	return b.String()
}

// #endregion document

// #region names
// name parses a map key or a declaration name (specification 4.4). A single-quoted name admits any
// non-newline character; a bare name is letters, digits, `_`, and `-`. A bare word that is a valid
// string but not a valid name — `a.b` — is DEON_LEX_INVALID at the start of the word, because what is
// wrong is the sequence, not the absence of something the grammar wanted.
func (p *parser) name() (string, Span) {
	start := p.pos
	if p.peek() == '\'' {
		parts := p.singleString()
		return literalOf(parts), p.spanBetween(start, p.pos)
	}

	for !p.wordStop(p.peek()) {
		p.advance()
	}
	if p.pos == start {
		fail(ParseExpected, "A name was expected here.", p.point())
	}

	word := string(p.runes[start:p.pos])
	for _, r := range word {
		if !isNameChar(r) {
			fail(LexInvalid, "'"+word+"' is not a valid name: a name is letters, digits, '_', and '-'.", p.spanAt(start))
		}
	}
	return word, p.spanBetween(start, p.pos)
}

func (p *parser) requiredSpace() {
	if !isSpace(p.peek()) {
		fail(ParseExpected, "A space was expected here.", p.point())
	}
	p.skipInline()
}

// #endregion names

// #region values
func (p *parser) value() node {
	if p.depth > maxDepth {
		fail(ParseExpected, "The document nests more deeply than the parser will follow.", p.point())
	}
	p.depth++
	defer func() { p.depth-- }()

	switch {
	case p.peek() == '{':
		return p.mapValue()
	case p.peek() == '[':
		return p.listValue()
	case p.peek() == '<':
		return p.structure()
	case p.peek() == '#':
		return p.linkOrCall()
	case p.peek() == '\'':
		start := p.pos
		parts := p.singleString()
		return &scalarNode{parts: parts, span: p.spanBetween(start, p.pos)}
	case p.peek() == '`':
		start := p.pos
		parts := p.backtickString()
		return &scalarNode{parts: parts, span: p.spanBetween(start, p.pos)}
	default:
		return p.unquoted()
	}
}

func (p *parser) mapValue() node {
	start := p.pos
	p.advance() // {
	entries := []mapEntry{}

	p.skipTrivia()
	for !p.atEnd() && p.peek() != '}' {
		entries = append(entries, p.mapEntry())
		if !p.entrySeparator('}') {
			break
		}
	}

	p.expect('}', "A map opened with '{' must be closed with '}'.")
	return &mapNode{entries: entries, span: p.spanBetween(start, p.pos)}
}

func (p *parser) mapEntry() mapEntry {
	if p.startsWith("...#") {
		ref := p.spreadReference()
		return mapEntry{spread: &ref}
	}

	// A shortened link or call: `{ #entity.name }` receives at the final access segment (§6).
	if p.peek() == '#' {
		value := p.linkOrCall()
		key := receivingKey(value)
		return mapEntry{key: key, value: value, hasValue: true}
	}

	key, keySpan := p.name()

	// A value follows only across a required space; `{ key }` and `{ key, k2 }` leave the value empty.
	save := p.pos
	p.skipInline()
	if p.atEnd() || p.peek() == ',' || isNewline(p.peek()) || p.peek() == '}' {
		p.pos = save
		return mapEntry{key: key, keySpan: keySpan, value: p.emptyScalar(), hasValue: false}
	}
	value := p.value()
	return mapEntry{key: key, keySpan: keySpan, value: value, hasValue: true}
}

func (p *parser) listValue() node {
	start := p.pos
	p.advance() // [
	items := []listItem{}

	p.skipTrivia()
	for !p.atEnd() && p.peek() != ']' {
		if p.startsWith("...#") {
			ref := p.spreadReference()
			items = append(items, listItem{spread: &ref})
		} else {
			items = append(items, listItem{value: p.value()})
		}
		if !p.entrySeparator(']') {
			break
		}
	}

	p.expect(']', "A list opened with '[' must be closed with ']'.")
	return &listNode{items: items, span: p.spanBetween(start, p.pos)}
}

func (p *parser) structure() node {
	start := p.pos
	p.advance() // <
	fields := []string{}

	p.skipTrivia()
	for !p.atEnd() && p.peek() != '>' {
		name, _ := p.name()
		fields = append(fields, name)
		p.skipInline()
		if p.peek() == ',' {
			p.advance()
			p.skipTrivia()
		} else {
			p.skipTrivia()
		}
	}
	p.expect('>', "A structure signature opened with '<' must be closed with '>'.")

	// A field name may not repeat: two columns writing the same key would make the row a map with one
	// of them lost, so the signature is refused at the structure it heads.
	seenFields := map[string]bool{}
	for _, field := range fields {
		if seenFields[field] {
			fail(StructureArity, "The structure field '"+field+"' is named more than once.", p.spanAt(start))
		}
		seenFields[field] = true
	}

	p.skipTrivia()
	p.expect('[', "A structure signature must be followed by '[' and its rows.")

	rows := [][]node{}
	rowSpans := []Span{}
	p.skipTrivia()
	for !p.atEnd() && p.peek() != ']' {
		rowStart := p.pos
		row := []node{p.value()}
		p.skipInline()
		for p.peek() == ',' {
			p.advance()
			p.skipTrivia()
			row = append(row, p.value())
			p.skipInline()
		}
		if len(row) != len(fields) {
			fail(StructureArity,
				"A structure row must hold "+strconv.Itoa(len(fields))+" cells, and this one holds "+strconv.Itoa(len(row))+".",
				p.spanAt(start))
		}
		rows = append(rows, row)
		rowSpans = append(rowSpans, p.spanBetween(rowStart, p.pos))
		p.skipTrivia()
	}
	p.expect(']', "A structure's rows must be closed with ']'.")

	return &structureNode{fields: fields, rows: rows, rowSpans: rowSpans, span: p.spanBetween(start, p.pos)}
}

// entrySeparator consumes the separator after a map entry or list item: inline trivia, then a run of
// commas and newlines and trivia. It returns false when the container is at its close, so the caller
// stops. A trailing entry needs no separator: `{ a b }` closes with only a space before `}`.
func (p *parser) entrySeparator(closing rune) bool {
	p.skipInline()
	if p.peek() == closing || p.atEnd() {
		return false
	}
	if p.peek() != ',' && !isNewline(p.peek()) {
		// A string opener standing where a separator was due: let the string reader run so an
		// unterminated one is reported as the lexical error it is, at its opening quote. A terminated
		// one falls through to the missing-separator error, anchored at that same opening quote.
		at := p.point()
		if p.peek() == '\'' {
			p.singleString()
			fail(ParseExpected, "Entries are separated by a comma or a newline.", at)
		} else if p.peek() == '`' {
			p.backtickString()
			fail(ParseExpected, "Entries are separated by a comma or a newline.", at)
		}
		fail(ParseExpected, "Entries are separated by a comma or a newline.", p.point())
	}
	for {
		switch {
		case p.peek() == ',':
			p.advance()
		case isSpace(p.peek()) || isNewline(p.peek()):
			p.advance()
		case p.startsWith("//"):
			p.consumeLineComment()
		case p.startsWith("/*"):
			p.consumeBlockComment()
		default:
			return true
		}
	}
}

func (p *parser) expect(r rune, message string) {
	if p.peek() != r {
		fail(ParseExpected, message, p.point())
	}
	p.advance()
}

func (p *parser) emptyScalar() node {
	return &scalarNode{parts: []stringPart{{literal: ""}}, span: p.point()}
}

// #endregion values

// #region references
func (p *parser) linkOrCall() node {
	start := p.pos
	p.advance() // #
	ref := p.reference()

	if p.peek() == '(' {
		argsSpan := p.point() // the '('
		args := p.callArguments()
		return &callNode{ref: ref, args: args, span: p.spanBetween(start, p.pos), argsSpan: argsSpan}
	}
	return &linkNode{ref: ref, span: p.spanBetween(start, p.pos)}
}

func (p *parser) spreadReference() reference {
	start := p.pos
	p.advance() // .
	p.advance() // .
	p.advance() // .
	p.advance() // #
	ref := p.reference()
	// A spread's diagnostic (a list spread into a map, say) is reported at the `...`, the operator that
	// asked for the merge, rather than at the reference it names.
	ref.span = p.spanBetween(start, p.pos)
	return ref
}

func (p *parser) reference() reference {
	start := p.pos

	if p.peek() == '$' {
		p.advance()
		name := p.bareName()
		return reference{env: true, head: name, span: p.spanBetween(start, p.pos)}
	}

	var head string
	if p.peek() == '\'' {
		head = literalOf(p.singleString())
	} else {
		head = p.bareName()
	}

	ref := reference{head: head}
	for {
		switch p.peek() {
		case '.':
			p.advance()
			ref.access = append(ref.access, accessSegment{dot: true, name: p.bareName()})
		case '[':
			p.advance()
			ref.access = append(ref.access, p.bracketAccess())
			p.expect(']', "A bracket access must be closed with ']'.")
		default:
			ref.span = p.spanBetween(start, p.pos)
			return ref
		}
	}
}

func (p *parser) bracketAccess() accessSegment {
	if p.peek() == '\'' {
		return accessSegment{name: literalOf(p.singleString())}
	}
	start := p.pos
	digits := true
	var b strings.Builder
	for p.peek() != ']' && !p.wordStop(p.peek()) {
		r := p.advance()
		if !isDigit(r) {
			digits = false
		}
		b.WriteRune(r)
	}
	text := b.String()
	if text == "" {
		fail(ParseExpected, "A bracket access needs a name or an index.", p.spanAt(start))
	}
	if digits {
		index, _ := strconv.Atoi(text)
		return accessSegment{byIndex: true, index: index, name: text}
	}
	return accessSegment{name: text}
}

func (p *parser) bareName() string {
	start := p.pos
	for isNameChar(p.peek()) {
		p.advance()
	}
	if p.pos == start {
		fail(ParseExpected, "A reference name was expected here.", p.point())
	}
	return string(p.runes[start:p.pos])
}

func (p *parser) callArguments() []callArg {
	p.advance() // (
	args := []callArg{}
	p.skipTrivia()
	for !p.atEnd() && p.peek() != ')' {
		start := p.pos
		name, nameSpan := p.name()
		p.requiredSpace()
		value := p.value()
		args = append(args, callArg{name: name, nameSpan: nameSpan, value: value})
		_ = start
		if !p.entrySeparator(')') {
			break
		}
	}
	p.expect(')', "A call opened with '(' must be closed with ')'.")
	return args
}

// receivingKey is the map key a shortened link or call contributes: the final access segment, or the
// head when there is none (specification 6).
func receivingKey(value node) string {
	var ref reference
	switch n := value.(type) {
	case *linkNode:
		ref = n.ref
	case *callNode:
		ref = n.ref
	default:
		return ""
	}
	if len(ref.access) > 0 {
		return ref.access[len(ref.access)-1].name
	}
	return ref.head
}

// #endregion references

func literalOf(parts []stringPart) string {
	var b strings.Builder
	for _, part := range parts {
		if part.interp == nil {
			b.WriteString(part.literal)
		}
	}
	return b.String()
}
