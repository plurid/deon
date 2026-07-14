// #region imports
    // #region libraries
    import {
        promises as fs,
    } from 'node:fs';

    import path from 'node:path';
    // #endregion libraries


    // #region external
    import type {
        ConfiledFile,
    } from '../../data/interfaces';

    import {
        DEON_CLI_VERSION,
    } from '../../data/constants';

    import {
        resolveAbsolutePath,
    } from '../general/impure';

    import {
        typer,
    } from '../typer';

    import Stringifier from '../../objects/Stringifier';

    import {
        spawnEnvironmentCommand,
    } from '../environment';
    // #endregion external
// #endregion imports



// #region module
const help = `Usage: deon <file> [options]
       deon convert <source.json> [destination.deon]
       deon environment <source.deon> <command...>
       deon confile <files...> [--destination confile.deon]
       deon exfile <source.deon> [--unsafe-paths]
       deon lint <files...> [--warnings-as-errors]

Options:
  -o, --output <deon|json>
  -t, --typed
  -f, --filesystem <true|false>
  -n, --network <true|false>
  -w, --writeover
      --unsafe-paths
      --warnings-as-errors
  -v, --version
  -h, --help
`;


/**
 * The options that take a value after them, rather than standing on their own.
 */
const VALUED = new Set([
    '-d', '--destination',
    '-o', '--output',
    '-f', '--filesystem',
    '-n', '--network',
    '-t', '--typed',
]);


const handleFileOutput = (
    data: unknown,
    dataAsString: string,
    options: {
        output: string;
        typed: boolean;
    },
) => {
    if (options.output === 'deon') {
        process.stdout.write(dataAsString);
        return;
    }

    if (options.output === 'json') {
        const value = options.typed ? typer(data) : data;

        process.stdout.write(`${JSON.stringify(value, null, 4)}\n`);
        return;
    }

    throw new Error(`Unsupported output '${options.output}'.`);
}


const handleConvert = async (
    destination: string | undefined,
    data: string,
) => {
    if (!destination) {
        process.stdout.write(data);
        return;
    }

    const filepath = resolveAbsolutePath(destination);

    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, data, 'utf8');
}


/**
 * Gathers files into one document, keyed by the path each was read from.
 */
const handleConfile = async (
    files: string[],
    destination: string,
) => {
    const filesData: Record<string, ConfiledFile> = {};

    for (const file of files) {
        filesData[file] = {
            data: await fs.readFile(resolveAbsolutePath(file), 'utf8'),
        };
    }

    const destinationPath = resolveAbsolutePath(destination);

    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.writeFile(
        destinationPath,
        new Stringifier().stringify(filesData),
        'utf8',
    );
}


/**
 * Writes a confiled document back out as the files it was made from.
 *
 * A key is a path, and a document is data, so a document that has been carried from somewhere else
 * could otherwise write wherever it liked. Nothing is written outside the working directory unless
 * that is explicitly permitted.
 */
const handleExfile = async (
    deon: any,
    source: string,
    options: { unsafePaths?: boolean } = {},
) => {
    const data = await deon.parseFile(source);

    if (!data || Array.isArray(data) || typeof data !== 'object') {
        throw new Error('An exfile source must contain a root map.');
    }

    const base = process.cwd();
    const files: { destination: string; data: string }[] = [];

    for (const [filepath, entry] of Object.entries(data as Record<string, unknown>)) {
        const normalized = path.normalize(filepath);
        const outside = normalized === '..' || normalized.startsWith(`..${path.sep}`);

        if (!options.unsafePaths && (path.isAbsolute(filepath) || outside)) {
            throw new Error(
                `Unsafe exfile path '${filepath}'. Use --unsafe-paths to permit it.`,
            );
        }

        // An entry is either the text of the file, or a map holding it under `data`.
        const filedata = typeof entry === 'string'
            ? entry
            : entry
                && typeof entry === 'object'
                && typeof (entry as { data?: unknown }).data === 'string'
                ? (entry as { data: string }).data
                : null;

        if (filedata === null) {
            throw new Error(
                `Exfile entry '${filepath}' must be a string or a map with a string data field.`,
            );
        }

        files.push({
            destination: path.isAbsolute(filepath)
                ? filepath
                : path.resolve(base, filepath),
            data: filedata,
        });
    }

    // Nothing is written until every entry has been read, so a bad one writes no files at all.
    for (const file of files) {
        await fs.mkdir(path.dirname(file.destination), { recursive: true });
        await fs.writeFile(file.destination, file.data, 'utf8');
    }
}


