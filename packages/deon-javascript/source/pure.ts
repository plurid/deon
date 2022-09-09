// #region imports
    // #region internal
    import {
        DEON_FILENAME_EXTENSION,
        DEON_MEDIA_TYPE,
    } from './data/constants';


    import DeonPure from './objects/DeonPure';


    import {
        deonPure,
        deonPureSynchronous,
    } from './logics/template/deonPure';


    import {
        customTyper,
        typer,
    } from './utilities/typer';

    import * as typings from './utilities/typer/typings';
    // #endregion internal
// #endregion imports



// #region exports
export * from './data/interfaces';


export {
    DEON_FILENAME_EXTENSION,
    DEON_MEDIA_TYPE,

    DeonPure,
    deonPure,
    deonPureSynchronous,

    customTyper,
    typer,
    typings,
};
// #endregion exports
