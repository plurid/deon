// #region imports
    // #region internal
    import {
        DEON_FILENAME_EXTENSION,
        DEON_MEDIA_TYPE,
    } from './data/constants';

    import cli from './cli';

    import Deon from './objects/Deon';
    import DeonPure from './objects/DeonPure';

    import Scanner from './objects/Scanner';
    import Parser from './objects/Parser';
    import Interpreter from './objects/Interpreter';

    import {
        deon,
        deonSynchronous,
    } from './logics/template/deon';

    import {
        deonPure,
        deonPureSynchronous,
    } from './logics/template/deonPure';

    import {
        typer,
    } from './utilities/typer';
    // #endregion internal
// #endregion imports



// #region module
const internals = {
    Scanner,
    Parser,
    Interpreter,
};
// #endregion module



// #region exports
export * from './data/interfaces';


export {
    // constants
    DEON_FILENAME_EXTENSION,
    DEON_MEDIA_TYPE,


    // functionalities
    cli,

    deon,
    deonSynchronous,

    DeonPure,
    deonPure,
    deonPureSynchronous,

    typer,

    internals,
};


export default Deon;
// #endregion exports
