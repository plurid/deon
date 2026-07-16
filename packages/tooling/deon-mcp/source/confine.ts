// #region imports
    // #region libraries
    import fs from 'node:fs';
    import path from 'node:path';
    import { execFileSync } from 'node:child_process';
    // #endregion libraries


    // #region external
    import Deon, {
        internals,
        DeonError,
        DiagnosticCode,
        readDatasign,
        applyDatasign,
    } from '@plurid/deon';

    import type {
        DeonInterpreterOptions,
        DeonValue,
        DocumentNode,
        FetcherType,
        PartialDeonParseOptions,
    } from '@plurid/deon';

    import type {
        ServerOptions,
    } from './options.js';
    // #endregion external
// #endregion imports



// #region module
/**
 * Confinement: every file a served document reads must lie inside a configured root, and *inside*
 * means the real path, after every symbolic link is resolved — not the spelling of the path.
 *
 * `Deon.parseSynchronous` builds its interpreter with the library's default fetcher, which reads any
 * path it is given. A root document may import and inject, and so may whatever it imports, so a
 * document under a root could name `../../../etc/passwd`, or a symlink that points there, and be
 * read. The fix does not change the library: it hands the interpreter a *different* fetcher, one
 * that refuses to read outside the roots, and hands the interpreter a Deon that does the same for the
 * documents it loads transitively.
 */


const DEON_EXTENSION = '.deon';

// The bound on a single network fetch, matching the library's own synchronous URL fetcher.
const NETWORK_TIMEOUT = 30_000;


/**
 * The real, absolute path of a target, or `undefined` if it cannot be resolved — because it does not
 * exist, or is a broken link. Resolving the links is the whole point: a lexical prefix check is
 * fooled by a symlink inside a root that points out of it, and a `realpath` is not.
 */
export const realpath = (
    target: string,
): string | undefined => {
    try {
        return fs.realpathSync(target);
    } catch {
        return undefined;
    }
};


// The following three helpers are ports of the library's own path resolution (its `resolveFetchFile`
// and the `solveExtensionName`/`resolveMappedAbsolutePath` it calls). The confined fetcher resolves a
// target to exactly the path the library would have read, so that the file it *checks* is the file it
// *reads*, and reads only that.

const solveExtensionName = (
    type: FetcherType | undefined,
    extname: string,
) => {
    if (type === 'inject') {
        return { filetype: extname, concatenate: false };
    }

    if (extname === DEON_EXTENSION || extname === '.json') {
        return { filetype: extname, concatenate: false };
    }

    if (!extname) {
        return { filetype: DEON_EXTENSION, concatenate: true };
    }

    return { filetype: extname, concatenate: false };
};

const isAbsolutePath = (
    value: string,
) => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);

const resolveMappedAbsolutePath = (
    file: string,
    mappings: Record<string, string>,
) => {
    if (!isAbsolutePath(file)) {
        return file;
    }

    if (Object.prototype.hasOwnProperty.call(mappings, file)) {
        return mappings[file];
    }

    const wildcard = Object.keys(mappings)
        .filter(key => key.endsWith('/*') && file.startsWith(key.slice(0, -1)))
        .sort((left, right) => right.length - left.length)[0];

    if (!wildcard) {
        return file;
    }

    const prefix = wildcard.slice(0, -1);
    const suffix = file.slice(prefix.length);
    const directory = mappings[wildcard].replace(/\/+$/, '');

    return `${directory}/${suffix}`;
};

const resolveBasePath = (
    parsedFile: string | undefined,
    filebase: string,
) => {
    if (!parsedFile) {
        return filebase;
    }

    if (path.isAbsolute(parsedFile)) {
        return path.dirname(parsedFile);
    }

    return path.dirname(path.join(filebase, path.basename(parsedFile)));
};

