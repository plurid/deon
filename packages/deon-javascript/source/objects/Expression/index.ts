// #region imports
    // #region external
    import Token from '../Token';

    import {
        Statement,
    } from '../Statement';
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
    visitKeyExpression: (keyExpression: KeyExpression) => T;
    visitGroupingExpression: (groupingExpression: GroupingExpression) => T;
    visitRootExpression: (rootExpression: RootExpression) => T;
    visitMapExpression: (mapExpression: MapExpression) => T;
    visitListExpression: (listExpression: ListExpression) => T;
    visitLiteralExpression: (literalExpression: LiteralExpression) => T;
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


export class KeyExpression extends Expression {
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
        return visitor.visitKeyExpression(this);
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


export class RootExpression extends Expression {
    public expression: Expression[];

    constructor(
        expression: Expression[],
    ) {
        super();

        this.expression = expression;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitRootExpression(this);
    }
}


export class MapExpression extends Expression {
    public keys: Statement[];

    constructor(
        keys: Statement[],
    ) {
        super();

        this.keys = keys;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitMapExpression(this);
    }
}



export class ListExpression extends Expression {
    public items: Statement[];

    constructor(
        items: Statement[],
    ) {
        super();

        this.items = items;
    }

    accept<T>(
        visitor: Visitor<T>,
    ) {
        return visitor.visitListExpression(this);
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

    public visitKeyExpression(
        keyExpression: KeyExpression,
    ) {
        return keyExpression.name.toString();
    }

    public visitGroupingExpression(
        groupingExpression: GroupingExpression,
    ) {
        return this.parenthesize(
            'group',
            groupingExpression.expression,
        );
    }

    public visitRootExpression(
        rootExpression: RootExpression,
    ) {
        return '';
    }

    public visitMapExpression(
        mapExpression: MapExpression,
    ) {
        return '';
        // return this.parenthesize(
        //     'group',
        //     mapExpression.expression,
        // );
    }

    public visitListExpression(
        groupingExpression: ListExpression,
    ) {
        return '';
        // return this.parenthesize(
        //     'group',
        //     groupingExpression.expression,
        // );
    }

    public visitLiteralExpression(
        literalExpression: LiteralExpression,
    ) {
        if (literalExpression.value == null) {
            return 'nil';
        }

        return literalExpression.value.toString();
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
