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
        // Specification 15: resources resolve through an injected resolver, never the public network.
        const keyValueURL = 'https://raw.githubusercontent.com/plurid/deon/master/packages/deon-javascript/tests/simple/key-value.deon';

        const dataValues = `
import keyValue from ${keyValueURL}

{
    key #keyValue.aKey
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = deon.parseSynchronous<{key: string}>(
            dataValues,
            {
                resources: {
                    [keyValueURL]: `{\n    aKey aValue\n}\n`,
                },
            },
        );
        const end = Date.now();
        // log(data);


        expect(data.key).toEqual('aValue');

        compareTimeBenchmark(
            start,
            end,
            'fast',
            `${suites.synchronous} - simple import`,
        );
    });
});
// #endregion module
