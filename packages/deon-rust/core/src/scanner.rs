//! Source text into tokens.

use std::rc::Rc;

use crate::diagnostic::{err, DResult, DiagnosticCode, Span};
use crate::syntax::Reference;
use crate::token::{Literal, Token, TokenType};

/// Stands in for an escaped `#{`, so that the interpolator, which runs later and over the evaluated
/// string, does not mistake it for an interpolation to resolve.
pub const ESCAPED_INTERPOLATION: &str = "\u{0}deon-interpolation\u{0}";

/// A reference ends at any of these, when it is not inside a bracket access.
const REFERENCE_STOPS: &str = " \t\r\n,{}()<>";

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

/// Reads the text of a link into the segments it navigates: `entity.name`, `entity[name]`,
/// `items[0]`, or the environment `$NAME`. A quoted head may hold any character.
pub fn parse_reference(raw: &str) -> Reference {
    let characters: Vec<char> = raw.chars().collect();
    let mut segments: Vec<String> = Vec::new();
    let mut index = 0;

    if characters.first() == Some(&'\'') {
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

        segments.push(decode_minimal(&quoted, Some('\'')));

        if characters.get(index) == Some(&'\'') {
            index += 1;
        }
    } else {
        let mut end = index;

        while end < characters.len() && characters[end] != '.' && characters[end] != '[' {
            end += 1;
        }

        segments.push(characters[index..end].iter().collect());
        index = end;
    }

    while index < characters.len() {
        if characters[index] == '.' {
            index += 1;

            let mut end = index;

            while end < characters.len() && characters[end] != '.' && characters[end] != '[' {
                end += 1;
            }

            segments.push(characters[index..end].iter().collect());
            index = end;
            continue;
        }

        if characters[index] == '[' {
            let closing = characters[index + 1..]
                .iter()
                .position(|character| *character == ']')
                .map(|at| index + 1 + at);

            let Some(closing) = closing else {
                segments.push(characters[index + 1..].iter().collect());
                break;
            };

            let segment: String = characters[index + 1..closing].iter().collect();

            segments.push(
                if segment.len() >= 2 && segment.starts_with('\'') && segment.ends_with('\'') {
                    decode_minimal(&segment[1..segment.len() - 1], Some('\''))
                } else {
                    segment
                },
            );

            index = closing + 1;
            continue;
        }

        index += 1;
    }

    segments
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

    fn reference(
        &mut self,
        ty: TokenType,
        start: usize,
        line: usize,
        column: usize,
    ) -> DResult<()> {
        let mut raw = String::new();
        let mut brackets = 0usize;

        if self.peek(0) == '\'' {
            raw.push(self.advance());

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

            raw.push(self.advance());
        }

        while !self.at_end() {
            let character = self.peek(0);

            if character == '[' {
                brackets += 1;
            }

            if character == ']' {
                if brackets == 0 {
                    break;
                }

                brackets -= 1;
            }

            if brackets == 0 && REFERENCE_STOPS.contains(character) {
                break;
            }

            raw.push(self.advance());
        }

        if brackets != 0 {
            return self.fail(
                DiagnosticCode::LexUnterminated,
                "Unterminated bracket access.",
                start,
                line,
                column,
            );
        }

        if raw.is_empty() {
            return self.fail(
                DiagnosticCode::LexInvalid,
                "A link requires a reference.",
                start,
                line,
                column,
            );
        }

        self.add(
            ty,
            Literal::Reference(parse_reference(&raw)),
            start,
            line,
            column,
        );

        Ok(())
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
