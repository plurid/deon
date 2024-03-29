// #region imports
    // #region external
    import {
        DeonInterpreterOptions,
    } from '../../data/interfaces';

    import {
        deonParseOptions,
        INTERNAL_INTERPOLATOR_SIGN,
    } from '../../data/constants';

    import * as Expression from '../Expression';
    // import type Deon from '../Deon';
    // import type DeonPure from '../DeonPure';
    import * as Statement from '../Statement';
    import Environment from '../Environment';
    import Token from '../Token';

    import {
        isURL,
    } from '../../utilities/general';
    // #endregion external
// #endregion imports



// #region module
class Interpreter implements Expression.Visitor<any>, Statement.Visitor<any> {
    public globals: Environment = new Environment();
    public locals: Map<Expression.Expression, number> = new Map();

    private Deon: any;
    private fetcher: any;
    private environment: Environment = this.globals;
    private leaflinks: Environment = new Environment();
    private rootEnvironment: Environment = new Environment();
    private rootKind = 'map';
    private options: DeonInterpreterOptions = {
        file: undefined,
        parseOptions: {
            ...deonParseOptions,
        },
    };
    private interpretation: 'synchronous' | 'asynchronous' | '' = '';
    private pure: boolean;
    private interpolatorKeys: string[] = [];
    private interpolatorRecords: Record<string, string> = {};


    constructor(
        Deon: any,
        fetcher: any,
        options?: {
            pure?: boolean,
        },
    ) {
        this.Deon = Deon;
        this.fetcher = fetcher;
        this.pure = options?.pure || false;
    }


    public async interpret(
        statements: (Statement.Statement | Expression.Expression)[],
        options: DeonInterpreterOptions,
    ) {
        try {
            this.interpretation = 'asynchronous';

            this.options = {
                file: options.file,
                parseOptions: {
                    ...deonParseOptions,
                    ...options.parseOptions,
                },
            };

            const injectStatements: Statement.Statement[] = [];
            const importStatements: Statement.Statement[] = [];
            const leaflinkStatements: Statement.Statement[] = [];
            let rootStatement;

            for (const statement of statements) {
                if (
                    statement instanceof Statement.InterpolateStatement
                ) {
                    this.visitInterpolateStatement(statement);
                    continue;
                }

                if (
                    statement instanceof Statement.LeaflinkStatement
                ) {
                    leaflinkStatements.push(statement);
                }

                if (statement instanceof Statement.RootStatement) {
                    rootStatement = statement;
                }

                if (statement instanceof Statement.ImportStatement) {
                    importStatements.push(statement);
                }

                if (statement instanceof Statement.InjectStatement) {
                    injectStatements.push(statement);
                }
            }

            await this.resolveLeaflinks([
                ...injectStatements,
                ...importStatements,
                ...leaflinkStatements,
            ]);
            this.resolveRoot(rootStatement);

            this.resolveInterpolatorRecords();

            return this.extract();
        } catch (error) {
            return;
        }
    }

    public interpretSynchronous(
        statements: (Statement.Statement | Expression.Expression)[],
        options: DeonInterpreterOptions,
    ) {
        try {
            this.interpretation = 'synchronous';

            this.options = {
                file: options.file,
                parseOptions: {
                    ...deonParseOptions,
                    ...options.parseOptions,
                },
            };

            const injectStatements: Statement.Statement[] = [];
            const importStatements: Statement.Statement[] = [];
            const leaflinkStatements: Statement.Statement[] = [];
            let rootStatement;

            for (const statement of statements) {
                if (
                    statement instanceof Statement.InterpolateStatement
                ) {
                    this.visitInterpolateStatement(statement);
                    continue;
                }

                if (
                    statement instanceof Statement.LeaflinkStatement
                ) {
                    leaflinkStatements.push(statement);
                }

                if (statement instanceof Statement.RootStatement) {
                    rootStatement = statement;
                }

                if (statement instanceof Statement.ImportStatement) {
                    importStatements.push(statement);
                }

                if (statement instanceof Statement.InjectStatement) {
                    injectStatements.push(statement);
                }
            }

            this.resolveLeaflinksSynchronous([
                ...injectStatements,
                ...importStatements,
                ...leaflinkStatements,
            ]);
            this.resolveRoot(rootStatement);

            return this.extract();
        } catch (error) {
            return;
        }
    }

