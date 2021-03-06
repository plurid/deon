// #region imports
    // #region external
    import * as Expression from '../Expression';
    import * as Statement from '../Statement';
    import Interpreter from '../Interpreter';
    import Token from '../Token';
    // #endregion external
// #endregion imports



// #region module
class Resolver implements Expression.Visitor<any>, Statement.Visitor<any> {
    private interpreter: Interpreter;
    private scopes: Map<string, boolean>[] = [];
    private deonError: any;

    constructor(
        interpeter: Interpreter,
        error: any,
    ) {
        this.deonError = error;
        this.interpreter = interpeter;
    }


    public async visitImportStatement(
        statement: Statement.ImportStatement,
    ) {
        // console.log('statement', statement);

        return null;
    }

    public async visitInjectStatement(
        statement: Statement.InjectStatement,
    ) {
        // console.log('statement', statement);

        return null;
    }

    // public visitBlockStatement(
    //     statement: Statement.BlockStatement,
    // ) {
    //     this.beginScope();

    //     this.resolve(
    //         statement.statements,
    //     );

    //     this.endScope();

    //     return null;
    // }

    public visitRootStatement(
        statement: Statement.RootStatement,
    ) {
        this.beginScope();

        // this.resolve(
        //     statement.statements,
        // );

        this.endScope();

        return null;
    }

    // public visitMapStatement(
    //     statement: Statement.MapStatement,
    // ) {
    //     this.beginScope();

    //     // this.resolve(
    //     //     statement.statements,
    //     // );

    //     this.endScope();

    //     return null;
    // }

    // public visitListStatement(
    //     statement: Statement.ListStatement,
    // ) {
    //     this.beginScope();

    //     // this.resolve(
    //     //     statement.statements,
    //     // );

    //     this.endScope();

    //     return null;
    // }

    public visitKeyStatement(
        statement: Statement.KeyStatement,
    ) {
        this.declare(statement.name);

        if (statement.initializer !== null) {
            this.resolveExpression(statement.initializer);
        }

        this.define(statement.name);

        return null;
    }

    public visitItemStatement(
        statement: Statement.ItemStatement,
    ) {
        return null;
    }

    public visitLeaflinkStatement(
        statement: Statement.LeaflinkStatement,
    ) {
        return null;
    }

    public visitLinkStatement(
        statement: Statement.LinkStatement,
    ) {
        return null;
    }

    public visitInterpolateStatement(
        statement: Statement.InterpolateStatement,
    ) {
        return null;
    }

    public visitSpreadStatement(
        statement: Statement.SpreadStatement,
    ) {
        return null;
    }


    public visitVariableExpression(
        expression: Expression.VariableExpression,
    ) {
        const lastScopeIndex = this.scopes.length - 1;
        const scope = this.scopes[lastScopeIndex];

        if (
            this.scopes.length !== 0
            && scope.get(expression.name.lexeme) === false
        ) {
            this.deonError(
                expression.name,
                'Cannot read local variable in its own initializer.',
            );
        }

        this.resolveLocal(
            expression,
            expression.name,
        );

        return null;
    }

    public visitMapExpression(
        expression: Expression.MapExpression,
    ) {

    }

    public visitListExpression(
        expression: Expression.ListExpression,
    ) {

    }

    public visitLinkExpression(
        expression: Expression.LinkExpression,
    ) {
    }

    public visitAssignExpression(
        expression: Expression.AssignExpression,
    ) {
        this.resolveExpression(expression.value);
        this.resolveLocal(
            expression,
            expression.name,
        );
        return null;
    }

    public visitExpressionStatement(
        statement: Statement.ExpressionStatement,
    ) {
        this.resolveExpression(statement.expression);
        return null;
    }

    public visitGroupingExpression(
        expression: Expression.GroupingExpression,
    ) {
        this.resolveExpression(expression.expression);
        return null;
    }

    public visitLiteralExpression(
        expression: Expression.LiteralExpression,
    ) {
        return null;
    }



    public async resolve(
        statements: Statement.Statement[],
    ) {
        const orderedStatements = this.orderStatements(statements);
        console.log('orderedStatements', orderedStatements);

        for (const statement of orderedStatements) {
            this.resolveStatement(statement);
        }
    }

    public resolveStatement(
        statement: Statement.Statement,
    ) {
        statement.accept(this);
    }

    public resolveExpression(
        expression: Expression.Expression,
    ) {
        expression.accept(this);
    }



    private beginScope() {
        this.scopes.push(
            new Map(),
        );
    }

    private endScope() {
        this.scopes.pop();
    }

    private declare(
        name: Token,
    ) {
        if (
            this.scopes.length === 0
        ) {
            return;
        }

        const lastScopeIndex = this.scopes.length - 1;

        const scope = this.scopes[lastScopeIndex];

        if (scope.has(name.lexeme)) {
            this.deonError(
                name,
                'Variable with this name already declared in this scope.',
            );
        }

        scope.set(
            name.lexeme,
            false,
        );
        this.scopes[lastScopeIndex] = new Map(scope);
    }

    private define(
        name: Token,
    ) {
        if (
            this.scopes.length === 0
        ) {
            return;
        }

        const lastScopeIndex = this.scopes.length - 1;

        const scope = this.scopes[lastScopeIndex];
        scope.set(
            name.lexeme,
            true,
        );
        this.scopes[lastScopeIndex] = new Map(scope);
    }

    private resolveLocal(
        expression: Expression.Expression,
        name: Token,
    ) {
        for (const [key, scope] of this.scopes.entries()) {
            if (scope.has(name.lexeme)) {
                this.interpreter.resolve(
                    expression,
                    this.scopes.length - 1 - key,
                );
            }
        }

        // Not found. Assume it is global.
    }

    private orderStatements(
        statements: Statement.Statement[],
    ) {
        const importStatements: Statement.Statement[] = [];
        const leaflinkStatements: Statement.Statement[] = [];
        const rootStatement: Statement.Statement[] = [];

        for (const statement of statements) {
            if (statement instanceof Statement.LeaflinkStatement) {
                leaflinkStatements.push(statement);
                continue;
            }

            if (statement instanceof Statement.RootStatement) {
                rootStatement.push(statement);
            }

            if (statement instanceof Statement.ImportStatement) {
                importStatements.push(statement);
                continue;
            }
        }

        const orderedStatements = [
            ...importStatements,
            ...leaflinkStatements,
            ...rootStatement,
        ];

        return orderedStatements;
    }
}
// #endregion module



// #region exports
export default Resolver;
// #endregion exports
