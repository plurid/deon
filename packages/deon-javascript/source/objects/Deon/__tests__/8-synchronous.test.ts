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
        const data = deon.parseSynchronous<{key: string}>(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.key).toEqual('value');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.synchronous} - simple`,
        );
    });



    it('simple import', () => {
        const dataValues = `
import keyValue from https://raw.githubusercontent.com/plurid/deon/master/packages/deon-javascript/tests/simple/key-value.deon

{
    key #keyValue.aKey
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = deon.parseSynchronous<{key: string}>(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.key).toEqual('aValue');

        compareTimeBenchmark(
            start,
            end,
            'network',
            `${suites.synchronous} - simple import`,
        );
    });
});
// #endregion module
