// #region imports
    // #region internal
    import {
        DeonStringifyOptions,
    } from '../interfaces';
    // #endregion internal
// #endregion imports



// #region module
const DEON_FILE_EXTENSION = '.deon';


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

    deonStrigifyOptions,
};
// #endregion exports
