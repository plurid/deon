// #region imports
    // #region libraries
    import {
        createServer,
    } from 'node:http';

    import type {
        AddressInfo,
    } from 'node:net';
    // #endregion libraries
// #endregion imports



// #region module
/**
 * A resource served from this machine.
 *
 * The specification requires the tests to resolve a resource through an injected or a local
 * resolver rather than a public network service (15). The loopback interface is local, and it is
 * the only way to see what was actually sent: an injected resource never travels over a wire, so it
 * can never show that the authenticator reached one.
 */
interface LocalServer {
    url: string;

    /**
     * The `Authorization` header the server received, if it received one.
     */
    authorization: () => string | undefined;

    /**
     * How many requests reached the server. A capability that was denied leaves this at zero.
     */
    requests: () => number;
}


const withLocalServer = async (
    body: string,
    run: (
        server: LocalServer,
    ) => Promise<void>,
    status = 200,
) => {
    let authorization: string | undefined;
    let requests = 0;

    const server = createServer((request, response) => {
        requests += 1;
        authorization = request.headers.authorization;

        response.writeHead(status, { 'Content-Type': 'application/deon' });
        response.end(body);
    });

    await new Promise<void>(resolve => {
        server.listen(0, '127.0.0.1', () => resolve());
    });

    const { port } = server.address() as AddressInfo;

    try {
        await run({
            url: `http://127.0.0.1:${port}/key-value.deon`,
            authorization: () => authorization,
            requests: () => requests,
        });
    } finally {
        await new Promise<void>(resolve => {
            server.close(() => resolve());
        });
    }
}
// #endregion module



// #region exports
export {
    withLocalServer,
};

export type {
    LocalServer,
};
// #endregion exports
