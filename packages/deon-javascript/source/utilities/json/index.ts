// #region imports
    // #region external
    import type {
        DeonValue,
    } from '../../data/syntax';
    // #endregion external
// #endregion imports



// #region module
/**
 * Reads JSON into the Deon data model, where everything is a string, a list, or a map.
 *
 * The host's own `JSON.parse` cannot be used for this. A JSON number must arrive as the spelling it
 * was written with (specification 9.1), and `JSON.parse` would have already turned it into a host
 * number: `1.0` would come back as `1`, and a number too large for the host to hold would come back
 * as something other than what the document said. So the source is read directly, and a number is
 * carried across as the characters it was written as.
 */
class JsonReader {
    private index = 0;

    constructor(
        private readonly source: string,
    ) {}


    public parse(): DeonValue {
        const value = this.value();

        this.whitespace();

        if (this.index !== this.source.length) {
            this.fail('Unexpected trailing input');
        }

        return value;
    }


    private value(): DeonValue {
        this.whitespace();

        const character = this.source[this.index];

        if (character === '"') {
            return this.string();
        }

        if (character === '[') {
            return this.array();
        }

        if (character === '{') {
            return this.object();
        }

        if (this.source.startsWith('true', this.index)) {
            this.index += 4;
            return 'true';
        }

        if (this.source.startsWith('false', this.index)) {
            this.index += 5;
            return 'false';
        }

        // There is no null in the data model, and an absent value is the empty string.
        if (this.source.startsWith('null', this.index)) {
            this.index += 4;
            return '';
        }

        const match = this.source.slice(this.index).match(
            /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/,
        );

        // The number is kept exactly as it was written.
        if (match) {
            this.index += match[0].length;
            return match[0];
        }

        return this.fail('Expected a JSON value');
    }


    private string(): string {
        const start = this.index;
        this.index += 1;

        while (this.index < this.source.length) {
            const character = this.source[this.index];

            // The escapes of a JSON string are the host's own, so once the bounds of the string are
            // known, the host can be trusted to decode what is inside them.
            if (character === '"') {
                this.index += 1;

                return JSON.parse(this.source.slice(start, this.index)) as string;
            }

            if (character === '\\') {
                this.index += 2;
                continue;
            }

            if (character.charCodeAt(0) < 0x20) {
                this.fail('Unescaped control character in string');
            }

            this.index += 1;
        }

        return this.fail('Unterminated JSON string');
    }


    private array(): DeonValue[] {
        const result: DeonValue[] = [];

        this.index += 1;
        this.whitespace();

        if (this.take(']')) {
            return result;
        }

        while (true) {
            result.push(this.value());
            this.whitespace();

            if (this.take(']')) {
                return result;
            }

            this.expect(',');
        }
    }


    private object(): Record<string, DeonValue> {
        const result: Record<string, DeonValue> = {};

        this.index += 1;
        this.whitespace();

        if (this.take('}')) {
            return result;
        }

        while (true) {
            this.whitespace();

            if (this.source[this.index] !== '"') {
                this.fail('Expected a quoted object key');
            }

            const key = this.string();

            this.whitespace();
            this.expect(':');

            const value = this.value();

            // A repeated member follows the last-write-wins rule of a Deon map, and so moves to the
            // position of its final write.
            if (Object.prototype.hasOwnProperty.call(result, key)) {
                delete result[key];
            }

            Object.defineProperty(result, key, {
                configurable: true,
                enumerable: true,
                value,
                writable: true,
            });

            this.whitespace();

            if (this.take('}')) {
                return result;
            }

            this.expect(',');
        }
    }


    private whitespace() {
        while (/[ \t\r\n]/.test(this.source[this.index] ?? '')) {
            this.index += 1;
        }
    }


    private expect(
        character: string,
    ) {
        this.whitespace();

        if (!this.take(character)) {
            this.fail(`Expected '${character}'`);
        }
    }


    private take(
        character: string,
    ) {
        if (this.source[this.index] !== character) {
            return false;
        }

        this.index += 1;

        return true;
    }


    private fail(
        message: string,
    ): never {
        throw new SyntaxError(`${message} at offset ${this.index}.`);
    }
}
// #endregion module



// #region exports
export const parseJSON = (
    source: string,
) => new JsonReader(source).parse();
// #endregion exports
