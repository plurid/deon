// #region imports
    // #region external
    import {
        deonStrigifyOptions,
    } from '../../data/constants';

    import {
        DeonStringifyOptions,
        PartialDeonStringifyOptions,
    } from '../../data/interfaces';

    import {
        DeonValue,
    } from '../../data/syntax';

    import {
        guardDepth,
    } from '../../utilities/guardDepth';
    // #endregion external
// #endregion imports



// #region module
/**
 * A leaflink standing in for the value that was extracted out of the root.
 */
interface LinkValue {
    kind: 'link';
    name: string;
}

type Serializable = DeonValue | LinkValue;

interface GeneratedLeaflink {
    name: string;
    value: DeonValue;
}


const isLink = (
    value: Serializable,
): value is LinkValue => typeof value === 'object'
    && !Array.isArray(value)
    && 'kind' in value
    && value.kind === 'link';


const isContainer = (
    value: DeonValue,
) => Array.isArray(value) || typeof value === 'object';


/**
 * Brings a host value into the Deon data model, where everything is a string, a list, or a map.
 */
const normalize = (
    value: unknown,
): DeonValue => {
    if (value === null || value === undefined) {
        return '';
    }

    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError('Deon cannot stringify non-finite numbers.');
        }

        return String(value);
    }

    if (Array.isArray(value)) {
        return value.map(normalize);
    }

    if (typeof value === 'object') {
        const result: Record<string, DeonValue> = {};

        for (const [key, entry] of Object.entries(value)) {
            Object.defineProperty(result, key, {
                configurable: true,
                enumerable: true,
                value: normalize(entry),
                writable: true,
            });
        }

        return result;
    }

    throw new TypeError(`Deon cannot stringify a value of type '${typeof value}'.`);
}


/**
 * Canonical output sorts map keys by code point, not by the host's locale.
 */
const compareCodePoints = (
    left: string,
    right: string,
) => {
    const a = Array.from(left, character => character.codePointAt(0) as number);
    const b = Array.from(right, character => character.codePointAt(0) as number);

    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
        if (a[index] !== b[index]) {
            return a[index] - b[index];
        }
    }

    return a.length - b.length;
}


/**
 * The backslash is doubled before any escape is introduced, or the backslash of that escape would
 * itself be doubled.
 */
const escapeShared = (
    value: string,
) => value
    .replace(/\\/g, '\\\\')
    .replace(/#\{/g, '\\#{');


/**
 * A singlequoted string cannot cross a newline, so its line breaks are written as escapes. Unlike a
 * backticked string, it keeps the whitespace at its boundaries exactly as it is given.
 */
const quoted = (
    value: string,
) => `'${escapeShared(value)
    .replace(/'/g, '\\\'')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')}'`;


/**
 * A backticked string trims the whitespace at its boundaries, so it can only hold a value that has
 * none. Anything else would come back shorter than it went in.
 */
const multiline = (
    value: string,
) => `\`${escapeShared(value).replace(/`/g, '\\`')}\``;


/**
 * Characters that would otherwise be read as syntax. A number sign is quoted wherever it falls, not
 * only at a token boundary: section 4.3 makes an interior `#` harmless literal text, but section 12
 * quotes it all the same so two implementations cannot disagree about the canonical form (section 13).
 */
const unsafe = /#|\\|[\[\]{},()<>]|\/\/|\/\*|['`]/;


/**
 * Writes a string in the shortest form that reads back unchanged.
 *
 * Backticks can hold a laid-out value only when nothing at its boundaries would be trimmed away, and
 * only when it carries no carriage return, which the source normalization would fold into the line
 * ending. Everything else is singlequoted, where an escape says precisely what is meant.
 */
const scalar = (
    value: string,
) => {
    if (!value) {
        return '\'\'';
    }

    const bounded = value !== value.trim();

    if (/\n/.test(value) && !bounded && !/\r/.test(value)) {
        return multiline(value);
    }

    if (bounded || /[\n\r\t]/.test(value) || unsafe.test(value)) {
        return quoted(value);
    }

    return value;
}


const name = (
    value: string,
) => /^[A-Za-z0-9_-]+$/.test(value)
    ? value
    : quoted(value);


/**
 * The root-relative path of a generated leaflink, `~` written as `~0` and `/` as `~1` so that the
 * segments can be joined by `/` without ambiguity.
 */
