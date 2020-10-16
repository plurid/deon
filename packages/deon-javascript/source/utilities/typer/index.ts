// #region module
const typer = (
    data: any,
): any => {
    if (Array.isArray(data) || data instanceof Array) {
        const newArray = [];
        for (const element of data) {
            const newElement = typer(element);
            newArray.push(newElement);
        }
        return newArray;
    }

    if (typeof data === 'object') {
        for (const [key, value] of Object.entries(data)) {
            data[key] = typer(value);
        }
    }

    if (data === 'true') {
        return true;
    }

    if (data === 'false') {
        return false;
    }

    if (typeof data === 'string') {
        return data;
    }

    if (!isNaN(data)) {
        if (Number.isInteger(data)) {
            return parseInt(data);
        }

        return parseFloat(data);
    }

    return data;
}
// #endregion module



// #region exports
export {
    typer,
};
// #endregion exports
