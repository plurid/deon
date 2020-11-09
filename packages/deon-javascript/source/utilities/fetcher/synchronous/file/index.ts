// #region imports
    // #region libraries
    import fs from 'fs';

    import path from 'path';
    // #endregion libraries


    // #region external
    import {
        DeonInterpreterOptions,
        FetcherType,
    } from '../../../../data/interfaces';

    import {
        resolveFilepath,
    } from '../../logic';
    // #endregion external
// #endregion imports



// #region module
const fetchFromFile = (
    file: string,
    options: DeonInterpreterOptions,
    type?: FetcherType,
) => {
    const {
        filepath,
        filetype,
    } = resolveFilepath(
        file,
        options,
        type,
    );

    const data = fs.readFileSync(
        filepath,
        'utf-8',
    );

    return {
        data,
        filetype,
        filebase: path.dirname(filepath),
    };
}
// #endregion module



// #region exports
export {
    fetchFromFile,
};
// #endregion exports
