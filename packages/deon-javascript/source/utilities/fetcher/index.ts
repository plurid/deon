// #region imports
    // #region libraries
    import {
        promises as fs,
    } from 'fs';

    import path from 'path';

    import fetch from 'cross-fetch';
    // #endregion libraries


    // #region external
    import {
        DeonInterpreterOptions,
    } from '../../data/interfaces';

    import {
        fetcherDefaultHeaders,

        DEON_FILENAME_EXTENSION,
    } from '../../data/constants';
    // #endregion external
// #endregion imports



// #region module
const isURL = (
    path: string,
) => {
    return path.startsWith('http');
}


const fetchFromURL = async (
    path: string,
    token?: string,
) => {
    const headers = token
        ?  {
            ...fetcherDefaultHeaders,
            Authorization: `Bearer ${token}`,
        } : {
            ...fetcherDefaultHeaders,
        };

    const response = await fetch(
        path,
        {
            headers,
        },
    );
    const data = await response.text();

    return data;
}


const fetchFromFile = async (
    file: string,
    options: DeonInterpreterOptions,
) => {
    const {
        file: parsedFile,
    } = options;

    const basePath = parsedFile
        ? path.isAbsolute(parsedFile)
            ? path.dirname(parsedFile)
            : path.dirname(path.join(process.cwd(), parsedFile))
        : process.cwd();

    const hasDeonExtension = path.extname(file) === DEON_FILENAME_EXTENSION;
    const extension = hasDeonExtension
        ? ''
        : DEON_FILENAME_EXTENSION;
    const resolvedFile = file + extension;

    const filepath = path.isAbsolute(resolvedFile)
        ? resolvedFile
        : path.join(
            basePath,
            resolvedFile,
        );

    const data = await fs.readFile(filepath, 'utf-8');

    return data;
}


const fetcher = async (
    file: string,
    options: DeonInterpreterOptions,
    token?: string,
) => {
    try {
        const fileIsUrl = isURL(file);

        if (fileIsUrl) {
            const data = await fetchFromURL(
                file,
                token,
            );

            return data;
        }

        const data = await fetchFromFile(
            file,
            options,
        );

        return data;
    } catch (error) {
        return;
    }
}
// #endregion module



// #region exports
export {
    fetcher,
};
// #endregion exports
