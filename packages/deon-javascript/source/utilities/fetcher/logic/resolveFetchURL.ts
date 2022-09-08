// #region imports
    // #region external
    import {
        FetcherType,
    } from '../../../data/interfaces';

    import {
        fetcherDefaultImportHeaders,
        fetcherDefaultInjectHeaders,
    } from '../../../data/constants';

    import {
        solveExtensionName,
    } from '../../general';
    // #endregion external
// #endregion imports



// #region module
const getExtname = (
    value: string,
) => {
    const match = value.match(/\.\w*$/);
    if (!match) {
        return '';
    }

    return match[0];
}


const resolveFetchURL = (
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

    const extname = getExtname(url);
    const {
        filetype,
    } = solveExtensionName(
        type || 'import',
        extname,
    );

    return {
        headers,
        filetype,
    };
}
// #endregion module



// #region exports
export default resolveFetchURL;
// #endregion exports
