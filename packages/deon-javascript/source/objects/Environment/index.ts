// #region imports
    // #region external
    import Token from '../Token';
    // #endregion external
// #endregion imports



// #region module
class Environment {
    public enclosing: Environment | undefined;
    private values: Map<string, any> = new Map();

    constructor(
        enclosing?: Environment,
    ) {
        this.enclosing = enclosing;
    }

    public define(
        name: string,
        value: any,
    ) {
        this.values.set(name, value);
    }

    public get(
        name: Token,
    ): any {
        if (this.values.has(name.lexeme)) {
            return this.values.get(name.lexeme);
        }

        if (this.enclosing) {
            return this.enclosing.get(name);
        }

        // throw new RuntimeError(
        //     name,
        //     `Undefined variable '${name.lexeme}'`,
        // );
    }

    public getValue(
        name: string,
    ): any {
        if (this.values.has(name)) {
            return this.values.get(name);
        }

        return;

        // throw new RuntimeError(
        //     name,
        //     `Undefined variable '${name.lexeme}'`,
        // );
    }

    public assign(
        name: Token,
        value: any,
    ) {
        if (this.values.has(name.lexeme)) {
            this.values.set(name.lexeme, value);
            return;
        }

        if (this.enclosing) {
            this.enclosing.assign(name, value);
            return;
        }

        // throw new RuntimeError(
        //     name,
        //     `Undefined variable '${name.lexeme}'`,
        // );
    }

    public getAt(
        distance: number,
        name: string,
    ) {
        return this.ancestor(distance)?.values.get(name);
    }

    public getAll() {
        return this.values;
    }

    public ancestor(
        distance: number,
    ) {
        let environment: Environment | undefined = this;

        for (let i = 0; i < distance; i++) {
            environment = environment?.enclosing;
        }

        return environment;
    }

    public assignAt(
        distance: number,
        name: Token,
        value: any,
    ) {
        this.ancestor(distance)?.values.set(name.lexeme, value);
    }
}
// #endregion module



// #region exports
export default Environment;
// #endregion exports
