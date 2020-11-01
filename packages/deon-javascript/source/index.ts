// #region imports
    // #region internal
    import {
        DEON_FILENAME_EXTENSION,
        DEON_MEDIA_TYPE,
    } from './data/constants';

    import cli from './cli';

    import Deon from './objects/Deon';
    import DeonPure from './objects/DeonPure';

    import {
        typer,
    } from './utilities/typer';

    import {
        deon,
        deonSynchronous,
    } from './utilities/template';

    import {
        deon as deonPure,
        deonSynchronous as deonSynchronousPure,
    } from './utilities/template/pure';
    // #endregion internal
// #endregion imports



// #region exports
export * from './data/interfaces';


export {
    // constants
    DEON_FILENAME_EXTENSION,
    DEON_MEDIA_TYPE,


    // functionalities
    cli,
    typer,
    deon,
    deonSynchronous,

    DeonPure,
    deonPure,
    deonSynchronousPure,
};


export default Deon;
// #endregion exports
