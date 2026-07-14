// #region imports
    // #region external
    import {
        TokenType,
    } from '../../data/enumerations';
    // #endregion external
// #endregion imports



// #region module
/**
 * A token, and where it was written. The position is what a diagnostic underlines, so it is carried
 * from here all the way out to the caller.
 *
 * `leading` is the whitespace read before the token. An unquoted value may be written across
 * several tokens, and this is what puts it back together with the spacing it was given.
 */
class Token {
    public type: TokenType;
    public lexeme: string;
    public literal: any;
    public line: number;
    public column: number;
    public start: number;
    public end: number;
    public source: string;
    public leading: string;
    public endLine: number;
    public endColumn: number;

    constructor(
        type: TokenType,
        lexeme: string,
        literal: any,
        line: number,
        column = 1,
        start = 0,
        end = start,
        source = '<memory>',
        leading = '',
    ) {
        this.type = type;
        this.lexeme = lexeme;
        this.literal = literal;
        this.line = line;
        this.column = column;
        this.start = start;
        this.end = end;
        this.source = source;
        this.leading = leading;

        // A token may span lines, and a column counts characters rather than code units, so that an
        // editor underlines what a reader would call one character.
        const lines = lexeme.split('\n');

        this.endLine = line + lines.length - 1;
        this.endColumn = lines.length === 1
            ? column + Array.from(lexeme).length
            : Array.from(lines[lines.length - 1]).length + 1;
    }


    public toString() {
        return this.type + ' ' + this.lexeme + ' ' + this.literal;
    }
}
// #endregion module



// #region exports
export default Token;
// #endregion exports
