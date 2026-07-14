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
 * What went wrong, and exactly where. An editor reads the range to underline the offending text.
 */
export class DeonDiagnostic {
    public readonly code: DiagnosticCodeValue;
    public readonly severity: 'error' | 'warning';
    public readonly message: string;
    public readonly source: string;
    public readonly range: Range;

    constructor(
        code: DiagnosticCodeValue,
        message: string,
        token: Token,
        severity: 'error' | 'warning' = 'error',
    ) {
        this.code = code;
        this.severity = severity;
        this.message = message;
        this.source = token.source;

        this.range = {
            start: {
                offset: token.start,
                line: token.line,
                column: token.column,
            },
            end: {
                offset: token.end,
                line: token.endLine,
                column: token.endColumn,
            },
        };
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
    ) {
        super(message);

        this.name = 'DeonError';
        this.code = code;
        this.diagnostics = [new DeonDiagnostic(code, message, token)];
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
) => never = (
    code,
    message,
    token,
) => {
    throw new DeonError(code, message, token);
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
// #endregion module
