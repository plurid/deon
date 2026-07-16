package deon

import "strings"

// The three string forms of section 4.3, and the shared escape and interpolation decoding. Every form
// recognizes `#{reference}` interpolation and the minimal escape set; they differ only in how they
// begin and end and in what whitespace they keep.

// singleString parses a single-quoted string, which is confined to one logical line: a raw newline
// before the closing quote is an unterminated string, though an escaped `\n` is content.
func (p *parser) singleString() []stringPart {
	open := p.pos
	p.advance() // '
	var parts []stringPart
	var literal strings.Builder

	flush := func() {
		if literal.Len() > 0 {
			parts = append(parts, stringPart{literal: literal.String()})
			literal.Reset()
		}
	}

	for {
		if p.atEnd() {
			fail(LexUnterminated, "A single-quoted string was opened and never closed.", p.spanAt(open))
		}
		r := p.peek()
		switch {
		case r == '\'':
			p.advance()
			flush()
			return ensureParts(parts)
		case isNewline(r):
			fail(LexUnterminated, "A single-quoted string may not cross a line.", p.spanAt(open))
		case r == '\\':
			literal.WriteString(p.decodeEscape('\''))
		case p.startsWith("#{"):
			flush()
			parts = append(parts, p.interpolation())
		default:
			literal.WriteRune(p.advance())
		}
	}
}

// singleName parses a single-quoted name (§4.4). It is lexed exactly like a single-quoted string —
// confined to one logical line, sharing the same escapes so `\\`, `\'`, `\n`, `\r`, `\t`, and `\#{`
// decode identically — with the one difference the grammar draws (quoted-name in deon.ebnf): a name is
// never interpolated, so a `#{` is not an interpolation opener here but two ordinary characters. The
// key written `'a#{n}'` is therefore the literal name `a#{n}`, never a lookup of `n` and never the
// truncated `a`, and matches the escaped spelling `'a\#{n}'`, whose `\#{` decodes to a literal `#{`.
func (p *parser) singleName() string {
	open := p.pos
	p.advance() // '
	var b strings.Builder

	for {
		if p.atEnd() {
			fail(LexUnterminated, "A single-quoted string was opened and never closed.", p.spanAt(open))
		}
		r := p.peek()
		switch {
		case r == '\'':
			p.advance()
			return b.String()
		case isNewline(r):
			fail(LexUnterminated, "A single-quoted string may not cross a line.", p.spanAt(open))
		case r == '\\':
			b.WriteString(p.decodeEscape('\''))
		default:
			b.WriteRune(p.advance())
		}
	}
}

// backtickString parses a backtick string, which may span lines. Boundary whitespace is removed
// through the first and last non-whitespace character; the trimming is of the *source* text, before
// escapes are decoded, so an escaped line break is content and is never trimmed.
func (p *parser) backtickString() []stringPart {
	open := p.pos
	p.advance() // `

	// Collect the raw inner runes, respecting escapes only enough to find the true closing backtick.
	var raw []rune
	for {
		if p.atEnd() {
			fail(LexUnterminated, "A backtick string was opened and never closed.", p.spanAt(open))
		}
		r := p.peek()
		if r == '`' {
			p.advance()
			break
		}
		if r == '\\' {
			raw = append(raw, p.advance())
			if p.atEnd() {
				fail(LexUnterminated, "A backtick string ended in an unfinished escape.", p.spanAt(open))
			}
			raw = append(raw, p.advance())
			continue
		}
		raw = append(raw, p.advance())
	}

	// Trim boundary whitespace of the source text. A backslash is not whitespace, so `\n` at an edge
	// survives.
	start, end := 0, len(raw)
	for start < end && isTrimmable(raw[start]) {
		start++
	}
	for end > start && isTrimmable(raw[end-1]) {
		end--
	}

	return decodeInner(raw[start:end], '`', p.spanBetween(open, p.pos))
}

func isTrimmable(r rune) bool { return r == ' ' || r == '\t' || r == '\n' }

