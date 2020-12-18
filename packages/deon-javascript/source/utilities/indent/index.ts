// #region imports
    // #region external
    import {
        SPACING_FOUR,
    } from '../../data/constants';
    // #endregion external
// #endregion imports



// #region module
const indentLevel = (
    indent: number,
    spaces?: string,
) => {
    if (indent === 0) {
        return '';
    }

    let spacing = '';

    for (let i = 0; i < indent; i++) {
        spacing += spaces ?? SPACING_FOUR;
    }

    return spacing;
}
// #endregion module



// #region exports
export {
    indentLevel,
};
// #endregion exports
