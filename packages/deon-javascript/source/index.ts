// #region imports
    // #region internal
    import cli from './cli';

    import Deon from './objects/Deon';

    import {
        typer,
    } from './utilities/typer';

    import {
        deon,
        deonSynchronous,
    } from './utilities/template';
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
};

export default Deon;
// #endregion exports
