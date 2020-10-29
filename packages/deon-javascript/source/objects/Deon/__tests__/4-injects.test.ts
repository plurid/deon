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
describe(suites.injects, () => {
    it('simple inject', async () => {
        const dataValues = `
inject keyValue from https://raw.githubusercontent.com/plurid/deon/master/packages/deon-javascript/tests/simple/key-value.deon

{
    key #keyValue
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.key).toEqual(`{\n    aKey aValue\n}\n`);

        compareTimeBenchmark(
            start,
            end,
            'network',
            `${suites.injects} - simple inject`,
        );
    });


    xit('simple inject - with token', async () => {
        const dataValues = `
inject keyValue from https://raw.githubusercontent.com/plurid/deon/master/packages/deon-javascript/tests/simple/key-value.deon with secret-token

{
    key #keyValue
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.key).toEqual(`{\n    aKey aValue\n}\n`);

        compareTimeBenchmark(
            start,
            end,
            'network',
            `${suites.injects} - simple inject - with token`,
        );
    });
});
// #endregion module
