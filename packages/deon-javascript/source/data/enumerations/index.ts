// #region module
export enum TokenType {
    // Single-character tokens.
    LEFT_SQUARE_BRACKET, RIGHT_SQUARE_BRACKET,
    LEFT_CURLY_BRACKET, RIGHT_CURLY_BRACKET,
    LEFT_PARENTHESIS, RIGHT_PARENTHESIS,
    LEFT_ANGLE_BRACKET, RIGHT_ANGLE_BRACKET,
    COMMA,
    NEWLINE,

    // Multi-character tokens.
    SPREAD,
    IMPORT, INJECT, FROM, WITH,

    // Literals.
    SIGNIFIER,
    STRING,
    LINK,
    INTERPOLATE,
    IDENTIFIER,

    EOF,
}
// #endregion module
