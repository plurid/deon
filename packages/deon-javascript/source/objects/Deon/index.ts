// #region imports
    // #region libraries
    import fsSync, {
        promises as fs,
    } from 'fs';

    import path from 'path';

    import {
        program,
    } from 'commander';

    import fetch from 'cross-fetch';
    // #endregion libraries


    // #region external
    import Scanner from '../Scanner';
    import Token from '../Token';
    import Parser from '../Parser';
    // import Resolver from '../Resolver';
    import Interpreter from '../Interpreter';
    import Stringifier from '../Stringifier';

    import {
        DEON_CLI_VERSION,
        DEON_MEDIA_TYPE,

        defaultCacheDuration,
        defaultCacheDirectory,
    } from '../../data/constants';

    import {
        TokenType,
    } from '../../data/enumerations';

    import {
        PartialDeonParseOptions,
        PartialDeonStringifyOptions,
        DeonInterpreterOptions,
        DeonLoadEnvironmentOptions,
    } from '../../data/interfaces';

    import fetcher from '../../utilities/fetcher';

    import {
        resolveAbsolutePath,
    } from '../../utilities/general/impure';

    import {
        handleFileOutput,
        handleConvert,
        handleConfile,
        handleExfile,
    } from '../../utilities/cli';

    import sha from '../../utilities/sha';

    import {
        setEnvironment,
        spawnEnvironmentCommand,
    } from '../../utilities/environment';
    // #endregion external
// #endregion imports



// #region module
class Deon {
    private interpreter: Interpreter = new Interpreter(
        Deon,
        fetcher,
    );
    private hadError = false;
    private parsedFile = '';



    /**
     * Parse based on arguments passed as command line.
     *
     * @param args
     */
    public async demand(
        args: string[],
    ) {
        program
            .name('deon')
            .version(DEON_CLI_VERSION, '-v, --version')
            .arguments('<file>')
            .description('read a ".deon" file and output the parsed result')
            .option(
                '-o, --output <value>',
                'output type: deon, json',
                'deon',
            )
            .option(
                '-t, --typed <value>',
                'typed output',
                'false',
            )
            .option(
                '-f, --filesystem <value>',
                'allow filesystem',
                'true',
            )
            .option(
                '-n, --network <value>',
                'allow network',
                'true',
            ).action(async (
                file: string,
                options: any,
            ) => {
                try {
                    options = {
                        ...options,
                        typed: options.typed.trim().toLowerCase() === 'true',
                        filesystem: options.filesystem.trim().toLowerCase() === 'true',
                        network: options.network.trim().toLowerCase() === 'true',
                    };

                    const data: any = await this.parseFile(
                        file,
                        {
                            allowFilesystem: options.filesystem,
                            allowNetwork: options.network,
                        },
                    );

                    handleFileOutput(
                        data,
                        this.stringify(data),
                        options,
                    );
                } catch (error) {
                    console.log(`Deon :: Something went wrong.`);
                }
            });

        program
            .command('convert <source> [destination]')
            .description('convert a ".json" file to ".deon"')
            .action(async (
                source: string,
                destination: string | undefined,
            ) => {
                try {
                    const filepath = resolveAbsolutePath(source);
                    const data = await fs.readFile(
                        filepath,
                        'utf-8',
                    );
                    const parsedData = JSON.parse(data);
                    const deonString = this.stringify(
                        parsedData,
                    );

                    await handleConvert(
                        destination,
                        deonString,
                    );
                } catch (error) {
                    console.log(`Deon :: Could not convert '${source}'.`);
                }
            });

        program
            .command('environment <source> <command...>')
            .description('loads environment variables from a ".deon" file and spawns a new command')
            .option(
                '-w, --writeover',
                'overwrite keys if already defined',
                false,
            )
            .action(async (
                source: string,
                command: string[],
                options,
            ) => {
                const data = await this.parseFile<any>(source);
                spawnEnvironmentCommand(
                    command,
                    data,
                    {
                        overwrite: options.writeover,
                    },
                );
            });

        program
            .command('confile <files...>')
            .description('combine files into a single ".deon" file')
            .option(
                '-d, --destination <file>',
                'path to confile',
                'confile.deon',
            )
            .action(async (
                files: string[],
                options: any,
            ) => {
                const destination = options.destination;

                try {
                    await handleConfile(
                        files,
                        destination,
                    );
                } catch (error) {
                    console.log(`Deon :: Could not confile '${destination}'.`);
                }
            });

        program
            .command('exfile <source>')
            .description('extract files from a ".deon" confile')
            .action(async (
                source: string,
            ) => {
                try {
                    const deon = new Deon();

                    await handleExfile(
                        deon,
                        source,
                    );
                } catch (error) {
                    console.log(`Deon :: Could not exfile '${source}'.`);
                }
            });

        await program.parseAsync(args);

        return;
    }


