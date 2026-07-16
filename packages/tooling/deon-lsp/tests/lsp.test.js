// The server, driven exactly as an editor drives it: framed JSON-RPC over a pair of streams. Nothing
// is stubbed — the messages are encoded with the server's own framer, sent through, and the replies
// read back and decoded. What these prove is that the wire works, that a fault becomes a squiggle at
// the right place (including across a non-BMP character, where UTF-16 and code points disagree), and
// that the outline, the jump, the hover, and the completion each answer from the real syntax tree.

// #region imports
    import assert from 'node:assert/strict';
    import { PassThrough } from 'node:stream';
    import { describe, it } from 'node:test';

    import { createServer, encodeMessage } from '../distribution/index.js';
// #endregion imports



// #region client
/**
 * A minimal LSP client: it speaks the same framed protocol the server does, tracks the last
 * diagnostics published per document, and lets a test await either a response by id or the next
 * diagnostics for a URI.
 */
class Client {
    constructor() {
        this.toServer = new PassThrough();
        this.fromServer = new PassThrough();
        this.pending = Buffer.alloc(0);
        this.messages = [];
        this.waiters = [];
        this.id = 0;

        this.fromServer.on('data', (chunk) => this.receive(chunk));
        createServer({ input: this.toServer, output: this.fromServer, onExit: () => {} });
    }

    receive(chunk) {
        this.pending = Buffer.concat([this.pending, chunk]);
        for (;;) {
            const headerEnd = this.pending.indexOf('\r\n\r\n');
            if (headerEnd === -1) return;
            const header = this.pending.subarray(0, headerEnd).toString('ascii');
            const length = /content-length:\s*(\d+)/i.exec(header);
            if (!length) {
                this.pending = this.pending.subarray(headerEnd + 4);
                continue;
            }
            const bodyStart = headerEnd + 4;
            const bodyEnd = bodyStart + Number(length[1]);
            if (this.pending.length < bodyEnd) return;
            const message = JSON.parse(this.pending.subarray(bodyStart, bodyEnd).toString('utf8'));
            this.pending = this.pending.subarray(bodyEnd);
            this.messages.push(message);
            this.waiters = this.waiters.filter((waiter) => !waiter(message));
        }
    }

    send(message) {
        this.toServer.write(encodeMessage(message));
    }

    waitFor(predicate, { skipExisting = false, timeout = 4000 } = {}) {
        if (!skipExisting) {
            const already = this.messages.find(predicate);
            if (already) return Promise.resolve(already);
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('timed out waiting for a message')), timeout);
            this.waiters.push((message) => {
                if (!predicate(message)) return false;
                clearTimeout(timer);
                resolve(message);
                return true;
            });
        });
    }

    async request(method, params) {
        const id = ++this.id;
        const answer = this.waitFor((m) => m.id === id && ('result' in m || 'error' in m));
        this.send({ jsonrpc: '2.0', id, method, params });
        const message = await answer;
        if (message.error) throw new Error(message.error.message);
        return message.result;
    }

    notify(method, params) {
        this.send({ jsonrpc: '2.0', method, params });
    }

    /** Open a document and return the diagnostics the server publishes for it. */
    async open(uri, text) {
        const published = this.waitFor(
            (m) => m.method === 'textDocument/publishDiagnostics' && m.params.uri === uri,
            { skipExisting: true },
        );
        this.notify('textDocument/didOpen', {
            textDocument: { uri, languageId: 'deon', version: 1, text },
        });
        return (await published).params.diagnostics;
    }
}
// #endregion client



