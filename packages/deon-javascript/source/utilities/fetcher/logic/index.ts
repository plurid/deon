// #region imports
    // #region libraries
    import path from 'path';
    // #endregion libraries


    // #region external
    import {
        DeonInterpreterOptions,
        FetcherType,
    } from '../../../data/interfaces';

    import {
        solveExtensionName,
    } from '../../general';
    // #endregion external
// #endregion imports



// #region module
const resolveBasePath = (
    parsedFile: string | undefined,
    filebase: string,
) => {
    if (!parsedFile) {
        return filebase;
    }

    if (path.isAbsolute(parsedFile)) {
        return path.dirname(parsedFile);
    }

    return path.dirname(
        path.join(
            filebase,
            path.basename(parsedFile)
        ),
    );
}


const resolveFilepath = (
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

    const basePath = resolveBasePath(
        parsedFile,
        filebase,
    );

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

    return {
        filetype,
        filepath,
    };
}
// #endregion module



// #region exports
export {
    resolveBasePath,
    resolveFilepath,
};
// #endregion exports
