// #region imports
    // #region external
    import Deon from '../Deon';
    import Token from '../Token';
    import * as Expression from '../Expression';
    import * as Statement from '../Statement';

    import {
        TokenType,
    } from '../../data/enumerations';
    // #endregion external
// #endregion imports



// #region module
class Parser {
    private tokens: Token[];
    private current = 0;
    private ParseError = class ParseError extends Error {};

    constructor(
        tokens: Token[],
    ) {
        this.tokens = tokens;
    }


    public parse() {
        const statements: any[] = [];

        while (!this.isAtEnd()) {
            statements.push(this.declaration());
        }

        return statements;
    }

    public declaration() {
        try {
            if (
                this.match(TokenType.VAR)
            ) {
                return this.variableDeclaration();
            }

            return this.statement();
        } catch (error) {
            this.synchronize();
            return null;
        }
    }

    public variableDeclaration() {
        const name = this.consume(TokenType.IDENTIFIER, 'Expect variable name.');

        let initializer = null;
        if (
            this.match(TokenType.EQUAL)
        ) {
            initializer = this.expression();
        }

        this.consume(TokenType.SEMICOLON, "Expect ';' after variable declaration.");

        return new Statement.VariableStatement(name, initializer);
    }

    public statement() {
        if (
            this.match(TokenType.LEFT_BRACE)
        ) {
            return new Statement.BlockStatement(this.block());
        }

        return this.expressionStatement();
    }

    public expressionStatement() {
        const expression = this.expression();
        this.consume(TokenType.SEMICOLON, "Expect ';' after expression.");
        return new Statement.ExpressionStatement(expression);
    }

    public expression() {
        return this.assignment();
    }


    public function(
        kind: string,
    ) {
        const name = this.consume(TokenType.IDENTIFIER, `Expect ${kind} name.`);

        this.consume(TokenType.LEFT_PAREN, `Expect '(' after ${kind} name.`);

        const parameters: Token[] = [];

        if (!this.check(TokenType.RIGHT_PAREN)) {
            do {
                if (parameters.length >= 255) {
                    this.error(this.peek(), 'Cannot have more than 255 parameters.');
                }

                parameters.push(
                    this.consume(TokenType.IDENTIFIER, 'Expect parameter name.')
                );
            } while (
                this.match(TokenType.COMMA)
            );
        }

        this.consume(TokenType.RIGHT_PAREN, `Expect ')' after parameters.`);

        this.consume(TokenType.LEFT_BRACE, `Expect '{' before ${kind} name..`);

        const body = this.block();

        return new Statement.FunctionStatement(name, parameters, body);
    }

    public block() {
        const statements: any[] = [];

        while (
            !this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()
        ) {
            statements.push(this.declaration());
        }

        this.consume(TokenType.RIGHT_BRACE, "Expect '}' after block.");

        return statements;
    }

    public assignment(): any {
        const expression = this.or();

        if (
            this.match(TokenType.EQUAL)
        ) {
            const equals = this.previous();
            const value = this.assignment();

            if (
                expression instanceof Expression.VariableExpression
            ) {
                const name = expression.name;
                return new Expression.AssignExpression(name, value);
            } else if (
                expression instanceof Expression.GetExpression
            ) {
                const get = expression;
                return new Expression.SetExpression(get.object, get.name, value);
            }

            this.error(equals, 'Invalid assignment target.');
        }

        return expression;
    }

    public primary(): Expression.Expression {
        if (
            this.match(TokenType.IDENTIFIER)
        ) {
            return new Expression.VariableExpression(this.previous());
        }

        if (
            this.match(TokenType.LEFT_PAREN)
        ) {
            const expression = this.expression();
            this.consume(TokenType.RIGHT_PAREN, "Expect ')' after expression.");
            return new Expression.GroupingExpression(expression);
        }

        throw this.error(this.peek(), "Expect expression.");
    }


    private consume(
        type: TokenType,
        message: string,
    ) {
        if (this.check(type)) {
            return this.advance();
        }

        throw this.error(this.peek(), message);
    }

    private error(
        token: Token,
        message: string,
    ) {
        Deon.error(token, message);

        return new this.ParseError();
    }

    private synchronize() {
        this.advance();

        while(
            !this.isAtEnd()
        ) {
            if (this.previous().type === TokenType.SEMICOLON) {
                return;
            }

            switch (this.peek().type) {
                case TokenType.CLASS:
                case TokenType.FUN:
                case TokenType.VAR:
                case TokenType.FOR:
                case TokenType.IF:
                case TokenType.WHILE:
                case TokenType.PRINT:
                case TokenType.RETURN:
                    return;
            }

            this.advance();
        }
    }

    private match(
        ...types: TokenType[]
    ) {
        for (const type of types) {
            if (this.check(type)) {
                this.advance();
                return true;
            }
        }

        return false;
    }

    private check(
        type: TokenType,
    ) {
        if (this.isAtEnd()) {
            return false;
        }

        return this.peek().type === type;
    }

    private advance() {
        if (!this.isAtEnd()) {
            this.current += 1;
        }

        return this.previous();
    }

    private isAtEnd() {
        return this.peek().type === TokenType.EOF;
    }

    private peek() {
        return this.tokens[this.current];
    }

    private previous() {
        return this.tokens[this.current - 1];
    }
}
// #endregion module



// #region exports
export default Parser;
// #endregion exports
