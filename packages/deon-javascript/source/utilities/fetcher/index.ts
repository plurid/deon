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
        FetcherType,
    } from '../../data/interfaces';

    import {
        fetcherDefaultImportHeaders,
        fetcherDefaultInjectHeaders,

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
    url: string,
    token?: string,
    type?: FetcherType,
) => {
    const defaultHeaders = type === 'inject'
        ? fetcherDefaultInjectHeaders
        : fetcherDefaultImportHeaders;

    const headers = token
        ?  {
            ...defaultHeaders,
            Authorization: `Bearer ${token}`,
        } : {
            ...defaultHeaders,
        };

    const response = await fetch(
        url,
        {
            headers,
        },
    );

    const data = await response.text();

    const extname = path.extname(url);
    const filetype = type === 'inject'
        ? extname || ''
        : extname || DEON_FILENAME_EXTENSION;

    return {
        data,
        filetype,
    };
}


const fetchFromFile = async (
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

    const data = await fs.readFile(
        filepath,
        'utf-8',
    );

    return {
        data,
        filetype,
    };
}


const fetcher = async (
    file: string,
    options: DeonInterpreterOptions,
    token?: string,
    type?: FetcherType,
) => {
    try {
        const fileIsUrl = isURL(file);

        if (fileIsUrl) {
            if (!options.parseOptions?.allowNetwork) {
                return;
            }

            const {
                data,
                filetype,
            } = await fetchFromURL(
                file,
                token,
                type,
            );

            return {
                data,
                filetype,
            };
        }

        if (!options.parseOptions?.allowFilesystem) {
            return;
        }

        const {
            data,
            filetype,
        } = await fetchFromFile(
            file,
            options,
            type,
        );

        return {
            data,
            filetype,
        };
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
