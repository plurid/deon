// #region imports
    // #region external
    import {
        TokenType,
    } from '../../data/enumerations';

    import {
        Reference,
    } from '../../data/syntax';

    import {
        deonError,
        DiagnosticCode,
    } from '../Diagnostic';

    import Token from '../Token';
    // #endregion external
// #endregion imports



// #region module
/**
 * Stands in for an escaped `#{`, so that the interpolator, which runs later and over the evaluated
 * string, does not mistake it for an interpolation to resolve.
 */
export const ESCAPED_INTERPOLATION = '\u0000deon-interpolation\u0000';


/**
 * A newline, a carriage return, or a tab that a string could not otherwise carry: an unquoted
 * string ends at a newline, a singlequoted one cannot cross one, and a backticked one trims the
 * whitespace at its boundaries. Without these, a value such as `alpha` followed by a newline could
 * not be written down at all.
 */
const CONTROL_ESCAPES: Record<string, string> = {
    n: '\n',
    r: '\r',
    t: '\t',
};


const PUNCTUATION: Record<string, TokenType> = {
    '[': TokenType.LEFT_SQUARE_BRACKET,
    ']': TokenType.RIGHT_SQUARE_BRACKET,
    '{': TokenType.LEFT_CURLY_BRACKET,
    '}': TokenType.RIGHT_CURLY_BRACKET,
    '(': TokenType.LEFT_PARENTHESIS,
    ')': TokenType.RIGHT_PARENTHESIS,
    '<': TokenType.LEFT_ANGLE_BRACKET,
    '>': TokenType.RIGHT_ANGLE_BRACKET,
    ',': TokenType.COMMA,
};


const KEYWORDS: Record<string, TokenType> = {
    import: TokenType.IMPORT,
    inject: TokenType.INJECT,
    from: TokenType.FROM,
    with: TokenType.WITH,
};


/**
 * A reference ends at any of these, when it is not inside a bracket access.
 */
const REFERENCE_STOPS = ' \t\r\n,{}()<>';


/**
 * Decodes the escapes of a string. `delimiter` is the quote the string was written in, if any: a
 * backslash before it means the quote itself, rather than the end of the string.
 *
 * Every other backslash is kept as it is written.
 */
export const decodeMinimal = (
    raw: string,
    delimiter = '',
) => {
    let value = '';

    for (let index = 0; index < raw.length; index += 1) {
        if (raw.startsWith('\\#{', index)) {
            value += ESCAPED_INTERPOLATION;
            index += 2;
            continue;
        }

        if (raw[index] === '\\' && index + 1 < raw.length) {
            const next = raw[index + 1];

            if (next === '\\' || (delimiter && next === delimiter)) {
                value += next;
                index += 1;
                continue;
            }

            const control = CONTROL_ESCAPES[next];
            if (control !== undefined) {
                value += control;
                index += 1;
                continue;
            }
        }

        value += raw[index];
    }

    return value;
}


/**
 * Reads the text of a link into the segments it navigates: `entity.name`, `entity[name]`,
 * `items[0]`, or the environment `$NAME`. A quoted head may hold any character.
 */
export const parseReference = (
    raw: string,
): Reference => {
    const segments: string[] = [];
    let index = 0;

    if (raw[index] === '\'') {
        index += 1;

        // Decoded exactly as a singlequoted string is, so that a declaration and a link to it agree
        // on what the name is.
        let quoted = '';
        while (index < raw.length && raw[index] !== '\'') {
            if (raw[index] === '\\' && index + 1 < raw.length) {
                quoted += raw[index] + raw[index + 1];
                index += 2;
                continue;
            }

            quoted += raw[index];
            index += 1;
        }

        segments.push(decodeMinimal(quoted, '\''));

        if (raw[index] === '\'') {
            index += 1;
        }
    } else {
        let end = index;
        while (end < raw.length && raw[end] !== '.' && raw[end] !== '[') {
            end += 1;
        }

        segments.push(raw.slice(index, end));
        index = end;
    }

    while (index < raw.length) {
        if (raw[index] === '.') {
            index += 1;

            let end = index;
            while (end < raw.length && raw[end] !== '.' && raw[end] !== '[') {
                end += 1;
            }

            segments.push(raw.slice(index, end));
            index = end;
            continue;
        }

        if (raw[index] === '[') {
            const end = raw.indexOf(']', index + 1);
            if (end === -1) {
                segments.push(raw.slice(index + 1));
                break;
            }

            const segment = raw.slice(index + 1, end);
            segments.push(
                segment.startsWith('\'') && segment.endsWith('\'')
                    ? decodeMinimal(segment.slice(1, -1), '\'')
                    : segment,
            );
            index = end + 1;
            continue;
        }

        index += 1;
    }

    return segments;
}



