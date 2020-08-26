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
            console.log('declaration');

            if (
                this.match(TokenType.IDENTIFIER)
            ) {
                console.log('declaration variable');
                // return this.variableDeclaration();
                return this.expression();
            }

            console.log('declaration statement');
            return this.statement();
        } catch (error) {
            this.synchronize();
            return null;
        }
    }

    public variableDeclaration() {
        const name = this.consume(TokenType.SIGNIFIER, 'Expect variable name.');
        console.log('variableDeclaration', name);

        let initializer = null;
        if (
            this.match(
                TokenType.SIGNIFIER,
                TokenType.LEFT_CURLY_BRACKET,
                TokenType.LEFT_SQUARE_BRACKET,
            )
        ) {
            initializer = this.expression();
        }
        console.log('initializer', initializer);

        // this.consume(TokenType.SEMICOLON, "Expect ';' after variable declaration.");

        return new Statement.VariableStatement(name, initializer);
    }

    public statement() {
        if (
            this.match(
                TokenType.LEFT_CURLY_BRACKET,
            )
        ) {
            console.log('Statement.Map');
            // return new Statement.MapStatement(
            //     this.block(TokenType.LEFT_CURLY_BRACKET),
            // );
        }

        if (
            this.match(
                TokenType.LEFT_SQUARE_BRACKET,
            )
        ) {
            console.log('Statement.List');
            // return new Statement.ListStatement(
            //     this.block(TokenType.LEFT_SQUARE_BRACKET),
            // );
        }

        return;
        // return this.expressionStatement();
    }

    public expressionStatement() {
        const expression = this.expression();
        // this.consume(TokenType.SEMICOLON, "Expect ';' after expression.");
        return new Statement.ExpressionStatement(expression);
    }

    public expression() {
        return this.assignment();
    }


    public block(
        tokenType: TokenType,
    ) {
        switch (tokenType) {
            case TokenType.LEFT_CURLY_BRACKET: {
                const statements: any[] = [];

                while (
                    !this.check(TokenType.RIGHT_CURLY_BRACKET)
                    && !this.isAtEnd()
                ) {
                    statements.push(this.declaration());
                }

                this.consume(TokenType.RIGHT_CURLY_BRACKET, "Expect '}' after block.");

                return statements;
            }
            case TokenType.LEFT_SQUARE_BRACKET: {
                const statements: any[] = [];

                while (
                    !this.check(TokenType.RIGHT_SQUARE_BRACKET)
                    && !this.isAtEnd()
                ) {
                    statements.push(this.declaration());
                }

                this.consume(TokenType.RIGHT_SQUARE_BRACKET, "Expect ']' after block.");

                return statements;
            }
            default:
                return [];
        }
    }

    public assignment(): any {
        console.log('assignment');

        const expression = this.primary();
        console.log('expression', expression);

        if (this.match(TokenType.IDENTIFIER)) {
            const equals = this.previous();
            const value = this.assignment();
            console.log('equals', equals);
            console.log('value', value);

            if (
                expression instanceof Expression.VariableExpression
            ) {
                const name = expression.name;
                console.log('name', name);
                return new Expression.AssignExpression(name, value);
            }
        }

        if (this.match(TokenType.LEFT_CURLY_BRACKET)) {

        }

        if (this.match(TokenType.LEFT_SQUARE_BRACKET)) {

        }


        // const expression = this.or();

        // if (
        //     this.match(TokenType.EQUAL)
        // ) {
        //     const equals = this.previous();
        //     const value = this.assignment();

        //     if (
        //         expression instanceof Expression.VariableExpression
        //     ) {
        //         const name = expression.name;
        //         return new Expression.AssignExpression(name, value);
        //     } else if (
        //         expression instanceof Expression.GetExpression
        //     ) {
        //         const get = expression;
        //         return new Expression.SetExpression(get.object, get.name, value);
        //     }

        //     this.error(equals, 'Invalid assignment target.');
        // }

        return expression;
    }

    public primary(): Expression.Expression {
        if (
            this.match(TokenType.IDENTIFIER)
        ) {
            return new Expression.VariableExpression(this.previous());
        }

        if (
            this.match(TokenType.STRING)
        ) {
            return new Expression.LiteralExpression(this.previous().literal);
        }

        if (
            this.match(
                TokenType.LEFT_CURLY_BRACKET,
            )
        ) {
            const expression = this.expression();
            this.consume(TokenType.RIGHT_CURLY_BRACKET, "Expect '}' after expression.");
            return new Expression.GroupingExpression(expression);
        }

        if (
            this.match(
                TokenType.LEFT_SQUARE_BRACKET,
            )
        ) {
            const expression = this.expression();
            this.consume(TokenType.RIGHT_SQUARE_BRACKET, "Expect '}' after expression.");
            return new Expression.GroupingExpression(expression);
        }

        // if (
        //     this.match(TokenType.LEFT_PAREN)
        // ) {
        //     const expression = this.expression();
        //     this.consume(TokenType.RIGHT_PAREN, "Expect ')' after expression.");
        //     return new Expression.GroupingExpression(expression);
        // }

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
            // if (this.previous().type === TokenType.SEMICOLON) {
            //     return;
            // }

            // switch (this.peek().type) {
            //     case TokenType.CLASS:
            //     case TokenType.FUN:
            //     case TokenType.VAR:
            //     case TokenType.FOR:
            //     case TokenType.IF:
            //     case TokenType.WHILE:
            //     case TokenType.PRINT:
            //     case TokenType.RETURN:
            //         return;
            // }

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
