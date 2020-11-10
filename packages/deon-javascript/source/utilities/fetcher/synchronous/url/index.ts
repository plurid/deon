// #region imports
    // #region libraries
    import fetch from 'sync-request';
    // #endregion libraries


    // #region external
    import {
        FetcherType,
    } from '../../../../data/interfaces';

    import {
        resolveFetchURL,
    } from '../../logic';
    // #endregion external
// #endregion imports



// #region module
const fetchFromURL = (
    url: string,
    token?: string,
    type?: FetcherType,
) => {
    const {
        headers,
        filetype,
    } = resolveFetchURL(
        url,
        token,
        type,
    );

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
