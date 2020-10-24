// #region imports
    // #region external
    import {
        SPACING_TWO,
        SPACING_FOUR,
    } from '../../data/constants';

    import {
        indentLevel,
    } from '../../utilities/indent';
    // #endregion external
// #endregion imports



// #region module
class Stringifier {
    private dataString = '';
    private options: any;
    private indent = 0;
    private baseData: any;


    constructor(
        options: any,
    ) {
        this.options = options;
    }


    public stringify(
        data: any,
    ) {
        this.baseData = data;

        if (Array.isArray(data)) {
            this.stringifyList(
                data,
            );
        } else {
            this.stringifyMap(
                data,
            );
        }

        return this.dataString;
    }


    private stringifyItem(
        item: any,
    ) {
        if (typeof item === 'string') {
            return item + '\n';
        }

        if (typeof item === 'boolean') {
            const value = item ? 'true' : 'false';

            return value + '\n';
        }

        if (typeof item === 'number') {
            return item + '\n';
        }

        if (item === undefined || item === null) {
            return '\n';
        }

        if (Array.isArray(item)) {
            this.baseData = item;

            return this.stringifyList(item);
        }

        return this.stringifyMap(item);
    }

    private stringifyMap(
        data: any,
    ) {
        /**
         * Handles the spacing based on the previous item (`this.baseData`).
         */
        const beforeIndent = Array.isArray(this.baseData) && this.indent === 1
            ? SPACING_FOUR
            : !Array.isArray(this.baseData)
                ? ''
                : indentLevel(
                    this.indent,
                );

        this.dataString += beforeIndent + '{\n';

        this.indent += 1;
        const indent = indentLevel(
            this.indent,
        );

        for (const [key, value] of Object.entries(data)) {
            this.dataString += indent + `${key} `;

            this.baseData = null;

            const dataString = this.stringifyItem(value);

            if (dataString) {
                this.dataString += dataString;
            }
        }

        this.indent -= 1;
        const afterIndent = indentLevel(
            this.indent,
        );

        this.dataString += afterIndent + '}\n';
    }

    private stringifyList(
        data: any[],
    ) {
        this.dataString += '[\n';

        this.indent += 1;
        const indent = indentLevel(
            this.indent,
        );

        for (const item of data) {
            const dataString = this.stringifyItem(item);
            if (dataString) {
                this.dataString += indent + dataString;
            }

            this.baseData = data;
        }

        this.indent -= 1;
        const afterIndent = indentLevel(
            this.indent,
        );

        this.dataString += afterIndent + ']\n';
    }
}
// #endregion module



// #region exports
export default Stringifier;
// #endregion exports
