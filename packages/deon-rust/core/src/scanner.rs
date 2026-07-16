//! Source text into tokens.

use std::rc::Rc;

use crate::diagnostic::{err, DResult, DiagnosticCode, Span};
use crate::syntax::{Access, Reference};
use crate::text::is_control;
use crate::token::{Literal, Token, TokenType};

/// Stands in for an escaped `#{`, so that the interpolator, which runs later and over the evaluated
/// string, does not mistake it for an interpolation to resolve.
pub const ESCAPED_INTERPOLATION: &str = "\u{0}deon-interpolation\u{0}";

/// Finalizes a decoded name, turning the escaped-interpolation sentinel back into the literal `#{`
/// it stands for. A name — a map key, a declaration or argument name, a structure field, a reference
/// head, or a bracket-access key — is never interpolated (§4.4), so unlike a string value it has no
/// later interpolation pass to undo the sentinel; it is undone here, the instant the name is fixed,
/// so a name can never carry the sentinel out. Both `'a#{n}'` and `'a\#{n}'` name the same literal
/// `a#{n}`. The replace is a no-op for a name that carried no escaped interpolation.
pub fn finalize_name(name: &str) -> String {
    name.replace(ESCAPED_INTERPOLATION, "#{")
}

/// A character that ends the head or a dot segment of a reference. A `.` or `[` continues the
/// reference into another segment and is handled by the caller, so neither ends a name here.
fn ends_reference_name(character: char) -> bool {
    matches!(
        character,
        ' ' | '\t' | '\r' | '\n' | ',' | '{' | '}' | '(' | ')' | '<' | '>' | ']'
    )
}

/// A character that ends the content of a bracket access. Whitespace inside a bracket ends the
/// segment — a space before the `]` is therefore an error, not part of the key — as does any
/// grouping delimiter or quote. A `.` does not, so `[1.0]` reads the key `1.0` (specification 6).
fn ends_bracket_content(character: char) -> bool {
    matches!(
        character,
        ' ' | '\t'
            | '\r'
            | '\n'
            | ','
            | '{'
            | '}'
            | '['
            | '('
            | ')'
            | '<'
            | '>'
            | '\''
            | '`'
    )
}

/// A reference name character, matching `is_bare_name`: letters, digits, `_`, and `-`.
fn is_reference_name(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_' || character == '-'
}

/// Classifies the already-extracted content of a bracket access into a key or an index. Quoted
/// content is a decoded key; an all-decimal-digit run is an index read as the integer (leading zeros
/// permitted, `None` on overflow); anything else is the exact characters as a key (specification 6).
fn classify_bracket(content: &str) -> Access {
    if content.len() >= 2 && content.starts_with('\'') && content.ends_with('\'') {
        return Access::Key(finalize_name(&decode_minimal(
            &content[1..content.len() - 1],
            Some('\''),
        )));
    }

    if !content.is_empty() && content.bytes().all(|byte| byte.is_ascii_digit()) {
        return Access::Index {
            index: content.parse::<usize>().ok(),
            text: content.to_string(),
        };
    }

    Access::Key(content.to_string())
}

/// Reports whether the reference inside a `#{...}` interpolation is malformed against the reference
/// grammar (§6, §10), which forbids surrounding whitespace and an empty reference. Returns `true`
/// when the reference is ill-formed and `false` when it is well-formed.
///
/// It answers only *whether* the reference is faulty, never *where*: by §11.2 an interpolation's
/// diagnostic is anchored at the string that carries it, because the reference within was recovered
/// by decoding and has no source position of its own. The caller positions the fault at the carrying
/// string's start, so this validation carries no column.
fn interpolation_fault(inner: &str) -> bool {
    let characters: Vec<char> = inner.chars().collect();
    let mut index = 0;

    // The head: an environment name, a quoted name, or a bare-name run. It may not be empty and may
    // not be preceded by whitespace, so a fault here is column 3.
    match characters.first() {
        Some('$') => {
            index += 1;
            let start = index;
            while index < characters.len() && is_reference_name(characters[index]) {
                index += 1;
            }
            if index == start {
                return true;
            }
        }
        Some('\'') => {
            index += 1;
            while index < characters.len() && characters[index] != '\'' {
                if characters[index] == '\\' && index + 1 < characters.len() {
                    index += 1;
                }
                index += 1;
            }
            if characters.get(index) != Some(&'\'') {
                return true;
            }
            index += 1;
        }
        _ => {
            let start = index;
            while index < characters.len() && is_reference_name(characters[index]) {
                index += 1;
            }
            if index == start {
                return true;
            }
        }
    }

    // The access segments.
    while index < characters.len() {
        match characters[index] {
            '.' => {
                index += 1;
                let start = index;
                while index < characters.len() && is_reference_name(characters[index]) {
                    index += 1;
                }
                if index == start {
                    return true;
                }
            }
            '[' => {
                index += 1;
                if characters.get(index) == Some(&'\'') {
                    index += 1;
                    while index < characters.len() && characters[index] != '\'' {
                        if characters[index] == '\\' && index + 1 < characters.len() {
                            index += 1;
                        }
                        index += 1;
                    }
                    if characters.get(index) != Some(&'\'') {
                        return true;
                    }
                    index += 1;
                } else {
                    let start = index;
                    while index < characters.len()
                        && characters[index] != ']'
                        && !ends_bracket_content(characters[index])
                    {
                        index += 1;
                    }
                    if index == start {
                        return true;
                    }
                }
                if characters.get(index) != Some(&']') {
                    return true;
                }
                index += 1;
            }
            // Anything else where a segment or the end was due: the `}` was expected here.
            _ => return true,
        }
    }

    false
}

