// #region imports
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import {
        mkdirSync,
        mkdtempSync,
        realpathSync,
        rmSync,
        symlinkSync,
        writeFileSync,
    } from 'node:fs';
    import { tmpdir } from 'node:os';
    import path from 'node:path';
    import { after, before, beforeEach, describe, it } from 'node:test';

    import { Client } from '@modelcontextprotocol/sdk/client/index.js';
    import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

    import { createServer } from '../distribution/index.js';
    import { confinement } from '../distribution/confine.js';
// #endregion imports



// #region module
/**
 * A server confines every read a served document makes to the configured roots. These tests plant a
 * sentinel *outside* a root and prove it is never read — not by a `..` traversal, not through a
 * symbolic link, not by something an in-root document imports, and not by a path swapped out from
 * under the server after it was listed.
 *
 * The proof is direct rather than incidental: `fs.readFileSync` is wrapped for the duration, every
 * path it is handed is recorded, and after each attempt the test asserts that none of those paths
 * resolves — following its links — to anywhere outside the root. A refusal that still read the file,
 * or read it through a link, would be caught here even if the value never reached the output.
 */

// The real path of the sentinel base, so a macOS `/var` -> `/private/var` link does not itself read
// as an escape.
const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'deon-mcp-confine-')));

let reads = [];
const realReadFileSync = fs.readFileSync;

before(() => {
    fs.readFileSync = (target, ...rest) => {
        if (typeof target === 'string') {
            reads.push(target);
        }

        return realReadFileSync.call(fs, target, ...rest);
    };
});

after(() => {
    fs.readFileSync = realReadFileSync;
    rmSync(base, { recursive: true, force: true });
});

beforeEach(() => {
    reads = [];
});


/**
 * The reads that escaped a root: every recorded read, under the sentinel base, whose real path is
 * not the root itself and not inside it. Empty is the whole point.
 */
const escapes = (root) => reads
    .filter(target => target.startsWith(base + path.sep))
    .filter(target => {
        try {
            const real = realpathSync(target);

            return real !== root && !real.startsWith(root + path.sep);
        } catch {
            // A path that no longer resolves was, at least, not read from outside the root.
            return false;
        }
    });


/**
 * A fresh case: a root, and an `outside` directory that is its sibling rather than its child, so
 * nothing written to `outside` is inside the root.
 */
const scenario = () => {
    const directory = mkdtempSync(path.join(base, 'case-'));
    const root = path.join(directory, 'root');
    const outside = path.join(directory, 'outside');

    mkdirSync(root);
    mkdirSync(outside);

    return { root, outside };
};


const connect = async (options) => {
    const server = createServer(options);
    const client = new Client({ name: 'test', version: '0' });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
    ]);

    return client;
};


/**
 * The read a library makes is attempted the moment the library is read — every resource it declares
 * is loaded before it is evaluated (specification 9) — so a malicious import is refused at
 * registration, and the refusal surfaces as `connect` rejecting. A library that got past that would
 * still be refused when the prompt was rendered; either way, the flow must reject.
 */
const rejectsLibrary = async (library, root, promptName = 'greet') => assert.rejects(async () => {
    const client = await connect({ prompts: library, roots: [root] });

    await client.getPrompt({ name: promptName, arguments: { name: 'x' } });
});


const EXPOSED = 'greet `Hello #{name}`\n\n{\n    greet A greeting\n}\n';


