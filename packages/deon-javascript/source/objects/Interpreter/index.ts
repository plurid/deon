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
        fetcher,
    } from '../../utilities/fetcher';

    import {
        mapToObject,
    } from '../../utilities/general';
    // #endregion external
// #endregion imports



// #region module
class Interpreter implements Expression.Visitor<any>, Statement.Visitor<any> {
    public globals: Environment = new Environment();
    public locals: Map<Expression.Expression, number> = new Map();
    private environment: Environment = this.globals;
    private leaflinks: Environment = new Environment();
    private rootEnvironment: Environment = new Environment();
    private rootKind = 'map';


    public async interpret(
        statements: Statement.Statement[],
    ) {
        try {
            const importStatements = [];
            const leaflinkStatements = [];
            let rootStatement;

            for (const statement of statements) {
                if (
                    statement instanceof Statement.LeaflinkStatement
                ) {
                    leaflinkStatements.push(statement);
                }

                if (statement instanceof Statement.RootStatement) {
                    rootStatement = statement;
                }

                if (statement instanceof Statement.ImportStatement) {
                    importStatements.push(statement);
                }
            }

            await this.resolveLeaflinks([
                ...importStatements,
                ...leaflinkStatements,
            ]);
            await this.resolveRoot(rootStatement);

            return this.extract();
        } catch (error) {

            return;
        }
    }

