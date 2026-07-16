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
 * halves of such a pair: the trailing half advances the UTF-16 cursor without opening a new column,
 * and — in `utf8ByteOffsets` below — carries none of the astral character's four bytes, which its
 * leading half already accounts for.
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
 * A control character that has no literal form in a document (specification 4.3): a C0 control other
 * than a horizontal tab, a line feed, or a carriage return — which keep their separator roles — a
 * `DEL` (`U+007F`), or a C1 control (`U+0080` through `U+009F`). Written raw anywhere in the source,
 * such a character is a lexical error at its own position; it is carried instead by a `\u{…}` escape.
 */
const isControl = (
    character: string,
) => {
    const code = character.charCodeAt(0);

    return (code <= 0x1F && code !== 0x09 && code !== 0x0A && code !== 0x0D)
        || code === 0x7F
        || (code >= 0x80 && code <= 0x9F);
}


/**
 * The number of UTF-8 bytes the UTF-16 code unit at `index` contributes to the encoded source. A
 * character in the Basic Multilingual Plane is one code unit and one, two, or three bytes; an astral
 * character is written as a surrogate pair whose leading half carries all four of its bytes and
 * whose trailing half carries none. Counting the pair this way keeps a byte offset aligned to a code
 * point, so a token's UTF-16 `start`/`end` — which still index the JavaScript string to slice a
 * lexeme out of it — never have to move.
 */
const utf8ByteLength = (
    source: string,
    index: number,
) => {
    const code = source.charCodeAt(index);

    if (code <= 0x7F) {
        return 1;
    }

    if (code <= 0x7FF) {
        return 2;
    }

    if (isHighSurrogate(source[index])) {
        return isLowSurrogate(source[index + 1]) ? 4 : 3;
    }

    if (isLowSurrogate(source[index])) {
        return 0;
    }

    return 3;
}


/**
 * A table from every UTF-16 code-unit index in `source` to its UTF-8 byte offset, with a final entry
 * for the position one past the end. A diagnostic reports a byte offset into the CRLF-folded source
 * (`spec/diagnostics.md`), but a JavaScript string is indexed in UTF-16 code units; so the scanner
 * keeps its cursor in code units — for slicing — and maps a token's start and end through this table
 * only for the position it reports. Built once, in a single pass, so a token costs one lookup rather
 * than a re-encoding of everything written before it.
 */
