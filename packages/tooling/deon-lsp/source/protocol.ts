// The slice of the Language Server Protocol this server speaks. Only the shapes it actually sends or
// receives are named; the protocol is large and most of it is not needed to give a Deon author live
// diagnostics, an outline, a hover, a jump to a declaration, and a completion.

// #region imports
    import type { LspRange, LspPosition } from './positions.js';
// #endregion imports



// #region module
/**
 * How the editor keeps the server's copy of a document current. `Full` means every change carries
 * the whole text — the simplest correct choice, and what this server asks for.
 */
export const TextDocumentSyncKind = {
    None: 0,
    Full: 1,
    Incremental: 2,
} as const;


/**
 * Diagnostic severity, as the protocol numbers it. Deon has just the two: an error refuses the
 * document, a warning (a duplicate key) does not.
 */
export const DiagnosticSeverity = {
    Error: 1,
    Warning: 2,
    Information: 3,
    Hint: 4,
} as const;


/**
 * The kinds an outline entry may take. A leaflink is a constant, an import or an inject a module, an
 * entity a function, a map a struct, a list an array, and a plain key a field — the nearest the
 * protocol's fixed vocabulary comes to Deon's own.
 */
export const SymbolKind = {
    File: 1,
    Module: 2,
    Namespace: 3,
    Package: 4,
    Class: 5,
    Method: 6,
    Property: 7,
    Field: 8,
    Constructor: 9,
    Enum: 10,
    Interface: 11,
    Function: 12,
    Variable: 13,
    Constant: 14,
    String: 15,
    Number: 16,
    Boolean: 17,
    Array: 18,
    Object: 19,
    Key: 20,
    Null: 21,
    EnumMember: 22,
    Struct: 23,
    Event: 24,
    Operator: 25,
    TypeParameter: 26,
} as const;


export const CompletionItemKind = {
    Text: 1,
    Method: 2,
    Function: 3,
    Constructor: 4,
    Field: 5,
    Variable: 6,
    Module: 9,
    Property: 10,
    Keyword: 14,
    Constant: 21,
} as const;


export interface LspDiagnosticRelated {
    location: { uri: string; range: LspRange };
    message: string;
}

export interface LspDiagnostic {
    range: LspRange;
    severity: number;
    code: string;
    source: 'deon';
    message: string;
    relatedInformation?: LspDiagnosticRelated[];
}


export interface DocumentSymbol {
    name: string;
    detail?: string;
    kind: number;
    range: LspRange;
    selectionRange: LspRange;
    children?: DocumentSymbol[];
}


export interface Location {
    uri: string;
    range: LspRange;
}


export interface MarkupContent {
    kind: 'markdown' | 'plaintext';
    value: string;
}

export interface Hover {
    contents: MarkupContent;
    range?: LspRange;
}


export interface CompletionItem {
    label: string;
    kind: number;
    detail?: string;
}


export interface TextDocumentPositionParams {
    textDocument: { uri: string };
    position: LspPosition;
}


/**
 * The semantic-token legend the server declares and then indexes into. The order is the contract: a
 * token names its type by that type's position in this array, and its modifiers by a bit set at the
 * position in the modifier array. The editor is told both on `initialize`.
 */
export const SEMANTIC_TOKEN_TYPES = [
    'variable',
    'property',
    'function',
    'keyword',
    'string',
    'parameter',
] as const;

export const SEMANTIC_TOKEN_MODIFIERS = [
    'declaration',
] as const;

export const SemanticTokenType = {
    variable: 0,
    property: 1,
    function: 2,
    keyword: 3,
    string: 4,
    parameter: 5,
} as const;

export const SemanticTokenModifier = {
    declaration: 1 << 0,
} as const;

export interface SemanticTokens {
    data: number[];
}


export interface ParameterInformation {
    label: string;
}

export interface SignatureInformation {
    label: string;
    documentation?: MarkupContent;
    parameters: ParameterInformation[];
}

export interface SignatureHelp {
    signatures: SignatureInformation[];
    activeSignature: number;
    activeParameter: number;
}
// #endregion module
