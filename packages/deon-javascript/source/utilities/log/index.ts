// #region imports
    // #region libraries
    import utilities from 'util';
    // #endregion libraries
// #endregion imports



// #region module
const log = <T>(
    data: T,
) => {
    let text = utilities.inspect(
        data,
        {
            showHidden: false,
            depth: null,
        },
    );

    if (text.startsWith('`')) {
        text = text.slice(1);
    }
    if (text.startsWith('\'')) {
        text = text.slice(1);
    }
    if (text.endsWith('`')) {
        text = text.slice(0, text.length - 1);
    }
    if (text.endsWith('\'')) {
        text = text.slice(0, text.length - 1);
    }

    console.log(text);
}
// #endregion module



// #region exports
export {
    log,
};
// #endregion exports
