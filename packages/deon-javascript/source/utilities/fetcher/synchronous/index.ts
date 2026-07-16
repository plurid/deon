// #region imports
    // #region external
    import {
        DeonInterpreterOptions,
        FetcherType,
    } from '../../../data/interfaces';

    import {
        isURL,
    } from '../../general';

    import {
        DeonError,
    } from '../../../objects/Diagnostic';
    // #endregion external


    // #region internal
    import {
        fetchFromURL,
    } from './url';

    import {
        fetchFromFile,
    } from './file';
    // #endregion internal
// #endregion imports



// #region module
const fetcher = (
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

            return fetchFromURL(file, token, type);
        }

        if (!options.parseOptions?.allowFilesystem) {
            return;
        }

        return fetchFromFile(file, options, type);
    } catch (error) {
        // A resource that could not be reached is answered with `undefined`, which the interpreter
        // reads as unavailable. A resource that *was* reached but is malformed — invalid UTF-8, say —
        // is a real diagnostic about it, and must not be flattened into "unavailable" (specification 9).
        if (error instanceof DeonError) {
            throw error;
        }

        return;
    }
}
// #endregion module



// #region exports
export {
    fetcher,
};
// #endregion exports
