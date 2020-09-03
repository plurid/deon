// #region module
class Stringifier {
    private dataString = '';
    private options: any;


    constructor(
        options: any,
    ) {
        this.options = options;
    }


    public stringify(
        data: any,
    ) {
        if (Array.isArray(data)) {
            this.stringifyList(data);
        } else {
            this.stringifyMap(data);
        }

        return this.dataString;
    }


    private stringifyItem(
        item: any,
    ) {
        if (typeof item === 'string') {
            return item + '\n';
        }

        if (Array.isArray(item)) {
            return this.stringifyList(item);
        }

        return this.stringifyMap(item);
    }

    private stringifyMap(
        data: any,
    ) {
        this.dataString += '{\n';

        for (const [key, value] of Object.entries(data)) {
            this.dataString += `${key} `;

            const dataString = this.stringifyItem(value);

            if (dataString) {
                this.dataString += dataString;
            }
        }

        this.dataString += '}\n';
    }

    private stringifyList(
        data: any[],
    ) {
        this.dataString += '[\n';

        for (const item of data) {
            const dataString = this.stringifyItem(item);
            if (dataString) {
                this.dataString += dataString;
            }
        }

        this.dataString += ']\n';
    }
}
// #endregion module



// #region exports
export default Stringifier;
// #endregion exports
