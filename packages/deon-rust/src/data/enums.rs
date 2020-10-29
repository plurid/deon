// #region module
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
    String,
    Link,
    Identifier,

    // Entities.
    Map,
    List,

    Eof,
}
// #endregion module
