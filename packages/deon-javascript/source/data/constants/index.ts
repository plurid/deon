// #region imports
    // #region internal
    import {
        DeonParseOptions,
        DeonStringifyOptions,
    } from '../interfaces';
    // #endregion internal
// #endregion imports



// #region module
const DEON_CLI_VERSION = '#DEON_CLI_VERSION' as string;

const DEON_FILENAME_EXTENSION = '.deon' as const;
const DEON_MEDIA_TYPE = 'application/deon' as const;


const fetcherDefaultImportHeaders = {
    Accept: 'text/plain,application/json,' + DEON_MEDIA_TYPE,
};

const fetcherDefaultInjectHeaders = {
    Accept: '*/*',
};



const defaultCacheDuration = 1_000 * 60 * 60;


const deonParseOptions: DeonParseOptions = {
    sourceName: '<memory>',
    filebase: '',
    absolutePaths: {},
    authorization: {},
    datasignFiles: [],
    datasignMap: {},
    allowFilesystem: false,
    allowNetwork: false,
    cache: false,
    cacheDuration: defaultCacheDuration,
    cacheDirectory: '',
    token: '',
    environment: {},
    resources: {},
    resourceStack: [],
};


const deonStrigifyOptions: DeonStringifyOptions = {
    canonical: false,
    readable: true,
    indentation: 4,
    leaflinks: false,
    leaflinkLevel: 1,
    leaflinkShortening: true,
    generatedHeader: false,
    generatedComments: false,
};


const SPACING_TWO = '  ';
const SPACING_FOUR = SPACING_TWO + SPACING_TWO;


const nonAlphanumericCharacters = [
    ' ',
    '\n',
    ',',
];


const INTERNAL_INTERPOLATOR_SIGN = '#-~-#';
// #endregion module



// #region exports
export {
    DEON_CLI_VERSION,

    DEON_FILENAME_EXTENSION,
    DEON_MEDIA_TYPE,
    fetcherDefaultImportHeaders,
    fetcherDefaultInjectHeaders,

    defaultCacheDuration,

    deonParseOptions,
    deonStrigifyOptions,

    SPACING_TWO,
    SPACING_FOUR,

    nonAlphanumericCharacters,


    INTERNAL_INTERPOLATOR_SIGN,
};
// #endregion exports