const option = (
    args: string[],
    short: string,
    long: string,
    fallback?: string,
) => {
    const index = args.findIndex(
        argument => argument === short || argument === long,
    );

    return index === -1 ? fallback : args[index + 1];
}


/**
 * `--typed` reads either as a bare flag or as `--typed true|false`, since the two forms are both in
 * circulation.
 */
const toggle = (
    args: string[],
    short: string,
    long: string,
) => {
    const index = args.findIndex(
        argument => argument === short || argument === long,
    );

    if (index === -1) {
        return false;
    }

    return args[index + 1] !== 'false';
}


/**
 * The arguments that are not options, and not the values of options.
 */
const positional = (
    args: string[],
) => {
    const values: string[] = [];

    for (let index = 0; index < args.length; index += 1) {
        // `--typed true` spends its value; a bare `--typed` does not.
        if (
            VALUED.has(args[index])
            && (args[index + 1] === 'true' || args[index + 1] === 'false')
        ) {
            index += 1;
            continue;
        }

        if (
            VALUED.has(args[index])
            && args[index] !== '-t'
            && args[index] !== '--typed'
        ) {
            index += 1;
            continue;
        }

        if (!args[index].startsWith('-')) {
            values.push(args[index]);
        }
    }

    return values;
}


const runCLI = async (
    deon: any,
    processArguments: string[],
) => {
    const args = processArguments.slice(2);

    if (args.includes('-v') || args.includes('--version')) {
        process.stdout.write(`${DEON_CLI_VERSION}\n`);
        return;
    }

    if (!args.length || args.includes('-h') || args.includes('--help')) {
        process.stdout.write(help);
        return;
    }

    const command = args[0];

    if (command === 'convert') {
        const [source, destination] = positional(args.slice(1));

        if (!source) {
            throw new Error('convert requires a source file.');
        }

        const json = JSON.parse(
            await fs.readFile(resolveAbsolutePath(source), 'utf8'),
        );

        await handleConvert(destination, deon.stringify(json));
        return;
    }

    if (command === 'environment') {
        const source = args[1];
        const commandArguments = args.slice(2).filter(
            argument => argument !== '-w' && argument !== '--writeover',
        );

        if (!source || !commandArguments.length) {
            throw new Error('environment requires a source file and a command.');
        }

        spawnEnvironmentCommand(
            commandArguments,
            await deon.parseFile(source),
            {
                overwrite: args.includes('-w') || args.includes('--writeover'),
            },
        );
        return;
    }

    if (command === 'confile') {
        const destination = option(args, '-d', '--destination', 'confile.deon') as string;
        const files = positional(args.slice(1)).filter(file => file !== destination);

        if (!files.length) {
            throw new Error('confile requires at least one input file.');
        }

        await handleConfile(files, destination);
        return;
    }

    if (command === 'exfile') {
        if (!args[1]) {
            throw new Error('exfile requires a source file.');
        }

        await handleExfile(deon, args[1], {
            unsafePaths: args.includes('--unsafe-paths'),
        });
        return;
    }

    if (command === 'lint') {
        const files = positional(args.slice(1));

        if (!files.length) {
            throw new Error('lint requires at least one input file.');
        }

        let warnings = 0;

        for (const file of files) {
            const filepath = resolveAbsolutePath(file);
            const source = await fs.readFile(filepath, 'utf8');

            for (const diagnostic of deon.lint(source, filepath)) {
                warnings += 1;

                process.stdout.write(
                    `${diagnostic.source}`
                        + `:${diagnostic.range.start.line}`
                        + `:${diagnostic.range.start.column}`
                        + ` ${diagnostic.severity}`
                        + ` ${diagnostic.code}`
                        + ` ${diagnostic.message}\n`,
                );
            }

            // Linting reports the warnings; evaluating is what surfaces the errors.
            await deon.parse(source, {
                allowFilesystem: true,
                filebase: path.dirname(filepath),
                sourceName: filepath,
            });
        }

        // A warning is not a failure unless it has been asked to be one.
        if (warnings && args.includes('--warnings-as-errors')) {
            process.exitCode = 1;
        }

        return;
    }

    const output = option(args, '-o', '--output', 'deon') as string;

    const data = await deon.parseFile(command, {
        allowFilesystem: option(args, '-f', '--filesystem', 'true') === 'true',
        allowNetwork: option(args, '-n', '--network', 'false') === 'true',
    });

    handleFileOutput(data, deon.stringify(data), {
        output,
        typed: toggle(args, '-t', '--typed'),
    });
}
// #endregion module



// #region exports
export {
    handleFileOutput,
    handleConvert,
    handleConfile,
    handleExfile,
    runCLI,
};
// #endregion exports