class Scanner {
    private readonly source: string;
    private readonly sourceName: string;
    private readonly tokens: Token[] = [];
    private current = 0;
    private line = 1;
    private column = 1;

    /**
     * The whitespace read since the last token. A value written across several tokens is put back
     * together from these, so `two words` keeps its single space.
     */
    private leading = '';

    constructor(
        source: string,
        _error?: unknown,
        sourceName = '<memory>',
    ) {
        this.source = source.replace(/\r\n/g, '\n');
        this.sourceName = sourceName;
    }


    public scanTokens() {
        while (!this.atEnd()) {
            this.scanToken();
        }

        this.tokens.push(
            new Token(
                TokenType.EOF,
                '',
                null,
                this.line,
                this.column,
                this.current,
                this.current,
                this.sourceName,
            ),
        );

        return this.tokens;
    }


    private scanToken() {
        const start = this.current;
        const line = this.line;
        const column = this.column;
        const character = this.advance();

        if (character === ' ' || character === '\t' || character === '\r') {
            this.leading += character;
            return;
        }

        if (character === '\n') {
            this.add(TokenType.NEWLINE, '\n', null, start, line, column);
            return;
        }

        if (character === '/' && this.peek() === '/') {
            while (!this.atEnd() && this.peek() !== '\n') {
                this.advance();
            }
            return;
        }

        if (character === '/' && this.peek() === '*') {
            this.advance();
            this.blockComment(start, line, column);
            return;
        }

        if (character === '.' && this.source.startsWith('..#', this.current)) {
            this.advance();
            this.advance();
            this.advance();
            this.reference(TokenType.SPREAD, start, line, column);
            return;
        }

        if (character === '#' && this.peek() === '{') {
            this.interpolation(start, line, column);
            return;
        }

        if (character === '#') {
            this.reference(TokenType.LINK, start, line, column);
            return;
        }

        const punctuation = PUNCTUATION[character];
        if (punctuation !== undefined) {
            this.add(punctuation, character, null, start, line, column);
            return;
        }

        if (character === '\'' || character === '`') {
            this.string(character, start, line, column);
            return;
        }

        this.bare(start, line, column);
    }


    private blockComment(
        start: number,
        line: number,
        column: number,
    ) {
        while (!this.atEnd() && !(this.peek() === '*' && this.peek(1) === '/')) {
            this.advance();
        }

        if (this.atEnd()) {
            this.fail(
                TokenType.EOF,
                DiagnosticCode.LEX_UNTERMINATED,
                'Unterminated block comment.',
                start,
                line,
                column,
            );
        }

        this.advance();
        this.advance();
    }


    private interpolation(
        start: number,
        line: number,
        column: number,
    ) {
        this.advance();

        while (!this.atEnd() && this.peek() !== '}') {
            this.advance();
        }

        if (this.atEnd()) {
            this.fail(
                TokenType.INTERPOLATE,
                DiagnosticCode.LEX_UNTERMINATED,
                'Unterminated interpolation.',
                start,
                line,
                column,
            );
        }

        this.advance();

        const lexeme = this.source.slice(start, this.current);
        this.add(TokenType.INTERPOLATE, lexeme, lexeme, start, line, column);
    }


    /**
     * The source characters are collected with their escapes intact, so that a backticked string
     * trims the whitespace of its layout without touching a newline that was written as an escape.
     */
    private string(
        delimiter: string,
        start: number,
        line: number,
        column: number,
    ) {
        let raw = '';

        while (!this.atEnd()) {
            const character = this.peek();

            if (character === delimiter) {
                this.advance();

                const content = delimiter === '`' ? raw.trim() : raw;
                this.add(
                    TokenType.STRING,
                    this.source.slice(start, this.current),
                    decodeMinimal(content, delimiter),
                    start,
                    line,
                    column,
                );
                return;
            }

            if (delimiter === '\'' && character === '\n') {
                this.fail(
                    TokenType.STRING,
                    DiagnosticCode.LEX_UNTERMINATED,
                    'Singlequoted strings cannot cross a newline.',
                    start,
                    line,
                    column,
                );
            }

            // An escaped delimiter must not end the string, so a backslash always takes the next
            // character with it.
            if (character === '\\' && this.current + 1 < this.source.length) {
                raw += this.advance();
                raw += this.advance();
                continue;
            }

            raw += this.advance();
        }

        this.fail(
            TokenType.STRING,
            DiagnosticCode.LEX_UNTERMINATED,
            'Unterminated string.',
            start,
            line,
            column,
        );
    }


