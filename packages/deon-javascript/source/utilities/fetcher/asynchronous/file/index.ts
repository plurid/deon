// #region imports
    // #region libraries
    import {
        promises as fs,
    } from 'fs';

    import path from 'path';
    // #endregion libraries


    // #region external
    import {
        DeonInterpreterOptions,
        FetcherType,
    } from '../../../../data/interfaces';

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

    const data = await fs.readFile(
        filepath,
        'utf-8',
    );

    return {
        data,
        filetype,
        filebase,
    };
}
// #endregion module



// #region exports
export {
    fetchFromFile,
};
// #endregion exports