    /**
     * Parse from file
     *
     * @param file
     * @param options
     */
    public async parseFile<T>(
        file: string,
        options?: PartialDeonParseOptions,
    ) {
        try {
            this.parsedFile = file;
            const filepath = resolveAbsolutePath(file);

            const data = await fs.readFile(
                filepath,
                'utf-8',
            );

            const parsed = await this.parse<T>(
                data,
                {
                    ...options,
                    filebase: path.dirname(filepath),
                },
            );

            if (this.hadError) {
                console.log(`Deon :: Error parsing file: ${file}`);
                return;
            }

            return parsed;
        } catch (error) {
            console.log(`Deon :: Error reading file: ${file}`);

            return;
        }
    }


    /**
     * Parse from link
     *
     * @param link
     * @param options
     */
    public async parseLink<T>(
        link: string,
        options?: PartialDeonParseOptions,
    ) {
        try {
            const cache = await this.getCache(
                link,
                options,
            );
            if (cache) {
                return cache;
            }


            const headers: Record<string, string> = {
                'Content-Type': DEON_MEDIA_TYPE,
            };

            if (options?.token) {
                headers['Deon-Token'] = options.token;
            }

            const response = await fetch(
                link,
                {
                    headers,
                },
            );
            const data = await response.text();

            const parsed = await this.parse<T>(
                data,
                {
                    ...options,
                },
            );

            this.setCache(
                link,
                parsed,
                options,
            );

            return parsed;
        } catch (error) {
            console.log(`Deon :: Error parsing link: ${link}`);

            return;
        }
    }


    /**
     * Parse `deon` data.
     *
     * @param data
     * @param options
     */
    public async parse<T = any>(
        data: string,
        options?: PartialDeonParseOptions,
    ) {
        const scanner = new Scanner(
            data,
            this.error,
        );
        const tokens = scanner.scanTokens();
        // console.log('tokens', tokens);

        const parser = new Parser(
            tokens,
            this.error,
        );
        const statements = parser.parse();
        // console.log('statements', statements);

        // // Stop if there was a syntax error.
        // if (this.hadError) {
        //     return;
        // }

        // const resolver = new Resolver(
        //     this.interpreter,
        //     this.error,
        // );
        // await resolver.resolve(statements);

        // // Stop if there was a resolution error.
        // if (this.hadError) {
        //     return;
        // }

        const interpretOptions: DeonInterpreterOptions = {
            file: this.parsedFile,
            parseOptions: options,
        };
        const interpretedData: T = await this.interpreter.interpret(
            statements,
            interpretOptions,
        );

        return interpretedData;
    }


    /**
     * Parse `deon` data synchronously.
     *
     * @param data
     * @param options
     */
    public parseSynchronous<T = any>(
        data: string,
        options?: PartialDeonParseOptions,
    ) {
        const scanner = new Scanner(
            data,
            this.error,
        );
        const tokens = scanner.scanTokens();

        const parser = new Parser(
            tokens,
            this.error,
        );
        const statements = parser.parse();

        const interpretOptions: DeonInterpreterOptions = {
            file: this.parsedFile,
            parseOptions: options,
        };
        const interpretedData: T = this.interpreter.interpretSynchronous(
            statements,
            interpretOptions,
        );

        return interpretedData;
    }