/// A newline, a carriage return, or a tab that a string could not otherwise carry: an unquoted
/// string ends at a newline, a singlequoted one cannot cross one, and a backticked one trims the
/// whitespace at its boundaries. Without these, a value such as `alpha` followed by a newline could
/// not be written down at all.
fn control_escape(character: char) -> Option<char> {
    match character {
        'n' => Some('\n'),
        'r' => Some('\r'),
        't' => Some('\t'),
        _ => None,
    }
}

fn punctuation(character: char) -> Option<TokenType> {
    match character {
        '[' => Some(TokenType::LeftSquare),
        ']' => Some(TokenType::RightSquare),
        '{' => Some(TokenType::LeftCurly),
        '}' => Some(TokenType::RightCurly),
        '(' => Some(TokenType::LeftParen),
        ')' => Some(TokenType::RightParen),
        '<' => Some(TokenType::LeftAngle),
        '>' => Some(TokenType::RightAngle),
        ',' => Some(TokenType::Comma),
        _ => None,
    }
}

fn keyword(lexeme: &str) -> Option<TokenType> {
    match lexeme {
        "import" => Some(TokenType::Import),
        "inject" => Some(TokenType::Inject),
        "from" => Some(TokenType::From),
        "with" => Some(TokenType::With),
        _ => None,
    }
}

/// The outcome of reading a `\u{…}` escape (§4.3).
enum UnicodeEscape {
    /// A well-formed escape: the scalar value it names, and the count of characters it spans from the
    /// backslash through the closing brace, so the reader can consume the whole of it.
    Decoded { value: char, length: usize },
    /// An empty pair, a non-hexadecimal character before the brace, more than six digits, a surrogate,
    /// or a value beyond `U+10FFFF`.
    Invalid,
    /// The input ended before the closing brace.
    Unterminated,
}

/// Reads a `\u{…}` escape whose backslash the caller is sitting on. `at(offset)` yields the character
/// `offset` positions past the backslash, or `None` at the end of input; the caller guarantees that
/// `at(0)` is the backslash, `at(1)` is `u`, and `at(2)` is `{`.
///
/// The braces hold one to six hexadecimal digits, read case-insensitively, naming a Unicode scalar
/// value — at most `U+10FFFF` and never a surrogate `U+D800`–`U+DFFF`, both of which `char::from_u32`
/// already refuses (§4.3).
fn read_unicode_escape(at: impl Fn(usize) -> Option<char>) -> UnicodeEscape {
    let mut offset = 3;
    let mut digits = String::new();

    loop {
        match at(offset) {
            None => return UnicodeEscape::Unterminated,
            Some('}') => break,
            Some(character) if character.is_ascii_hexdigit() => {
                digits.push(character);
                offset += 1;
            }
            Some(_) => return UnicodeEscape::Invalid,
        }
    }

    if digits.is_empty() || digits.len() > 6 {
        return UnicodeEscape::Invalid;
    }

    match u32::from_str_radix(&digits, 16).ok().and_then(char::from_u32) {
        Some(value) => UnicodeEscape::Decoded {
            value,
            length: offset + 1,
        },
        None => UnicodeEscape::Invalid,
    }
}

/// Decodes the escapes of a string. `delimiter` is the quote the string was written in, if any: a
/// backslash before it means the quote itself, rather than the end of the string.
///
/// Every other backslash is kept as it is written.
pub fn decode_minimal(raw: &str, delimiter: Option<char>) -> String {
    let characters: Vec<char> = raw.chars().collect();
    let mut value = String::with_capacity(raw.len());
    let mut index = 0;

    while index < characters.len() {
        if characters[index] == '\\'
            && characters.get(index + 1) == Some(&'#')
            && characters.get(index + 2) == Some(&'{')
        {
            value.push_str(ESCAPED_INTERPOLATION);
            index += 3;
            continue;
        }

        // A `\u{…}` escape names a Unicode scalar value (§4.3). The scanner has already validated
        // every escape at its source position, so only a well-formed one is decoded here; a malformed
        // one that reaches this infallible reader is left as its literal characters rather than
        // panicked on.
        if characters[index] == '\\'
            && characters.get(index + 1) == Some(&'u')
            && characters.get(index + 2) == Some(&'{')
        {
            if let UnicodeEscape::Decoded { value: scalar, length } =
                read_unicode_escape(|offset| characters.get(index + offset).copied())
            {
                value.push(scalar);
                index += length;
                continue;
            }
        }

        if characters[index] == '\\' && index + 1 < characters.len() {
            let next = characters[index + 1];

            if next == '\\' || delimiter == Some(next) {
                value.push(next);
                index += 2;
                continue;
            }

            if let Some(control) = control_escape(next) {
                value.push(control);
                index += 2;
                continue;
            }
        }

        value.push(characters[index]);
        index += 1;
    }

    value
}

