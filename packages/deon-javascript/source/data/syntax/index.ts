// #region imports
    // #region external
    import Token from '../../objects/Token';
    // #endregion external
// #endregion imports



// #region module
/**
 * A Deon value is exactly one of three things: a string, an ordered list, or an ordered map. There
 * is no null, no boolean, and no number, so a host that has them must say what they become
 * (specification 2).
 */
export type DeonValue =
    | string
    | DeonValue[]
    | { [key: string]: DeonValue };


/**
 * One navigation step of a link (specification 6). A dot segment is always a map key. A bracket
 * segment is a list index only when its content is a run of decimal digits — leading zeros allowed,
 * read as the integer — and is otherwise a map key: a quoted string, or the exact characters written
 * between the brackets.
 */
export interface AccessSegment {
    // The map key to look up, or the digits of an index. Kept verbatim, so a shortened link receives
    // under the exact text between its brackets and a diagnostic can quote it.
    name: string;
    // A decimal-digit bracket segment reaches a list by position. A dot, a quoted bracket, or a
    // non-digit bracket is a key, never an index, so it is `DEON_UNRESOLVED_LINK` on a list.
    byIndex: boolean;
    // The parsed index, meaningful only when `byIndex`. A run of digits too large to represent
    // becomes a value past any list length, which resolves as out-of-range rather than a crash.
    index: number;
}


/**
 * What a link, spread, interpolation, or call names: a head — a leaflink or entity name, a quoted
 * name, or an environment name kept with its `$` — and the segments that navigate into it.
 */
export interface Reference {
    head: string;
    access: AccessSegment[];
}


export interface ScalarNode {
    type: 'scalar';
    value: string;
    /**
     * A scalar parsed from source carries its `#{…}` interpolations and escapes unresolved, to be
     * decoded when it is evaluated. A scalar reconstructed from an already-final value — an injected
     * resource, which specification 9 binds without parsing, or an imported one, whose strings were
     * resolved as it was read — is `literal`: its text is the value itself, and evaluating it must
     * not decode it a second time, or an injected `#{x}` would resolve where it should stay literal.
     */
    literal?: boolean;
    token: Token;
}

export interface LinkNode {
    type: 'link';
    reference: Reference;
    token: Token;
}

export interface CallArgumentNode {
    name: string;
    value: ValueNode;
    token: Token;
}

export interface CallNode {
    type: 'call';
    reference: Reference;
    arguments: CallArgumentNode[];
    token: Token;
}


export interface MapEntryNode {
    type: 'entry';
    name: string;
    value: ValueNode;
    token: Token;
}

/**
 * The shortened form, which takes its receiving key from the last segment of the link.
 */
export interface MapLinkNode {
    type: 'link-entry';
    value: LinkNode | CallNode;
    token: Token;
}

export interface MapSpreadNode {
    type: 'spread-entry';
    reference: Reference;
    token: Token;
}

export type MapItemNode =
    | MapEntryNode
    | MapLinkNode
    | MapSpreadNode;

export interface MapNode {
    type: 'map';
    entries: MapItemNode[];
    token: Token;
}


export interface ListSpreadNode {
    type: 'spread-item';
    reference: Reference;
    token: Token;
}

export interface ListNode {
    type: 'list';
    items: (ValueNode | ListSpreadNode)[];
    token: Token;
}


/**
 * A list of maps written as a table: a signature, and the rows under it.
 */
export interface StructureNode {
    type: 'structure';
    fields: string[];
    rows: ValueNode[][];
    token: Token;
}


export type ValueNode =
    | ScalarNode
    | LinkNode
    | CallNode
    | MapNode
    | ListNode
    | StructureNode;


export interface LeaflinkNode {
    type: 'leaflink';
    name: string;
    value: ValueNode;
    token: Token;
}

export interface ResourceNode {
    type: 'import' | 'inject';
    name: string;
    target: string;
    authenticator: ValueNode | null;
    token: Token;
}

export type DeclarationNode =
    | LeaflinkNode
    | ResourceNode;


/**
 * Any number of declarations around exactly one root, written in any order (specification 3).
 */
export interface DocumentNode {
    type: 'document';
    declarations: DeclarationNode[];
    root: MapNode | ListNode;
    source: string;
}


export const scalarNode = (
    value: string,
    token: Token,
) => ({
    type: 'scalar',
    value,
    token,
} as ScalarNode);
// #endregion module