    public async execute(
        statement: Statement.Statement,
    ) {
        if (statement instanceof Statement.ImportStatement) {
            await this.visitImportStatementAsynchronous(statement);
            return;
        }

        if (statement instanceof Statement.InjectStatement) {
            await this.visitInjectStatementAsynchronous(statement);
            return;
        }

        const value: any = await statement.accept(this);
        return value;
    }

    public executeSynchronous(
        statement: Statement.Statement,
    ) {
        if (statement instanceof Statement.ImportStatement) {
            this.visitImportStatementSynchronous(statement);
            return;
        }

        if (statement instanceof Statement.InjectStatement) {
            this.visitInjectStatementSynchronous(statement);
            return;
        }

        const value: any = statement.accept(this);
        return value;
    }

    public resolve(
        expression: Expression.Expression,
        depth: number,
    ) {
        this.locals.set(
            expression,
            depth,
        );
    }

    private extractFromValues(
        values: any,
    ) {
        let obj: any = {}

        for (const [key, value] of values) {
            if (value instanceof Environment) {
                const envValues = value.getAll();
                const keyValue = this.extractFromValues(envValues);
                obj[key] = this.solveInterpolations(keyValue);
            } else {
                obj[key] = this.solveInterpolations(value);
            }
        }

        return obj;
    }

    private solveInterpolations(
        value: any,
    ) {
        let data = value;

        for (const [key, record] of Object.entries(this.interpolatorRecords)) {
            data = data.replace(
                INTERNAL_INTERPOLATOR_SIGN + key,
                record,
            );
        }

        return data;
    }

    private resolveInterpolatorRecords() {
        for (const interpolatorKey of this.interpolatorKeys) {
            const accessNames = this.resolveDeepAccess(interpolatorKey);

            const value: any = accessNames.reduce((previous, current) => {
                if (previous instanceof Environment) {
                    const value = previous.getValue(current);

                    return value;
                }

                if (Array.isArray(previous)) {
                    return previous[current];
                }

                if (typeof previous === 'object') {
                    return previous[current];
                }

                if (typeof previous === 'string') {
                    return previous;
                }

                return null;
            }, this.leaflinks);

            if (typeof value === 'string') {
                this.interpolatorRecords[interpolatorKey] = value;
            }
        }
    }

    public extract() {
        const obj: any = this.rootKind === 'map' ? {} : [];

        const values = this.rootEnvironment.getAll();

        for (const [key, value] of values) {
            if (value instanceof Environment) {
                const envValues = value.getAll();
                obj[key] = this.extractFromValues(envValues);
            } else {
                obj[key] = this.solveInterpolations(value);
            }
        }

        return obj;
    }



    /** STATEMENTS */
    public visitImportStatement(
        statement: Statement.ImportStatement,
    ) {
        if (this.interpretation === 'asynchronous') {
            this.visitImportStatementAsynchronous(statement);
        } else {
            this.visitImportStatementSynchronous(statement);
        }
    }

    private async visitImportStatementAsynchronous(
        statement: Statement.ImportStatement,
    ) {
        try {
            const valid = this.checkImportFunctionality(statement);
            if (!valid) {
                return;
            }

            const authenticator = statement.authenticator?.lexeme;

            const result = await this.fetcher.asynchronous(
                statement.path.lexeme,
                this.options,
                authenticator,
            );

            if (!result) {
                return;
            }

            const {
                data,
                filetype,
                filebase,
            } = result;

            let parsedData;
            const deon = new this.Deon();

            switch (filetype) {
                case '.deon':
                    parsedData = await deon.parse(
                        data,
                        {
                            filebase,
                        },
                    );
                    break;
                case '.json':
                    parsedData = JSON.parse(data);
                    break;
            }

            this.environment.define(
                statement.name.lexeme,
                parsedData,
            );

            return null;
        } catch (error) {
            return null;
        }
    }

