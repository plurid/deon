// #region imports
    // #region libraries
    import path from 'node:path';
    // #endregion libraries


    // #region external
    import type {
        PartialDeonParseOptions,
    } from '@plurid/deon';

    import {
        realpath,
    } from './confine.js';
    // #endregion external
// #endregion imports



// #region module
/**
 * How much of the host the server is willing to give a document.
 *
 * Deon already has a capability model (specification 9): the filesystem and the network are denied
 * unless they are asked for. That model is exactly what a server exposing arbitrary documents to a
 * model needs, so it is not reinvented here — it is simply defaulted to *off*, and turned on only for
 * the directories the operator named.
 */
export interface ServerOptions {
    /**
     * The directories a document may be read from. Nothing outside them is reachable, and an empty
     * list means nothing is.
     */
    roots: string[];

    /**
     * A `.deon` file whose entities become MCP prompts.
     */
    prompts?: string;

    /**
     * Whether a document may `import` over the network.
     *
     * Off, and it should stay off. A document's text becomes prompt text, so a document that may
     * fetch from an arbitrary URL is a way to put words a model will read into a channel nobody is
     * watching. Turning this on is a decision about trust, not about convenience.
     */
    allowNetwork: boolean;
}


export const defaultOptions = (): ServerOptions => ({
    roots: [],
    prompts: undefined,
    allowNetwork: false,
});


/**
 * The options a *tool* runs with.
 *
 * A tool is handed a document as text, by a model, and that document is not trusted. So it may reach
 * nothing at all: no filesystem, no network, whatever the server was configured with. A document that
 * imports will be told it may not, which is a diagnostic rather than a surprise.
 */
export const parseOptions = (
    _options: ServerOptions,
): PartialDeonParseOptions => ({
    allowFilesystem: false,
    allowNetwork: false,
});


/**
 * The options a *file under a root* runs with.
 *
 * This document was named by the operator rather than by the model, so it may read the filesystem —
 * but only within the roots, which `absolutePaths` and the resolved base enforce.
 */
export const fileOptions = (
    file: string,
    options: ServerOptions,
): PartialDeonParseOptions => ({
    sourceName: file,
    filebase: path.dirname(file),
    allowFilesystem: true,
    allowNetwork: options.allowNetwork,
});


/**
 * Whether a path lies inside one of the roots.
 *
 * Compared after resolving every symbolic link, so that `../` cannot climb out of a root and a
 * symlink inside a root cannot point out of one: it is the real paths that are compared, not the
 * spelling of them. A path that does not resolve — because it is missing, or a broken link — is
 * inside no root. A server with no roots can reach nothing, which is the safe way to be wrong.
 */
export const withinRoots = (
    file: string,
    options: ServerOptions,
) => {
    const resolved = realpath(path.resolve(file));

    if (!resolved) {
        return false;
    }

    return options.roots.some(root => {
        const base = realpath(path.resolve(root));

        return !!base && (resolved === base || resolved.startsWith(base + path.sep));
    });
}
// #endregion module