    private reference(
        type: TokenType,
        start: number,
        line: number,
        column: number,
    ) {
        let raw = '';
        let brackets = 0;

        if (this.peek() === '\'') {
            raw += this.advance();

            while (!this.atEnd() && this.peek() !== '\'') {
                if (this.peek() === '\\' && this.peek(1) !== '\0') {
                    raw += this.advance();
                }

                raw += this.advance();
            }

            if (this.atEnd()) {
                this.fail(
                    type,
                    DiagnosticCode.LEX_UNTERMINATED,
                    'Unterminated quoted link name.',
                    start,
                    line,
                    column,
                );
            }

            raw += this.advance();
        }

        while (!this.atEnd()) {
            const character = this.peek();

            if (character === '[') {
                brackets += 1;
            }

            if (character === ']') {
                if (brackets === 0) {
                    break;
                }

                brackets -= 1;
            }

            if (brackets === 0 && REFERENCE_STOPS.includes(character)) {
                break;
            }

            raw += this.advance();
        }

        if (brackets !== 0) {
            this.fail(
                type,
                DiagnosticCode.LEX_UNTERMINATED,
                'Unterminated bracket access.',
                start,
                line,
                column,
            );
        }

        if (!raw) {
            this.fail(
                type,
                DiagnosticCode.LEX_INVALID,
                'A link requires a reference.',
                start,
                line,
                column,
            );
        }

        this.add(
            type,
            this.source.slice(start, this.current),
            parseReference(raw),
            start,
            line,
            column,
        );
    }


    /**
     * An unquoted word. It ends at whitespace or at a grouping character, and it swallows any
     * interpolation written inside it, which is resolved later against the evaluated value.
     */
    private bare(
        start: number,
        line: number,
        column: number,
    ) {
        while (!this.atEnd()) {
            const character = this.peek();

            if (
                character === ' '
                || character === '\t'
                || character === '\r'
                || character === '\n'
            ) {
                break;
            }

            if ('[]{}()<>,'.includes(character)) {
                break;
            }

            if (this.source.startsWith('#{', this.current)) {
                this.advance();
                this.advance();

                while (!this.atEnd() && this.peek() !== '}') {
                    this.advance();
                }

                if (this.atEnd()) {
                    this.fail(
                        TokenType.SIGNIFIER,
                        DiagnosticCode.LEX_UNTERMINATED,
                        'Unterminated interpolation.',
                        start,
                        line,
                        column,
                    );
                }

                this.advance();
                continue;
            }

            if (this.source.startsWith('\\#{', this.current)) {
                this.advance();
                this.advance();
                this.advance();
                continue;
            }

            this.advance();
        }

        const lexeme = this.source.slice(start, this.current);

        this.add(
            KEYWORDS[lexeme] ?? TokenType.SIGNIFIER,
            lexeme,
            decodeMinimal(lexeme),
            start,
            line,
            column,
        );
    }


    private add(
        type: TokenType,
        lexeme: string,
        literal: unknown,
        start: number,
        line: number,
        column: number,
    ) {
        this.tokens.push(
            new Token(
                type,
                lexeme,
                literal,
                line,
                column,
                start,
                this.current,
                this.sourceName,
                this.leading,
            ),
        );

        this.leading = '';
    }


    /**
     * The lexeme is the source read so far, so that the diagnostic can quote the text it failed on
     * rather than an empty string.
     */
    private fail(
        type: TokenType,
        code: Parameters<typeof deonError>[0],
        message: string,
        start: number,
        line: number,
        column: number,
    ): never {
        return deonError(
            code,
            message,
            new Token(
                type,
                this.source.slice(start, this.current),
                null,
                line,
                column,
                start,
                this.current,
                this.sourceName,
            ),
        );
    }


    private advance() {
        const character = this.source[this.current++] ?? '\0';

        if (character === '\n') {
            this.line += 1;
            this.column = 1;
        } else {
            this.column += 1;
        }

        return character;
    }


    private peek(
        offset = 0,
    ) {
        return this.source[this.current + offset] ?? '\0';
    }


    private atEnd() {
        return this.current >= this.source.length;
    }
}
// #endregion module



// #region exports
export default Scanner;
// #endregion exports
