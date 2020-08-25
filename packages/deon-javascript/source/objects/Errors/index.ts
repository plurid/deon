// #region imports
    // #region external
    import Token from '../Token';
    // #endregion external
// #endregion imports



// #region module
export class RuntimeError extends Error {
    public token: Token | null;

    constructor(
        token: Token | null,
        message: string,
    ) {
        super(message);
        this.token = token;
    }
}
// #endregion module
