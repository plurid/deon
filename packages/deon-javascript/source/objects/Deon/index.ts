// #region imports
    // #region libraries
    import * as readline from 'readline';
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
        EXIT_CODE_ERROR,
        EXIT_CODE_RUNTIME_ERROR,
    } from '../../data/constants';

    import {
        TokenType,
    } from '../../data/enumerations';
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
            return
        }

        if (length === 3) {
            await this.runFile(args[2]);
            return;
        }

        this.runREPL();
    }

    static async runFile(
        file: string,
    ) {
        try {
            const filepath = path.join(process.cwd(), file);
            const data = await fs.readFile(filepath, 'utf-8');

            this.run(data);

            if (this.hadError) {
                process.exit(EXIT_CODE_ERROR);
            }

            if (this.hadRuntimeError) {
                process.exit(EXIT_CODE_RUNTIME_ERROR);
            }
        } catch (error) {
            console.log(`Error reading file: ${file}`);
        }
    }

    static runREPL() {
        // console.log('\n\tdeon read-evaluate-print loop >>>\n');

        // let inputline = readline.createInterface({
        //     input: process.stdin,
        //     output: process.stdout,
        // });

        // const recursiveAsyncReadLine = () => {
        //     inputline.question('> ', (answer) => {
        //         if (answer == 'exit') {
        //             return inputline.close();
        //         }

        //         this.run(answer);
        //         this.hadError = false;

        //         recursiveAsyncReadLine();
        //     });
        // };

        // recursiveAsyncReadLine();
    }

    static run(
        data: string,
    ) {
        const scanner = new Scanner(data);
        console.log('scanner', scanner);
        const tokens = scanner.scanTokens();
        console.log('tokens', tokens);
        // const parser = new Parser(tokens);
        // const statements = parser.parse();

        // // Stop if there was a syntax error.
        // if (this.hadError) {
        //     return;
        // }

        // const resolver = new Resolver(this.interpreter);
        // resolver.resolve(statements);

        // // Stop if there was a resolution error.
        // if (this.hadError) {
        //     return;
        // }

        // this.interpreter.interpret(statements);
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
