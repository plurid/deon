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
                this.match(TokenType.IDENTIFIER)
                ) {
                return this.leaflinkDeclaration();
            }

            return this.statement();
        } catch (error) {
            this.synchronize();
            return null;
        }
    }

    public leaflinkDeclaration() {
        const name = this.previous();

        let initializer = null;
        if (
            this.match(
                TokenType.STRING,
                TokenType.LEFT_CURLY_BRACKET,
                TokenType.LEFT_SQUARE_BRACKET,
            )
        ) {
            initializer = this.expression();
        }

        return new Statement.VariableStatement(name, initializer);
    }

    public statement() {
        if (
            this.match(
                TokenType.LEFT_CURLY_BRACKET,
            )
        ) {
            return new Statement.RootStatement(
                this.block(TokenType.LEFT_CURLY_BRACKET),
            );
        }

        if (
            this.match(
                TokenType.LEFT_SQUARE_BRACKET,
            )
        ) {
            return new Statement.RootStatement(
                this.block(TokenType.LEFT_SQUARE_BRACKET),
            );
        }

        if (
            this.match(
                TokenType.IMPORT,
            )
        ) {
            return this.importStatement();
        }

        return this.expressionStatement();
    }

    public importStatement() {
        const importName = this.consume(TokenType.IDENTIFIER, "Expect name for import.");
        this.consume(TokenType.FROM, "Expect 'from' for import.");
        const importPath = this.consume(TokenType.IDENTIFIER, "Expect path for import.");

        return new Statement.ImportStatement(
            importName,
            importPath,
        );
    }

    public expressionStatement() {
        const expression = this.expression();

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
        const expression = this.primary();

        // if (this.match(TokenType.STRING)) {
        //     const equals = this.previous();
        //     const value = this.assignment();
        //     console.log('equals', equals);
        //     console.log('value', value);

        //     if (
        //         expression instanceof Expression.VariableExpression
        //     ) {
        //         const name = expression.name;
        //         console.log('name', name);
        //         return new Expression.AssignExpression(name, value);
        //     }
        // }

        // if (this.match(TokenType.LEFT_CURLY_BRACKET)) {

        // }

        // if (this.match(TokenType.LEFT_SQUARE_BRACKET)) {

        // }

        return expression;
    }

    public primary(): Expression.Expression {
        const previous = this.previous();

        if (
            previous.type === TokenType.STRING
        ) {
            return new Expression.LiteralExpression(previous.literal);
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
            this.consume(TokenType.RIGHT_SQUARE_BRACKET, "Expect ']' after expression.");
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
