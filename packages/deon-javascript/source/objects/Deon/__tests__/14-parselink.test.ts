// #region imports
    // #region external
    import Deon from '../';

    import {
        withLocalServer,
    } from './localServer';
    // #endregion external
// #endregion imports



// #region module
const document = '{\n    aKey aValue\n}\n';


const codeOf = async (
    run: () => Promise<unknown>,
) => {
    try {
        await run();
    } catch (error) {
        return (error as { code?: string }).code;
    }

    return undefined;
}


describe('Deon parseLink', () => {
    it('reads a document from a link when the network is asked for', async () => {
        await withLocalServer(document, async (server) => {
            const deon = new Deon();

            const data = await deon.parseLink<{ aKey: string }>(server.url, {
                allowNetwork: true,
            });

            expect(data.aKey).toEqual('aValue');
            expect(server.requests()).toEqual(1);
        });
    });


    it('is denied unless the network is asked for', async () => {
        await withLocalServer(document, async (server) => {
            const deon = new Deon();

            const code = await codeOf(() => deon.parseLink(server.url));

            // Naming the link is not the same as being allowed to reach it (specification 9).
            expect(code).toEqual('DEON_CAPABILITY_DENIED');

            // Denied before the request, rather than after it.
            expect(server.requests()).toEqual(0);
        });
    });


    it('sends a non-empty token as a bearer credential', async () => {
        await withLocalServer(document, async (server) => {
            const deon = new Deon();

            await deon.parseLink(server.url, {
                allowNetwork: true,
                token: 'secret-token',
            });

            expect(server.authorization()).toEqual('Bearer secret-token');
        });
    });


    it('sends no authorization header for an empty token', async () => {
        await withLocalServer(document, async (server) => {
            const deon = new Deon();

            await deon.parseLink(server.url, {
                allowNetwork: true,
                token: '',
            });

            expect(server.authorization()).toEqual(undefined);
        });
    });


    it('fails on a non-success status', async () => {
        await withLocalServer('not here', async (server) => {
            const deon = new Deon();

            const code = await codeOf(() => deon.parseLink(server.url, {
                allowNetwork: true,
            }));

            expect(code).toEqual('DEON_RESOURCE_IO');
        }, 404);
    });
});
// #endregion module
