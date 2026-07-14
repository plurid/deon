// #region imports
    // #region libraries
    import {
        spawn,
    } from 'node:child_process';
    // #endregion libraries


    // #region external
    import {
        fetchFromURL,
    } from '../synchronous/url';
    // #endregion external
// #endregion imports



// #region module
/**
 * The synchronous fetcher blocks until the document arrives, which is the whole point of it, and a
 * blocked process cannot answer its own request: a server living here would never be reached. So
 * the server is given a process of its own.
 *
 * It is local, as the specification requires of the tests (15), and it answers `/echo.deon` with
 * the authenticator it was sent, which is the only way to see a header from behind a call that
 * hands back nothing but the body.
 */
const SERVER = `
import { createServer } from 'node:http';

const server = createServer((request, response) => {
    if (request.url === '/missing.deon') {
        response.writeHead(404);
        response.end('not here');
        return;
    }

    if (request.url === '/echo.deon') {
        response.writeHead(200);
        response.end(request.headers.authorization ?? '');
        return;
    }

    response.writeHead(200, { 'Content-Type': 'application/deon' });
    response.end('{\\n    alpha beta\\n}\\n');
});

server.listen(0, '127.0.0.1', () => {
    process.stdout.write(server.address().port + '\\n');
});
`;


const withServer = async (
    body: (base: string) => void,
) => {
    const child = spawn(
        process.execPath,
        ['--input-type=module', '--eval', SERVER],
        { stdio: ['ignore', 'pipe', 'inherit'] },
    );

    try {
        const port = await new Promise<string>((resolve, reject) => {
            let buffered = '';

            child.stdout?.on('data', (chunk: Buffer) => {
                buffered += chunk.toString('utf8');

                const end = buffered.indexOf('\n');

                if (end !== -1) {
                    resolve(buffered.slice(0, end).trim());
                }
            });

            child.once('error', reject);
            child.once('exit', () => {
                reject(new Error('The test server exited before it was ready.'));
            });
        });

        body(`http://127.0.0.1:${port}`);
    } finally {
        child.kill();
    }
}


describe('fetcher synchronous url', () => {
    it('reads a document over http, and returns it rather than a promise', async () => {
        await withServer(base => {
            const result = fetchFromURL(`${base}/document.deon`, undefined, 'import');

            expect(result.data).toEqual('{\n    alpha beta\n}\n');
            expect(result.filetype).toEqual('.deon');
            expect(result.resourceId).toEqual(`${base}/document.deon`);
        });
    });

    it('sends a non-empty authenticator as a bearer token', async () => {
        await withServer(base => {
            const result = fetchFromURL(`${base}/echo.deon`, 'sekrit', 'import');

            expect(result.data).toEqual('Bearer sekrit');
        });
    });

    it('sends no authorization header for an empty authenticator', async () => {
        await withServer(base => {
            const result = fetchFromURL(`${base}/echo.deon`, '', 'import');

            expect(result.data).toEqual('');
        });
    });

    it('fails the evaluation on a non-success status', async () => {
        await withServer(base => {
            let threw = false;

            try {
                fetchFromURL(`${base}/missing.deon`, undefined, 'import');
            } catch {
                threw = true;
            }

            expect(threw).toEqual(true);
        });
    });
});
// #endregion module
