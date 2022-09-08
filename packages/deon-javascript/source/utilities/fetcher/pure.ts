// #region imports
    // #region external
    import {
        DeonInterpreterOptions,
        FetcherType,
    } from '../../data/interfaces';

    import {
        isURL,
    } from '../general';
    // #endregion external


    // #region internal
    import {
        fetchFromURL as fetchFromURLSynchronous,
    } from './synchronous/url';

    import {
        fetchFromURL as fetchFromURLAsynchronous,
    } from './asynchronous/url';
    // #endregion internal
// #endregion imports



// #region module
export const pureSynchronousFetcher = (
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
            } = fetchFromURLSynchronous(
                file,
                token,
                type,
            );

            return {
                data,
                filetype,
            };
        }

        return;
    } catch (error) {
        return;
    }
}

export const pureAsynchronousFetcher = async (
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
            } = await fetchFromURLAsynchronous(
                file,
                token,
                type,
            );

            return {
                data,
                filetype,
            };
        }

        return;
    } catch (error) {
        return;
    }
}


const fetcher = {
    synchronous: pureSynchronousFetcher,
    asynchronous: pureAsynchronousFetcher,
};
// #endregion module



// #region exports
export default fetcher;
// #endregion exports
