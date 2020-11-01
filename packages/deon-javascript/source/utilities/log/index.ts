// #region imports
    // #region libraries
    import utilities from 'util';
    // #endregion libraries
// #endregion imports



// #region module
const log = <T>(
    data: T,
) => {
    const text = utilities.inspect(
        data,
        {
            showHidden: false,
            depth: null,
        },
    );

    console.log(text);
}
// #endregion module



// #region exports
export {
    log,
};
// #endregion exports
