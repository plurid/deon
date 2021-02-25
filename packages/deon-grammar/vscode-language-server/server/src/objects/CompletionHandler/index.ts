// #region module
class CompletionHandler {
    private value: any = null;

    public set(
        value: any
    ) {
        this.value = value;
    }

    public get() {
        return this.value;
    }
}
// #endregion module



// #region exports
const completionHandler = new CompletionHandler();

export default completionHandler;
// #endregion exports
