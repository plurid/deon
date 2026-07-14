// #region imports
    // #region external
    import Deon from '../../../objects/DeonPure';
    // #endregion external
// #endregion imports



// #region module
/**
 * Writes the interpolated values back out as Deon, so that a host value handed to the tag is read
 * as the value it is rather than as whatever its `toString` would have made of it.
 *
 * The trailing newline of the stringified value is dropped: it is the layout of a document, and
 * what is being written here is a fragment of one.
 */
const source = (
    strings: TemplateStringsArray,
    values: unknown[],
) => {
    const serializer = new Deon();

    return strings.reduce(
        (result, string, index) => result + string + (index < values.length
            ? serializer.stringify(values[index]).replace(/\n$/, '')
            : ''),
        '',
    );
}


const deonPure = async <T = any>(
    strings: TemplateStringsArray,
    ...values: unknown[]
): Promise<T> => new Deon().parse<T>(source(strings, values));


const deonPureSynchronous = <T = any>(
    strings: TemplateStringsArray,
    ...values: unknown[]
): T => new Deon().parseSynchronous<T>(source(strings, values));
// #endregion module



// #region exports
export {
    deonPure,
    deonPureSynchronous,
};
// #endregion exports
