// #region module
const setEnvironment = (
    data: any
) => {
    Object.keys(data).forEach((key) => {
        const value = data[key];

        if (typeof value !== 'string') {
            return;
        }

        if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
            process.env[key] = value;
        } else {
            console.log(`"${key}" is already defined in \`process.env\` and will not be overwritten`)
        }
    });
}
// #endregion module



// #region exports
export {
    setEnvironment,
};
// #endregion exports
