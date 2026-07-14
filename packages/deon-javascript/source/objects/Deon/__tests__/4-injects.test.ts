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

    import {
        withLocalServer,
    } from './localServer';
    // #endregion external
// #endregion imports



// #region module
// Specification 15: resources resolve through an injected resolver, never the public network.
const keyValueURL = 'https://raw.githubusercontent.com/plurid/deon/master/packages/deon-javascript/tests/simple/key-value.deon';
const keyValueFile = `{\n    aKey aValue\n}\n`;


describe(suites.injects, () => {
    it('simple inject', async () => {
        const dataValues = `
inject keyValue from ${keyValueURL}

{
    key #keyValue
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
            {
                resources: {
                    [keyValueURL]: keyValueFile,
                },
            },
        );
        const end = Date.now();
        // log(data);


        // An injection binds the resource text exactly, unparsed.
        expect(data.key).toEqual(keyValueFile);

        compareTimeBenchmark(
            start,
            end,
            'fast',
            `${suites.injects} - simple inject`,
        );
    });


    it('simple inject - with token', async () => {
        await withLocalServer(keyValueFile, async (server) => {
            const dataValues = `
inject keyValue from ${server.url} with secret-token

{
    key #keyValue
}
            `;

            const start = Date.now();
            const deon = new Deon();
            const data = await deon.parse(
                dataValues,
                {
                    allowNetwork: true,
                },
            );
            const end = Date.now();


            // An injection binds the text exactly, without parsing it.
            expect(data.key).toEqual(`{\n    aKey aValue\n}\n`);

            expect(server.authorization()).toEqual('Bearer secret-token');

            compareTimeBenchmark(
                start,
                end,
                'network',
                `${suites.injects} - simple inject - with token`,
            );
        });
    });
});
// #endregion module
