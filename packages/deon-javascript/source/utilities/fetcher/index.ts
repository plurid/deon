// #region imports
    // #region internal
    import {
        fetcher as asynchronousFetcher,
    } from '../../utilities/fetcher/asynchronous';

    import {
        fetcher as synchronousFetcher,
    } from '../../utilities/fetcher/synchronous';
    // #endregion internal
// #endregion imports



// #region module
const fetcher = {
    asynchronous: asynchronousFetcher,
    synchronous: synchronousFetcher,
};
// #endregion module



// #region exports
export default fetcher;
// #endregion exports
