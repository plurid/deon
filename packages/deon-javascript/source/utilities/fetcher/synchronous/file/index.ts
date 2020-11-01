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
        DEON_FILENAME_EXTENSION,
    } from '../../../../data/constants';
    // #endregion external
// #endregion imports



// #region module
const fetchFromFile = (
    file: string,
    options: DeonInterpreterOptions,
    type?: FetcherType,
) => {
    const {
        file: parsedFile,
    } = options;

    const basePath = parsedFile
        ? path.isAbsolute(parsedFile)
            ? path.dirname(parsedFile)
            : path.dirname(path.join(process.cwd(), parsedFile))
        : process.cwd();

    const extname = path.extname(file);
    const filetype = type === 'inject'
        ? extname
        : extname || DEON_FILENAME_EXTENSION;
    const resolvedFile = file + filetype;

    const filepath = path.isAbsolute(resolvedFile)
        ? resolvedFile
        : path.join(
            basePath,
            resolvedFile,
        );

    const data = fs.readFileSync(
        filepath,
        'utf-8',
    );

    return {
        data,
        filetype,
    };
}
// #endregion module



// #region exports
export {
    fetchFromFile,
};
// #endregion exports