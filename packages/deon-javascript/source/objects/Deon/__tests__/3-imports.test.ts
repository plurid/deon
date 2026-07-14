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
// Specification 15: conformance and implementation tests resolve resources through injected or
// local resolvers, never the public network. `resources` is that injected resolver, so the URL
// import path stays under test without a request leaving the machine.
const keyValueURL = 'https://raw.githubusercontent.com/plurid/deon/master/packages/deon-javascript/tests/simple/key-value.deon';
const keyValueFile = `{\n    aKey aValue\n}\n`;


describe(suites.imports, () => {
    it('simple import', async () => {
        const dataValues = `
import keyValue from ${keyValueURL}

{
    key #keyValue.aKey
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


        expect(data.key).toEqual('aValue');

        compareTimeBenchmark(
            start,
            end,
            'fast',
            `${suites.imports} - simple import`,
        );
    });


    it('simple import - with token', async () => {
        await withLocalServer(keyValueFile, async (server) => {
            const dataValues = `
import keyValue from ${server.url} with secret-token

{
    key #keyValue.aKey
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


            expect(data.key).toEqual('aValue');

            // The whole point of the case: the authenticator has to reach the wire.
            expect(server.authorization()).toEqual('Bearer secret-token');

            compareTimeBenchmark(
                start,
                end,
                'network',
                `${suites.imports} - simple import - with token`,
            );
        });
    });


    it('an import over the network is denied unless the network is asked for', async () => {
        await withLocalServer(keyValueFile, async (server) => {
            const dataValues = `
import keyValue from ${server.url}

{
    key #keyValue.aKey
}
            `;

            const deon = new Deon();

            let code: string | undefined;

            try {
                await deon.parse(dataValues);
            } catch (error) {
                code = (error as { code?: string }).code;
            }

            expect(code).toEqual('DEON_CAPABILITY_DENIED');

            // Denied before the request, rather than after it: nothing reached the server.
            expect(server.requests()).toEqual(0);
        });
    });
});
// #endregion module
