// #region module
const setEnvironment = (
    data: any,
    overwrite?: boolean,
) => {
    if (!data) {
        return;
    }

    if (Array.isArray(data)) {
        return;
    }

    if (typeof data !== 'object') {
        return;
    }

    Object.keys(data).forEach((key) => {
        const value = data[key];

        if (typeof value !== 'string') {
            return;
        }

        if (
            !Object.prototype.hasOwnProperty.call(process.env, key)
        ) {
            process.env[key] = value;
            return;
        }

        if (overwrite) {
            process.env[key] = value;
            return;
        }

        console.log(`'${key}' is already defined.`);
    });
}
// #endregion module



// #region exports
export {
    setEnvironment,
};
// #endregion exports