    private visitImportStatementSynchronous(
        statement: Statement.ImportStatement,
    ) {
        try {
            const valid = this.checkImportFunctionality(statement);
            if (!valid) {
                return;
            }

            const authenticator = statement.authenticator?.lexeme;

            const result = this.fetcher.synchronous(
                statement.path.lexeme,
                this.options,
                authenticator,
            );

            if (!result) {
                return;
            }

            const {
                data,
                filetype,
                filebase,
            } = result;

            let parsedData;
            const deon = new this.Deon();

            switch (filetype) {
                case '.deon':
                    parsedData = deon.parseSynchronous(
                        data,
                        {
                            filebase,
                        },
                    );
                    break;
                case '.json':
                    parsedData = JSON.parse(data);
                    break;
            }

            this.environment.define(
                statement.name.lexeme,
                parsedData,
            );

            return null;
        } catch (error) {
            return null;
        }
    }

    public visitInjectStatement(
        statement: Statement.InjectStatement,
    ) {
        if (this.interpretation === 'asynchronous') {
            this.visitInjectStatementAsynchronous(statement);
        } else {
            this.visitInjectStatementSynchronous(statement);
        }
    }

    private async visitInjectStatementAsynchronous(
        statement: Statement.InjectStatement,
    ) {
        try {
            const valid = this.checkImportFunctionality(statement);
            if (!valid) {
                return;
            }

            const authenticator = statement.authenticator?.lexeme;

            const result = await this.fetcher.asynchronous(
                statement.path.lexeme,
                this.options,
                authenticator,
                'inject',
            );

            if (!result) {
                return;
            }

            const {
                data,
            } = result;

            this.environment.define(
                statement.name.lexeme,
                data,
            );

            return null;
        } catch (error) {
            return null;
        }
    }

    private visitInjectStatementSynchronous(
        statement: Statement.InjectStatement,
    ) {
        try {
            const valid = this.checkImportFunctionality(statement);
            if (!valid) {
                return;
            }

            const authenticator = statement.authenticator?.lexeme;

            const result = this.fetcher.synchronous(
                statement.path.lexeme,
                this.options,
                authenticator,
                'inject',
            );

            if (!result) {
                return;
            }

            const {
                data,
            } = result;

            this.environment.define(
                statement.name.lexeme,
                data,
            );

            return null;
        } catch (error) {
            return null;
        }
    }

    public visitRootStatement(
        statement: Statement.RootStatement,
    ) {
        this.rootKind = statement.kind;

        this.executeBlock(
            statement.statements,
            new Environment(),
            'root',
        );

        return null;
    }

    public visitExpressionStatement(
        statement: Statement.ExpressionStatement,
    ) {
        this.evaluate(statement.expression);

        return null;
    }

    public visitKeyStatement(
        statement: Statement.KeyStatement,
    ) {
        let value = null;

        if (statement.initializer !== null) {
            value = this.evaluate(statement.initializer);
        }

        this.environment.define(statement.name.lexeme, value ?? '');

        return null;
    }

    public visitItemStatement(
        statement: Statement.ItemStatement,
    ) {
        let value = null;

        if (statement.initializer !== null) {
            value = this.evaluate(statement.initializer);
        }

        this.environment.define(statement.index, value);

        return null;
    }

    public visitLeaflinkStatement(
        statement: Statement.LeaflinkStatement,
    ) {
        let value = null;

        if (statement.initializer !== null) {
            value = this.evaluate(statement.initializer);
        }

        this.leaflinks.define(statement.name.lexeme, value);

        return null;
    }

