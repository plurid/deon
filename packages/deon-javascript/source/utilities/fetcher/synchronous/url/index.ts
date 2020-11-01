// #region imports
    // #region libraries
    import path from 'path';

    import fetch from 'sync-request';
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
const fetchFromURL = (
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

    const response = fetch(
        'GET',
        url,
        {
            headers,
        },
    );

    const body = response.getBody();

    const data = typeof body === 'string'
        ? body
        : body.toString('utf-8');

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
