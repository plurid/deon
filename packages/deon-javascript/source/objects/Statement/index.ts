// #region imports
    // #region external
    import {
        RootKind,
    } from '../../data/interfaces';

    import Token from '../Token';

    import {
        Expression,
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
    visitLinkStatement: (linkStatement: LinkStatement) => T;
    visitSpreadStatement: (spreadStatement: SpreadStatement) => T;
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
    public kind: RootKind;
    public statements: Statement[];

    constructor(
        kind: RootKind,
        statements: Statement[],
    ) {
        super();

        this.kind = kind;
        this.statements = statements;
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


export class LinkStatement extends Statement {
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
        return visitor.visitLinkStatement(this);
    }
}


export class SpreadStatement extends Statement {
    public name: Token;

    constructor(
        name: Token,
    ) {
        super();

        this.name = name;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitSpreadStatement(this);
    }
}
// #endregion module