    public visitLinkStatement(
        statement: Statement.LinkStatement,
    ) {
        const name = statement.name.lexeme;

        let leaflinkName;

        if (statement.initializer) {
            leaflinkName = this.evaluate(statement.initializer);
        }


        if (leaflinkName[0] === '$') {
            const expressionValue = leaflinkName.slice(1);
            const leaflinkValue = process.env[expressionValue];

            const resolvedName = name === leaflinkName
                ? expressionValue
                : name;

            this.environment.define(resolvedName, leaflinkValue || '');

            return null;
        }


        const accessNames = this.resolveDeepAccess(leaflinkName);
        const keyName = accessNames[accessNames.length - 1];

        const leaflinkValue: any = accessNames.reduce((previous, current) => {
            if (previous instanceof Environment) {
                const value = previous.getValue(current);

                return value;
            }

            if (Array.isArray(previous)) {
                return previous[current];
            }

            if (typeof previous === 'object') {
                return previous[current];
            }

            if (typeof previous === 'string') {
                return previous;
            }

            return null;
        }, this.leaflinks);

        if (statement.kind === 'list') {
            if (name === leaflinkName) {
                return leaflinkValue;
            }
        }

        const resolvedName = name === leaflinkName
            ? keyName
            : name

        this.environment.define(resolvedName, leaflinkValue || '');

        return null;
    }

    public visitInterpolateStatement(
        statement: Statement.InterpolateStatement,
    ) {
        this.interpolatorKeys.push(
            statement.name.literal.replace(
                INTERNAL_INTERPOLATOR_SIGN,
                '',
            ),
        );

        return null;
    }

