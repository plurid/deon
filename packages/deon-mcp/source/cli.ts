#!/usr/bin/env node
// #region imports
    // #region libraries
    import {
        StdioServerTransport,
    } from '@modelcontextprotocol/sdk/server/stdio.js';
    // #endregion libraries


    // #region external
    import {
        createServer,
    } from './index.js';

    import type {
        ServerOptions,
    } from './options.js';
    // #endregion external
// #endregion imports



// #region module
const HELP = `Usage: deon-mcp [options]

Serves Deon over the Model Context Protocol, on stdio.

Options:
      --root <directory>    A directory whose .deon files are served as resources.
                            May be given more than once. Nothing outside a root is reachable.
      --prompts <file>      A .deon file whose entities are served as prompts.
      --allow-network       Let a served document import over the network. Off by default,
                            and it should stay off: a document's text becomes prompt text.
  -h, --help
`;


const read = (
    argv: string[],
): ServerOptions | undefined => {
    const options: ServerOptions = {
        roots: [],
        prompts: undefined,
        allowNetwork: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];

        if (argument === '-h' || argument === '--help') {
            return undefined;
        }

        if (argument === '--allow-network') {
            options.allowNetwork = true;
            continue;
        }

        if (argument === '--root') {
            const value = argv[index + 1];

            if (!value) {
                throw new Error('--root requires a directory.');
            }

            options.roots.push(value);
            index += 1;
            continue;
        }

        if (argument === '--prompts') {
            const value = argv[index + 1];

            if (!value) {
                throw new Error('--prompts requires a file.');
            }

            options.prompts = value;
            index += 1;
            continue;
        }

        throw new Error(`Unknown option '${argument}'.`);
    }

    return options;
}


const main = async () => {
    let options: ServerOptions | undefined;

    try {
        options = read(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`deon-mcp: ${(error as Error).message}\n`);
        process.exitCode = 1;

        return;
    }

    if (!options) {
        process.stdout.write(HELP);

        return;
    }

    // The transport owns stdout. Anything written to it that is not a protocol message corrupts the
    // stream, so every word this server says to a human goes to stderr.
    const server = createServer(options);

    await server.connect(new StdioServerTransport());
}


main().catch(error => {
    process.stderr.write(`deon-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
// #endregion module
