// #region imports
    // #region external
    import Deon from '../../objects/Deon';
    // #endregion external
// #endregion imports



// #region module
const deon = async (
    strings: TemplateStringsArray,
    ...values: any[]
) => {
    let raw = '';

    strings.forEach((string, i) => {
        raw += string + (values[i] || '');
    });

    const deonObject = new Deon();

    const result = await deonObject.parse(raw);

    return result;
}
// #endregion module



// #region exports
export {
    deon,
};
// #endregion exports