    /**
     * Transform in-memory `data` into a deon string.
     *
     * @param data
     * @param options
     */
    public stringify(
        data: any,
        options?: PartialDeonStringifyOptions,
    ) {
        const stringifier = new Stringifier(
            options,
        );

        return stringifier.stringify(data);
    }


    /**
     * Formats deon data to the canonical shape.
     *
     * @param data
     */
    public canonical(
        data: string,
    ) {
        const parsed = this.parse(data);
        const stringified = this.stringify(parsed);

        return stringified;
    }


    /**
     * Loads environment variables from a ".deon" file.
     *
     * @param source
     */
    public async loadEnvironment(
        source: string,
        options?: DeonLoadEnvironmentOptions,
    ) {
        try {
            const data = await this.parseFile<any>(source);

            setEnvironment(
                data,
                options?.overwrite,
            );
        } catch (error) {
            console.log(`Deon :: Could not load environment '${source}'.`);
        }
    }



    private async getCache(
        name: string,
        options?: PartialDeonParseOptions,
    ) {
        if (typeof window !== 'undefined') {
            return;
        }

        if (!options?.cache) {
            return;
        }

        const cacheName = await sha.compute(name);
        if (!cacheName) {
            return;
        }

        const cacheDirectory = options.cacheDirectory || defaultCacheDirectory();
        const cachePath = path.join(
            cacheDirectory,
            `./${cacheName}`,
        );

        if (!fsSync.existsSync(cachePath)) {
            return;
        }

        const data = await fs.readFile(cachePath, 'utf-8');
        const parsed = await this.parse(data);
        if (
            !parsed
            || typeof parsed.cachedAt !== 'string'
        ) {
            return;
        }

        const cacheDuration = options.cacheDuration
            ? options.cacheDuration
            : parsed.cacheDuration
                ? parseInt(parsed.cacheDuration)
                : defaultCacheDuration;

        const now = Date.now();

        if ((parseInt(parsed.cachedAt) + cacheDuration) < now) {
            await fs.unlink(cachePath);
            return;
        }

        return parsed.data;
    }

    private async setCache(
        name: string,
        data: any,
        options?: PartialDeonParseOptions,
    ) {
        if (typeof window !== 'undefined') {
            return;
        }

        if (!options?.cache) {
            return;
        }

        const cacheName = await sha.compute(name);
        if (!cacheName) {
            return;
        }

        const cacheDirectory = options?.cacheDirectory || defaultCacheDirectory();
        const cachePath = path.join(
            cacheDirectory,
            `./${cacheName}`,
        );

        const cacheDuration = options?.cacheDuration;

        const cacheData = {
            cachedAt: Date.now(),
            cacheDuration,
            data,
        };

        if (!fsSync.existsSync(cacheDirectory)) {
            fsSync.mkdirSync(cacheDirectory);
        }

        await fs.writeFile(
            cachePath,
            this.stringify(cacheData),
        );

        return true;
    }



    /**
     * Log error.
     *
     * @param entity
     * @param message
     */
    private error(
        entity: number | Token,
        message: string,
    ) {
        if (typeof entity === 'number') {
            // entity is a line number
            // this.report(entity, '', message);
            return;
        }

        // entity is a Token
        if (entity.type === TokenType.EOF) {
            // this.report(entity.line, ' at end', message);
        } else {
            // this.report(entity.line, " at '" + entity.lexeme + "'", message);
        }
    }


    /**
     * Logs to console a static error.
     *
     * @param line
     * @param where
     * @param message
     */
    private report(
        line: number,
        where: string,
        message: string,
    ) {
        const value = 'Deon :: [line ' + line + '] Error' + where + ': ' + message;
        console.log(value);

        this.hadError = true;
    }
}
// #endregion module



// #region exports
export default Deon;
// #endregion exports
