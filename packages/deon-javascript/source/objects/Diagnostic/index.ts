// #region imports
    // #region external
    import {
        TokenType,
    } from '../../data/enumerations';

    import Token from '../Token';
    // #endregion external
// #endregion imports



// #region module
/**
 * The diagnostic catalogue. A conforming implementation reports these codes, and these positions,
 * for an invalid document, so they are part of the specification rather than of this port.
 */
export const DiagnosticCode = {
    CAPABILITY_DENIED: 'DEON_CAPABILITY_DENIED',
    CYCLE: 'DEON_CYCLE',
    DUPLICATE_DECLARATION: 'DEON_DUPLICATE_DECLARATION',
    ENTITY_ARGUMENT: 'DEON_ENTITY_ARGUMENT',
    LEX_INVALID: 'DEON_LEX_INVALID',
    LEX_UNTERMINATED: 'DEON_LEX_UNTERMINATED',
    LIMIT_EXCEEDED: 'DEON_LIMIT_EXCEEDED',
    LINT_DUPLICATE_KEY: 'DEON_LINT_DUPLICATE_KEY',
    PARSE_EXPECTED: 'DEON_PARSE_EXPECTED',
    PARSE_ROOT: 'DEON_PARSE_ROOT',
    RESOURCE_FORMAT: 'DEON_RESOURCE_FORMAT',
    RESOURCE_IO: 'DEON_RESOURCE_IO',
    STRUCTURE_ARITY: 'DEON_STRUCTURE_ARITY',
    TYPE_MISMATCH: 'DEON_TYPE_MISMATCH',
    UNRESOLVED_LINK: 'DEON_UNRESOLVED_LINK',
} as const;


export type DiagnosticCodeValue = typeof DiagnosticCode[keyof typeof DiagnosticCode];


interface Position {
    offset: number;
    line: number;
    column: number;
}


interface Range {
    start: Position;
    end: Position;
}


/**
 * The span a token occupies. Both the primary underline and every related span are built from a
 * token this same way, so the two never drift in what they measure.
 */
const rangeFromToken = (
    token: Token,
): Range => ({
    start: {
        offset: token.byteStart,
        line: token.line,
        column: token.column,
    },
    end: {
        offset: token.byteEnd,
        line: token.endLine,
        column: token.endColumn,
    },
});


/**
 * What went wrong, and exactly where. An editor reads the range to underline the offending text.
 *
 * `related` carries secondary spans the reader is sent to — the first declaration behind a duplicate,
 * for instance — as full ranges, built from their tokens exactly as the primary is (spec/diagnostics.md).
 * A diagnostic with nowhere else to point leaves it empty.
 */
export class DeonDiagnostic {
    public readonly code: DiagnosticCodeValue;
    public readonly severity: 'error' | 'warning';
    public readonly message: string;
    public readonly source: string;
    public readonly range: Range;
    public readonly related: Range[];

    constructor(
        code: DiagnosticCodeValue,
        message: string,
        token: Token,
        severity: 'error' | 'warning' = 'error',
        related: Token[] = [],
    ) {
        this.code = code;
        this.severity = severity;
        this.message = message;
        this.source = token.source;
        this.range = rangeFromToken(token);
        this.related = related.map(rangeFromToken);
    }
}


/**
 * Evaluation is atomic: the first error ends it, carrying its diagnostics out with it.
 */
export class DeonError extends Error {
    public readonly code: DiagnosticCodeValue;
    public readonly diagnostics: DeonDiagnostic[];

    constructor(
        code: DiagnosticCodeValue,
        message: string,
        token: Token,
        related: Token[] = [],
    ) {
        super(message);

        this.name = 'DeonError';
        this.code = code;
        this.diagnostics = [new DeonDiagnostic(code, message, token, 'error', related)];
    }
}


/**
 * The annotation must sit on the declaration, not only on the arrow's return type: control-flow
 * analysis narrows across a call only when the declared name is explicitly typed. Without it, every
 * caller would have to convince the compiler, again, that the code after a raised error is dead.
 */
export const deonError: (
    code: DiagnosticCodeValue,
    message: string,
    token: Token,
    related?: Token[],
) => never = (
    code,
    message,
    token,
    related = [],
) => {
    throw new DeonError(code, message, token, related);
};


/**
 * An error about a resource rather than about something written inside a document: a link that may
 * not be reached, a status that was not a success. There is no token to point at, because nothing
 * was read, so the diagnostic points at the beginning of the resource it names.
 */
export const resourceError: (
    code: DiagnosticCodeValue,
    message: string,
    source: string,
) => never = (
    code,
    message,
    source,
) => deonError(
    code,
    message,
    new Token(TokenType.EOF, '', null, 1, 1, 0, 0, source),
);


/**
 * Bytes read from a resource, decoded as UTF-8 and refused if they are not.
 *
 * A read that succeeded returned bytes, and bytes are not yet a document: their encoding is the last
 * thing that can be wrong before the scanner is ever handed them. A lenient reader would paper over
 * an invalid byte with U+FFFD and pass on a mangled document; a fatal `TextDecoder` refuses it, and
 * the refusal is a `DEON_RESOURCE_FORMAT` and not a `DEON_RESOURCE_IO` — the bytes *were* read, so
 * this is a fault of format and not of access (specification 1, 9). There is no token to point at,
 * so it is anchored at the start of the resource, exactly as `resourceError` anchors anything a
 * document has not yet been made from.
 */
export const decodeResource: (
    bytes: Uint8Array,
    source: string,
) => string = (
    bytes,
    source,
) => {
    try {
        // `fatal` refuses invalid bytes rather than papering over them with U+FFFD; `ignoreBOM` keeps
        // a leading byte-order mark as U+FEFF, exactly as the lenient reader this replaces did, so a
        // valid document decodes byte-for-byte as before and only an invalid one now fails.
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
        return resourceError(
            DiagnosticCode.RESOURCE_FORMAT,
            `The resource '${source}' is not valid UTF-8.`,
            source,
        );
    }
};
// #endregion module
