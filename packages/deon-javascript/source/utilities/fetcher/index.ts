// #region imports
    // #region libraries
    import * as fetch from 'cross-fetch';
    // #endregion libraries

    // #region external
    import {
        fetcherDefaultHeaders,
    } from '../../data/constants';
    // #endregion external
// #endregion imports



// #region module
const fetcher = async (
    path: string,
    token?: string,
) => {
    try {
        const headers = token
            ?  {
                ...fetcherDefaultHeaders,
                Authorization: `Bearer ${token}`,
            } : {
                ...fetcherDefaultHeaders,
            };

        const response = await fetch.default(
            path,
            {
                headers,
            },
        );
        const data = await response.text();

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
