//! Source text into tokens.

use std::rc::Rc;

use crate::diagnostic::{err, DResult, DiagnosticCode, Span};
use crate::syntax::{Access, Reference};
use crate::token::{Literal, Token, TokenType};

/// Stands in for an escaped `#{`, so that the interpolator, which runs later and over the evaluated
/// string, does not mistake it for an interpolation to resolve.
pub const ESCAPED_INTERPOLATION: &str = "\u{0}deon-interpolation\u{0}";

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
        return Access::Key(decode_minimal(&content[1..content.len() - 1], Some('\'')));
    }

    if !content.is_empty() && content.bytes().all(|byte| byte.is_ascii_digit()) {
        return Access::Index {
            index: content.parse::<usize>().ok(),
            text: content.to_string(),
        };
    }

    Access::Key(content.to_string())
}

/// Validates the reference inside a `#{...}` interpolation against the reference grammar (§6, §10),
/// which forbids surrounding whitespace and an empty reference. Returns the 1-based column, *within
/// the `#{...}` text*, of the first offending character, or `None` when the reference is well-formed.
///
/// The reference implementation parses the reference with a fresh cursor over just this text, so its
/// diagnostic is positioned relative to the `#{`, not to the document — the `#` sits at column 1 and
/// the reference therefore begins at column 3. A `#{ x }` and a `#{}` both fault at column 3, where a
/// reference name was due; a `#{x }` faults at column 4, where the `}` was.
fn interpolation_fault(inner: &str) -> Option<usize> {
    let characters: Vec<char> = inner.chars().collect();
    let column = |index: usize| index + 3;
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
                return Some(column(index));
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
                return Some(column(index));
            }
            index += 1;
        }
        _ => {
            let start = index;
            while index < characters.len() && is_reference_name(characters[index]) {
                index += 1;
            }
            if index == start {
                return Some(column(index));
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
                    return Some(column(index));
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
                        return Some(column(index));
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
                        return Some(column(index));
                    }
                }
                if characters.get(index) != Some(&']') {
                    return Some(column(index));
                }
                index += 1;
            }
            // Anything else where a segment or the end was due: the `}` was expected here.
            _ => return Some(column(index)),
        }
    }

    None
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

        // Decoded exactly as a singlequoted string is, so that a declaration and a link to it agree
        // on what the name is.
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

        decode_minimal(&quoted, Some('\''))
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
        // whitespace (specification 10). The strict implementations read it with a fresh cursor over
        // this text, so a fault is positioned relative to the `#{` rather than to the document.
        if let Some(fault) = interpolation_fault(&lexeme[2..lexeme.len() - 1]) {
            return err(
                DiagnosticCode::ParseExpected,
                "An interpolation needs a reference immediately between its braces.",
                &self.span(start, 1, fault),
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

                // Rust trims a slightly wider set of whitespace than the reference does, which no
                // document written in ASCII can tell apart.
                let content = if delimiter == '`' { raw.trim() } else { &raw };

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

            // An escaped delimiter must not end the string, so a backslash always takes the next
            // character with it.
            if character == '\\' && self.current + 1 < self.characters.len() {
                raw.push(self.advance());
                raw.push(self.advance());
                continue;
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
        // The head: a quoted name, or a bare run up to the first '.', '[', or a terminator. An
        // environment head keeps its leading '$', which the evaluator reads.
        let head = if self.peek(0) == '\'' {
            self.quoted_reference_name(start, line, column)?
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

                    while !self.at_end()
                        && self.peek(0) != '.'
                        && self.peek(0) != '['
                        && !ends_reference_name(self.peek(0))
                    {
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

        Ok(decode_minimal(&raw, Some('\'')))
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
                break;
            }

            if "[]{}()<>,".contains(character) {
                break;
            }

            if character == '#' && self.peek(1) == '{' {
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

                // An interpolation written inside a word carries the same reference grammar as one
                // standing alone, and its fault is positioned relative to the `#{` (specification 10).
                let lexeme = self.slice(interpolation_start, self.current).to_string();

                if let Some(fault) = interpolation_fault(&lexeme[2..lexeme.len() - 1]) {
                    return err(
                        DiagnosticCode::ParseExpected,
                        "An interpolation needs a reference immediately between its braces.",
                        &self.span(interpolation_start, 1, fault),
                    );
                }

                continue;
            }

            if character == '\\' && self.peek(1) == '#' && self.peek(2) == '{' {
                self.advance();
                self.advance();
                self.advance();
                continue;
            }

            self.advance();
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

    fn at_end(&self) -> bool {
        self.current >= self.characters.len()
    }
}
