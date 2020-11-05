// #region imports
    // #region external
    import {
        DeonInterpreterOptions,
        FetcherType,
    } from '../../../data/interfaces';

    import {
        isURL,
    } from '../../general';
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
const fetcher = async (
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
            } = await fetchFromURL(
                file,
                token,
                type,
            );

            return {
                data,
                filetype,
            };
        }

        if (!options.parseOptions?.allowFilesystem) {
            return;
        }

        const {
            data,
            filetype,
            filebase,
        } = await fetchFromFile(
            file,
            options,
            type,
        );

        return {
            data,
            filetype,
            filebase,
        };
    } catch (error) {
        console.log('error', error);
        return;
    }
}
// #endregion module



// #region exports
export {
    fetcher,
};
// #endregion exports
