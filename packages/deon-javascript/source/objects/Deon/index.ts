// #region imports
    // #region libraries
    import {
        promises as fs,
    } from 'fs';

    import path from 'path';

    import {
        program,
    } from 'commander';
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
    } from '../../data/constants';

    import {
        TokenType,
    } from '../../data/enumerations';

    import {
        PartialDeonParseOptions,
        PartialDeonStringifyOptions,
        DeonInterpreterOptions,
    } from '../../data/interfaces';

    import {
        log,
    } from '../../utilities/log';

    import {
        typer,
    } from '../../utilities/typer';
    // #endregion external
// #endregion imports



// #region module
class Deon {
    private interpreter: Interpreter = new Interpreter();
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
                '-o, --output <type>',
                'output type: deon, json',
                'deon',
            )
            .option(
                '-t, --typed',
                'typed output',
                false,
            ).action(async (
                file: string,
                options: any,
            ) => {
                const data: any = await this.parseFile(
                    file,
                );

                switch (options.output) {
                    case 'deon': {
                        const deonValue = this.stringify(data)
                        // remove doubled new lines
                        const value = deonValue.slice(
                            0,
                            deonValue.length - 1,
                        );
                        log(value);
                        break;
                    }
                    case 'json': {
                        if (options.typed) {
                            log(
                                JSON.stringify(
                                    typer(data),
                                    null,
                                    4,
                                ),
                            );
                        } else {
                            log(
                                JSON.stringify(
                                    data,
                                    null,
                                    4,
                                ),
                            );
                        }
                        break;
                    }
                    default:
                        console.log(`Unsupported output '${options.output}'`);
                        break;
                }
            });

        program
            .command('convert <source> [destination]')
            .description('convert a ".json" file to ".deon"')
            .action(async (
                source,
                destination,
            ) => {
                try {
                    const absolutePath = path.isAbsolute(source);
                    const filepath = absolutePath
                        ? source
                        : path.join(process.cwd(), source);

                    const data = await fs.readFile(
                        filepath,
                        'utf-8',
                    );

                    const parsedData = JSON.parse(data);

                    const deonString = this.stringify(
                        parsedData,
                    );

                    if (destination) {
                        const absoluteDestinationPath = path.isAbsolute(destination);
                        const filepathDestination = absoluteDestinationPath
                            ? destination
                            : path.join(process.cwd(), destination);

                        await fs.writeFile(
                            filepathDestination,
                            deonString,
                        );
                    } else {
                        // remove doubled new lines
                        const value = deonString.slice(
                            0,
                            deonString.length - 1,
                        );
                        console.log(value);
                    }
                } catch (error) {
                    console.log(`Could not convert '${source}'`);
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
            const absolutePath = path.isAbsolute(file);

            const filepath = absolutePath
                ? file
                : path.join(process.cwd(), file);

            const data = await fs.readFile(
                filepath,
                'utf-8',
            );

            const parsed: T = await this.parse(
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