    public async execute(
        statement: Statement.Statement,
    ) {
        // console.log('execute', statement);
        const value: any = await statement.accept(this);
        return value;
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

    private extractFromValues(
        values: any,
    ) {
        let obj: any = {}

        for (const [key, value] of values) {
            if (value instanceof Environment) {
                const envValues = value.getAll();
                const keyValue = this.extractFromValues(envValues);
                obj[key] = keyValue;
            } else {
                obj[key] = value;
            }
        }

        return obj;
    }

    public extract() {
        const obj: any = this.rootKind === 'map' ? {} : [];

        const values = this.rootEnvironment.getAll();
        // console.log('rootEnvironment', this.rootEnvironment);
        // console.log('extract', values);
        // console.log('leaflinks', this.leaflinks.getAll());
        // console.log('------------');

        for (const [key, value] of values) {
            if (value instanceof Environment) {
                const envValues = value.getAll();
                obj[key] = this.extractFromValues(envValues);
            } else {
                obj[key] = value;
            }
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

    public async visitRootStatement(
        statement: Statement.RootStatement,
    ) {
        this.rootKind = statement.kind;

        await this.executeBlock(
            statement.statements,
            new Environment(),
            'root',
        );

        return null;
    }

    public async visitExpressionStatement(
        statement: Statement.ExpressionStatement,
    ) {
        await this.evaluate(statement.expression);
        return null;
    }

    public async visitKeyStatement(
        statement: Statement.KeyStatement,
    ) {
        let value = null;

        if (statement.initializer !== null) {
            value = await this.evaluate(statement.initializer);
        }

        this.environment.define(statement.name.lexeme, value);

        return null;
    }

    public async visitLeaflinkStatement(
        statement: Statement.LeaflinkStatement,
    ) {
    }

    public async visitLinkStatement(
        statement: Statement.LinkStatement,
    ) {
        // console.log('visitLinkStatement', statement);
        // console.log('this.leaflinks', this.leaflinks);

        const name = statement.name.literal;

        let value = null;
        let leaflinkName;

        if (statement.initializer) {
            leaflinkName = await this.evaluate(statement.initializer);
        }

        console.log('visitLinkStatement', name, leaflinkName);

        if (name === leaflinkName) {
            const values = this.leaflinks.getAll();
            const leaflinkValue = values.get(name);
            console.log('leaflinkValue', leaflinkValue);

            if (!leaflinkValue) {
                // if looking for leaflinks
                // add to values that need research
                return;
            }

            // if it is shortened defined
            this.environment.define(name, leaflinkValue);

            // if it is in array
            return leaflinkValue;
        } else {
            // console.log('leaflinkName', leaflinkName);

            const values = this.leaflinks.getAll();
            // console.log('values', values);
            const leaflink = values.get(leaflinkName);
            // console.log('leaflink', leaflink);
            if (leaflink) {
                // console.log('leaflink', leaflink);
                // is array
                value = leaflink;

                // is environment
                // const values = leaflink.getAll();
                // value = mapToObject(values);
            }

            this.environment.define(statement.name.lexeme, value);
        }

        return null;
    }

    public visitSpreadStatement(
        statement: Statement.SpreadStatement,
    ) {
        const name = statement.name.lexeme.replace('...#', '');
        console.log(statement, name);

        const values = this.leaflinks.getAll();
        // console.log('values', values);
        const leaflink = values.get(name);
        if (leaflink) {
            this.environment.define(name, leaflink);
        }

        return null;
    }


    /** EXPRESSIONS */
    public visitLiteralExpression(
        literalExpression: Expression.LiteralExpression,
    ) {
        return literalExpression.value;
    }

    public visitKeyExpression(
        expression: Expression.KeyExpression,
    ) {

    }

    public visitRootExpression(
        expression: Expression.RootExpression,
    ) {

    }

    public async visitMapExpression(
        expression: Expression.MapExpression,
    ) {
        const environment = await this.executeBlock(
            expression.keys,
            new Environment(this.environment),
        );
        // console.log('environment visitMapExpression', environment);

        return environment;
    }

    public async visitListExpression(
        expression: Expression.ListExpression,
    ) {
        const environment = await this.executeBlock(
            expression.items,
            new Environment(),
        );
        // console.log('visitListExpression environment', environment);

        if (environment) {
            const data: any = [];
            const values = environment.getAll();

            for (const [index, value] of values.entries()) {
                if (value instanceof Environment) {
                    const values = value.getAll();
                    const environmentValue = this.extractFromValues(values);
                    data[index] = environmentValue;
                } else {
                    data[index] = value;
                }
            }

            return data;
        }

        return;
    }

    public async visitGroupingExpression(
        groupingExpression: Expression.GroupingExpression,
    ) {
        return await this.evaluate(groupingExpression.expression);
    }

    public visitVariableExpression(
        expression: Expression.VariableExpression,
    ) {
        return this.lookUpVariable(
            expression.name,
            expression,
        );
    }

    public async visitAssignExpression(
        expression: Expression.AssignExpression,
    ) {
        const value = await this.evaluate(expression.value);

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


    public async executeBlock(
        statements: Statement.Statement[],
        environment: Environment,
        type?: string,
    ) {
        const previous = this.environment;
        let local;

        try {
            this.environment = environment;

            for (const [index, statement] of statements.entries()) {
                const value: any = await this.execute(statement);
                // console.log('DDD', value);

                if (value) {
                    this.environment.define(
                        index + '',
                        value,
                    );
                }
            }

            // console.log('this.aaaa', this.environment);

            if (type === 'root') {
                this.rootEnvironment = this.environment;
            } else {
                local = this.environment;
            }
        } catch (error) {
            this.environment = previous;
            throw error;
        } finally {
            this.environment = previous;
            return local;
        }
    }

    public async evaluate(
        expression: Expression.Expression,
    ): Promise<any> {
        return await expression.accept(this);
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

        // throw new RuntimeError(operator, 'Operand must be a number.');
    }

    public checkNumberOperands(
        operator: Token,
        left: any,
        right: any,
    ) {
        if (typeof left === 'number' && typeof right === 'number') {
            return;
        }

        // throw new RuntimeError(operator, 'Operands must be numbers.');
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

    private async resolveRoot(
        statement: Statement.RootStatement | undefined,
    ) {
        if (!statement) {
            return;
        }

        await this.execute(statement);
    }

    private async resolveLeaflinks(
        statements: Statement.Statement[],
    ) {
        let loop = 0;

        // the index 3 is computed
        // based on the maximum depth between all the leaflinks
        while (loop < 3) {
            // console.log('resolveLeaflinks loop', loop);

            for (const statement of statements) {
                // console.log('statement', statement);

                await this.execute(statement);
                this.leaflinks = this.environment;
            }

            loop += 1;
        }
    }
}
// #endregion module



// #region exports
export default Interpreter;
// #endregion exports
