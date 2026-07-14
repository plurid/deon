// #region imports
    // #region libraries
    import { readdirSync, readFileSync, statSync } from 'node:fs';
    import path from 'node:path';

    import type {
        McpServer,
    } from '@modelcontextprotocol/sdk/server/mcp.js';
    // #endregion libraries


    // #region external
    import Deon from '@plurid/deon';

    import type {
        ServerOptions,
    } from './options.js';

    import {
        fileOptions,
        withinRoots,
    } from './options.js';
    // #endregion external
// #endregion imports



// #region module
/**
 * Every `.deon` file under a root, as an MCP resource.
 *
 * A root is the whole of the permission: a file outside one is not reachable, and a server given no
 * roots can reach nothing at all. That is checked again at read time rather than only at listing
 * time, because a listing is a snapshot and a read is an action.
 */


const DEPTH = 8;


const walk = (
    directory: string,
    depth = 0,
): string[] => {
    if (depth > DEPTH) {
        return [];
    }

    let entries: string[] = [];

    try {
        entries = readdirSync(directory);
    } catch {
        return [];
    }

    const found: string[] = [];

    for (const entry of entries) {
        if (entry.startsWith('.') || entry === 'node_modules') {
            continue;
        }

        const full = path.join(directory, entry);

        let stats;

        try {
            stats = statSync(full);
        } catch {
            continue;
        }

        if (stats.isDirectory()) {
            found.push(...walk(full, depth + 1));
            continue;
        }

        if (entry.endsWith('.deon')) {
            found.push(full);
        }
    }

    return found;
}


export const registerResources = (
    server: McpServer,
    options: ServerOptions,
) => {
    const deon = new Deon();

    const files = options.roots.flatMap(root => walk(path.resolve(root)));

    for (const file of files) {
        server.registerResource(
            path.basename(file),
            `deon://${file}`,
            {
                title: path.basename(file),
                description: `The Deon document at ${file}.`,
                mimeType: 'application/deon',
            },
            async (uri) => {
                // Checked again here. A listing says what was there; a read is what happens now.
                if (!withinRoots(file, options)) {
                    throw new Error(`'${file}' is outside every root.`);
                }

                const source = readFileSync(file, 'utf8');

                // The canonical form, so what a model reads is the document's meaning rather than
                // its layout — and so that two servers serving the same document serve it alike.
                const value = deon.parseSynchronous(source, fileOptions(file, options));

                return {
                    contents: [{
                        uri: uri.href,
                        mimeType: 'application/deon',
                        text: deon.canonical(value),
                    }],
                };
            },
        );
    }
}
// #endregion module
