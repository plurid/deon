// #region imports
    // #region libraries
    import {
        promises as fs,
    } from 'fs';
    // #endregion libraries


    // #region external
    import {
        DeonInterpreterOptions,
        FetcherType,
    } from '../../../../data/interfaces';

    import {
        decodeResource,
    } from '../../../../objects/Diagnostic';

    import {
        resolveFetchFile,
    } from '../../logic';
    // #endregion external
// #endregion imports



// #region module
const fetchFromFile = async (
    file: string,
    options: DeonInterpreterOptions,
    type?: FetcherType,
) => {
    const {
        filepath,
        filetype,
        filebase,
    } = resolveFetchFile(
        file,
        options,
        type,
    );

    const data = decodeResource(
        await fs.readFile(filepath),
        filepath,
    );

    return {
        data,
        filetype,
        filebase,
        resourceId: filepath,
    };
}
// #endregion module



// #region exports
export {
    fetchFromFile,
};
// #endregion exports
