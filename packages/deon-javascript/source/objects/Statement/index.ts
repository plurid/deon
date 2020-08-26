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
    visitBlockStatement: (blockStatement: BlockStatement) => T;
    // visitMapStatement: (blockStatement: MapStatement) => T;
    // visitListStatement: (blockStatement: ListStatement) => T;
    visitExpressionStatement: (expressionStatement: ExpressionStatement) => T;
    visitVariableStatement: (variableStatement: VariableStatement) => T;
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


// export class MapStatement extends Statement {
//     public statements: Statement[];

//     constructor(
//         statements: Statement[],
//     ) {
//         super();

//         this.statements = statements;
//     }

//     accept<T>(
//         visitor: Visitor<T>,
//     ) {
//         return visitor.visitMapStatement(this);
//     }
// }


// export class ListStatement extends Statement {
//     public statements: Statement[];

//     constructor(
//         statements: Statement[],
//     ) {
//         super();

//         this.statements = statements;
//     }

//     accept<T>(
//         visitor: Visitor<T>,
//     ) {
//         return visitor.visitListStatement(this);
//     }
// }


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
