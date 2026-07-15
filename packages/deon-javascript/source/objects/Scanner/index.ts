// #region imports
    // #region external
    import {
        TokenType,
    } from '../../data/enumerations';

    import {
        AccessSegment,
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
 * A column counts Unicode code points, not UTF-16 code units, because that is the position the
 * specification requires (`spec/diagnostics.md`: one-based Unicode code-point line/column). An
 * astral character — anything above the Basic Multilingual Plane — is written in JavaScript as a
 * surrogate pair, two code units, and must still count as a single column. These recognise the two
 * halves of such a pair so that the trailing half advances the byte offset without the column.
 */
const isHighSurrogate = (
    character: string | undefined,
) => {
    if (character === undefined) {
        return false;
    }

    const code = character.charCodeAt(0);
    return code >= 0xD800 && code <= 0xDBFF;
}


const isLowSurrogate = (
    character: string | undefined,
) => {
    if (character === undefined) {
        return false;
    }

    const code = character.charCodeAt(0);
    return code >= 0xDC00 && code <= 0xDFFF;
}


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
 * A reference is malformed at a character the grammar did not allow: an empty or spaced bracket, or a
 * dot with no name after it. `parseReference` throws this rather than a positioned diagnostic, because
 * it reads a bare string and does not know where in the source that string sits; the caller — the
 * scanner for a link, the interpolation check for `#{…}` — maps `offset` to the position it reports.
 */
export class ReferenceFault {
    constructor(
        public readonly offset: number,
        public readonly message: string,
    ) {}
}


const REFERENCE_NAME = /[A-Za-z0-9_-]/;

/**
 * The characters that end a bracket segment before its `]` — whitespace, a comma, a newline, and the
 * bracketing delimiters — so a space inside a bracket is a fault at the space rather than a name that
 * happens to contain one (specification 6).
 */
const BRACKET_STOP = ' \t\r\n,{}[]()<>\'`';


const isBracketStop = (
    character: string | undefined,
) => character === undefined || BRACKET_STOP.includes(character);


/**
 * Reads the text of a reference into a head and the segments it navigates: `entity.name`,
 * `entity[name]`, `items[0]`, a quoted head, or the environment `$NAME` (specification 6). A dot
 * segment is always a map key. A bracket segment is a list index only when its content is a run of
 * decimal digits — leading zeros allowed, read as the integer — and is otherwise a key: a quoted
 * string, or the exact characters between the brackets. An empty or spaced bracket, and a trailing
 * dot, are malformations raised through a `ReferenceFault` carrying the offset of the offending
 * character. `end` is the index one past the reference, so a caller reading `#{…}` can tell a
 * trailing space from the closing brace.
 */
export const parseReference = (
    raw: string,
): { reference: Reference; end: number } => {
    let index = 0;

    const bareName = () => {
        const start = index;
        while (index < raw.length && REFERENCE_NAME.test(raw[index])) {
            index += 1;
        }

        if (index === start) {
            throw new ReferenceFault(start, 'A reference name was expected here.');
        }

        return raw.slice(start, index);
    };

    // Decoded exactly as a singlequoted string is, so that a declaration and a link to it agree on
    // what the name is.
    const quoted = () => {
        index += 1; // opening '
        let value = '';

        while (index < raw.length && raw[index] !== '\'') {
            if (raw[index] === '\\' && index + 1 < raw.length) {
                value += raw[index] + raw[index + 1];
                index += 2;
                continue;
            }

            value += raw[index];
            index += 1;
        }

        if (raw[index] === '\'') {
            index += 1; // closing '
        }

        return decodeMinimal(value, '\'');
    };

    const bracket = (): AccessSegment => {
        // A quoted bracket is a key, never an index.
        if (raw[index] === '\'') {
            return { name: quoted(), byIndex: false, index: 0 };
        }

        const start = index;
        let digits = true;

        while (index < raw.length && raw[index] !== ']' && !isBracketStop(raw[index])) {
            if (raw[index] < '0' || raw[index] > '9') {
                digits = false;
            }

            index += 1;
        }

        const text = raw.slice(start, index);
        if (text === '') {
            throw new ReferenceFault(start, 'A bracket access needs a name or an index.');
        }

        // A run of decimal digits is a list index; anything else — a decimal, a word — is a key.
        return digits
            ? { name: text, byIndex: true, index: Number(text) }
            : { name: text, byIndex: false, index: 0 };
    };

    let head: string;
    if (raw[index] === '$') {
        index += 1;
        head = '$' + bareName();
    } else if (raw[index] === '\'') {
        head = quoted();
    } else {
        head = bareName();
    }

    const access: AccessSegment[] = [];

    while (index < raw.length) {
        if (raw[index] === '.') {
            index += 1;
            // A dot is always a map key; a trailing dot names nothing and is a fault.
            access.push({ name: bareName(), byIndex: false, index: 0 });
            continue;
        }

        if (raw[index] === '[') {
            index += 1;
            access.push(bracket());

            if (raw[index] !== ']') {
                throw new ReferenceFault(index, 'A bracket access must be closed with \']\'.');
            }

            index += 1;
            continue;
        }

        break;
    }

    return {
        reference: { head, access },
        end: index,
    };
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
            if (this.stringTerminates(character)) {
                this.string(character, start, line, column);
            } else {
                // A quote that opens a string which never closes is not, on its own, an error: only
                // the first character of a value opens a quoted string, so a `'` or a backtick that
                // continues an unquoted value is ordinary literal content (4.3). The scanner cannot
                // tell a value's first token from a later one, so rather than fail here it reads the
                // run as a bare word and marks it — the parser raises the unterminated-string error
                // if, and only if, the word begins a value, a key, or a target.
                this.bare(start, line, column, true);
            }
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
        this.advance(); // {
        const contentStart = this.current;

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

        const content = this.source.slice(contentStart, this.current);
        this.advance(); // }

        this.checkInterpolation(content);

        const lexeme = this.source.slice(start, this.current);
        this.add(TokenType.INTERPOLATE, lexeme, lexeme, start, line, column);
    }


    /**
     * An interpolation names a reference written immediately between `#{` and `}`, with no
     * surrounding whitespace and never empty (specification 10). The reference within is recovered by
     * decoding and has no source position of its own, so a fault is pointed at relative to the
     * interpolation's own `#` — column 1 the `#`, column 2 the `{`, column 3 the reference's first
     * character — which is the position the strict implementations agree on (§11.2).
     */
    private checkInterpolation(
        content: string,
    ) {
        let end: number;

        try {
            end = parseReference(content).end;
        } catch (fault) {
            if (fault instanceof ReferenceFault) {
                this.failInterpolation(fault.offset);
            }

            throw fault;
        }

        // Anything between the reference and the `}` — a trailing space, another word — is not part of
        // the reference and is refused where it begins.
        if (end !== content.length) {
            this.failInterpolation(end);
        }
    }


    private failInterpolation(
        offset: number,
    ): never {
        return deonError(
            DiagnosticCode.PARSE_EXPECTED,
            'An interpolation names a reference between #{ and }, with no surrounding spaces.',
            new Token(
                TokenType.INTERPOLATE,
                '',
                null,
                1,
                offset + 3,
                this.current,
                this.current,
                this.sourceName,
            ),
        );
    }


    /**
     * Whether a string opened at the cursor would find its closing delimiter, looked ahead without
     * consuming. It walks the same characters `string` would — honouring the escape that carries the
     * next character, and, for a singlequote, stopping at the newline it may not cross — and reports
     * whether the delimiter is reached. When it is not, the opening quote begins no string: the caller
     * reads the run as a bare word instead of failing, and the parser decides by position whether that
     * is a real unterminated string or literal content (4.3).
     */
    private stringTerminates(
        delimiter: string,
    ) {
        let index = this.current;

        while (index < this.source.length) {
            const character = this.source[index];

            if (character === delimiter) {
                return true;
            }

            if (delimiter === '\'' && character === '\n') {
                return false;
            }

            if (character === '\\' && index + 1 < this.source.length) {
                index += 2;
                continue;
            }

            index += 1;
        }

        return false;
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
        // The `#` (or `...#`) is already consumed, so the cursor sits at the reference's first
        // character. A reference does not cross a line, so an offset into `raw` maps to an absolute
        // column by adding it to this one — which is how a malformed access is pointed at.
        const rawLine = this.line;
        const rawColumn = this.column;

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

        let reference: Reference;
        try {
            reference = parseReference(raw).reference;
        } catch (fault) {
            if (fault instanceof ReferenceFault) {
                // A dot or bracket the access grammar did not allow. The offence is a character inside
                // the reference, not the whole link, so it is pointed at where it stands (spec 6).
                deonError(
                    DiagnosticCode.PARSE_EXPECTED,
                    fault.message,
                    new Token(
                        type,
                        raw,
                        null,
                        rawLine,
                        rawColumn + fault.offset,
                        start,
                        this.current,
                        this.sourceName,
                    ),
                );
            }

            throw fault;
        }

        this.add(
            type,
            this.source.slice(start, this.current),
            reference,
            start,
            line,
            column,
        );
    }


    /**
     * An unquoted word. It ends at whitespace or at a grouping character, and it swallows any
     * interpolation written inside it, which is resolved later against the evaluated value.
     *
     * `unterminatedQuote` is set when the word began with a `'` or a backtick that opened a string
     * which never closed: the word is read literally, and the flag is carried to the parser, which
     * raises the unterminated-string error only where such a word begins a value, a key, or a target.
     */
    private bare(
        start: number,
        line: number,
        column: number,
        unterminatedQuote = false,
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
                this.advance(); // #
                this.advance(); // {
                const contentStart = this.current;

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

                const content = this.source.slice(contentStart, this.current);
                this.advance(); // }

                this.checkInterpolation(content);
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
            unterminatedQuote,
        );
    }


    private add(
        type: TokenType,
        lexeme: string,
        literal: unknown,
        start: number,
        line: number,
        column: number,
        unterminatedQuote = false,
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
                unterminatedQuote,
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
        } else if (!(isLowSurrogate(character) && isHighSurrogate(this.source[this.current - 2]))) {
            // The trailing half of a surrogate pair completes the astral character its leading half
            // began, so it does not open a new column: the pair is one code point, and therefore one
            // column. `current` still advances by a code unit, so byte offsets and lexeme slices are
            // untouched — only the column counts code points.
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
