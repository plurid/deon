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
describe(suites.interpolation, () => {
    it('basic', async () => {
        const dataValues = `
{
    key one #{interpolation} three
}

interpolation two
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        log(data);


        expect(data.key).toEqual('one two three');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.interpolation} - basic`,
        );
    });
});
// #endregion module
