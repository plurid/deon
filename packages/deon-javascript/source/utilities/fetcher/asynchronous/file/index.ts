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
        solveExtensionName,
    } from '../../../general';
    // #endregion external
// #endregion imports



// #region module
const fetchFromFile = async (
    file: string,
    options: DeonInterpreterOptions,
    type?: FetcherType,
) => {
    const {
        file: parsedFile,
        parseOptions,
    } = options;

    const filebase = parseOptions?.filebase
        ? parseOptions?.filebase
        : process.cwd();

    const basePath = parsedFile
        ? path.isAbsolute(parsedFile)
            ? path.dirname(parsedFile)
            : path.dirname(path.join(filebase, parsedFile))
        : filebase;

    const extname = path.extname(file);

    const {
        filetype,
        concatenate,
    } = solveExtensionName(
        type || 'import',
        extname,
    );

    const resolvedFile = concatenate
        ? file + filetype
        : file;

    const filepath = path.isAbsolute(resolvedFile)
        ? resolvedFile
        : path.join(
            basePath,
            resolvedFile,
        );

    const data = await fs.readFile(
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
