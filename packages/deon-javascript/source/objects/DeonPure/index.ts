// #region imports
    // #region external
    import Scanner from '../Scanner';
    import Token from '../Token';
    import Parser from '../Parser';
    // import Resolver from '../Resolver';
    import Interpreter from '../InterpreterPure';
    import Stringifier from '../Stringifier';

    import {
        TokenType,
    } from '../../data/enumerations';

    import {
        PartialDeonParseOptions,
        PartialDeonStringifyOptions,
        DeonInterpreterOptions,
    } from '../../data/interfaces';
    // #endregion external
// #endregion imports



// #region module
class DeonPure {
    private interpreter: Interpreter = new Interpreter();
    private hadError = false;
    private parsedFile = '';

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
export default DeonPure;
// #endregion exports