// unquoted parses an unquoted string (section 4.3): a value that does not begin with a quote. It ends
// only at an unnested comma, a newline, an enclosing bracket, or a `#` that starts a link at a token
// boundary — the value's first character (routed away by the caller's dispatch) or a `#` after
// separating whitespace (stopped by unquotedContinues). Everywhere else a `'`, a backtick, and a `#`
// are ordinary literal content: `x'q'y` is five characters, `p`q`r` keeps its backticks, and `x#y`
// keeps its `#`. A `#{` opens an interpolation wherever it appears. What the value spans is recovered
// as the source between its first and last character — comments cut out, inter-word whitespace kept —
// and decoded once, so an interpolation is resolved and an escape is read in the same pass.
func (p *parser) unquoted() node {
	start := p.pos
	var raw []rune

	for !p.atEnd() {
		r := p.peek()
		if r == ',' || isNewline(r) || isHardDelimiter(r) {
			break
		}

		if isSpace(r) {
			save := p.pos
			spaces := p.interWord()
			if p.unquotedContinues() {
				raw = append(raw, []rune(spaces)...)
				continue
			}
			// Trailing whitespace belongs to the separator, not to the value: give it back.
			p.pos = save
			break
		}

		// `#{` opens an interpolation wherever it appears, the value's first character included; a `#`
		// that does not open one (`x#y`, `word#`) is ordinary literal text and falls to the default
		// below. A `#` that starts a link only does so at a token boundary, which never reaches here:
		// at the value's start the caller's dispatch routes it away, and after whitespace
		// unquotedContinues stops the value before the `#` is read.
		if p.startsWith("#{") {
			p.consumeInterpolationRaw(&raw)
			continue
		}
		// `\#{` opens an escaped interpolation (§4.3, §10): it is written and lexed exactly as the
		// `#{...}` it mirrors, so its closing `}` is read into the word rather than ending it, but its
		// characters are kept literally when the raw is decoded. Without a clean single-line close it is
		// the plain escape for a literal `#{`, which the decode pass produces from the `\#{` left here.
		if p.startsWith("\\#{") {
			p.consumeEscapedInterpolationRaw(&raw)
			continue
		}
		if r == '\\' {
			// A backslash takes the character after it, so an escaped delimiter does not end anything;
			// both characters are kept raw for the single decode pass below.
			raw = append(raw, p.advance())
			if !p.atEnd() {
				raw = append(raw, p.advance())
			}
			continue
		}
		raw = append(raw, p.advance())
	}

	if len(raw) == 0 {
		fail(ParseExpected, "A value was expected here.", p.spanAt(start))
	}
	return &scalarNode{parts: decodeInner(raw, 0, p.spanBetween(start, p.pos)), span: p.spanBetween(start, p.pos)}
}

// unquotedContinues reports whether, after inter-word whitespace, the unquoted value goes on — it does
// unless the next character ends it: the end of input, a comma, a newline, an enclosing bracket, or a
// `#name` link.
func (p *parser) unquotedContinues() bool {
	if p.atEnd() {
		return false
	}
	r := p.peek()
	if r == ',' || isNewline(r) || isHardDelimiter(r) {
		return false
	}
	if r == '#' && p.peekAt(1) != '{' {
		return false
	}
	return true
}

// consumeInterpolationRaw copies a `#{ ... }` opener and its reference into the raw source, so the one
// decode pass reads it as an interpolation. It may not cross a line.
func (p *parser) consumeInterpolationRaw(raw *[]rune) {
	open := p.pos
	*raw = append(*raw, p.advance(), p.advance()) // #{
	for {
		if p.atEnd() || isNewline(p.peek()) {
			fail(LexUnterminated, "An interpolation was opened and never closed.", p.spanAt(open))
		}
		if p.peek() == '}' {
			*raw = append(*raw, p.advance())
			return
		}
		*raw = append(*raw, p.advance())
	}
}

