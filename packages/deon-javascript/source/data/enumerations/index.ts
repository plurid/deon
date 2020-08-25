// #region module
export enum TokenType {
    // Single-character tokens.
    LEFT_SQUARE_BRACKET, RIGHT_SQUARE_BRACKET,
    LEFT_CURLY_BRACKET, RIGHT_CURLY_BRACKET,
    COMMA, HASH, BACKTICK, SLASH, STAR,

    // Literals.
    IDENTIFIER,

    // Entities.
    MAP,
    LIST,
    STRING,

    EOF,
}
// #endregion module
