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


// The bound on a single network fetch, in milliseconds. Without it a stalled server hangs the parse.
// Thirty seconds, matching the other implementations' clients.
const NETWORK_TIMEOUT = 30_000;


// The default expansion budget: the number of code points substitution may produce before evaluation
// is stopped as a runaway (specification 11). 2^26 is large enough that an ordinary document never
// approaches it — the existing tests do not come near — yet small enough that a doubling blow-up is
// caught in well under a second rather than after gigabytes have been assembled.
const DEON_DEFAULT_EXPANSION = 2 ** 26;


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
    expansion: DEON_DEFAULT_EXPANSION,
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

    NETWORK_TIMEOUT,

    DEON_DEFAULT_EXPANSION,

    deonParseOptions,
    deonStrigifyOptions,

    SPACING_TWO,
    SPACING_FOUR,

    nonAlphanumericCharacters,


    INTERNAL_INTERPOLATOR_SIGN,
};
// #endregion exports