/// Reads the text of a link into the head and the segments it navigates: `entity.name`,
/// `entity[name]`, `items[0]`, or the environment `$NAME`. A quoted head may hold any character.
///
/// This is the infallible reader, used where the reference has already been validated — the inner
/// text of an interpolation, whose faults are caught where the string is scanned. The scanner's own
/// [`Scanner::reference`] is the fallible one, which reports the position of a malformed segment.
pub fn parse_reference(raw: &str) -> Reference {
    let characters: Vec<char> = raw.chars().collect();
    let mut index = 0;

    let head = if characters.first() == Some(&'\'') {
        index += 1;

        // Decoded and finalized exactly as a singlequoted name is, so that a declaration and a link
        // to it agree on what the name is.
        let mut quoted = String::new();

        while index < characters.len() && characters[index] != '\'' {
            if characters[index] == '\\' && index + 1 < characters.len() {
                quoted.push(characters[index]);
                quoted.push(characters[index + 1]);
                index += 2;
                continue;
            }

            quoted.push(characters[index]);
            index += 1;
        }

        if characters.get(index) == Some(&'\'') {
            index += 1;
        }

        finalize_name(&decode_minimal(&quoted, Some('\'')))
    } else {
        let start = index;

        while index < characters.len() && characters[index] != '.' && characters[index] != '[' {
            index += 1;
        }

        characters[start..index].iter().collect()
    };

    let mut access: Vec<Access> = Vec::new();

    while index < characters.len() {
        if characters[index] == '.' {
            index += 1;

            let start = index;

            while index < characters.len() && characters[index] != '.' && characters[index] != '[' {
                index += 1;
            }

            access.push(Access::Key(characters[start..index].iter().collect()));
            continue;
        }

        if characters[index] == '[' {
            let closing = characters[index + 1..]
                .iter()
                .position(|character| *character == ']')
                .map(|at| index + 1 + at);

            let Some(closing) = closing else {
                let content: String = characters[index + 1..].iter().collect();
                access.push(classify_bracket(&content));
                break;
            };

            let content: String = characters[index + 1..closing].iter().collect();
            access.push(classify_bracket(&content));

            index = closing + 1;
            continue;
        }

        index += 1;
    }

    Reference { head, access }
}

pub struct Scanner {
    /// The source with `\r\n` folded to `\n`, so that a position means one thing. Every offset a
    /// diagnostic carries indexes *this*, rather than the bytes the caller handed over.
    source: String,

    /// Every character with the byte offset it starts at. The scanner indexes this by code point and
    /// slices the source by byte, which is what keeps a position countable and a non-ASCII document
    /// readable at the same time.
    characters: Vec<(usize, char)>,

    source_name: Rc<str>,
    tokens: Vec<Token>,
    current: usize,
    line: usize,
    column: usize,

    /// The whitespace read since the last token. A value written across several tokens is put back
    /// together from these, so `two words` keeps its single space.
    leading: String,
}

impl Scanner {
    pub fn new(source: &str, source_name: &str) -> Self {
        let source = source.replace("\r\n", "\n");
        let characters = source.char_indices().collect();

        Self {
            source,
            characters,
            source_name: Rc::from(source_name),
            tokens: Vec::new(),
            current: 0,
            line: 1,
            column: 1,
            leading: String::new(),
        }
    }

    pub fn scan(mut self) -> DResult<Vec<Token>> {
        self.reject_raw_controls()?;

        while !self.at_end() {
            self.scan_token()?;
        }

        let span = self.span(self.current, self.line, self.column);

        self.tokens.push(Token {
            ty: TokenType::Eof,
            lexeme: String::new(),
            literal: Literal::None,
            span,
            leading: std::mem::take(&mut self.leading),
        });

        Ok(self.tokens)
    }