const pathName = (
    segments: string[],
) => segments
    .map(segment => segment.replace(/~/g, '~0').replace(/\//g, '~1'))
    .join('/');



class Stringifier {
    private readonly options: DeonStringifyOptions;
    private readonly indentation: string;

    constructor(
        options?: PartialDeonStringifyOptions,
    ) {
        this.options = {
            ...deonStrigifyOptions,
            ...options,
        };

        // Canonical output is defined as four spaces and LF, so it is readable by construction.
        if (this.options.canonical) {
            this.options = {
                ...this.options,
                generatedComments: false,
                generatedHeader: false,
                leaflinks: false,
                readable: true,
            };
        }

        if (!Number.isInteger(this.options.indentation) || this.options.indentation < 0) {
            throw new RangeError('Stringification indentation must be a non-negative integer.');
        }

        this.indentation = ' '.repeat(this.options.indentation);
    }


    public stringify(
        input: unknown,
    ) {
        // The guard runs before any recursion below, so a value nesting past the limit is refused with
        // a coded diagnostic rather than taking the host stack down with it.
        guardDepth(input);

        const data = normalize(input);

        const leaflinks: GeneratedLeaflink[] = [];
        const root = this.options.leaflinks && this.options.leaflinkLevel >= 1
            ? this.extract(data, [], 0, leaflinks)
            : data;

        const sections: string[] = [];

        if (this.options.generatedHeader) {
            sections.push('// Generated by Deon.');
        }

        if (this.options.generatedComments) {
            sections.push('// Root.');
        }

        sections.push(this.value(root, 0));

        if (leaflinks.length) {
            if (this.options.generatedComments) {
                sections.push('// Leaflinks.');
            }

            sections.push(
                leaflinks
                    .map(leaflink => `${name(leaflink.name)} ${this.value(leaflink.value, 0)}`)
                    .join('\n\n'),
            );
        }

        return `${sections.join('\n\n').replace(/\n+$/g, '')}\n`;
    }


    /**
     * Lifts the containers sitting exactly at `leaflinkLevel` out of the root and into declarations
     * of their own. Once an ancestor is lifted, its descendants travel with it.
     */
    private extract(
        value: DeonValue,
        path: string[],
        level: number,
        leaflinks: GeneratedLeaflink[],
    ): Serializable {
        if (!isContainer(value)) {
            return value;
        }

        if (level === this.options.leaflinkLevel) {
            const generatedName = pathName(path);
            leaflinks.push({
                name: generatedName,
                value,
            });

            return {
                kind: 'link',
                name: generatedName,
            };
        }

        if (Array.isArray(value)) {
            return value.map(
                (entry, index) => this.extract(entry, [...path, String(index)], level + 1, leaflinks),
            ) as Serializable as DeonValue;
        }

        const result: Record<string, DeonValue> = {};

        for (const [key, entry] of Object.entries(value)) {
            result[key] = this.extract(entry, [...path, key], level + 1, leaflinks) as DeonValue;
        }

        return result;
    }


    private value(
        value: Serializable,
        level: number,
    ): string {
        if (isLink(value)) {
            return `#${name(value.name)}`;
        }

        if (typeof value === 'string') {
            return scalar(value);
        }

        if (Array.isArray(value)) {
            return this.list(value, level);
        }

        return this.map(value, level);
    }


    private map(
        value: Record<string, DeonValue>,
        level: number,
    ) {
        const keys = Object.keys(value);

        if (this.options.canonical) {
            keys.sort(compareCodePoints);
        }

        if (!keys.length) {
            return '{}';
        }

        const entries = keys.map(key => {
            const entry = value[key] as Serializable;

            // The shortened form is only written when the receiving key is the name of the leaflink.
            if (isLink(entry) && this.options.leaflinkShortening && key === entry.name) {
                return `#${name(entry.name)}`;
            }

            return `${name(key)} ${this.value(entry, level + 1)}`;
        });

        return this.group('{', '}', entries, level);
    }


    private list(
        value: DeonValue[],
        level: number,
    ) {
        if (!value.length) {
            return '[]';
        }

        const items = value.map(entry => this.value(entry as Serializable, level + 1));

        return this.group('[', ']', items, level);
    }


    /**
     * Readable output lays each entry on its own line. Otherwise the entries are separated by the
     * comma, which the grammar accepts wherever it accepts a newline.
     */
    private group(
        open: string,
        close: string,
        entries: string[],
        level: number,
    ) {
        if (!this.options.readable) {
            return `${open}${entries.join(', ')}${close}`;
        }

        const indent = this.indentation.repeat(level + 1);
        const closing = this.indentation.repeat(level);

        return `${open}\n${entries.map(entry => indent + entry).join('\n')}\n${closing}${close}`;
    }
}
// #endregion module



// #region exports
export default Stringifier;
// #endregion exports