    public visitSpreadStatement(
        statement: Statement.SpreadStatement,
    ) {
        const name = statement.name.lexeme.replace('...#', '').replace(/'/g, '');

        const accessNames = this.resolveDeepAccess(name);

        const leaflink: any = accessNames.reduce((previous, current) => {
            if (previous instanceof Environment) {
                const value = previous.getValue(current);

                return value;
            }

            if (Array.isArray(previous)) {
                return previous[current];
            }

            if (typeof previous === 'object') {
                return previous[current];
            }

            if (typeof previous === 'string') {
                return previous;
            }

            return null;
        }, this.leaflinks);

        if (leaflink) {
            // to handle multi-array spreading
            if (Array.isArray(leaflink)) {
                const all = this.environment.getAll();

                if (all.size === 0) {
                    for (const [index, value] of leaflink.entries()) {
                        this.environment.define(index + '', value);
                    }
                } else {
                    for (const [index, value] of leaflink.entries()) {
                        const all = this.environment.getAll();
                        const idx = all.size + index;

                        this.environment.define(idx  + '', value);
                    }
                }
            }

            // to handle recursivity
            if (leaflink instanceof Environment) {
                const leaflinkValues = leaflink.getAll();
                for (const [name, value] of leaflinkValues) {
                    this.environment.define(name, value);
                }
            }

            if (typeof leaflink === 'string') {
                for (let i = 0; i < leaflink.length; i++) {
                    const char = leaflink[i];
                    this.environment.define(i + '', char);
                }
            }

            // to handle map
            if (
                typeof leaflink === 'object'
                && !Array.isArray(leaflink)
            ) {
                for (const [key, value] of Object.entries(leaflink)) {
                    this.environment.define(key, value);
                }
            }
        }

        return null;
    }


    /** EXPRESSIONS */
    public visitLiteralExpression(
        literalExpression: Expression.LiteralExpression,
    ) {
        return literalExpression.value;
    }

    public visitMapExpression(
        expression: Expression.MapExpression,
    ) {
        const environment = this.executeBlock(
            expression.keys,
            new Environment(this.environment),
        );

        return environment;
    }

    public visitListExpression(
        expression: Expression.ListExpression,
    ) {
        const environment = this.executeBlock(
            expression.items,
            new Environment(),
        );

        if (environment) {
            const data: any = [];
            const values = environment.getAll();

            if (values.size === 0) {
                return [];
            }

            for (const [index, value] of values.entries()) {
                if (value instanceof Environment) {
                    const values = value.getAll();
                    const environmentValue = this.extractFromValues(values);
                    data[index] = environmentValue;
                } else {
                    data[index] = value;
                }
            }

            return data;
        }

        return;
    }

    public visitLinkExpression(
        expression: Expression.LinkExpression,
    ) {
        if (expression.value[0] === '$') {
            const expressionValue = expression.value.slice(1);
            const value = process.env[expressionValue];

            return value || '';
        }

        const accessNames = this.resolveDeepAccess(expression.value);

        const value: any = accessNames.reduce((previous, current) => {
            if (previous instanceof Environment) {
                const value = previous.getValue(current);

                return value;
            }

            if (Array.isArray(previous)) {
                return previous[current];
            }

            if (typeof previous === 'object') {
                return previous[current];
            }

            if (typeof previous === 'string') {
                return previous;
            }

            return null;
        }, this.leaflinks);

        return value;
    }

    public visitGroupingExpression(
        groupingExpression: Expression.GroupingExpression,
    ) {
        return this.evaluate(groupingExpression.expression);
    }

    public visitVariableExpression(
        expression: Expression.VariableExpression,
    ) {
        return this.lookUpVariable(
            expression.name,
            expression,
        );
    }

    public visitAssignExpression(
        expression: Expression.AssignExpression,
    ) {
        const value = this.evaluate(expression.value);

        const distance = this.locals.get(expression);
        if (distance) {
            this.environment.assignAt(
                distance,
                expression.name,
                value,
            );
        } else {
            this.globals.assign(
                expression.name,
                value,
            );
        }

        this.environment.assign(expression.name, value);
        return value;
    }

    public getLeaflinks() {
        const obj: any = {};

        const values = this.leaflinks.getAll();

        for (const [key, value] of values) {
            if (value instanceof Environment) {
                const envValues = value.getAll();
                obj[key] = this.extractFromValues(envValues);
            } else {
                obj[key] = value;
            }
        }

        return obj;
    }



    private executeBlock(
        statements: Statement.Statement[],
        environment: Environment,
        type?: string,
    ) {
        const previous = this.environment;
        let local;

        try {
            // TODO
            // cleanup

            this.environment = environment;

            let tempEnv;
            let idx = 0;

            // Loops over statements
            // and handles the spread in list case
            for (const [index, statement] of statements.entries()) {
                if (statement instanceof Statement.SpreadStatement) {
                    tempEnv = this.environment;
                    this.environment = new Environment();
                    statement.accept(this);
                    const holder = this.environment;
                    this.environment = tempEnv;

                    for (const [index, value] of holder.getAll()) {
                        if (
                            typeof parseInt(index as any) === 'number'
                            && !isNaN(parseInt(index as any))
                        ) {
                            this.environment.define(
                                idx + '',
                                value,
                            );

                            idx += 1;
                        } else {
                            if (index === 'enclosing' || index === 'values') {
                                continue;
                            }

                            this.environment.define(
                                index + '',
                                value,
                            );
                        }
                    }

                    continue;
                }

                tempEnv = this.environment;
                this.environment = new Environment();
                const value = this.executeSynchronous(statement);
                const holder = this.environment;
                this.environment = tempEnv;

                if (value) {
                    if (
                        typeof parseInt(index as any) === 'number'
                        && !isNaN(parseInt(index as any))
                    ) {
                        this.environment.define(
                            idx + '',
                            value,
                        );

                        idx += 1;
                    } else {
                        this.environment.define(
                            index + '',
                            value,
                        );
                    }
                    continue;
                }

                for (const [index, value] of holder.getAll()) {
                    if (
                        typeof parseInt(index) === 'number'
                        && !isNaN(parseInt(index))
                    ) {
                        this.environment.define(
                            idx + '',
                            value,
                        );

                        idx += 1;
                    } else {
                        this.environment.define(
                            index + '',
                            value,
                        );
                    }
                }
            }

            if (type === 'root') {
                this.rootEnvironment = this.environment;
            } else {
                local = this.environment;
            }
        } catch (error) {
            this.environment = previous;
            throw error;
        } finally {
            this.environment = previous;
            return local;
        }
    }

    private evaluate(
        expression: Expression.Expression,
    ): any {
        return expression.accept(this);
    }

    private lookUpVariable(
        name: Token,
        expression: Expression.Expression,
    ) {
        const distance = this.locals.get(expression);

        if (typeof distance !== 'undefined') {
            return this.environment.getAt(distance, name.lexeme);
        } else {
            return this.globals.get(name);
        }
    }

    private resolveRoot(
        statement: Statement.RootStatement | undefined,
    ) {
        if (!statement) {
            return;
        }

        this.executeSynchronous(statement);
    }

    private async resolveLeaflinks(
        statements: Statement.Statement[],
    ) {
        // TODO
        // to loop once over the statements
        // and create a dependency graph
        // then loop again starting from the base of the graph
        // and execute the statements

        const resolvedIndex = this.resolveLeaflinksDepth(
            statements,
        );

        let loop = 0;

        while (loop < resolvedIndex) {
            for (const statement of statements) {
                if (
                    loop > 1
                    && (
                        statement instanceof Statement.ImportStatement
                        || statement instanceof Statement.InjectStatement
                    )
                ) {
                    continue;
                }

                await this.execute(statement);

                this.leaflinks = this.environment;
            }

            loop += 1;
        }
    }

    private resolveLeaflinksSynchronous(
        statements: Statement.Statement[],
    ) {
        // TODO
        // to loop once over the statements
        // and create a dependency graph
        // then loop again starting from the base of the graph
        // and execute the statements

        const resolvedIndex = this.resolveLeaflinksDepth(
            statements,
        );

        let loop = 0;

        while (loop < resolvedIndex) {
            for (const statement of statements) {
                if (
                    loop > 1
                    && (
                        statement instanceof Statement.ImportStatement
                        || statement instanceof Statement.InjectStatement
                    )
                ) {
                    continue;
                }

                this.executeSynchronous(statement);

                this.leaflinks = this.environment;
            }

            loop += 1;
        }
    }

    private resolveLeaflinksDepth(
        statements: Statement.Statement[],
    ) {
        let greatestDepth = 1;

        for (const statement of statements) {
            if (
                statement instanceof Statement.ImportStatement
                || statement instanceof Statement.InjectStatement
            ) {
                continue;
            }

            const depth = this.resolveStatementDepth(statement);

            if (depth > greatestDepth) {
                greatestDepth = depth;
            }
        }

        return greatestDepth;
    }

    private resolveStatementDepth(
        statement: Statement.Statement,
    ) {
        // TODO
        // hardcoded 4
        // it should visit the statement and get the depth
        return 4;
    }

    private resolveDeepAccess(
        key: string
    ) {
        const dotSplit = key.split('.');

        const nameAccess = dotSplit.map(name => {
            const values = name.replace(/]/g, '').split('[');

            return values;
        });

        return nameAccess.flat();
    }

    private checkImportFunctionality(
        statement: Statement.ImportStatement | Statement.InjectStatement,
    ) {
        if (!this.options.parseOptions?.allowNetwork) {
            return false;
        }

        if (this.pure) {
            const url = isURL(statement.path.lexeme);

            if (!url) {
                return false;
            }

            return true;
        }

        return true;
    }
}
// #endregion module



// #region exports
export default Interpreter;
// #endregion exports