    /// A control character has no literal form anywhere in the source — inside a string, inside a
    /// comment, or in the whitespace between tokens — so the whole source is swept for one before a
    /// token is read, and a raw control is `DEON_LEX_INVALID` at its own position (§4.3). Sweeping up
    /// front means every context is covered by one rule, and the position is exact because the sweep
    /// counts lines and columns the way the scanner itself does, over the same normalized source.
    fn reject_raw_controls(&self) -> DResult<()> {
        let mut line = 1;
        let mut column = 1;

        for (at, (_, character)) in self.characters.iter().enumerate() {
            if is_control(*character) {
                return err(
                    DiagnosticCode::LexInvalid,
                    "A control character has no literal form; write it as a '\\u{…}' escape.",
                    &self.span(at, line, column),
                );
            }

            if *character == '\n' {
                line += 1;
                column = 1;
            } else {
                column += 1;
            }
        }

        Ok(())
    }

    /// The cursor sits on the backslash of a `\u{…}` escape (`peek(0)` is `\`, `peek(1)` is `u`,
    /// `peek(2)` is `{`). Validates and consumes the whole escape, or fails at the backslash: a
    /// malformed escape is `DEON_LEX_INVALID` and one that runs off the end before its closing brace
    /// is `DEON_LEX_UNTERMINATED`, both anchored where the escape began (§4.3). On success the escape's
    /// characters are consumed and left in the source run for `decode_minimal` to turn into the scalar.
    fn consume_unicode_escape(&mut self, at: usize, line: usize, column: usize) -> DResult<()> {
        match read_unicode_escape(|offset| {
            self.characters.get(self.current + offset).map(|(_, c)| *c)
        }) {
            UnicodeEscape::Decoded { length, .. } => {
                for _ in 0..length {
                    self.advance();
                }

                Ok(())
            }
            UnicodeEscape::Invalid => self.fail(
                DiagnosticCode::LexInvalid,
                "A Unicode escape names a scalar value as one to six hexadecimal digits, at most U+10FFFF and never a surrogate.",
                at,
                line,
                column,
            ),
            UnicodeEscape::Unterminated => self.fail(
                DiagnosticCode::LexUnterminated,
                "A Unicode escape must be closed with '}'.",
                at,
                line,
                column,
            ),
        }
    }

    fn scan_token(&mut self) -> DResult<()> {
        let start = self.current;
        let line = self.line;
        let column = self.column;
        let character = self.advance();

        if character == ' ' || character == '\t' || character == '\r' {
            self.leading.push(character);
            return Ok(());
        }

        if character == '\n' {
            self.add(TokenType::Newline, Literal::None, start, line, column);
            return Ok(());
        }

        if character == '/' && self.peek(0) == '/' {
            while !self.at_end() && self.peek(0) != '\n' {
                self.advance();
            }

            return Ok(());
        }

        if character == '/' && self.peek(0) == '*' {
            self.advance();
            return self.block_comment(start, line, column);
        }

        if character == '.' && self.peek(0) == '.' && self.peek(1) == '.' && self.peek(2) == '#' {
            self.advance();
            self.advance();
            self.advance();

            return self.reference(TokenType::Spread, start, line, column);
        }

        if character == '#' && self.peek(0) == '{' {
            return self.interpolation(start, line, column);
        }

        if character == '#' {
            return self.reference(TokenType::Link, start, line, column);
        }

        if let Some(punctuation) = punctuation(character) {
            self.add(punctuation, Literal::None, start, line, column);
            return Ok(());
        }

        if character == '\'' || character == '`' {
            return self.string(character, start, line, column);
        }

        self.bare(start, line, column)
    }

    fn block_comment(&mut self, start: usize, line: usize, column: usize) -> DResult<()> {
        while !self.at_end() {
            if self.peek(0) == '*' && self.peek(1) == '/' {
                break;
            }

            self.advance();
        }

        if self.at_end() {
            return self.fail(
                DiagnosticCode::LexUnterminated,
                "Unterminated block comment.",
                start,
                line,
                column,
            );
        }

        self.advance();
        self.advance();

        Ok(())
    }

    fn interpolation(&mut self, start: usize, line: usize, column: usize) -> DResult<()> {
        self.advance();

        while !self.at_end() && self.peek(0) != '}' {
            self.advance();
        }

        if self.at_end() {
            return self.fail(
                DiagnosticCode::LexUnterminated,
                "Unterminated interpolation.",
                start,
                line,
                column,
            );
        }

        self.advance();

        let lexeme = self.slice(start, self.current).to_string();

        // The reference between the braces must be a well-formed reference with no surrounding
        // whitespace (specification 10). A fault has no position of its own inside the braces: by
        // §11.2 the diagnostic is anchored at the string that carries the interpolation, which for a
        // standalone one is this token itself, so it points at the `#{`'s own start.
        if interpolation_fault(&lexeme[2..lexeme.len() - 1]) {
            return err(
                DiagnosticCode::ParseExpected,
                "An interpolation needs a reference immediately between its braces.",
                &self.span(start, line, column),
            );
        }

        self.add(
            TokenType::Interpolate,
            Literal::String(lexeme),
            start,
            line,
            column,
        );

        Ok(())
    }

