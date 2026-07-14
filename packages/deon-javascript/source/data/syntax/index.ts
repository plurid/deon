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
 * The segments a link navigates: `entity.name` is `['entity', 'name']`.
 */
export type Reference = string[];


export interface ScalarNode {
    type: 'scalar';
    value: string;
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
