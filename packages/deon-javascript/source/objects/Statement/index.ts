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
    visitRootStatement: (rootStatement: RootStatement) => T;
    visitExpressionStatement: (expressionStatement: ExpressionStatement) => T;
    visitKeyStatement: (keyStatement: KeyStatement) => T;
    visitItemStatement: (itemStatement: ItemStatement) => T;
    visitLeaflinkStatement: (leaflinkStatement: LeaflinkStatement) => T;
    visitLinkStatement: (linkStatement: LinkStatement) => T;
    visitSpreadStatement: (spreadStatement: SpreadStatement) => T;
}



export class ImportStatement extends Statement {
    public name: Token;
    public path: Token;
    public authenticator: Token | undefined;

    constructor(
        name: Token,
        path: Token,
        authenticator: Token | undefined,
    ) {
        super();

        this.name = name;
        this.path = path;
        this.authenticator = authenticator;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitImportStatement(this);
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


export class KeyStatement extends Statement {
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
        return visitor.visitKeyStatement(this);
    }
}


export class ItemStatement extends Statement {
    public index: string;
    public initializer: Expression | null;

    constructor(
        index: string,
        initializer: Expression | null,
    ) {
        super();

        this.index = index;
        this.initializer = initializer;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitItemStatement(this);
    }
}


export class LeaflinkStatement extends Statement {
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
        return visitor.visitLeaflinkStatement(this);
    }
}


export class LinkStatement extends Statement {
    public name: Token;
    public initializer: Expression | null;
    public kind: RootKind;

    constructor(
        name: Token,
        initializer: Expression | null,
        kind: RootKind,
    ) {
        super();

        this.name = name;
        this.initializer = initializer;
        this.kind = kind;
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
