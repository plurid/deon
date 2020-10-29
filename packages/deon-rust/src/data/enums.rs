use std::fmt::{
    self,
    Debug,
    Display,
};



#[derive(Debug)]
pub enum TokenType {
    // Single-character tokens.
    LeftSquareBracket, RightSquareBracket,
    LeftCurlyBracket, RightCurlyBracket,
    Comma, Dot,

    // Multi-character tokens.
    Spread,
    Import, Inject, From, With,

    // Literals.
    Signifier,
    Link,
    Identifier,

    // Entities.
    Map,
    List,

    Eof,
}


impl Display for TokenType {
    fn fmt(
        &self,
        f: &mut fmt::Formatter,
    ) -> fmt::Result {
        fmt::Debug::fmt(self, f)
    }
}