// consumeEscapedInterpolationRaw copies `\#{...}` into the raw source so the closing `}` of a
// well-formed escaped interpolation is read into the word rather than ending it. It takes `\#{`, a
// reference with no interior whitespace, and a closing `}`. When no `}` closes it on the line — a
// space, a comma, a newline, a non-reference delimiter, or the value's end comes first — only `\#{`
// is taken; that escape decodes to a literal `#{` and the rest is read as ordinary text (§4.3, §10).
// Whether the reference is well-formed, and an empty one an error, is decided when the raw is decoded,
// so an escaped interpolation faults exactly where the real interpolation it mirrors would.
func (p *parser) consumeEscapedInterpolationRaw(raw *[]rune) {
	*raw = append(*raw, p.advance(), p.advance(), p.advance()) // \ # {
	for !p.atEnd() {
		r := p.peek()
		if r == '}' {
			*raw = append(*raw, p.advance())
			return
		}
		if isSpace(r) || isNewline(r) || r == ',' || isNonReferenceDelimiter(r) {
			return
		}
		*raw = append(*raw, p.advance())
	}
}

// isNonReferenceDelimiter reports the bracketing delimiters that cannot occur in a reference and so
// end an escaped interpolation's scan without closing it. `[` and `]` are excluded because a bracket
// access is part of a reference; `}` is handled by the caller as the closer.
func isNonReferenceDelimiter(r rune) bool {
	switch r {
	case '{', '(', ')', '<', '>':
		return true
	}
	return false
}

func isHardDelimiter(r rune) bool {
	switch r {
	case '{', '}', '[', ']', '(', ')', '<', '>':
		return true
	}
	return false
}

// interWord consumes the whitespace between two words, dropping any comment written in it and keeping
// the surrounding spaces. A newline is not inter-word whitespace — it ends the unquoted string — so
// this stops at one.
func (p *parser) interWord() string {
	var b strings.Builder
	for {
		switch {
		case isSpace(p.peek()):
			b.WriteRune(p.advance())
		case p.startsWith("//"):
			p.consumeLineComment()
		case p.startsWith("/*"):
			p.consumeBlockComment()
		default:
			return b.String()
		}
	}
}

// interpolation parses `#{reference}` and returns it as a part to be resolved at evaluation.
func (p *parser) interpolation() stringPart {
	p.advance() // #
	p.advance() // {
	ref := p.reference()
	p.expect('}', "An interpolation opened with '#{' must be closed with '}'.")
	return stringPart{interp: &ref}
}

// decodeEscape decodes a backslash sequence at the cursor. The active quote is the string's own
// delimiter — `'`, “ ` “, or 0 for an unquoted string — so that `\'` is a quote inside a single
// string and preserved verbatim outside one. Every sequence the specification does not name is kept
// as its two literal characters.
func (p *parser) decodeEscape(active rune) string {
	open := p.pos
	p.advance() // backslash
	if p.atEnd() {
		fail(LexUnterminated, "A string ended in an unfinished escape.", p.spanAt(open))
	}

	r := p.peek()
	switch {
	case r == '\\':
		p.advance()
		return "\\"
	case active != 0 && r == active:
		p.advance()
		return string(active)
	case r == '#' && p.peekAt(1) == '{':
		p.advance()
		p.advance()
		return "#{"
	case r == 'n':
		p.advance()
		return "\n"
	case r == 'r':
		p.advance()
		return "\r"
	case r == 't':
		p.advance()
		return "\t"
	default:
		// Preserved literally: the backslash and whatever followed it.
		p.advance()
		return "\\" + string(r)
	}
}

