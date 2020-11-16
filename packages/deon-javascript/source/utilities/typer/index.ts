// #region module
const customTyper = <T = any>(
    data: any,
    typingFunction: (
        value: string,
    ) => any,
): T => {
    if (Array.isArray(data) || data instanceof Array) {
        const newArray: any[] = [];
        for (const element of data) {
            const newElement = customTyper(
                element,
                typingFunction,
            );
            newArray.push(newElement);
        }
        return newArray as any;
    }

    if (typeof data === 'object') {
        const newData: any = {};
        for (const [key, value] of Object.entries(data)) {
            newData[key] = customTyper(
                value,
                typingFunction,
            );
        }
        return newData;
    }

    if (typeof data === 'string') {
        const value = typingFunction(
            data,
        );
        return value;
    }

    return data;
}


const typer = <T = any>(
    data: any,
): T => {
    const typedData = customTyper<T>(
        data,
        (
            value,
        ) => {
            if (value === 'true') {
                return true;
            }

            if (value === 'false') {
                return false;
            }

            const valueNumber = Number(value);

            if (!isNaN(valueNumber)) {
                if (Number.isInteger(valueNumber)) {
                    return parseInt(value);
                }

                return parseFloat(value);
            }

            return value;
        }
    );

    return typedData;
}
// #endregion module



// #region exports
export {
    customTyper,
    typer,
};
// #endregion exports
