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

	return decodeInner(raw[start:end], '`')
}

func isTrimmable(r rune) bool { return r == ' ' || r == '\t' || r == '\n' }

// unquoted parses an unquoted string. Section 4.3 describes it as ending at a delimiter "wherever it
// occurs", but the reference reads more than that: a quote inside an unquoted value opens a region that
// is kept as literal source (its own delimiters included) rather than ending the value, so `x'a'y` is
// one string of five characters and `p`q`r` keeps its backticks. Only a comma, a newline, an enclosing
// bracket, or a `#name` link ends the value. What the value spans is recovered as the source between
// its first and last character — comments cut out, inter-word whitespace kept — and then decoded once,
// so an interpolation inside a quote region is still resolved and an escape is still read.
//
// This is a deliberate divergence from §4.3 as written; it matches the reference and is pinned by the
// differential corpus. It is logged as a specification defect in this package's notes.
func (p *parser) unquoted() node {
	start := p.pos
	var raw []rune

	for !p.atEnd() {
		r := p.peek()
		if r == ',' || isNewline(r) || isHardDelimiter(r) {
			break
		}
		// A link (`#name`) is its own value and ends this one; an interpolation (`#{`) is part of it.
		if r == '#' && p.peekAt(1) != '{' {
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

		if r == '\'' || r == '`' {
			p.consumeQuoteRegion(&raw)
			continue
		}
		if p.startsWith("#{") {
			p.consumeInterpolationRaw(&raw)
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
	return &scalarNode{parts: decodeInner(raw, 0), span: p.spanBetween(start, p.pos)}
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

// consumeQuoteRegion copies a quoted region into an unquoted string's raw source, delimiters and all,
// validating only that it is terminated. Its content is decoded later along with the rest of the
// value, so the quote marks survive as literal characters while an interpolation inside is still read.
func (p *parser) consumeQuoteRegion(raw *[]rune) {
	quote := p.peek()
	open := p.pos
	*raw = append(*raw, p.advance()) // opening quote, kept literal
	for {
		if p.atEnd() {
			fail(LexUnterminated, "A string was opened and never closed.", p.spanAt(open))
		}
		r := p.peek()
		if quote == '\'' && isNewline(r) {
			fail(LexUnterminated, "A single-quoted string may not cross a line.", p.spanAt(open))
		}
		if r == '\\' {
			*raw = append(*raw, p.advance())
			if p.atEnd() {
				fail(LexUnterminated, "A string ended in an unfinished escape.", p.spanAt(open))
			}
			*raw = append(*raw, p.advance())
			continue
		}
		if r == quote {
			*raw = append(*raw, p.advance()) // closing quote, kept literal
			return
		}
		*raw = append(*raw, p.advance())
	}
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
// trimming, so this walks a rune slice rather than the live cursor.
func decodeInner(raw []rune, active rune) []stringPart {
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
				literal.WriteString("#{")
				i += 2
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
			ref, consumed := parseInnerReference(raw[i:])
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

// parseInnerReference parses one `#{reference}` out of a run of backtick source and reports how many
// runes it consumed. Backtick strings are decoded from an extracted rune slice rather than the live
// cursor, so the reference parser is run over a fresh cursor on that slice.
func parseInnerReference(raw []rune) (reference, int) {
	sub := newParser(string(raw), "")
	part := sub.interpolation()
	return *part.interp, sub.pos
}

// ensureParts guarantees a scalar always has at least one part, so the empty string is a real value
// and not an absent one.
func ensureParts(parts []stringPart) []stringPart {
	if len(parts) == 0 {
		return []stringPart{{literal: ""}}
	}
	return parts
}
