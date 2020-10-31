// #region imports
    // #region external
    import Deon from '../';

    import {
        log,
    } from '../../../utilities/log';

    import {
        compareTimeBenchmark,
        suites,
    } from '../../../utilities/test';
    // #endregion external
// #endregion imports



// #region module
describe(suites.synchronous, () => {
    it('simple', () => {
        const dataValues = `
{
    key value
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = deon.parseSynchronous(
            dataValues,
        );
        const end = Date.now();
        log(data);


        expect(Object.keys(data).length).toEqual(0);

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.synchronous} - simple`,
        );
    });
});
// #endregion module
