// #region imports
    // #region external
    // import {
    //     TokenType,
    // } from '../../data/enumerations';

    import Deon from '../Deon';
    import * as Expression from '../Expression';
    import * as Statement from '../Statement';
    import Environment from '../Environment';
    import Token from '../Token';
    import {
        RuntimeError,
    } from '../Errors';

    import {
        fetcher,
    } from '../../utilities/fetcher';
    // #endregion external
// #endregion imports



// #region module
class Interpreter implements Expression.Visitor<any>, Statement.Visitor<any> {
    public globals: Environment = new Environment();
    public locals: Map<Expression.Expression, number> = new Map();
    private environment: Environment = this.globals;
    private rootEnvironment: Environment = new Environment();
    private runtimeError: any;


    constructor(
        runtimeError: any,
    ) {
        this.runtimeError = runtimeError;
    }


    public async interpret(
        statements: Statement.Statement[],
    ) {
        try {
            for (const statement of statements) {
                await this.execute(statement);
            }

            return this.extract();
        } catch (error) {
            this.runtimeError(error);

            return;
        }
    }

    public async execute(
        statement: Statement.Statement,
    ) {
        await statement.accept(this);
    }

    public resolve(
        expression: Expression.Expression,
        depth: number,
    ) {
        this.locals.set(
            expression,
            depth,
        );
    }

    public extract() {
        console.log('this.environment', this.environment);
        console.log('this.rootEnvironment', this.rootEnvironment);

        const obj: any = {};

        const values = this.rootEnvironment.getAll();

        for (const [key, value] of values) {
            obj[key] = value;
        }

        return obj;
    }



    /** STATEMENTS */
    public async visitImportStatement(
        statement: Statement.ImportStatement,
    ) {
        const data = await fetcher(statement.path.lexeme);

        if (!data) {
            return;
        }

        const deon = new Deon();
        const parsedData = await deon.parse(data);

        this.environment.define(
            statement.name.lexeme,
            parsedData,
        );

        return null;
    }

    public visitBlockStatement(
        statement: Statement.BlockStatement,
    ) {
        this.executeBlock(
            statement.statements,
            new Environment(this.environment),
        );

        return null;
    }

    public visitRootStatement(
        statement: Statement.RootStatement,
    ) {
        this.executeBlock(
            statement.statements,
            new Environment(this.environment),
            'root',
        );

        return null;
    }

    public visitMapStatement(
        statement: Statement.MapStatement,
    ) {
        this.executeBlock(
            statement.statements,
            new Environment(this.environment),
        );

        return null;
    }

    public visitListStatement(
        statement: Statement.ListStatement,
    ) {
        this.executeBlock(
            statement.statements,
            new Environment(this.environment),
        );

        return null;
    }

    public visitExpressionStatement(
        statement: Statement.ExpressionStatement,
    ) {
        this.evaluate(statement.expression);
        return null;
    }

    public visitVariableStatement(
        statement: Statement.VariableStatement,
    ) {
        let value = null;

        if (statement.initializer !== null) {
            value = this.evaluate(statement.initializer);
        }

        this.environment.define(statement.name.lexeme, value);

        return null;
    }



    /** EXPRESSIONS */
    public visitLiteralExpression(
        literalExpression: Expression.LiteralExpression,
    ) {
        return literalExpression.value;
    }

    public visitGroupingExpression(
        groupingExpression: Expression.GroupingExpression,
    ) {
        return this.evaluate(groupingExpression.expression);
    }

    public visitVariableExpression(
        expression: Expression.VariableExpression,
    ) {
        return this.lookUpVariable(
            expression.name,
            expression,
        );
    }

    public visitAssignExpression(
        expression: Expression.AssignExpression,
    ) {
        const value = this.evaluate(expression.value);

        const distance = this.locals.get(expression);
        if (distance) {
            this.environment.assignAt(
                distance,
                expression.name,
                value,
            );
        } else {
            this.globals.assign(
                expression.name,
                value,
            );
        }

        this.environment.assign(expression.name, value);
        return value;
    }


    public executeBlock(
        statements: Statement.Statement[],
        environment: Environment,
        type?: string,
    ) {
        const previous = this.environment;

        try {
            this.environment = environment;

            for (const statement of statements) {
                this.execute(statement);
            }

            if (type === 'root') {
                this.rootEnvironment = this.environment;
            }
        } catch (error) {
            this.environment = previous;
            throw error;
        } finally {
            this.environment = previous;
        }
    }

    public evaluate(
        expression: Expression.Expression,
    ): any {
        return expression.accept(this);
    }

    public isTruthy(
        object: any,
    ) {
        if (object === null) {
            return false;
        }

        if (typeof object === 'boolean') {
            return object;
        }

        return true;
    }

    public isEqual(
        a: any,
        b: any,
    ) {
        // nil is only equal to nil.
        if (a === null && b === null) {
            return true;
        }

        if (a === null) {
            return false;
        }

        if (Object.keys(a).length !== Object.keys(b).length) {
            return false;
        }

        return a === b;
    }

    public checkNumberOperand(
        operator: Token,
        operand: any,
    ) {
        if (typeof operand === 'number') {
            return;
        }

        throw new RuntimeError(operator, 'Operand must be a number.');
    }

    public checkNumberOperands(
        operator: Token,
        left: any,
        right: any,
    ) {
        if (typeof left === 'number' && typeof right === 'number') {
            return;
        }

        throw new RuntimeError(operator, 'Operands must be numbers.');
    }

    public stringify(
        object: any,
    ) {
        if (object === null) {
            return 'nil';
        }

        if (typeof object === 'number') {
            let text = object.toString();
            if (text.endsWith(".0")) {
                text = text.substring(0, text.length - 2);
            }
            return text;
        }

        return object.toString();
    }

    private lookUpVariable(
        name: Token,
        expression: Expression.Expression,
    ) {
        const distance = this.locals.get(expression);

        if (typeof distance !== 'undefined') {
            return this.environment.getAt(distance, name.lexeme);
        } else {
            return this.globals.get(name);
        }
    }
}
// #endregion module



// #region exports
export default Interpreter;
// #endregion exports
