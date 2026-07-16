// #region imports
    // #region libraries
    import fsSync, {
        promises as fs,
    } from 'node:fs';

    import path from 'node:path';
    // #endregion libraries


    // #region external
    import Scanner from '../Scanner';

    import Parser, {
        lintDocument,
    } from '../Parser';

    import Interpreter, {
        entityParameters,
    } from '../Interpreter';

    import Stringifier from '../Stringifier';

    import type {
        DocumentNode,
        DeonValue,
    } from '../../data/syntax';

    import type {
        DeonDiagnostic,
    } from '../Diagnostic';

    import {
        DiagnosticCode,
        decodeResource,
        resourceError,
    } from '../Diagnostic';

    import {
        applyDatasign,
        datasignError,
        readDatasign,
    } from '../../utilities/datasign';

    import type {
        DeonEntity,
        DeonInterpreterOptions,
        DeonLoadEnvironmentOptions,
        PartialDeonParseOptions,
        PartialDeonStringifyOptions,
    } from '../../data/interfaces';

    import {
        DEON_MEDIA_TYPE,
        defaultCacheDuration,
    } from '../../data/constants';

    import fetcher from '../../utilities/fetcher';

    import {
        defaultCacheDirectory,
        resolveAbsolutePath,
    } from '../../utilities/general/impure';

    import {
        runCLI,
    } from '../../utilities/cli';

    import sha from '../../utilities/sha';

    import {
        setEnvironment,
    } from '../../utilities/environment';
    // #endregion external
// #endregion imports



// #region module
/**
 * Deon on a host that has a filesystem and a network.
 *
 * The capabilities are not granted alike: `parseFile` opens the filesystem, for the file it is
 * given and for what that file imports, while a string handed to `parse` grants nothing at all.
 * The network is never opened unless it is asked for (specification 9).
 */
class Deon {
    public demand(
        args: string[],
    ) {
        return runCLI(this, args);
    }


    public parseSyntax(
        data: string,
        sourceName = '<memory>',
    ): DocumentNode {
        const scanner = new Scanner(data, undefined, sourceName);
        const parser = new Parser(scanner.scanTokens(), undefined, sourceName);

        return parser.parse();
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
        const document = this.parseSyntax(data, sourceName);
        const interpreter = new Interpreter(Deon, fetcher);

        const root = await interpreter.interpret(
            document,
            this.interpreterOptions(sourceName, options),
        ) as DeonValue;

        const files = this.datasignFiles(options);

        if (!files) {
            return root as T;
        }

        const sources = await Promise.all(
            files.map(file => this.readDatasignSource(file, options)),
        );

        return this.applyDatasignSources(root, sources, options) as T;
    }


    public parseSynchronous<T = any>(
        data: string,
        options?: PartialDeonParseOptions,
    ): T {
        const sourceName = options?.sourceName ?? '<memory>';
        const document = this.parseSyntax(data, sourceName);
        const interpreter = new Interpreter(Deon, fetcher);

        const root = interpreter.interpretSynchronous(
            document,
            this.interpreterOptions(sourceName, options),
        ) as DeonValue;

        const files = this.datasignFiles(options);

        if (!files) {
            return root as T;
        }

        const sources = files.map(
            file => this.readDatasignSourceSynchronous(file, options),
        );

        return this.applyDatasignSources(root, sources, options) as T;
    }


    /**
     * Reading a file grants the filesystem, to this document and to what it imports, unless the
     * caller says otherwise.
     */
    public async parseFile<T = any>(
        file: string,
        options?: PartialDeonParseOptions,
    ): Promise<T> {
        const filepath = resolveAbsolutePath(file);

        const data = options?.resources?.[filepath]
            ?? options?.resources?.[file]
            ?? await this.readSource(filepath);

        return this.parse<T>(data, {
            ...options,
            allowFilesystem: options?.allowFilesystem ?? true,
            filebase: path.dirname(filepath),
            sourceName: filepath,
        });
    }


    public parseFileSynchronous<T = any>(
        file: string,
        options?: PartialDeonParseOptions,
    ): T {
        const filepath = resolveAbsolutePath(file);

        const data = options?.resources?.[filepath]
            ?? options?.resources?.[file]
            ?? this.readSourceSynchronous(filepath);

        return this.parseSynchronous<T>(data, {
            ...options,
            allowFilesystem: options?.allowFilesystem ?? true,
            filebase: path.dirname(filepath),
            sourceName: filepath,
        });
    }


