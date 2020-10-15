// #region imports
    // #region internal
    import {
        DeonParseOptions,
        DeonStringifyOptions,
    } from '../interfaces';
    // #endregion internal
// #endregion imports



// #region module
const DEON_FILENAME_EXTENSION = '.deon';
const DEON_MEDIA_TYPE = 'application/deon';


const fetcherDefaultHeaders = {
    Accept: 'text/plain,' + DEON_MEDIA_TYPE,
};


const deonParseOptions: DeonParseOptions = {
    absolutePaths: {},
    authorization: {},
    datasignFiles: [],
    datasignMap: {},
    allowFilesystem: true,
    allowNetwork: true,
};


const deonStrigifyOptions: DeonStringifyOptions = {
    readable: true,
    indentation: 4,
    leaflinks: true,
    leaflinkLevel: 1,
    leaflinkShortening: true,
    generatedHeader: true,
    generatedComments: true,
};


const SPACING_TWO = '  ';
const SPACING_FOUR = SPACING_TWO + SPACING_TWO;
// #endregion module



// #region exports
export {
    DEON_FILENAME_EXTENSION,
    DEON_MEDIA_TYPE,
    fetcherDefaultHeaders,

    deonParseOptions,
    deonStrigifyOptions,

    SPACING_TWO,
    SPACING_FOUR,
};
// #endregion exports
