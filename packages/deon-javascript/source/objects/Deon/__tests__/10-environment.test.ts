// #region imports
    // #region external
    import Deon from '../';

    import {
        compareTimeBenchmark,
        suites,
    } from '../../../utilities/test';
    // #endregion external
// #endregion imports



// #region module
describe(suites.environment, () => {
    it('loads environment', async () => {
        const start = Date.now();
        const deon = new Deon();
        await deon.loadEnvironment('./tests/environment/env.deon');
        const end = Date.now();

        expect(process.env.ONE).toEqual('one');
        expect(process.env.TWO).toEqual('two');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.environment} - loads environment`,
        );
    });
});
// #endregion module
