// #region imports
    // #region external
    import Deon from '../../../objects/DeonPure';
    // #endregion external
// #endregion imports



// #region module
const deon = async <T = any>(
    strings: TemplateStringsArray,
    ...values: any[]
): Promise<T> => {
    let raw = '';

    strings.forEach((value, index) => {
        raw += value + (values[index] || '');
    });

    const deonObject = new Deon();

    const result: T = await deonObject.parse(raw);

    return result;
}


const deonSynchronous = <T = any>(
    strings: TemplateStringsArray,
    ...values: any[]
) => {
    let raw = '';

    strings.forEach((value, index) => {
        raw += value + (values[index] || '');
    });

    const deonObject = new Deon();

    const result: T = deonObject.parseSynchronous(raw);

    return result;
}
// #endregion module



// #region exports
export {
    deon,
    deonSynchronous,
};
// #endregion exports