// decodeInner decodes an already-extracted run of backtick source (the runes between the trimmed
// boundaries) into parts, honoring escapes and interpolation. Backtick strings are decoded after
// trimming, so this walks a rune slice rather than the live cursor. carrier is the source span of the
// string that carries these parts; a malformed interpolation's diagnostic is anchored there rather
// than at a position inside the reference (§11.2), which was recovered by decoding and has no source
// position of its own.
func decodeInner(raw []rune, active rune, carrier Span) []stringPart {
	var parts []stringPart
	var literal strings.Builder
	flush := func() {
		if literal.Len() > 0 {
			parts = append(parts, stringPart{literal: literal.String()})
			literal.Reset()
		}
	}

	i := 0
	peek := func(k int) rune {
		if i+k < len(raw) {
			return raw[i+k]
		}
		return 0
	}

	for i < len(raw) {
		r := raw[i]
		switch {
		case r == '\\':
			i++
			if i >= len(raw) {
				literal.WriteRune('\\')
				break
			}
			next := raw[i]
			switch {
			case next == '\\':
				literal.WriteRune('\\')
				i++
			case active != 0 && next == active:
				literal.WriteRune(active)
				i++
			case next == '#' && peek(1) == '{':
				// `\#{...}` is an escaped interpolation: lexed exactly as the `#{...}` it mirrors — its
				// reference validated, an empty or whitespace one reported as the same DEON_PARSE_EXPECTED
				// at the same position a real interpolation gives — but the characters `#{...}` are kept
				// literally rather than resolved (§4.3, §10). With no clean close on the line the `\#{` is
				// the plain escape for a literal `#{`.
				if n := escapedInterpolationLength(raw[i:]); n > 0 {
					parseInnerReference(raw[i:i+n], carrier) // validate; raises on a bad reference at the carrying string
					literal.WriteString(string(raw[i : i+n]))
					i += n
				} else {
					literal.WriteString("#{")
					i += 2
				}
			case next == 'n':
				literal.WriteRune('\n')
				i++
			case next == 'r':
				literal.WriteRune('\r')
				i++
			case next == 't':
				literal.WriteRune('\t')
				i++
			default:
				literal.WriteRune('\\')
				literal.WriteRune(next)
				i++
			}
		case r == '#' && peek(1) == '{':
			flush()
			ref, consumed := parseInnerReference(raw[i:], carrier)
			parts = append(parts, stringPart{interp: &ref})
			i += consumed
		default:
			literal.WriteRune(r)
			i++
		}
	}

	flush()
	return ensureParts(parts)
}

// escapedInterpolationLength reports the length of a `#{reference}` at the front of raw — the opener,
// the reference, and the closing `}` — or 0 when no `}` closes it before a whitespace character or the
// end. It decides only where an escaped interpolation ends; whether the reference between the braces
// is well-formed is decided by decoding it, exactly as for a real interpolation. raw begins with `#{`.
func escapedInterpolationLength(raw []rune) int {
	for j := 2; j < len(raw); j++ {
		switch raw[j] {
		case '}':
			return j + 1
		case ' ', '\t', '\n', '\r':
			return 0
		}
	}
	return 0
}

// parseInnerReference parses one `#{reference}` out of a run of string source and reports how many
// runes it consumed. A carrying string is decoded from an extracted rune slice rather than the live
// cursor, so the reference parser is run over a fresh cursor on that slice. That fresh cursor's
// offsets are its own, not the document's, so a fault it raises is re-anchored onto carrier — the span
// of the string that carries the interpolation (§11.2).
func parseInnerReference(raw []rune, carrier Span) (reference, int) {
	sub := newParser(string(raw), "")
	defer reanchorInterpolationFault(carrier)
	part := sub.interpolation()
	return *part.interp, sub.pos
}

// reanchorInterpolationFault re-raises a reference fault at the carrying string's span. Per §11.2 an
// interpolation's diagnostic is at the string that carries it, not at a position inside the reference:
// the reference was recovered by decoding and has no source position of its own, so the sub-parser's
// own (document-external) offset is not a real position and must not be reported. Deferred around the
// sub-parser that reads a reference, this moves any raised fault onto the carrier the caller supplies
// and leaves a genuine host panic — anything not an *Error — to propagate unchanged.
func reanchorInterpolationFault(carrier Span) {
	if raised := recover(); raised != nil {
		if deonErr, ok := raised.(*Error); ok {
			for i := range deonErr.Diagnostics {
				deonErr.Diagnostics[i].Span = carrier
			}
		}
		panic(raised)
	}
}

// ensureParts guarantees a scalar always has at least one part, so the empty string is a real value
// and not an absent one.
func ensureParts(parts []stringPart) []stringPart {
	if len(parts) == 0 {
		return []stringPart{{literal: ""}}
	}
	return parts
}
