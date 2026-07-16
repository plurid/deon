// #region imports
    // #region external
    import {
        FetcherType,
    } from '../../../../data/interfaces';

    import {
        NETWORK_TIMEOUT,
    } from '../../../../data/constants';

    import {
        decodeResource,
    } from '../../../../objects/Diagnostic';

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
    // The body is decoded strictly: a response that is not valid UTF-8 is a resource-format fault,
    // the same as a file that is not (matching the six other implementations), not text papered over
    // with U+FFFD.
    const data = decodeResource(
        new Uint8Array(await response.arrayBuffer()),
        url,
    );

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
