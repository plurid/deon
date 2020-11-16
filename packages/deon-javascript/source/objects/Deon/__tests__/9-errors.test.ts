// #region imports
    // #region external
    import Deon from '../';

    import {
        log,
    } from '../../../utilities/log';

    import {
        typer,
    } from '../../../utilities/typer';

    import {
        compareTimeBenchmark,
        suites,
    } from '../../../utilities/test';
    // #endregion external
// #endregion imports



// #region module
describe(suites.errors, () => {
    it('no root line', async () => {
        const dataValues = `a`;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(Object.keys(data).length).toEqual(0);

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.errors} - no root line`,
        );
    });



    it('no root', async () => {
        const dataValues = `
a
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(Object.keys(data).length).toEqual(0);

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.errors} - no root`,
        );
    });



    it('no closing bracket', async () => {
        const dataValues = `
{
    key value
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(Object.keys(data).length).toEqual(0);

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.errors} - no closing bracket`,
        );
    });
});
// #endregion module
