// #region imports
    // #region libraries
    import path from 'path';

    import fetch from 'cross-fetch';
    // #endregion libraries


    // #region external
    import {
        FetcherType,
    } from '../../../../data/interfaces';

    import {
        fetcherDefaultImportHeaders,
        fetcherDefaultInjectHeaders,

        DEON_FILENAME_EXTENSION,
    } from '../../../../data/constants';
    // #endregion external
// #endregion imports



// #region module
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
// #endregion module



// #region exports
export {
    fetchFromURL,
};
// #endregion exports
