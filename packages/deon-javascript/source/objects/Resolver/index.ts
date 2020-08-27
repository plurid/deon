// #region imports
    // #region external
    import * as Expression from '../Expression';
    import * as Statement from '../Statement';
    import Interpreter from '../Interpreter';
    import Token from '../Token';
    import Deon from '../Deon';
    // #endregion external
// #endregion imports



// #region module
class Resolver implements Expression.Visitor<any>, Statement.Visitor<any> {
    private interpreter: Interpreter;
    private scopes: Map<string, boolean>[] = [];

    constructor(
        interpeter: Interpreter,
    ) {
        this.interpreter = interpeter;
    }


    public visitImportStatement(
        statement: Statement.ImportStatement,
    ) {
        console.log('import statement', statement);

        return null;
    }

    public visitBlockStatement(
        statement: Statement.BlockStatement,
    ) {
        this.beginScope();

        this.resolve(
            statement.statements,
        );

        this.endScope();

        return null;
    }

    public visitRootStatement(
        statement: Statement.RootStatement,
    ) {
        this.beginScope();

        this.resolve(
            statement.statements,
        );

        this.endScope();

        return null;
    }

    public visitMapStatement(
        statement: Statement.MapStatement,
    ) {
        this.beginScope();

        this.resolve(
            statement.statements,
        );

        this.endScope();

        return null;
    }

    public visitListStatement(
        statement: Statement.ListStatement,
    ) {
        this.beginScope();

        this.resolve(
            statement.statements,
        );

        this.endScope();

        return null;
    }

    public visitVariableStatement(
        statement: Statement.VariableStatement,
    ) {
        this.declare(statement.name);

        if (statement.initializer !== null) {
            this.resolveExpression(statement.initializer);
        }

        this.define(statement.name);

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
            Deon.error(
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



    public resolve(
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
            Deon.error(
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
            if (statement instanceof Statement.ImportStatement) {
                importStatements.push(statement);
                continue;
            }

            if (statement instanceof Statement.VariableStatement) {
                leaflinkStatements.push(statement);
                continue;
            }

            if (statement instanceof Statement.RootStatement) {
                rootStatement.push(statement);
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
