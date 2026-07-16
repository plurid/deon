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
 *
 * `unterminatedQuote` marks a word the scanner read where a `'` or a backtick opened a quoted
 * string that never closed. The scanner cannot tell whether that quote begins a value — a real
 * unterminated string — or merely continues an unquoted one, where the quote is ordinary literal
 * content (4.3); it defers that to the parser, which knows the position, and this is the flag it
 * reads.
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
    public unterminatedQuote: boolean;
    public endLine: number;
    public endColumn: number;
    /**
     * The same span as `start`/`end`, but measured in UTF-8 bytes into the CRLF-folded source rather
     * than in UTF-16 code units. A diagnostic reports these (`spec/diagnostics.md`); `start`/`end`
     * stay in code units because they index this JavaScript string to slice a lexeme out of it. They
     * default to `start`/`end` for a synthesised token that names an offset of zero, where the two
     * measures coincide.
     */
    public byteStart: number;
    public byteEnd: number;

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
        unterminatedQuote = false,
        byteStart = start,
        byteEnd = end,
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
        this.unterminatedQuote = unterminatedQuote;
        this.byteStart = byteStart;
        this.byteEnd = byteEnd;

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
