// #region imports
    // #region internal
    import {
        DeonParseOptions,
        DeonStringifyOptions,
    } from '../interfaces';
    // #endregion internal
// #endregion imports



// #region module
const DEON_CLI_VERSION = '0.0.0-0';

const DEON_FILENAME_EXTENSION = '.deon';
const DEON_MEDIA_TYPE = 'application/deon';


const fetcherDefaultImportHeaders = {
    Accept: 'text/plain,application/json,' + DEON_MEDIA_TYPE,
};

const fetcherDefaultInjectHeaders = {
    Accept: '*/*',
};


const deonParseOptions: DeonParseOptions = {
    filebase: '',
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


const nonAlphanumericCharacters = [
    ' ',
    '\n',
    ',',
];
// #endregion module



// #region exports
export {
    DEON_CLI_VERSION,

    DEON_FILENAME_EXTENSION,
    DEON_MEDIA_TYPE,
    fetcherDefaultImportHeaders,
    fetcherDefaultInjectHeaders,

    deonParseOptions,
    deonStrigifyOptions,

    SPACING_TWO,
    SPACING_FOUR,

    nonAlphanumericCharacters,
};
// #endregion exports
