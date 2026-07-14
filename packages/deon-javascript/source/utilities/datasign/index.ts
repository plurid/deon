// #region imports
    // #region external
    import {
        TokenType,
    } from '../../data/enumerations';

    import {
        DeonValue,
    } from '../../data/syntax';

    import {
        deonError,
        DiagnosticCode,
        DiagnosticCodeValue,
    } from '../../objects/Diagnostic';

    import Token from '../../objects/Token';
    // #endregion external
// #endregion imports



// #region module
export interface DatasignField {
    name: string;
    type: string;
    required: boolean;
}

/**
 * A `.datasign` entity name mapped to its declared fields.
 */
export type DatasignSignatures = Record<string, DatasignField[]>;

/**
 * Reads `.datasign` source into signatures. Supplying one replaces the built-in reader, so
 * `@plurid/datasign` can own the format once it exposes its parser (today every public entry point
 * of that package returns generated code, not the parsed entities).
 */
export type DatasignReader = (source: string) => DatasignSignatures;


const ENTITY_START = /^\s*data\s+(\w+)\s*\{/;
const ENTITY_END = /^\s*\}/;
const ANNOTATION = /^\s*@/;
const COMMENT = /^\s*(\/\/|\/\*|\*)/;


/**
 * Reads the `.datasign` data contract format:
 *
 *     data Entity {
 *         name: string;
 *         age: number;
 *         nickname?: string;   // optional
 *     }
 *
 * Annotations (`@graphql ID`) and comments carry no meaning for typing and are skipped. Only the
 * shape is taken: an entity name, and each field's name, type, and whether it is required.
 */
export const parseDatasign: DatasignReader = (
    source: string,
) => {
    const signatures: DatasignSignatures = {};
    let fields: DatasignField[] | null = null;

    for (const line of source.split('\n')) {
        if (COMMENT.test(line) || ANNOTATION.test(line)) {
            continue;
        }

        const value = line.replace(/\/\/.*$/, '');
        if (!value.trim()) {
            continue;
        }

        const start = value.match(ENTITY_START);
        if (start) {
            fields = [];
            signatures[start[1]] = fields;
            continue;
        }

        if (ENTITY_END.test(value)) {
            fields = null;
            continue;
        }

        if (!fields) {
            continue;
        }

        const separator = value.indexOf(':');
        if (separator === -1) {
            continue;
        }

        const name = value.slice(0, separator).trim();
        const type = value.slice(separator + 1).replace(/;\s*$/, '').trim();
        if (!name || !type) {
            continue;
        }

        fields.push({
            name: name.replace(/\?$/, ''),
            type,
            required: !name.endsWith('?'),
        });
    }

    return signatures;
}


// Typing happens after evaluation, so no source token survives to point at. The path through the
// data (`entities[0].age`) is what makes the diagnostic actionable, not a line number.
export const datasignError = (
    code: DiagnosticCodeValue,
    message: string,
    source: string,
): never => deonError(
    code,
    message,
    new Token(TokenType.EOF, '', null, 1, 1, 0, 0, source),
);


const mismatch = (
    message: string,
    source: string,
) => datasignError(DiagnosticCode.TYPE_MISMATCH, message, source);


const describe = (
    value: DeonValue,
) => {
    if (typeof value === 'string') return 'a string';
    if (Array.isArray(value)) return 'a list';
    return 'a map';
}


/**
 * Converts one evaluated Deon value to its declared datasign type.
 *
 * Deon values are only strings, lists, and maps, so this is the point where a declaration supplies
 * the intent a value cannot carry on its own: `007` is an id or a count depending on what was
 * declared, and no amount of looking at the value will say which.
 *
 * A type that names neither a primitive nor a known entity (`Date`, say, which datasign expects to
 * be defined elsewhere) leaves its value untouched rather than guessing at a conversion.
 */
export const typeDatasign = (
    value: DeonValue,
    type: string,
    signatures: DatasignSignatures,
    path: string,
    source: string,
): unknown => {
    const declared = type.trim();

    if (declared.endsWith('[]')) {
        if (!Array.isArray(value)) {
            return mismatch(`Expected '${path}' to be a list for '${declared}', found ${describe(value)}.`, source);
        }

        const item = declared.slice(0, -2).trim();
        return value.map((entry, index) => typeDatasign(entry, item, signatures, `${path}[${index}]`, source));
    }

    if (declared === 'string' || declared === 'number' || declared === 'boolean') {
        if (typeof value !== 'string') {
            return mismatch(`Expected '${path}' to be a string for '${declared}', found ${describe(value)}.`, source);
        }

        if (declared === 'string') {
            return value;
        }

        if (declared === 'boolean') {
            if (value === 'true') return true;
            if (value === 'false') return false;
            return mismatch(`Expected '${path}' to be 'true' or 'false' for 'boolean', found '${value}'.`, source);
        }

        const numeric = Number(value);
        if (!value.trim() || !Number.isFinite(numeric)) {
            return mismatch(`Expected '${path}' to be a number, found '${value}'.`, source);
        }
        return numeric;
    }

    const entity = signatures[declared];
    if (!entity) {
        // An externally-defined type. Datasign does not describe it, so neither does Deon.
        return value;
    }

    if (typeof value !== 'object' || Array.isArray(value)) {
        return mismatch(`Expected '${path}' to be a map for '${declared}', found ${describe(value)}.`, source);
    }

    const fields = new Map(entity.map(field => [field.name, field]));
    const result: Record<string, unknown> = {};

    // Deon's write order is preserved, and a key the contract does not mention passes through
    // untyped rather than being dropped.
    for (const [key, entry] of Object.entries(value)) {
        const field = fields.get(key);
        result[key] = field
            ? typeDatasign(entry, field.type, signatures, `${path}.${key}`, source)
            : entry;
    }

    for (const field of entity) {
        if (field.required && !Object.prototype.hasOwnProperty.call(result, field.name)) {
            return mismatch(`Required field '${path}.${field.name}' of '${declared}' is missing.`, source);
        }
    }

    return result;
}


/**
 * Applies `datasignMap` to an evaluated root: each named root key is converted to the datasign type
 * declared for it. Keys absent from the map, and keys absent from the data, are left alone.
 */
export const applyDatasign = (
    root: DeonValue,
    signatures: DatasignSignatures,
    map: Record<string, string>,
    source = '<datasign>',
) => {
    const entries = Object.entries(map);
    if (!entries.length) {
        return root;
    }

    if (typeof root !== 'object' || Array.isArray(root)) {
        return mismatch(`A datasignMap requires a root map, found ${describe(root)}.`, source);
    }

    const result: Record<string, unknown> = { ...root };

    for (const [key, type] of entries) {
        if (!Object.prototype.hasOwnProperty.call(root, key)) {
            continue;
        }

        result[key] = typeDatasign(root[key], type, signatures, key, source);
    }

    return result;
}


/**
 * Reads every `.datasign` source into one set of signatures. Later files win on a repeated entity.
 */
export const readDatasign = (
    sources: string[],
    reader: DatasignReader = parseDatasign,
) => {
    const signatures: DatasignSignatures = {};

    for (const source of sources) {
        Object.assign(signatures, reader(source));
    }

    return signatures;
}
// #endregion module
