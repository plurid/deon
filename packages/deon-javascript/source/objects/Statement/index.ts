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
    visitClassStatement: (classStatement: ClassStatement) => T;
    visitExpressionStatement: (expressionStatement: ExpressionStatement) => T;
    visitFunctionStatement: (functionStatement: FunctionStatement) => T;
    visitIfStatement: (ifStatement: IfStatement) => T;
    visitPrintStatement: (printStatement: PrintStatement) => T;
    visitReturnStatement: (returnStatement: ReturnStatement) => T;
    visitVariableStatement: (variableStatement: VariableStatement) => T;
    visitWhileStatement: (whileStatement: WhileStatement) => T;
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


export class ClassStatement extends Statement {
    public name: Token;
    public superclass: VariableExpression | null;
    public methods: FunctionStatement[];

    constructor(
        name: Token,
        superclass: VariableExpression | null,
        methods: FunctionStatement[],
    ) {
        super();

        this.name = name;
        this.superclass = superclass;
        this.methods = methods;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitClassStatement(this);
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


export class FunctionStatement extends Statement {
    public name: Token;
    public params: Token[];
    public body: Statement[];

    constructor(
        name: Token,
        params: Token[],
        body: Statement[],
    ) {
        super();

        this.name = name;
        this.params = params;
        this.body = body;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitFunctionStatement(this);
    }
}


export class IfStatement extends Statement {
    public condition: Expression;
    public thenBranch: Statement;
    public elseBranch: Statement | null;

    constructor(
        condition: Expression,
        thenBranch: Statement,
        elseBranch: Statement | null,
    ) {
        super();

        this.condition = condition;
        this.thenBranch = thenBranch;
        this.elseBranch = elseBranch;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitIfStatement(this);
    }
}


export class PrintStatement extends Statement {
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
        return visitor.visitPrintStatement(this);
    }
}


export class ReturnStatement extends Statement {
    public keyword: Token;
    public value: Expression;

    constructor(
        keyword: Token,
        value: Expression,
    ) {
        super();

        this.keyword = keyword;
        this.value = value;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitReturnStatement(this);
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


export class WhileStatement extends Statement {
    public condition: Expression;
    public body: Statement;

    constructor(
        condition: Expression,
        body: Statement,
    ) {
        super();

        this.condition = condition;
        this.body = body;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitWhileStatement(this);
    }
}
// #endregion module
