// #region module
const javascript = (
    value: string,
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
// #endregion module



// #region exports
export default javascript;
// #endregion exports
