// #region imports
    // #region libraries
    import {
        promises as fs,
    } from 'fs';

    import path from 'path';
    // #endregion libraries


    // #region external
    /**
     * circular dependency fixable when Deon and Scanner are in the same file
     */
    import Scanner from '../Scanner';
    import Token from '../Token';
    import Parser from '../Parser';
    import Interpreter from '../Interpreter';
    import Resolver from '../Resolver';
    import {
        RuntimeError,
    } from '../Errors';

    import {
        TokenType,
    } from '../../data/enumerations';

    import {
        PartialDeonParseOptions,
        PartialDeonStringifyOptions,
    } from '../../data/interfaces';
    // #endregion external
// #endregion imports



// #region module
class Deon {
    static interpreter: Interpreter = new Interpreter();
    static hadError = false;
    static hadRuntimeError = false;

    static async main(
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
                console.log(data);
            }

            return;
        }

        return;
    }

    static async parseFile(
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
                console.log(`Error parsing file: ${file}`);
                return;
            }

            return parsed;
        } catch (error) {
            console.log(`Error reading file: ${file}`);

            return;
        }
    }

    static async parse(
        data: string,
    ) {
        const scanner = new Scanner(data);
        // console.log('scanner', scanner);
        const tokens = scanner.scanTokens();
        // console.log('tokens', tokens);
        const parser = new Parser(tokens);
        // console.log('parser', parser);
        const statements = parser.parse();

        // // Stop if there was a syntax error.
        if (this.hadError) {
            return;
        }

        // for (const statement of statements) {
        //     console.log('statement', statement);
        // }

        const resolver = new Resolver(this.interpreter);
        resolver.resolve(statements);

        // Stop if there was a resolution error.
        if (this.hadError) {
            return;
        }

        const interpretedData = this.interpreter.interpret(statements);

        return interpretedData;
    }

    static stringify(
        data: any,
        options?: PartialDeonStringifyOptions,
    ) {

        return '';
    }

    static error(
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

    static runtimeError(
        error: RuntimeError,
    ) {
        console.log(
            error.message + '\n[line ' + error.token?.line + ']'
        );
        this.hadRuntimeError = true;
    }

    static report(
        line: number,
        where: string,
        message: string,
    ) {
        const value = '[line ' + line + '] Error' + where + ': ' + message;
        console.log(value);

        this.hadError = true;
    }
}
// #endregion module



// #region exports
export default Deon;
// #endregion exports
