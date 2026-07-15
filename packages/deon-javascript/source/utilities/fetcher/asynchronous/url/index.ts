// #region imports
    // #region external
    import {
        FetcherType,
    } from '../../../../data/interfaces';

    import {
        NETWORK_TIMEOUT,
    } from '../../../../data/constants';

    import resolveFetchURL from '../../logic/resolveFetchURL';
    // #endregion external
// #endregion imports



// #region module
const fetchFromURL = async (
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

    // Bounded so a stalled server cannot hang the parse (matching the synchronous fetcher).
    const response = await fetch(
        url,
        {
            headers,
            signal: AbortSignal.timeout(NETWORK_TIMEOUT),
        },
    );
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} while loading '${url}'.`);
    }
    const data = await response.text();

    return {
        data,
        filetype,
        resourceId: url,
    };
}
// #endregion module



// #region exports
export {
    fetchFromURL,
};
// #endregion exports
