// #region imports
    // #region libraries
    import utilities from 'util';
    // #endregion libraries
// #endregion imports



// #region module
const log = (
    data: any,
) => {
    console.log(
        utilities.inspect(
            data,
            {
                showHidden: false,
                depth: null,
            },
        ),
    );
}
// #endregion module



// #region exports
export {
    log,
};
// #endregion exports