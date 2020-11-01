// #region imports
    // #region internal
    import {
        DEON_FILENAME_EXTENSION,
        DEON_MEDIA_TYPE,
    } from './data/constants';

    import cli from './cli';

    import Deon from './objects/Deon';
    import DeonBrowser from './objects/DeonBrowser';

    import {
        typer,
    } from './utilities/typer';

    import {
        deon,
        deonSynchronous,
    } from './utilities/template';

    import {
        deon as deonBrowser,
        deonSynchronous as deonSynchronousBrowser,
    } from './utilities/template/browser';
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

    DeonBrowser,
    deonBrowser,
    deonSynchronousBrowser,
};


export default Deon;
// #endregion exports
