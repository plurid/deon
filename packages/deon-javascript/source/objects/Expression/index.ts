// #region imports
    // #region external
    import Token from '../Token';
    // #endregion external
// #endregion imports



// #region module
export abstract class Expression {
    abstract accept<T>(
        visitor: Visitor<T>,
    ): T;
}


export interface Visitor<T> {
    visitAssignExpression: (assignExpression: AssignExpression) => T;
    visitBinaryExpression: (binaryExpression: BinaryExpression) => T;
    visitCallExpression: (callExpression: CallExpression) => T;
    visitGetExpression: (getExpression: GetExpression) => T;
    visitGroupingExpression: (groupingExpression: GroupingExpression) => T;
    visitLiteralExpression: (literalExpression: LiteralExpression) => T;
    visitLogicalExpression: (logicalExpression: LogicalExpression) => T;
    visitSetExpression: (setExpression: SetExpression) => T;
    visitSuperExpression: (superExpression: SuperExpression) => T;
    visitThisExpression: (thisExpression: ThisExpression) => T;
    visitUnaryExpression: (unaryExpression: UnaryExpression) => T;
    visitVariableExpression: (variableExpression: VariableExpression) => T;
}


export class AssignExpression extends Expression {
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
        return visitor.visitAssignExpression(this);
    }
}


export class BinaryExpression extends Expression {
    public left: Expression;
    public operator: Token;
    public right: Expression;

    constructor(
        left: Expression,
        operator: Token,
        right: Expression,
    ) {
        super();

        this.left = left;
        this.operator = operator;
        this.right = right;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitBinaryExpression(this);
    }
}


export class CallExpression extends Expression {
    public callee: Expression;
    public paren: Token;
    public args: Expression[];

    constructor(
        callee: Expression,
        paren: Token,
        args: Expression[],
    ) {
        super();

        this.callee = callee;
        this.paren = paren;
        this.args = args;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitCallExpression(this);
    }
}


export class GetExpression extends Expression {
    public object: Expression;
    public name: Token;

    constructor(
        object: Expression,
        name: Token,
    ) {
        super();

        this.object = object;
        this.name = name;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitGetExpression(this);
    }
}


export class GroupingExpression extends Expression {
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
        return visitor.visitGroupingExpression(this);
    }
}


export class LiteralExpression extends Expression {
    public value: any;

    constructor(
        value: any,
    ) {
        super();

        this.value = value;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitLiteralExpression(this);
    }
}


export class LogicalExpression extends Expression {
    public left: Expression;
    public operator: Token;
    public right: Expression;

    constructor(
        left: Expression,
        operator: Token,
        right: Expression,
    ) {
        super();

        this.left = left;
        this.operator = operator;
        this.right = right;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitLogicalExpression(this);
    }
}


export class SetExpression extends Expression {
    public object: Expression;
    public name: Token;
    public value: Expression;

    constructor(
        object: Expression,
        name: Token,
        value: Expression,
    ) {
        super();

        this.object = object;
        this.name = name;
        this.value = value;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitSetExpression(this);
    }
}


export class SuperExpression extends Expression {
    public keyword: Token;
    public method: Token;

    constructor(
        keyword: Token,
        method: Token,
    ) {
        super();

        this.keyword = keyword;
        this.method = method;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitSuperExpression(this);
    }
}


export class ThisExpression extends Expression {
    public keyword: Token;

    constructor(
        keyword: Token,
    ) {
        super();

        this.keyword = keyword;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitThisExpression(this);
    }
}


export class UnaryExpression extends Expression {
    public operator: Token;
    public right: Expression;

    constructor(
        operator: Token,
        right: Expression,
    ) {
        super();

        this.operator = operator;
        this.right = right;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitUnaryExpression(this);
    }
}


export class VariableExpression extends Expression {
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
        return visitor.visitVariableExpression(this);
    }
}


export class ASTPrinter implements Visitor<string> {
    public print(
        expresssion: Expression,
    ) {
        return expresssion.accept(this);
    }

    public visitAssignExpression(
        assignExpression: AssignExpression,
    ) {
        return assignExpression.name.toString();
    }

    public visitBinaryExpression(
        binaryExpression: BinaryExpression,
    ) {
        return this.parenthesize(
            binaryExpression.operator.lexeme,
            binaryExpression.left,
            binaryExpression.right,
        );
    }

    public visitCallExpression(
        callExpression: CallExpression,
    ) {
        return '';
    }

    public visitGetExpression(
        getExpression: GetExpression,
    ) {
        return getExpression.name.lexeme;
    }

    public visitGroupingExpression(
        groupingExpression: GroupingExpression,
    ) {
        return this.parenthesize(
            'group',
            groupingExpression.expression,
        );
    }

    public visitLiteralExpression(
        literalExpression: LiteralExpression,
    ) {
        if (literalExpression.value == null) {
            return 'nil';
        }

        return literalExpression.value.toString();
    }

    public visitLogicalExpression(
        logicalExpression: LogicalExpression,
    ) {
        return this.parenthesize(
            logicalExpression.operator.lexeme,
            logicalExpression.left,
            logicalExpression.right,
        );
    }

    public visitSetExpression(
        setExpression: SetExpression,
    ) {
        return setExpression.name.lexeme;
    }

    public visitSuperExpression(
        superExpression: SuperExpression,
    ) {
        return superExpression.keyword.lexeme;
    }

    public visitThisExpression(
        thisExpression: ThisExpression,
    ) {
        return thisExpression.keyword.lexeme;
    }

    public visitUnaryExpression(
        unaryExpression: UnaryExpression,
    ) {
        return this.parenthesize(
            unaryExpression.operator.lexeme,
            unaryExpression.right,
        );
    }

    public visitVariableExpression(
        variableExpression: VariableExpression,
    ) {
        return variableExpression.name.toString();
    }


    private parenthesize(
        name: string,
        ...expressions: Expression[]
    ) {
        const builder: string[] = [];

        builder.push('(');
        builder.push(name);

        for (const expression of expressions) {
            builder.push(' ');
            builder.push(expression.accept(this));
        }

        builder.push(')');

        return builder.join('');
    }
}
// #endregion module