    /// The source characters are collected with their escapes intact, so that a backticked string
    /// trims the whitespace of its layout without touching a newline that was written as an escape.
    fn string(
        &mut self,
        delimiter: char,
        start: usize,
        line: usize,
        column: usize,
    ) -> DResult<()> {
        let mut raw = String::new();

        while !self.at_end() {
            let character = self.peek(0);

            if character == delimiter {
                self.advance();

                // A backtick trims the ASCII whitespace of its layout (§4.1) — a space, tab, line
                // feed, or carriage return — and nothing else: a Unicode space such as U+00A0 at a
                // boundary is content and is kept, so the value reads back exactly as it was written.
                let content = if delimiter == '`' {
                    raw.trim_matches(|c: char| matches!(c, ' ' | '\t' | '\n' | '\r'))
                } else {
                    &raw
                };

                self.add(
                    TokenType::String,
                    Literal::String(decode_minimal(content, Some(delimiter))),
                    start,
                    line,
                    column,
                );

                return Ok(());
            }

            if delimiter == '\'' && character == '\n' {
                return self.unterminated_quote(start, line, column);
            }

            // A `\u{…}` escape is validated at the backslash and consumed whole, so a malformed one
            // fails there rather than being kept as literal text; its characters stay in `raw` for
            // `decode_minimal` to turn into the scalar (§4.3).
            if character == '\\' && self.peek(1) == 'u' && self.peek(2) == '{' {
                let before = self.current;
                self.consume_unicode_escape(before, self.line, self.column)?;
                raw.push_str(self.slice(before, self.current));
                continue;
            }

            // An escaped delimiter must not end the string, so a backslash always takes the next
            // character with it.
            if character == '\\' && self.current + 1 < self.characters.len() {
                raw.push(self.advance());
                raw.push(self.advance());
                continue;
            }

            // A real interpolation `#{…}` is validated for its reference now, at scan time, exactly as
            // one written in an unquoted word is (§10): an empty `#{}` is `DEON_PARSE_EXPECTED` even
            // when the carrying value is never evaluated, anchored at the value's first character
            // (§11.2). An escaped `\#{` was already taken by the backslash branch above, so a `#{`
            // reaching here always opens a real one. The reference is bounded by the first `}` — as the
            // evaluator's interpolation is — but only within this string; a `#{` the string closes
            // without a `}` is unterminated, which the evaluator still reports when the value is used.
            if character == '#' && self.peek(1) == '{' {
                let mut scan = self.current + 2;

                while scan < self.characters.len()
                    && self.characters[scan].1 != '}'
                    && self.characters[scan].1 != delimiter
                    && !(delimiter == '\'' && self.characters[scan].1 == '\n')
                {
                    scan += 1;
                }

                if scan < self.characters.len()
                    && self.characters[scan].1 == '}'
                    && interpolation_fault(self.slice(self.current + 2, scan))
                {
                    return err(
                        DiagnosticCode::ParseExpected,
                        "An interpolation needs a reference immediately between its braces.",
                        &self.span(start, line, column),
                    );
                }
            }

            raw.push(self.advance());
        }

        self.unterminated_quote(start, line, column)
    }

    /// A `'` or backtick that opened a string and never closed it. Whether that is an error is a
    /// question of position — an opening quote must close, but a quote partway through an unquoted
    /// value is ordinary content that opens nothing (4.3) — and the scanner, which has no notion of a
    /// key against a value, cannot answer it. So rather than fail here, it rewinds to the opening quote
    /// and re-reads the run as literal text under an `Unterminated` token; the parser raises
    /// `DEON_LEX_UNTERMINATED` only where that token stands at the head of a value, name, or target.
    fn unterminated_quote(&mut self, start: usize, line: usize, column: usize) -> DResult<()> {
        self.current = start;
        self.line = line;
        self.column = column;

        // The opening quote is not a boundary character, so this consumes it and then the rest of the
        // word, stopping where any unquoted value would (whitespace, a grouping character, a comma).
        self.consume_bare_run(start, line, column)?;

        let lexeme = self.slice(start, self.current).to_string();
        let literal = Literal::String(decode_minimal(&lexeme, None));

        self.add(TokenType::Unterminated, literal, start, line, column);

        Ok(())
    }