const utf8ByteOffsets = (
    source: string,
) => {
    const offsets: number[] = new Array(source.length + 1);
    let bytes = 0;

    for (let index = 0; index < source.length; index += 1) {
        offsets[index] = bytes;
        bytes += utf8ByteLength(source, index);
    }

    offsets[source.length] = bytes;

    return offsets;
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

        // A `\u{HEX}` escape decodes to the Unicode scalar value its one-to-six case-insensitive
        // hexadecimal digits name (specification 4.3). The scanner has already refused a malformed one
        // at its backslash, so a well-formed escape is decoded here and a would-be malformed run — one
        // only a path that never met the scanner could carry — is left as its literal characters
        // rather than throwing without a position to point at.
        if (raw.startsWith('\\u{', index)) {
            const close = raw.indexOf('}', index + 3);

            if (close !== -1) {
                const hex = raw.slice(index + 3, close);

                if (/^[0-9A-Fa-f]{1,6}$/.test(hex)) {
                    const codePoint = parseInt(hex, 16);

                    if (codePoint <= 0x10FFFF && !(codePoint >= 0xD800 && codePoint <= 0xDFFF)) {
                        value += String.fromCodePoint(codePoint);
                        index = close;
                        continue;
                    }
                }
            }
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
 * Resolves a scanned name to the literal it stands for. A name is never interpolated (specification
 * 4.4): the interpolator that turns the sentinel an escaped `\#{` leaves behind back into `#{` runs
 * only over an evaluated value, never over a name. So a name resolves that sentinel to the literal
 * `#{` here instead, and one written `'a\#{n}'` finalizes to the very same literal `a#{n}` as one
 * written `'a#{n}'` — the `#{` carried as text, never a reference.
 *
 * It takes the already-decoded string, not the raw source, so it can finalize both a name the
 * scanner decoded into a token literal and one `parseReference` decodes for a reference.
 */
export const finalizeName = (
    decoded: string,
) => decoded.split(ESCAPED_INTERPOLATION).join('#{');


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

        return finalizeName(decodeMinimal(value, '\''));
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
    private readonly byteOffsets: number[];
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
        // The byte offsets index this folded source, so a `\r\n` folded to `\n` counts as the one
        // byte it became — a diagnostic's offset is into the folded text, never the original.
        this.byteOffsets = utf8ByteOffsets(this.source);
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
                '',
                false,
                this.byteOffsets[this.current],
                this.byteOffsets[this.current],
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

        this.checkInterpolation(content, start, line, column);

        const lexeme = this.source.slice(start, this.current);
        this.add(TokenType.INTERPOLATE, lexeme, lexeme, start, line, column);
    }


    /**
     * An interpolation names a reference written immediately between `#{` and `}`, with no
     * surrounding whitespace and never empty (specification 10). The reference within is recovered by
     * decoding and has no source position of its own, so §11.2 anchors a fault at the string that
     * carries the interpolation — not at a position inside it. The enclosing scan passes the carrying
     * value's real `start` (its first retained UTF-16 index), `line`, and `column`, which is where the
     * fault is pointed.
     */
    private checkInterpolation(
        content: string,
        start: number,
        line: number,
        column: number,
    ) {
        let end: number;

        try {
            end = parseReference(content).end;
        } catch (fault) {
            if (fault instanceof ReferenceFault) {
                this.failInterpolation(start, line, column);
            }

            throw fault;
        }

        // Anything between the reference and the `}` — a trailing space, another word — is not part of
        // the reference, and is refused at the carrying string too, never at a position inside the
        // `#{…}`.
        if (end !== content.length) {
            this.failInterpolation(start, line, column);
        }
    }


    /**
     * Raises the malformed-interpolation fault (§11.2), anchored at the carrying string's real start:
     * `line` and `column` are the value's first retained character, and `byteStart` is that same
     * character's UTF-8 offset into the folded source. The reference decoded from within the `#{…}`
     * has no source position of its own, so the diagnostic sits on the string that carries it rather
     * than on a fabricated position inside the interpolation.
     */
    private failInterpolation(
        start: number,
        line: number,
        column: number,
    ): never {
        return deonError(
            DiagnosticCode.PARSE_EXPECTED,
            'An interpolation names a reference between #{ and }, with no surrounding spaces.',
            new Token(
                TokenType.INTERPOLATE,
                '',
                null,
                line,
                column,
                start,
                start,
                this.sourceName,
                '',
                false,
                this.byteOffsets[start],
                this.byteOffsets[start],
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

                // A backtick trims the ASCII whitespace of its layout (specification 4.1) and nothing
                // else, so a Unicode space such as U+00A0 at a boundary is kept as content.
                const content = delimiter === '`'
                    ? raw.replace(/^[ \t\n\r]+/, '').replace(/[ \t\n\r]+$/, '')
                    : raw;
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

            // A `\u{…}` escape is validated at its backslash and read through its closing brace, so its
            // literal characters are retained here and turned into the code point by `decodeMinimal`.
            if (character === '\\' && this.peek(1) === 'u' && this.peek(2) === '{') {
                raw += this.unicodeEscape(TokenType.STRING);
                continue;
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


    /**
     * Validates and consumes the `\u{HEX}` escape the cursor sits on — the cursor is on its backslash
     * — returning the exact source characters so a caller building a raw buffer keeps them; the code
     * point itself is produced later, by `decodeMinimal`. `HEX` is one to six case-insensitive
     * hexadecimal digits naming a Unicode scalar value: at most `U+10FFFF`, and never a surrogate
     * (`U+D800` through `U+DFFF`). An empty escape, a non-hexadecimal digit, an over-long run, an
     * out-of-range value, or a surrogate is `DEON_LEX_INVALID`; a brace that never closes before the
     * end of the source is `DEON_LEX_UNTERMINATED`. Both anchor at the backslash (specification 4.3),
     * so the escape is measured ahead of the cursor and consumed only once it is known to be valid.
     */
    private unicodeEscape(
        type: TokenType,
    ) {
        const backslash = this.current;
        const line = this.line;
        const column = this.column;

        let scan = backslash + 3; // past the '\u{'
        while (scan < this.source.length && this.source[scan] !== '}') {
            scan += 1;
        }

        if (scan >= this.source.length) {
            this.fail(
                type,
                DiagnosticCode.LEX_UNTERMINATED,
                'Unterminated unicode escape.',
                backslash,
                line,
                column,
            );
        }

        const hex = this.source.slice(backslash + 3, scan);
        const codePoint = /^[0-9A-Fa-f]{1,6}$/.test(hex) ? parseInt(hex, 16) : Number.NaN;

        if (
            Number.isNaN(codePoint)
            || codePoint > 0x10FFFF
            || (codePoint >= 0xD800 && codePoint <= 0xDFFF)
        ) {
            this.fail(
                type,
                DiagnosticCode.LEX_INVALID,
                'A unicode escape names one to six hexadecimal digits of a Unicode scalar value.',
                backslash,
                line,
                column,
            );
        }

        // The validated escape holds only ASCII hex and braces — no newline, no control — so
        // consuming it advances one column each without tripping the raw-control guard in `advance`.
        while (this.current <= scan) {
            this.advance();
        }

        return this.source.slice(backslash, this.current);
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
        const rawStart = this.current;

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
                // the reference, not the whole link, so it is pointed at where it stands (spec 6): the
                // column counts code points into the reference, and the offset maps the same character
                // through to its byte, rather than reporting the byte of the link's `#`.
                const faultStart = rawStart + [...raw].slice(0, fault.offset).join('').length;

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
                        '',
                        false,
                        this.byteOffsets[faultStart],
                        this.byteOffsets[this.current],
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
        // The dispatcher consumes a value's first character before calling this, so a value that opens
        // with the '\' of an escape arrives with the cursor already past that backslash. Rewind onto it
        // so a value-initial escape — an escaped backslash `\\`, a unicode escape `\u{…}`, or an
        // escaped interpolation `\#{…}` — takes the very same path as a mid-word one, rather than the
        // greedy '#{' branch or, for `\u{…}`, a `{` that would otherwise end the value (specification
        // 4.3: value-initial and mid-string escapes behave identically). A value-initial backslash that
        // attaches a space or a tab (`\ `, `\<tab>`) is rewound the same way: with the cursor already
        // past the backslash the loop would break on that whitespace and drop it, so it is put back onto
        // the backslash for the attach branch below to keep the whitespace as content.
        if (
            this.current === start + 1
            && (
                this.source.startsWith('\\\\', start)
                || this.source.startsWith('\\u{', start)
                || this.source.startsWith('\\#{', start)
                || this.source.startsWith('\\ ', start)
                || this.source.startsWith('\\\t', start)
            )
        ) {
            this.current = start;
            this.column -= 1;
        }

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
                this.bareInterpolation(start, line, column);
                continue;
            }

            // An escaped backslash is taken as a unit, so the second backslash never opens a further
            // escape: `\\u{1b}` is a backslash then the literal `u{1b}` — whose `{` ends the unquoted
            // value — rather than a unicode escape, and `\\#{x}` a backslash then a real interpolation.
            if (this.source.startsWith('\\\\', this.current)) {
                this.advance();
                this.advance();
                continue;
            }

            // A `\u{…}` unicode escape is read through its closing brace so its `{` does not end the
            // value, and a malformed one fails at the backslash (specification 4.3). Its literal
            // characters stay in the lexeme and become the code point through `decodeMinimal`.
            if (this.source.startsWith('\\u{', this.current)) {
                this.unicodeEscape(TokenType.SIGNIFIER);
                continue;
            }

            // An escaped interpolation `\#{reference}` is lexed exactly as the `#{reference}` it
            // mirrors, and kept as the literal characters `#{reference}` rather than resolved
            // (specification 4.3, 10). It is read through its closing `}` — so a word carrying one
            // (`p\#{x}q`) is not cut in two at the brace — whenever a reference actually closes it.
            // Where none does before the word ends (a space, the group's edge), the backslash escapes
            // only the `#{` opener and the reference text is ordinary content, which keeps `p\#{q` the
            // literal `p#{q`. In either case `decodeMinimal` turns the `\#{` into the literal `#{`.
            if (this.source.startsWith('\\#{', this.current)) {
                if (this.escapedInterpolationCloses()) {
                    this.advance(); // the escaping backslash
                    this.bareInterpolation(start, line, column);
                } else {
                    this.advance(); // \
                    this.advance(); // #
                    this.advance(); // {
                }

                continue;
            }

            // A lone backslash immediately before a space or a tab attaches that one whitespace
            // character as literal content (specification 4.3): it belongs to the preserved backslash
            // sequence rather than to the separator whitespace that boundary trimming removes, so the
            // value written `\ ` is the two characters backslash and space, its trailing space
            // surviving. A backslash that completes an escape — `\\`, `\u{…}`, `\#{` — has already been
            // taken above, so the one reaching here does not, and it attaches its neighbour. Only that
            // single character is kept: any whitespace beyond it is ordinary trailing separator
            // whitespace, and the loop breaks on it next as usual.
            if (character === '\\' && (this.peek(1) === ' ' || this.peek(1) === '\t')) {
                this.advance(); // the backslash
                this.advance(); // the attached space or tab
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


    /**
     * Consumes a `#{...}` written inside an unquoted word, the cursor on its `#`, reading through the
     * closing `}` and validating the reference exactly as a value-position interpolation is
     * (specification 10). An unterminated one is `DEON_LEX_UNTERMINATED`; an empty or
     * whitespace-surrounded reference is `DEON_PARSE_EXPECTED` at the position a real one gives. Shared
     * by a real interpolation and by the closed form of an escaped one, so both report the same code
     * and position.
     */
    private bareInterpolation(
        start: number,
        line: number,
        column: number,
    ) {
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

        this.checkInterpolation(content, start, line, column);
    }


    /**
     * Whether an escaped `\#{...}` at the cursor is closed by a `}` that a reference reaches — scanning
     * forward from past the `\#{` over the characters a reference may hold. When a `}` is reached, the
     * escaped interpolation is lexed through its brace exactly like a real one (`\#{x}`); when a space
     * or the group's edge comes first, no reference closes it, so the backslash escapes only the `#{`
     * opener and the following text is ordinary content (`p\#{q` stays the literal `p#{q`) — the
     * lenient-versus-strict split section 4.3 settles in favour of a reference actually closing.
     */
    private escapedInterpolationCloses() {
        let index = this.current + 3; // past the '\#{'

        while (index < this.source.length) {
            const character = this.source[index];

            if (character === '}') {
                return true;
            }

            // A reference is name characters, dots, brackets, quotes, and the environment '$'. Anything
            // else — a space, a comma, another opener — ends the word before a reference could close.
            if (!/[A-Za-z0-9_.$'\[\]-]/.test(character)) {
                return false;
            }

            index += 1;
        }

        return false;
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
                this.byteOffsets[start],
                this.byteOffsets[this.current],
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
                '',
                false,
                this.byteOffsets[start],
                this.byteOffsets[this.current],
            ),
        );
    }


    private advance() {
        const index = this.current;
        const character = this.source[index] ?? '\0';
        this.current = index + 1;

        // A raw control character has no literal form anywhere in the source — inside a string, inside
        // a comment, or between tokens — and is refused at its own position (specification 4.3). Every
        // consumed character passes through here, so this one guard covers them all; the length check
        // excludes the '\0' the read yields past the end, which names no source character. The failure
        // is reported before the position advances, so it sits on the control rather than past it.
        if (index < this.source.length && isControl(character)) {
            this.fail(
                TokenType.SIGNIFIER,
                DiagnosticCode.LEX_INVALID,
                'A control character must be written with a \\u{…} escape.',
                index,
                this.line,
                this.column,
            );
        }

        if (character === '\n') {
            this.line += 1;
            this.column = 1;
        } else if (!(isLowSurrogate(character) && isHighSurrogate(this.source[index - 1]))) {
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
