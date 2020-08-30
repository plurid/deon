// #region imports
    // #region external
    import Deon from '../objects/Deon';
    // #endregion external
// #endregion imports



// #region module
const cli = () => {
    const deon = new Deon();
    deon.demand(process.argv);
}
// #endregion module



// #region exports
export default cli;
// #endregion exports