    /// Reads a link, spread, or interpolation-free reference from the cursor into its head and the
    /// segments it navigates, reporting the position of a malformed segment (specification 6). A dot
    /// segment is always a key; a bracket segment is an index only when it is all decimal digits, and
    /// a key otherwise. An empty bracket, whitespace inside one, or a trailing dot is
    /// `DEON_PARSE_EXPECTED` at the offending character, matching where the strict implementations
    /// underline it.
    fn reference(
        &mut self,
        ty: TokenType,
        start: usize,
        line: usize,
        column: usize,
    ) -> DResult<()> {
        // The head: a quoted name, an environment head, or a bare run up to the first '.', '[', or a
        // terminator. An environment head keeps its leading '$', which the evaluator reads.
        let head = if self.peek(0) == '\'' {
            self.quoted_reference_name(start, line, column)?
        } else if self.peek(0) == '$' {
            // An environment head is `$` then a non-empty bare-name (`environment-reference = "$",
            // bare-name`, deon.ebnf:42): letters, digits, `_`, and `-`. A lone `$`, or a `$` trailed
            // by a non-bare-name character such as a second `$`, has an empty name and is
            // `DEON_PARSE_EXPECTED` at the character where the name was due — matching the other
            // implementations, which report there rather than at the `#`. The name run stops on the
            // first non-bare-name character, so it never swallows the extra `$` of `$$X`.
            self.advance();

            let (at, at_line, at_column) = (self.current, self.line, self.column);
            let mut name = String::new();

            while !self.at_end() && is_reference_name(self.peek(0)) {
                name.push(self.advance());
            }

            if name.is_empty() {
                return self.parse_expected(
                    "A reference name was expected here.",
                    at,
                    at_line,
                    at_column,
                );
            }

            format!("${name}")
        } else {
            let mut head = String::new();

            while !self.at_end()
                && self.peek(0) != '.'
                && self.peek(0) != '['
                && !ends_reference_name(self.peek(0))
            {
                head.push(self.advance());
            }

            head
        };

        if head.is_empty() {
            return self.fail(
                DiagnosticCode::LexInvalid,
                "A link requires a reference.",
                start,
                line,
                column,
            );
        }

        let mut access: Vec<Access> = Vec::new();

        loop {
            match self.peek(0) {
                '.' => {
                    self.advance();

                    let (at, at_line, at_column) = (self.current, self.line, self.column);
                    let mut name = String::new();

                    // A dot segment is a bare-name (`dot-access = ".", bare-name`): letters, digits,
                    // `_`, and `-`. A character outside that set — a `+`, say — does not extend the
                    // name; a segment that reads none of them is the empty name reported just below,
                    // at that character, exactly as the other implementations report it.
                    while !self.at_end() && is_reference_name(self.peek(0)) {
                        name.push(self.advance());
                    }

                    if name.is_empty() {
                        return self.parse_expected(
                            "A reference name was expected here.",
                            at,
                            at_line,
                            at_column,
                        );
                    }

                    access.push(Access::Key(name));
                }
                '[' => {
                    self.advance();

                    let (at, at_line, at_column) = (self.current, self.line, self.column);

                    let segment = if self.peek(0) == '\'' {
                        Access::Key(self.quoted_reference_name(start, line, column)?)
                    } else {
                        let mut content = String::new();

                        while !self.at_end()
                            && self.peek(0) != ']'
                            && !ends_bracket_content(self.peek(0))
                        {
                            content.push(self.advance());
                        }

                        if content.is_empty() {
                            return self.parse_expected(
                                "A bracket access needs a name or an index.",
                                at,
                                at_line,
                                at_column,
                            );
                        }

                        classify_bracket(&content)
                    };

                    if self.peek(0) != ']' {
                        return self.parse_expected(
                            "A bracket access must be closed with ']'.",
                            self.current,
                            self.line,
                            self.column,
                        );
                    }

                    self.advance();

                    access.push(segment);
                }
                _ => break,
            }
        }

        // Any trailing characters that begin no segment and end no reference belong to nothing, but
        // consuming them keeps the token boundary where it has always been — a reference runs to a
        // separator or a grouping delimiter — so a following word is not read as a value of its own.
        while !self.at_end() && !ends_reference_name(self.peek(0)) {
            self.advance();
        }

        self.add(
            ty,
            Literal::Reference(Reference { head, access }),
            start,
            line,
            column,
        );

        Ok(())
    }

    /// Reads a single-quoted name from the cursor and decodes it, exactly as a single-quoted string
    /// is, so that a declaration and a link to it agree on the name. Used for a quoted head and for a
    /// quoted bracket key. An unterminated quote is the lexical error it is, at the reference's start.
    fn quoted_reference_name(
        &mut self,
        start: usize,
        line: usize,
        column: usize,
    ) -> DResult<String> {
        self.advance();

        let mut raw = String::new();

        while !self.at_end() && self.peek(0) != '\'' {
            // A quoted name shares the escape decoder, so a `\u{…}` escape is validated at the
            // backslash here too and its characters kept for `decode_minimal` (§4.3, §4.4).
            if self.peek(0) == '\\' && self.peek(1) == 'u' && self.peek(2) == '{' {
                let before = self.current;
                self.consume_unicode_escape(before, self.line, self.column)?;
                raw.push_str(self.slice(before, self.current));
                continue;
            }

            if self.peek(0) == '\\' && self.current + 1 < self.characters.len() {
                raw.push(self.advance());
            }

            raw.push(self.advance());
        }

        if self.at_end() {
            return self.fail(
                DiagnosticCode::LexUnterminated,
                "Unterminated quoted link name.",
                start,
                line,
                column,
            );
        }

        self.advance();

        Ok(finalize_name(&decode_minimal(&raw, Some('\''))))
    }

