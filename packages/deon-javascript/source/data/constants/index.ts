// #region imports
    // #region internal
    import {
        DeonParseOptions,
        DeonStringifyOptions,
    } from '../interfaces';
    // #endregion internal
// #endregion imports



// #region module
const DEON_FILE_EXTENSION = '.deon';


const deonParseOptions: DeonParseOptions = {
    absolutePaths: {},
    authorization: {},
    datasignFiles: [],
    datasignMap: {},
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
// #endregion module



// #region exports
export {
    DEON_FILE_EXTENSION,

    deonParseOptions,
    deonStrigifyOptions,
};
// #endregion exports
