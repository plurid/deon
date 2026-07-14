// #region imports
    // #region internal
    import {
        DEON_FILENAME_EXTENSION,
        DEON_MEDIA_TYPE,
    } from './data/constants';

    import cli from './cli';


    import Deon from './objects/Deon';
    import DeonPure from './objects/DeonPure';

    import Scanner, {
        ESCAPED_INTERPOLATION,
    } from './objects/Scanner';
    import Parser from './objects/Parser';
    import Token from './objects/Token';
    import Interpreter from './objects/Interpreter';
    import Stringifier from './objects/Stringifier';


    import {
        deon,
        deonSynchronous,
    } from './logics/template/deon';

    import {
        deonPure,
        deonPureSynchronous,
    } from './logics/template/deonPure';


    import {
        readDeonFile,
        writeDeonFile,
    } from './utilities/readwrite';

    import {
        customTyper,
        typer,
    } from './utilities/typer';

    import {
        applyDatasign,
        parseDatasign,
        readDatasign,
        typeDatasign,
    } from './utilities/datasign';

    import * as typings from './utilities/typer/typings';
    // #endregion internal
// #endregion imports



// #region module
const internals = {
    Scanner,
    Parser,
    Interpreter,
    Stringifier,
};
// #endregion module



// #region exports
export * from './data/interfaces';
export * from './data/syntax';
export * from './objects/Diagnostic';
export type { DatasignField, DatasignReader, DatasignSignatures } from './utilities/datasign';


export {
    // constants
    DEON_FILENAME_EXTENSION,
    DEON_MEDIA_TYPE,

    /**
     * The sentinel that stands for an escaped `#{`, so that the interpolator, which runs later and
     * over the evaluated string, does not mistake it for an interpolation to resolve.
     *
     * A host that hands a string *into* an entity — as an entity-call argument, say — is handing over
     * text, not source, and text that happens to contain `#{name}` must not be read as a link into
     * the surrounding document. Replacing `#{` with this before the value is evaluated is what says
     * so; the interpolator turns it back into `#{` on the way out.
     */
    ESCAPED_INTERPOLATION,


    // functionalities
    cli,

    deon,
    deonSynchronous,

    DeonPure,
    deonPure,
    deonPureSynchronous,

    readDeonFile,
    writeDeonFile,

    customTyper,
    typer,
    typings,

    // datasign, usable standalone and swappable for `@plurid/datasign`'s own reader
    applyDatasign,
    parseDatasign,
    readDatasign,
    typeDatasign,

    internals,

    // the token a syntax node carries, which is where a diagnostic gets its position
    Token,
};


export default Deon;
// #endregion exports