    /**
     * A document that cannot be read is a diagnostic, and not the host's exception.
     *
     * The file was named, so it was permitted, and it failed to load — which is exactly what
     * `DEON_RESOURCE_IO` is for. A caller should never have to catch an `ENOENT` to learn that a
     * document was missing: it would have no code, no position, and nothing an editor could show.
     */
    private async readSource(
        filepath: string,
    ): Promise<string> {
        let bytes: Uint8Array;

        try {
            bytes = await fs.readFile(filepath);
        } catch (error: unknown) {
            this.unreadable(filepath, error);
        }

        return decodeResource(bytes, filepath);
    }


    private readSourceSynchronous(
        filepath: string,
    ): string {
        let bytes: Uint8Array;

        try {
            bytes = fsSync.readFileSync(filepath);
        } catch (error: unknown) {
            this.unreadable(filepath, error);
        }

        return decodeResource(bytes, filepath);
    }


    private unreadable(
        filepath: string,
        error: unknown,
    ): never {
        const reason = error instanceof Error ? error.message : String(error);

        resourceError(
            DiagnosticCode.RESOURCE_IO,
            `Unable to read '${filepath}': ${reason}.`,
            filepath,
        );
    }


    /**
     * Reads a document from a link.
     *
     * Naming the link is not the same as being allowed to reach it: network access always requires
     * an explicit option (specification 9), and it is the option that grants the capability, never
     * the method that was called. So `allowNetwork` must be given, and because it is given it is
     * carried into the document that comes back, whose own imports may then reach the network too.
     */
    public async parseLink<T = any>(
        link: string,
        options?: PartialDeonParseOptions,
    ): Promise<T> {
        if (!options?.allowNetwork) {
            resourceError(
                DiagnosticCode.CAPABILITY_DENIED,
                `Reading '${link}' requires network access.`,
                link,
            );
        }

        const cached = await this.getCache<T>(link, options);

        if (cached !== undefined) {
            return cached;
        }

        const headers: Record<string, string> = {
            Accept: DEON_MEDIA_TYPE,
        };

        // An empty token sends no header at all.
        if (options.token) {
            headers.Authorization = `Bearer ${options.token}`;
        }

        const response = await fetch(link, { headers });

        if (!response.ok) {
            resourceError(
                DiagnosticCode.RESOURCE_IO,
                `Unable to read '${link}': HTTP ${response.status}.`,
                link,
            );
        }

        // Decoded strictly, like every other resource read: a response that is not valid UTF-8 is a
        // resource-format fault, not text papered over with U+FFFD.
        const parsed = await this.parse<T>(
            decodeResource(new Uint8Array(await response.arrayBuffer()), link),
            {
                ...options,
                sourceName: link,
            },
        );

        await this.setCache(link, parsed, options);

        return parsed;
    }


