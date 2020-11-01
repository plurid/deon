// #region imports
    // #region internal
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
export * from './data/constants';
export * from './data/interfaces';

export {
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
