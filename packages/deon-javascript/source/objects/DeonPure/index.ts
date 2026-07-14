// #region imports
    // #region external
    import Scanner from '../Scanner';

    import Parser, {
        lintDocument,
    } from '../Parser';

    import Interpreter from '../Interpreter';

    import Stringifier from '../Stringifier';

    import type {
        DeonValue,
        DocumentNode,
    } from '../../data/syntax';

    import type {
        DeonDiagnostic,
    } from '../Diagnostic';

    import {
        DiagnosticCode,
    } from '../Diagnostic';

    import type {
        DeonInterpreterOptions,
        PartialDeonParseOptions,
        PartialDeonStringifyOptions,
    } from '../../data/interfaces';

    import {
        applyDatasign,
        datasignError,
        readDatasign,
    } from '../../utilities/datasign';

    import fetcher from '../../utilities/fetcher/pure';
    // #endregion external
// #endregion imports



// #region module
/**
 * Deon without a host. It never reaches for the filesystem, whatever it is asked for, so it runs
 * wherever a string can be handed to it: a browser, a worker, a sandbox.
 *
 * A resource can still be resolved, but only through the `resources` option, which hands over the
 * document rather than a path to go and read.
 */
class DeonPure {
    public parseSyntax(
        data: string,
        sourceName = '<memory>',
    ): DocumentNode {
        const scanner = new Scanner(data, undefined, sourceName);

        return new Parser(scanner.scanTokens(), undefined, sourceName).parse();
    }


    public getSyntax(
        data: string,
        sourceName = '<memory>',
    ) {
        return this.parseSyntax(data, sourceName);
    }


    public async parse<T = any>(
        data: string,
        options?: PartialDeonParseOptions,
    ): Promise<T> {
        const sourceName = options?.sourceName ?? '<memory>';
        const interpreter = this.interpreter();

        const root = await interpreter.interpret(
            this.parseSyntax(data, sourceName),
            this.interpreterOptions(sourceName, options),
        ) as DeonValue;

        return this.datasign(root, options) as T;
    }


    public parseSynchronous<T = any>(
        data: string,
        options?: PartialDeonParseOptions,
    ): T {
        const sourceName = options?.sourceName ?? '<memory>';
        const interpreter = this.interpreter();

        const root = interpreter.interpretSynchronous(
            this.parseSyntax(data, sourceName),
            this.interpreterOptions(sourceName, options),
        ) as DeonValue;

        return this.datasign(root, options) as T;
    }


    public async leaflinks(
        data: string,
        options?: PartialDeonParseOptions,
    ): Promise<Record<string, DeonValue>> {
        const sourceName = options?.sourceName ?? '<memory>';
        const interpreter = this.interpreter();

        await interpreter.interpret(
            this.parseSyntax(data, sourceName),
            this.interpreterOptions(sourceName, options),
        );

        return interpreter.getLeaflinks();
    }


    public stringify(
        data: unknown,
        options?: PartialDeonStringifyOptions,
    ) {
        return new Stringifier(options).stringify(data);
    }


    public canonical(
        data: string | DeonValue,
    ) {
        const value = typeof data === 'string'
            ? this.parseSynchronous<DeonValue>(data)
            : data;

        return new Stringifier({ canonical: true }).stringify(value);
    }


    public lint(
        data: string,
        sourceName = '<memory>',
    ): DeonDiagnostic[] {
        return lintDocument(this.parseSyntax(data, sourceName));
    }


    private interpreter() {
        return new Interpreter(DeonPure, fetcher, { pure: true });
    }


    /**
     * Filesystem access is denied here, rather than merely left unasked for, so that an option
     * handed in from outside cannot turn it back on.
     */
    private interpreterOptions(
        sourceName: string,
        options?: PartialDeonParseOptions,
    ): DeonInterpreterOptions {
        return {
            file: sourceName === '<memory>' ? undefined : sourceName,
            parseOptions: {
                ...options,
                allowFilesystem: false,
            },
        };
    }


    /**
     * A pure evaluator has no filesystem, so a datasign contract arrives through `resources` rather
     * than as a path in `datasignFiles` for it to go and read.
     */
    private datasign(
        root: DeonValue,
        options?: PartialDeonParseOptions,
    ) {
        const map = options?.datasignMap;

        if (!map || !Object.keys(map).length) {
            return root;
        }

        const sources = (options?.datasignFiles ?? []).map(file => {
            const source = options?.resources?.[file];

            if (source === undefined) {
                datasignError(
                    DiagnosticCode.CAPABILITY_DENIED,
                    `Reading the datasign file '${file}' requires filesystem access.`,
                    file,
                );
            }

            return source as string;
        });

        return applyDatasign(
            root,
            readDatasign(sources, options?.datasignReader),
            map,
        );
    }
}
// #endregion module



// #region exports
export default DeonPure;
// #endregion exports