const resolveCandidate = (
    file: string,
    options: DeonInterpreterOptions,
    type?: FetcherType,
) => {
    const parseOptions = options.parseOptions;
    const filebase = parseOptions?.filebase ? parseOptions.filebase : process.cwd();
    const basePath = resolveBasePath(options.file, filebase);

    const extname = path.extname(file);
    const { filetype, concatenate } = solveExtensionName(type, extname);

    const resolvedFile = concatenate ? file + filetype : file;
    const mappedFile = resolveMappedAbsolutePath(resolvedFile, parseOptions?.absolutePaths || {});
    const filepath = path.isAbsolute(mappedFile)
        ? mappedFile
        : path.join(basePath, mappedFile);

    return { filepath, filetype };
};


const isURL = (
    value: string,
) => /^https?:\/\//i.test(value);


/**
 * A fetcher, as the interpreter's second constructor argument expects it.
 */
export interface ConfinedFetcher {
    synchronous: (
        file: string,
        options: DeonInterpreterOptions,
        token?: string,
        type?: FetcherType,
    ) => unknown;
    asynchronous: (
        file: string,
        options: DeonInterpreterOptions,
        token?: string,
        type?: FetcherType,
    ) => Promise<unknown>;
}


/**
 * The confinement for a server's options: a fetcher, a confined interpreter, and a confined parse,
 * all of which refuse to read outside the roots, and the root check they share.
 */
export interface Confinement {
    fetcher: ConfinedFetcher;
    interpreter: () => any;
    parse: <T = any>(source: string, parseOptions?: PartialDeonParseOptions) => T;
    withinRoots: (candidate: string) => boolean;
}