    /// A `DEON_PARSE_EXPECTED` at a single character, for a malformed reference segment.
    fn parse_expected<T>(
        &self,
        message: &str,
        at: usize,
        line: usize,
        column: usize,
    ) -> DResult<T> {
        err(
            DiagnosticCode::ParseExpected,
            message,
            &self.span(at, line, column),
        )
    }

    /// An unquoted word. It ends at whitespace or at a grouping character, and it swallows any
    /// interpolation written inside it, which is resolved later against the evaluated value.
    fn bare(&mut self, start: usize, line: usize, column: usize) -> DResult<()> {
        // The dispatch in `scan_token` consumed the first character to recognise a bare word; rewind
        // so the run is read whole from that first character. This lets an escaped interpolation
        // `\#{…}` at the very start of a value take the same non-greedy path as one written mid-word,
        // rather than its leading `\` being read past and the `#{` then read greedily — so
        // value-initial and mid-string escaped interpolations behave identically (specification 4.3).
        self.current = start;
        self.line = line;
        self.column = column;

        self.consume_bare_run(start, line, column)?;

        let lexeme = self.slice(start, self.current).to_string();
        let ty = keyword(&lexeme).unwrap_or(TokenType::Signifier);
        let literal = Literal::String(decode_minimal(&lexeme, None));

        self.add(ty, literal, start, line, column);

        Ok(())
    }

    /// Reads an unquoted run from the cursor to its boundary — whitespace, a grouping character, or a
    /// comma — swallowing any interpolation written inside it. Shared by the ordinary bare word and by
    /// the recovery that re-reads an unterminated quote as the literal content it is (4.3).
    fn consume_bare_run(&mut self, start: usize, line: usize, column: usize) -> DResult<()> {
        while !self.at_end() {
            let character = self.peek(0);

            if matches!(character, ' ' | '\t' | '\r' | '\n') {
                // A space or tab held against a lone backslash is that backslash's literal partner,
                // not the separator whitespace that ends the value: a `\` attaches the single
                // character after it (§4.3), so `a \ ` carries the two-character value `\ ` rather
                // than a lone backslash with the space trimmed away. Only an odd run of backslashes
                // just consumed leaves such a lone backslash against the cursor; an even run is
                // complete `\\` escapes, which attach nothing, so their trailing whitespace is
                // trimmed as any separator is. Exactly the one attached character is taken — any
                // whitespace beyond it has a non-backslash predecessor and so breaks here as usual.
                if matches!(character, ' ' | '\t') && self.preceding_backslashes(start) % 2 == 1 {
                    self.advance();
                    continue;
                }

                break;
            }

            if "[]{}()<>,".contains(character) {
                break;
            }

            if character == '#' && self.peek(1) == '{' {
                self.consume_interpolation(start, line, column)?;
                continue;
            }

            // An escaped interpolation `\#{reference}` is the literal text `#{reference}` (§4.3, §10):
            // the reference is read exactly as a real interpolation's, and a closing `}` reached over
            // reference characters completes it — `decode_minimal` then keeps it literal rather than
            // resolving it. It must fire wherever `#{` does, including mid-word, so `p\#{x}q` is the
            // literal `p#{x}q` and is not cut in two at the brace. An empty reference is the same error
            // a real `#{}` is. When no `}` closes the reference — a space, a delimiter, or the end
            // intervenes — the `\#{` is instead the plain escape for the two characters `#{`, and what
            // follows is ordinary content, so `p\#{q }` is the literal `p#{q`.
            if character == '\\' && self.peek(1) == '#' && self.peek(2) == '{' {
                let mut offset = 3;

                while !matches!(
                    self.peek(offset),
                    '}' | '\0' | ' ' | '\t' | '\r' | '\n' | '{' | '(' | ')' | '<' | '>' | ','
                ) {
                    offset += 1;
                }

                if self.peek(offset) == '}' {
                    let reference: String = (3..offset).map(|at| self.peek(at)).collect();

                    if interpolation_fault(&reference) {
                        return err(
                            DiagnosticCode::ParseExpected,
                            "An interpolation needs a reference immediately between its braces.",
                            &self.span(start, line, column),
                        );
                    }

                    for _ in 0..=offset {
                        self.advance();
                    }
                } else {
                    self.advance();
                    self.advance();
                    self.advance();
                }

                continue;
            }

            // A `\u{…}` escape, validated at the backslash and consumed whole (§4.3). Its characters
            // stay in the run, which `decode_minimal` later turns into the scalar.
            if character == '\\' && self.peek(1) == 'u' && self.peek(2) == '{' {
                self.consume_unicode_escape(self.current, self.line, self.column)?;
                continue;
            }

            self.advance();
        }

        Ok(())
    }

