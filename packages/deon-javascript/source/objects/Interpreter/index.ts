// #region imports
    // #region external
    import {
        TokenType,
    } from '../../data/enumerations';

    import Deon from '../Deon';
    import * as Expression from '../Expression';
    import * as Statement from '../Statement';
    import Token from '../Token';
    import {
        RuntimeError,
    } from '../Errors';
    // #endregion external
// #endregion imports



// #region module
class Interpreter implements Expression.Visitor<any>, Statement.Visitor<any> {
    public locals: Map<Expression.Expression, number> = new Map();

    public interpret(
        statements: Statement.Statement[],
    ) {
        try {
            for (const statement of statements) {
                this.execute(statement);
            }
        } catch (error) {
            Deon.runtimeError(error);
        }
    }

    public execute(
        statement: Statement.Statement,
    ) {
        statement.accept(this);
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



    /** STATEMENTS */
    public visitBlockStatement(
        statement: Statement.BlockStatement,
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

    public visitUnaryExpression(
        unaryExpression: Expression.UnaryExpression,
    ) {
        const right = this.evaluate(unaryExpression.right);

        switch (unaryExpression.operator.type) {
            case TokenType.BANG:
                return !this.isTruthy(right);
            case TokenType.MINUS:
                this.checkNumberOperand(unaryExpression.operator, right);
                return -right;
        }

        // Unreachable.
        return null;
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
