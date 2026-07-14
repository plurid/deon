// #region imports
    // #region external
    import Deon from '../objects/Deon';

    import {
        DeonError,
    } from '../objects/Diagnostic';
    // #endregion external
// #endregion imports



// #region module
const cli = () => {
    const deon = new Deon();

    void deon.demand(process.argv).catch((error: unknown) => {
        // A DeonError carries every diagnostic it could collect, each with a code and a source
        // position. They are reported in the same form as `deon lint` writes them, rather than
        // flattened into a single message that an editor could make nothing of.
        if (error instanceof DeonError) {
            for (const diagnostic of error.diagnostics) {
                const { start } = diagnostic.range;

                process.stderr.write(
                    `${diagnostic.source}`
                        + `:${start.line}`
                        + `:${start.column}`
                        + ` ${diagnostic.severity}`
                        + ` ${diagnostic.code}`
                        + ` ${diagnostic.message}\n`,
                );
            }

            process.exitCode = 1;
            return;
        }

        const message = error instanceof Error ? error.message : String(error);

        process.stderr.write(`deon: ${message}\n`);
        process.exitCode = 1;
    });
}
// #endregion module



// #region exports
export default cli;
// #endregion exports