    /// Consumes a `#{...}` from the cursor, which sits on the `#`, reading the reference to its
    /// closing `}`. An unterminated one is `DEON_LEX_UNTERMINATED`; an empty or whitespace-surrounded
    /// reference is `DEON_PARSE_EXPECTED` anchored at the start of the string that carries it — the
    /// carrying word `start` handed in here — because the reference within has no source position of
    /// its own (§11.2, specification 10). Shared by a real interpolation written inside a word and by
    /// an escaped one `\#{...}`, which is lexed identically and differs only in that `decode_minimal`
    /// keeps it as literal text (specification 4.3) — so an escaped interpolation reports the very
    /// code and position a real one reports.
    fn consume_interpolation(&mut self, start: usize, line: usize, column: usize) -> DResult<()> {
        let interpolation_start = self.current;

        self.advance();
        self.advance();

        while !self.at_end() && self.peek(0) != '}' {
            self.advance();
        }

        if self.at_end() {
            return self.fail(
                DiagnosticCode::LexUnterminated,
                "Unterminated interpolation.",
                start,
                line,
                column,
            );
        }

        self.advance();

        let lexeme = self.slice(interpolation_start, self.current).to_string();

        if interpolation_fault(&lexeme[2..lexeme.len() - 1]) {
            return err(
                DiagnosticCode::ParseExpected,
                "An interpolation needs a reference immediately between its braces.",
                &self.span(start, line, column),
            );
        }

        Ok(())
    }

    fn add(
        &mut self,
        ty: TokenType,
        literal: Literal,
        start: usize,
        line: usize,
        column: usize,
    ) {
        let lexeme = self.slice(start, self.current).to_string();
        let span = self.span_of(&lexeme, start, line, column);

        self.tokens.push(Token {
            ty,
            lexeme,
            literal,
            span,
            leading: std::mem::take(&mut self.leading),
        });
    }

    /// The lexeme is the source read so far, so that the diagnostic can quote the text it failed on
    /// rather than an empty string.
    fn fail<T>(
        &self,
        code: DiagnosticCode,
        message: &str,
        start: usize,
        line: usize,
        column: usize,
    ) -> DResult<T> {
        let lexeme = self.slice(start, self.current).to_string();

        err(code, message, &self.span_of(&lexeme, start, line, column))
    }

    /// A token may span lines, and a column counts characters rather than bytes, so that an editor
    /// underlines what a reader would call one character.
    fn span_of(&self, lexeme: &str, start: usize, line: usize, column: usize) -> Span {
        let lines = lexeme.split('\n').count();

        let end_line = line + lines - 1;
        let end_column = if lines == 1 {
            column + lexeme.chars().count()
        } else {
            lexeme
                .rsplit('\n')
                .next()
                .unwrap_or("")
                .chars()
                .count()
                + 1
        };

        Span {
            source: Rc::clone(&self.source_name),
            start: self.offset(start),
            end: self.offset(self.current),
            line,
            column,
            end_line,
            end_column,
        }
    }

    fn span(&self, at: usize, line: usize, column: usize) -> Span {
        Span {
            source: Rc::clone(&self.source_name),
            start: self.offset(at),
            end: self.offset(at),
            line,
            column,
            end_line: line,
            end_column: column,
        }
    }

    /// The byte offset a code point begins at. Past the end that is the length, so a slice never
    /// splits a character.
    fn offset(&self, at: usize) -> usize {
        match self.characters.get(at) {
            Some((offset, _)) => *offset,
            None => self.source.len(),
        }
    }

    fn slice(&self, start: usize, end: usize) -> &str {
        &self.source[self.offset(start)..self.offset(end)]
    }

    fn advance(&mut self) -> char {
        let character = self.peek(0);

        self.current += 1;

        if character == '\n' {
            self.line += 1;
            self.column = 1;
        } else {
            self.column += 1;
        }

        character
    }

    fn peek(&self, offset: usize) -> char {
        match self.characters.get(self.current + offset) {
            Some((_, character)) => *character,
            None => '\0',
        }
    }

    /// Counts the backslashes standing immediately before the cursor, reaching back no earlier than
    /// `floor`. An odd count leaves a lone backslash against the cursor — one that escapes whatever
    /// follows it — while an even count is a run of complete `\\` escapes, which escapes nothing
    /// (§4.3). Used to tell a value-ending separator space from one a trailing backslash has claimed.
    fn preceding_backslashes(&self, floor: usize) -> usize {
        let mut index = self.current;
        let mut count = 0;

        while index > floor && self.characters[index - 1].1 == '\\' {
            index -= 1;
            count += 1;
        }

        count
    }

    fn at_end(&self) -> bool {
        self.current >= self.characters.len()
    }
}