    public async leaflinks(
        data: string,
        options?: PartialDeonParseOptions,
    ): Promise<Record<string, DeonValue>> {
        const sourceName = options?.sourceName ?? '<memory>';
        const interpreter = new Interpreter(Deon, fetcher);

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


    /**
     * The entities a document declares, and the arguments each would demand if it were called.
     *
     * This is syntactic: the document is read, not evaluated, so nothing is loaded and nothing is
     * reached. It is safe to point at a file whose imports have not been agreed to.
     *
     * An entity that carries interpolations is a template — `#name(parameter value)` fills them in —
     * which is what lets a `.deon` file stand as a prompt library, and this is what says what a
     * prompt's arguments are.
     */
    public entities(
        data: string,
        sourceName = '<memory>',
    ): DeonEntity[] {
        const document = this.parseSyntax(data, sourceName);

        return document.declarations.map(declaration => {
            // A resource is a declaration too, and shares the one namespace, so leaving it out would
            // make the list a lie about which names are taken.
            if (declaration.type !== 'leaflink') {
                return {
                    name: declaration.name,
                    parameters: [],
                    kind: 'resource',
                } as DeonEntity;
            }

            return {
                name: declaration.name,
                parameters: [...entityParameters(declaration.value)],
                kind: declaration.value.type,
            } as DeonEntity;
        });
    }


    public async loadEnvironment(
        source: string,
        options?: DeonLoadEnvironmentOptions,
    ) {
        const data = await this.parseFile<Record<string, string>>(source);

        setEnvironment(data, options?.overwrite);

        return data;
    }


    private interpreterOptions(
        sourceName: string,
        options?: PartialDeonParseOptions,
    ): DeonInterpreterOptions {
        return {
            file: sourceName === '<memory>' ? undefined : sourceName,
            parseOptions: options,
        };
    }


    /**
     * Typing is outside the Deon data model, so a document is evaluated to strings, lists, and maps
     * first, and the datasign contract is applied to the finished root (specification 14). Without
     * a map there is nothing to apply, and the files are not read at all.
     */
    private datasignFiles(
        options?: PartialDeonParseOptions,
    ) {
        const map = options?.datasignMap;

        if (!map || !Object.keys(map).length) {
            return undefined;
        }

        return options?.datasignFiles ?? [];
    }


    private applyDatasignSources(
        root: DeonValue,
        sources: string[],
        options?: PartialDeonParseOptions,
    ) {
        const signatures = readDatasign(sources, options?.datasignReader);

        return applyDatasign(root, signatures, options?.datasignMap ?? {});
    }


    private datasignTarget(
        file: string,
        options?: PartialDeonParseOptions,
    ) {
        const base = options?.filebase || process.cwd();

        return path.isAbsolute(file) ? file : path.join(base, file);
    }


    private datasignVirtual(
        file: string,
        options?: PartialDeonParseOptions,
    ) {
        const target = this.datasignTarget(file, options);
        const virtual = options?.resources?.[target] ?? options?.resources?.[file];

        // Reading a datasign file is filesystem access, and a raw-text parser grants none.
        if (virtual === undefined && !options?.allowFilesystem) {
            datasignError(
                DiagnosticCode.CAPABILITY_DENIED,
                `Reading the datasign file '${file}' requires filesystem access.`,
                file,
            );
        }

        return {
            target,
            virtual,
        };
    }


    private async readDatasignSource(
        file: string,
        options?: PartialDeonParseOptions,
    ) {
        const { target, virtual } = this.datasignVirtual(file, options);

        if (virtual !== undefined) {
            return virtual;
        }

        let bytes: Uint8Array;

        try {
            bytes = await fs.readFile(target);
        } catch {
            return datasignError(
                DiagnosticCode.RESOURCE_IO,
                `Unable to read the datasign file '${file}'.`,
                file,
            );
        }

        return decodeResource(bytes, file);
    }


    private readDatasignSourceSynchronous(
        file: string,
        options?: PartialDeonParseOptions,
    ) {
        const { target, virtual } = this.datasignVirtual(file, options);

        if (virtual !== undefined) {
            return virtual;
        }

        let bytes: Uint8Array;

        try {
            bytes = fsSync.readFileSync(target);
        } catch {
            return datasignError(
                DiagnosticCode.RESOURCE_IO,
                `Unable to read the datasign file '${file}'.`,
                file,
            );
        }

        return decodeResource(bytes, file);
    }


    /**
     * The credential is part of the cache key, so a document read with one token can never be
     * served to a reader holding another (specification 9).
     */
    private async cacheKey(
        name: string,
        options?: PartialDeonParseOptions,
    ) {
        return sha.compute(`${name}\u0000${options?.token ?? ''}`);
    }


    private async getCache<T>(
        name: string,
        options?: PartialDeonParseOptions,
    ): Promise<T | undefined> {
        if (!options?.cache || typeof window !== 'undefined') {
            return undefined;
        }

        const key = await this.cacheKey(name, options);

        if (!key) {
            return undefined;
        }

        const directory = options.cacheDirectory || defaultCacheDirectory();
        const cachePath = path.join(directory, key);

        if (!fsSync.existsSync(cachePath)) {
            return undefined;
        }

        try {
            const cached = JSON.parse(await fs.readFile(cachePath, 'utf8')) as {
                cachedAt: number;
                cacheDuration: number;
                data: T;
            };

            if (cached.cachedAt + cached.cacheDuration < Date.now()) {
                await fs.unlink(cachePath);

                return undefined;
            }

            return cached.data;
        } catch {
            return undefined;
        }
    }


    private async setCache(
        name: string,
        data: unknown,
        options?: PartialDeonParseOptions,
    ) {
        if (!options?.cache || typeof window !== 'undefined') {
            return;
        }

        const key = await this.cacheKey(name, options);

        if (!key) {
            return;
        }

        const directory = options.cacheDirectory || defaultCacheDirectory();

        await fs.mkdir(directory, { recursive: true });

        await fs.writeFile(
            path.join(directory, key),
            JSON.stringify({
                cachedAt: Date.now(),
                cacheDuration: options.cacheDuration ?? defaultCacheDuration,
                data,
            }),
            'utf8',
        );
    }
}
// #endregion module



// #region exports
export default Deon;
// #endregion exports