export const confinement = (
    options: ServerOptions,
): Confinement => {
    // Roots are resolved to their real paths once, so the read-time comparison is realpath against
    // realpath and a root that is itself a symlink is handled. A server with no roots confines to
    // nothing: every read is refused, which is the safe way to be wrong.
    const roots = options.roots.map(root => realpath(path.resolve(root)) ?? path.resolve(root));
    const pure = roots.length === 0;

    const withinRoots = (
        candidate: string,
    ) => roots.some(root => candidate === root || candidate.startsWith(root + path.sep));


    /**
     * Reads a URL exactly as the library's own synchronous fetcher does — a child process, because
     * the platform has no synchronous fetch — but only when the operator turned the network on. This
     * path is off by default and is never taken by the tests; confinement is about the filesystem,
     * and the network stays governed by `allowNetwork`.
     */
    const fetchURL = (
        url: string,
        token: string | undefined,
        type?: FetcherType,
    ) => {
        const defaultHeaders = type === 'inject'
            ? { Accept: '*/*' }
            : { Accept: 'text/plain,application/json,application/deon' };
        const headers = token
            ? { ...defaultHeaders, Authorization: `Bearer ${token}` }
            : { ...defaultHeaders };

        const match = new URL(url).pathname.match(/\.[A-Za-z0-9]+$/);
        const { filetype } = solveExtensionName(type, match ? match[0] : '');

        const script = `
            const chunks = [];
            for await (const chunk of process.stdin) chunks.push(chunk);
            const { url, headers } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const response = await fetch(url, { headers, signal: AbortSignal.timeout(${NETWORK_TIMEOUT}) });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            process.stdout.write(await response.text());
        `;

        const data = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
            encoding: 'utf8',
            input: JSON.stringify({ url, headers }),
            maxBuffer: 64 * 1024 * 1024,
            timeout: NETWORK_TIMEOUT + 5000,
        });

        return { data, filetype, resourceId: url };
    };


    /**
     * The confined synchronous fetcher. For every read — the initial one and every transitive one —
     * it resolves the target to an absolute real path and refuses unless that real path lies inside a
     * root, re-validating at read time so a path that was safe at discovery cannot be swapped for one
     * that is not.
     *
     * A refusal returns `undefined`, which is exactly what the library's own fetcher returns when it
     * will not read: the interpreter then raises its own `DEON_RESOURCE_IO` diagnostic. The refusal
     * reads as a diagnostic, never as a leak and never as a crash.
     */
    const read = (
        file: string,
        interpreterOptions: DeonInterpreterOptions,
        token?: string,
        type?: FetcherType,
    ) => {
        try {
            const parseOptions = interpreterOptions.parseOptions;

            if (isURL(file)) {
                if (!parseOptions?.allowNetwork) {
                    return undefined;
                }

                return fetchURL(file, token, type);
            }

            if (!parseOptions?.allowFilesystem) {
                return undefined;
            }

            const { filepath, filetype } = resolveCandidate(file, interpreterOptions, type);
            const real = realpath(filepath);

            if (!real || !withinRoots(real)) {
                return undefined;
            }

            const data = fs.readFileSync(real, 'utf8');

            return {
                data,
                filetype,
                filebase: path.dirname(real),
                resourceId: real,
            };
        } catch {
            return undefined;
        }
    };

    const fetcher = {
        synchronous: read,
        asynchronous: async (
            file: string,
            interpreterOptions: DeonInterpreterOptions,
            token?: string,
            type?: FetcherType,
        ) => read(file, interpreterOptions, token, type),
    };


    /**
     * A datasign file is read by the Deon object directly, not through the fetcher, so confinement is
     * enforced here as well. `fileOptions` never asks for datasign, so this guards a path the server
     * does not currently take — but a confined evaluator that would read an out-of-root datasign file
     * is confined in name only, so it is closed here too.
     */
    const readDatasignConfined = (
        file: string,
        parseOptions: PartialDeonParseOptions | undefined,
        token: DocumentNode['root']['token'],
    ): string => {
        const base = parseOptions?.filebase || process.cwd();
        const target = path.isAbsolute(file) ? file : path.join(base, file);

        const virtual = parseOptions?.resources?.[target] ?? parseOptions?.resources?.[file];
        if (virtual !== undefined) {
            return virtual;
        }

        const real = realpath(target);
        if (!real || !withinRoots(real)) {
            throw new DeonError(
                DiagnosticCode.CAPABILITY_DENIED,
                `The datasign file '${file}' is outside every root.`,
                token,
            );
        }

        try {
            return fs.readFileSync(real, 'utf8');
        } catch {
            throw new DeonError(
                DiagnosticCode.RESOURCE_IO,
                `Unable to read the datasign file '${file}'.`,
                token,
            );
        }
    };


    /**
     * A Deon whose every evaluation is confined — and which hands *itself* to the interpreter, so
     * that a `.deon` file loaded by an import is parsed under the same confinement rather than under
     * the library's default, unconfined fetcher. This is the seam that closes the transitive escape:
     * without it, the first import is checked and everything it imports is not.
     */
    class ConfinedDeon extends Deon {
        public override parseSynchronous<T = any>(
            data: string,
            parseOptions?: PartialDeonParseOptions,
        ): T {
            const sourceName = parseOptions?.sourceName ?? '<memory>';
            const document = this.parseSyntax(data, sourceName);

            const interpreter = new internals.Interpreter(ConfinedDeon, fetcher, { pure });
            const root = interpreter.interpretSynchronous(document, {
                file: sourceName === '<memory>' ? undefined : sourceName,
                parseOptions,
            }) as DeonValue;

            // Datasign types the finished root (specification 14); without a map there is nothing to
            // apply and no file is read.
            const map = parseOptions?.datasignMap;
            if (!map || !Object.keys(map).length) {
                return root as T;
            }

            const files = parseOptions?.datasignFiles ?? [];
            const token = document.root.token;
            const sources = files.map(file => readDatasignConfined(file, parseOptions, token));
            const signatures = readDatasign(sources, parseOptions?.datasignReader);

            return applyDatasign(root, signatures, map) as T;
        }
    }


    /**
     * A confined interpreter, for the render path, which evaluates a synthesized document rather than
     * a source string.
     */
    const interpreter = () => new internals.Interpreter(ConfinedDeon, fetcher, { pure });

    /**
     * A confined synchronous parse, for the paths that start from source text.
     */
    const parse = <T = any>(
        source: string,
        parseOptions?: PartialDeonParseOptions,
    ): T => new ConfinedDeon().parseSynchronous<T>(source, parseOptions);


    return {
        fetcher,
        interpreter,
        parse,
        withinRoots,
    };
};
// #endregion module
