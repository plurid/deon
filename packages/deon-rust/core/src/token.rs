//! A token, and where it was written.

use crate::diagnostic::Span;
use crate::syntax::Reference;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TokenType {
    LeftSquare,
    RightSquare,
    LeftCurly,
    RightCurly,
    LeftParen,
    RightParen,
    LeftAngle,
    RightAngle,
    Comma,
    Newline,

    Spread,
    Import,
    Inject,
    From,
    With,

    Signifier,
    String,
    Link,
    Interpolate,

    Eof,
}

impl TokenType {
    /// The tokens a value may be made of. A keyword is only a keyword where a declaration may begin,
    /// so `import` is an ordinary word anywhere else.
    pub fn is_value(self) -> bool {
        matches!(
            self,
            Self::Signifier
                | Self::String
                | Self::Interpolate
                | Self::Import
                | Self::Inject
                | Self::From
                | Self::With
        )
    }

    /// A newline and a comma separate alike, so either ends an entry, an item, a cell, or an
    /// argument.
    pub fn is_boundary(self) -> bool {
        matches!(self, Self::Newline | Self::Comma)
    }
}

/// What a token carries beyond its text: the decoded string of a literal, or the segments of a link.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Literal {
    None,
    String(String),
    Reference(Reference),
}

/// The position is what a diagnostic underlines, so it is carried from here all the way out to the
/// caller.
///
/// `leading` is the whitespace read before the token. An unquoted value may be written across
/// several tokens, and this is what puts it back together with the spacing it was given.
#[derive(Clone, Debug)]
pub struct Token {
    pub ty: TokenType,
    pub lexeme: String,
    pub literal: Literal,
    pub span: Span,
    pub leading: String,
}

impl Token {
    /// The decoded literal where there is one, and the text as it was written where there is not.
    pub fn value(&self) -> &str {
        match &self.literal {
            Literal::String(value) => value,
            _ => &self.lexeme,
        }
    }

    pub fn reference(&self) -> Reference {
        match &self.literal {
            Literal::Reference(reference) => reference.clone(),
            _ => Vec::new(),
        }
    }
}
