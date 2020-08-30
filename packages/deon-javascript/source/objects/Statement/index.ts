// #region imports
    // #region external
    import Token from '../Token';

    import {
        Expression,
        VariableExpression,
    } from '../Expression';
    // #endregion external
// #endregion imports



// #region module
export abstract class Statement {
    abstract accept<T>(
        visitor: Visitor<T>,
    ): T;
}


export interface Visitor<T> {
    visitImportStatement: (importStatement: ImportStatement) => T;
    visitBlockStatement: (blockStatement: BlockStatement) => T;
    visitRootStatement: (rootStatement: RootStatement) => T;
    visitMapStatement: (mapStatement: MapStatement) => T;
    visitListStatement: (listStatement: ListStatement) => T;
    visitExpressionStatement: (expressionStatement: ExpressionStatement) => T;
    visitVariableStatement: (variableStatement: VariableStatement) => T;
}



export class ImportStatement extends Statement {
    public name: Token;
    public path: Token;

    constructor(
        name: Token,
        path: Token,
    ) {
        super();

        this.name = name;
        this.path = path;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitImportStatement(this);
    }
}


export class BlockStatement extends Statement {
    public statements: Statement[];

    constructor(
        statements: Statement[],
    ) {
        super();

        this.statements = statements;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitBlockStatement(this);
    }
}


export class RootStatement extends Statement {
    /**
     * The `statement` is either a `MapStatement` or a `ListStatement`.
     */
    public statement: Statement;

    constructor(
        statement: Statement,
    ) {
        super();

        this.statement = statement;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitRootStatement(this);
    }
}


export class MapStatement extends Statement {
    public name: Token;
    public value: Expression;

    constructor(
        name: Token,
        value: Expression,
    ) {
        super();

        this.name = name;
        this.value = value;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitMapStatement(this);
    }
}


export class ListStatement extends Statement {
    public name: Token;
    public value: Expression;

    constructor(
        name: Token,
        value: Expression,
    ) {
        super();

        this.name = name;
        this.value = value;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitListStatement(this);
    }
}


export class ExpressionStatement extends Statement {
    public expression: Expression;

    constructor(
        expression: Expression,
    ) {
        super();

        this.expression = expression;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitExpressionStatement(this);
    }
}


export class VariableStatement extends Statement {
    public name: Token;
    public initializer: Expression | null;

    constructor(
        name: Token,
        initializer: Expression | null,
    ) {
        super();

        this.name = name;
        this.initializer = initializer;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitVariableStatement(this);
    }
}
// #endregion module
