// #region imports
    // #region libraries
    import {
        promises as fs,
    } from 'fs';

    import path from 'path';
    // #endregion libraries


    // #region external
    import Scanner from '../Scanner';
    import Token from '../Token';
    import Parser from '../Parser';
    import Interpreter from '../Interpreter';
    import Resolver from '../Resolver';

    import {
        TokenType,
    } from '../../data/enumerations';

    import {
        DeonParseOptions,
        PartialDeonParseOptions,
        PartialDeonStringifyOptions,
    } from '../../data/interfaces';

    import {
        log,
    } from '../../utilities/log';
    // #endregion external
// #endregion imports



// #region module
class Deon {
    private interpreter: Interpreter = new Interpreter();
    private hadError = false;

    /**
     * Parse based on arguments passed as command line.
     *
     * @param args
     */
    async demand(
        args: string[],
    ) {
        const length = args.length;

        if (length > 3) {
            console.log('\n\tUsage: deon <source-file>\n');
            return;
        }

        if (length === 3) {
            const data = await this.parseFile(
                args[2],
            );

            if (data) {
                log(data);
            }

            return;
        }

        return;
    }

    /**
     * Parse from file
     *
     * @param file
     * @param options
     */
    async parseFile(
        file: string,
        options?: PartialDeonParseOptions,
    ) {
        try {
            const absolutePath = path.isAbsolute(file);

            const filepath = absolutePath
                ? file
                : path.join(process.cwd(), file);

            const data = await fs.readFile(filepath, 'utf-8');

            const parsed = this.parse(data);

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
     * Parse deon string `data`.
     *
     * @param data
     * @param options
     */
    async parse(
        data: string,
        options?: DeonParseOptions,
    ) {
        const scanner = new Scanner(
            data,
            this.error,
        );
        // console.log('scanner', scanner);
        const tokens = scanner.scanTokens();
        // console.log('tokens', tokens);
        const parser = new Parser(
            tokens,
            this.error,
        );
        // console.log('parser', parser);
        const statements = parser.parse();
        // console.log('statements', statements);
        // console.log('---');

        // // Stop if there was a syntax error.
        // if (this.hadError) {
        //     return;
        // }

        // for (const statement of statements) {
        //     console.log('statement', statement);
        //     // for (const stmt of statement.statements) {
        //     //     console.log('stmt', stmt);
        //     // }
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

        const interpretedData = await this.interpreter.interpret(statements);

        return interpretedData;
    }

    /**
     * Transform in-memory `data` into a deon string.
     *
     * @param data
     * @param options
     */
    stringify(
        data: any,
        options?: PartialDeonStringifyOptions,
    ) {

        return '';
    }

    /**
     * Log error.
     *
     * @param entity
     * @param message
     */
    error(
        entity: number | Token,
        message: string,
    ) {
        if (typeof entity === 'number') {
            // entity is a line number
            this.report(entity, '', message);
            return;
        }

        // entity is a Token
        if (entity.type === TokenType.EOF) {
            this.report(entity.line, ' at end', message);
        } else {
            this.report(entity.line, " at '" + entity.lexeme + "'", message);
        }
    }

    /**
     * Logs to console a static error.
     *
     * @param line
     * @param where
     * @param message
     */
    report(
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