describe('deon-mcp confinement', () => {
    it('(a) refuses a `..` traversal in an import', async () => {
        const { root, outside } = scenario();
        writeFileSync(path.join(outside, 'secret.deon'), '{\n    leak SENTINEL_A\n}\n');

        const library = path.join(root, 'lib.deon');
        writeFileSync(library, `import out from ../outside/secret\n\n${EXPOSED}`);

        await rejectsLibrary(library, root);
        assert.deepEqual(escapes(root), []);
    });


    it('(b) refuses a transitive escape (in-root imports in-root imports out-of-root)', async () => {
        const { root, outside } = scenario();
        writeFileSync(path.join(outside, 'secret.deon'), '{\n    leak SENTINEL_B\n}\n');

        // `mid` is inside the root and is read; what it imports is outside, and is not.
        writeFileSync(path.join(root, 'mid.deon'), 'import deep from ../outside/secret\n\n{\n    deep #deep\n}\n');

        const library = path.join(root, 'lib.deon');
        writeFileSync(library, `import mid from ./mid\n\n${EXPOSED}`);

        await rejectsLibrary(library, root);

        // The in-root `mid.deon` was reached; only the out-of-root file was refused.
        assert.ok(reads.some(target => target === path.join(root, 'mid.deon')), 'expected the in-root mid.deon to be read');
        assert.deepEqual(escapes(root), []);
    });


    it('(c) refuses a `..` traversal in an inject', async () => {
        const { root, outside } = scenario();
        writeFileSync(path.join(outside, 'secret.txt'), 'SENTINEL_C');

        const library = path.join(root, 'lib.deon');
        writeFileSync(library, `inject out from ../outside/secret.txt\n\n${EXPOSED}`);

        await rejectsLibrary(library, root);
        assert.deepEqual(escapes(root), []);
    });


    it('(d) refuses a datasign file outside the roots', async () => {
        const { root, outside } = scenario();
        writeFileSync(path.join(outside, 'secret.datasign'), 'data Entity {\n    name: string;\n}\n');

        // Datasign is not reachable through the server's own options, so the confined evaluator is
        // exercised directly — a confined evaluator that read an out-of-root datasign file would be
        // confined in name only.
        const confine = confinement({ roots: [root], allowNetwork: false });

        assert.throws(
            () => confine.parse('{ entity { name One } }', {
                filebase: root,
                allowFilesystem: true,
                datasignFiles: ['../outside/secret.datasign'],
                datasignMap: { entity: 'Entity' },
            }),
            (error) => error.code === 'DEON_CAPABILITY_DENIED',
        );

        assert.deepEqual(escapes(root), []);
    });


    it('(e) refuses a symlinked file inside a root that points outside', async () => {
        const { root, outside } = scenario();
        writeFileSync(path.join(outside, 'secret.deon'), '{\n    leak SENTINEL_E\n}\n');

        // A link named as a Deon document, inside the root, pointing out of it.
        symlinkSync(path.join(outside, 'secret.deon'), path.join(root, 'link.deon'));

        const library = path.join(root, 'lib.deon');
        writeFileSync(library, `import out from ./link\n\n${EXPOSED}`);

        await rejectsLibrary(library, root);
        assert.deepEqual(escapes(root), []);
    });


    it('(f) refuses a symlinked directory inside a root that points outside', async () => {
        const { root, outside } = scenario();
        writeFileSync(path.join(outside, 'secret.deon'), '{\n    leak SENTINEL_F\n}\n');

        // A link to a directory outside the root; the import reaches through it.
        symlinkSync(outside, path.join(root, 'linkdir'));

        const library = path.join(root, 'lib.deon');
        writeFileSync(library, `import out from ./linkdir/secret\n\n${EXPOSED}`);

        await rejectsLibrary(library, root);
        assert.deepEqual(escapes(root), []);
    });


    it('(g) refuses a resource swapped for an out-of-root symlink after it was listed', async () => {
        const { root, outside } = scenario();
        writeFileSync(path.join(outside, 'secret.deon'), '{\n    leak SENTINEL_G\n}\n');

        // A real, in-root document at listing time.
        const resource = path.join(root, 'resource.deon');
        writeFileSync(resource, '{\n    ok yes\n}\n');

        const client = await connect({ roots: [root] });
        await client.listResources();

        // Swapped, after the listing, for a link that points out of the root. The read must resolve
        // the link now, not trust the name it was listed under.
        rmSync(resource);
        symlinkSync(path.join(outside, 'secret.deon'), resource);

        await assert.rejects(() => client.readResource({ uri: `deon://${resource}` }));
        assert.deepEqual(escapes(root), []);
    });


    it('(+) still composes an in-root import into a rendered prompt', async () => {
        const { root } = scenario();

        // The imported list *is* the conversation; its content comes from a second in-root file.
        writeFileSync(
            path.join(root, 'greeting.deon'),
            '[\n    { role user, content Hello-from-in-root }\n]\n',
        );

        const library = path.join(root, 'lib.deon');
        writeFileSync(library, 'import conv from ./greeting\n\n{\n    conv A conversation\n}\n');

        const client = await connect({ prompts: library, roots: [root] });
        const result = await client.getPrompt({ name: 'conv', arguments: {} });

        assert.equal(result.messages[0].content.text, 'Hello-from-in-root');
        assert.deepEqual(escapes(root), []);
    });


    it('(+) still serves an in-root resource', async () => {
        const { root } = scenario();
        const resource = path.join(root, 'served.deon');
        writeFileSync(resource, '{\n    value in-root\n}\n');

        const client = await connect({ roots: [root] });
        const read = await client.readResource({ uri: `deon://${resource}` });

        assert.ok(read.contents[0].text.includes('in-root'));
        assert.deepEqual(escapes(root), []);
    });
});
// #endregion module
