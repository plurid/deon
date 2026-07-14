// #region imports
    // #region external
    import type {
        DeonInterpreterOptions,
        FetcherType,
    } from '../../data/interfaces';

    import {
        isURL,
    } from '../general';

    import {
        fetchFromURL,
    } from './asynchronous/url';
    // #endregion external
// #endregion imports



// #region module
/**
 * The fetcher of a pure evaluator. It has no filesystem at all, and it reaches the network only
 * when the network has been explicitly asked for (specification 9).
 */


/**
 * Reading a file synchronously means reading it from a filesystem, which is precisely what a pure
 * evaluator does not have.
 */
const synchronous = (
    _file: string,
    _options: DeonInterpreterOptions,
    _token?: string,
    _type?: FetcherType,
) => undefined;


const asynchronous = async (
    file: string,
    options: DeonInterpreterOptions,
    token?: string,
    type?: FetcherType,
) => {
    if (!isURL(file) || !options.parseOptions?.allowNetwork) {
        return undefined;
    }

    return fetchFromURL(file, token, type);
}
// #endregion module



// #region exports
export default {
    asynchronous,
    synchronous,
};
// #endregion exports
