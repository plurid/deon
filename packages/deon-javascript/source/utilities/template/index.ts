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

    strings.forEach((value, index) => {
        raw += value + (values[index] || '');
    });

    const deonObject = new Deon();

    const result = await deonObject.parse(raw);

    return result;
}


const deonSynchronous = (
    strings: TemplateStringsArray,
    ...values: any[]
) => {
    let raw = '';

    strings.forEach((value, index) => {
        raw += value + (values[index] || '');
    });

    const deonObject = new Deon();

    const result = deonObject.parseSynchronous(raw);

    return result;
}
// #endregion module



// #region exports
export {
    deon,
    deonSynchronous,
};
// #endregion exports