// #region tests
describe('deon-lsp', () => {
    it('announces what it can do', async () => {
        const client = new Client();
        const result = await client.request('initialize', { capabilities: {} });

        assert.equal(result.capabilities.textDocumentSync, 1);
        assert.equal(result.capabilities.documentSymbolProvider, true);
        assert.equal(result.capabilities.definitionProvider, true);
        assert.equal(result.capabilities.hoverProvider, true);
        assert.deepEqual(result.capabilities.completionProvider.triggerCharacters, ['#']);
        assert.equal(result.serverInfo.name, 'deon-lsp');
    });

    it('publishes no diagnostics for a well-formed document', async () => {
        const client = new Client();
        const diagnostics = await client.open('file:///ok.deon', '{\n    a one\n}\n');
        assert.deepEqual(diagnostics, []);
    });

    it('reports a syntax fault as an error with a range', async () => {
        const client = new Client();
        const diagnostics = await client.open('file:///broken.deon', '{\n    a [ one\n}\n');

        assert.equal(diagnostics.length, 1);
        assert.equal(diagnostics[0].severity, 1);
        assert.match(diagnostics[0].code, /^DEON_/);
        assert.equal(diagnostics[0].source, 'deon');
        assert.ok(diagnostics[0].range.start.line >= 0);
    });

    it('reports a duplicate key as a warning', async () => {
        const client = new Client();
        const diagnostics = await client.open('file:///dup.deon', '{\n    k 1\n    k 2\n}\n');

        assert.equal(diagnostics.length, 1);
        assert.equal(diagnostics[0].code, 'DEON_LINT_DUPLICATE_KEY');
        assert.equal(diagnostics[0].severity, 2);
        // The repeat is on the third line of the source, which is line index 2.
        assert.equal(diagnostics[0].range.start.line, 2);
    });

    it('places a diagnostic correctly across a non-BMP character', async () => {
        // `🎂` is one code point but two UTF-16 units. The `#z` after a value is a parse fault at the
        // `#`, and the LSP character must count the cake as two, landing on column 7, not 6.
        const client = new Client();
        const diagnostics = await client.open('file:///emoji.deon', '{ a 🎂 #z }');

        assert.equal(diagnostics.length, 1);
        assert.equal(diagnostics[0].range.start.line, 0);
        assert.equal(diagnostics[0].range.start.character, 7);
    });

    it('outlines declarations and keys', async () => {
        const client = new Client();
        const uri = 'file:///outline.deon';
        await client.open(uri, 'greeting hello\nimport c from child.deon\n{\n    message #greeting\n    nested {\n        inner value\n    }\n}\n');

        const symbols = await client.request('textDocument/documentSymbol', {
            textDocument: { uri },
        });

        const names = symbols.map((symbol) => symbol.name);
        assert.ok(names.includes('greeting'), `expected a 'greeting' symbol, got ${names.join(', ')}`);
        assert.ok(names.includes('c'), `expected a 'c' import symbol, got ${names.join(', ')}`);
        assert.ok(names.includes('message'), `expected a 'message' key symbol, got ${names.join(', ')}`);

        const nested = symbols.find((symbol) => symbol.name === 'nested');
        assert.ok(nested, 'expected a nested map symbol');
        assert.ok((nested.children ?? []).some((child) => child.name === 'inner'), 'expected the nested key');
    });

    it('jumps from a reference to its declaration', async () => {
        const client = new Client();
        const uri = 'file:///def.deon';
        await client.open(uri, 'greeting hello\n{\n    message #greeting\n}\n');

        const location = await client.request('textDocument/definition', {
            textDocument: { uri },
            position: { line: 2, character: 14 }, // on `#greeting`
        });

        assert.ok(location, 'expected a definition location');
        assert.equal(location.uri, uri);
        assert.equal(location.range.start.line, 0); // the `greeting` declaration
    });

    it('hovers a reference with what it names', async () => {
        const client = new Client();
        const uri = 'file:///hover.deon';
        await client.open(uri, 'greeting hello\n{\n    message #greeting\n}\n');

        const hover = await client.request('textDocument/hover', {
            textDocument: { uri },
            position: { line: 2, character: 14 },
        });

        assert.ok(hover, 'expected a hover');
        assert.match(hover.contents.value, /leaflink/);
        assert.match(hover.contents.value, /greeting/);
    });

    it('completes a declared name while the current line is unparseable', async () => {
        const client = new Client();
        const uri = 'file:///complete.deon';
        // Open a well-formed document, so a good syntax tree is cached...
        await client.open(uri, 'greeting hello\n{\n    message #greeting\n}\n');
        // ...then type a bare `#`, which does not parse. Completion must still offer the name, read
        // from the last tree that did parse.
        client.notify('textDocument/didChange', {
            textDocument: { uri, version: 2 },
            contentChanges: [{ text: 'greeting hello\n{\n    message #\n}\n' }],
        });

        const items = await client.request('textDocument/completion', {
            textDocument: { uri },
            position: { line: 2, character: 14 },
        });

        const labels = items.map((item) => item.label);
        assert.ok(labels.includes('greeting'), `expected 'greeting' in completions, got ${labels.join(', ')}`);
    });
});
// #endregion tests
