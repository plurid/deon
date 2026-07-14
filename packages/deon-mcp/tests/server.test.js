// #region imports
    import assert from 'node:assert/strict';
    import { mkdtempSync, writeFileSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import path from 'node:path';
    import { after, before, describe, it } from 'node:test';

    import { Client } from '@modelcontextprotocol/sdk/client/index.js';
    import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

    import { createServer } from '../distribution/index.js';
// #endregion imports



// #region module
/**
 * The server, driven over a real MCP transport rather than by calling its functions — because the
 * things a protocol server gets wrong are in the protocol, not in the functions.
 */

const scratch = mkdtempSync(path.join(tmpdir(), 'deon-mcp-'));

/**
 * A `.deon` file is a prompt library as it stands, with no new syntax: the leaflinks are the
 * templates, and the root names which of them are exposed and describes them.
 */
const LIBRARY = `secret the-hidden-value

voice \`You are terse.\`

review \`Review this #{language} code, focusing on #{focus}:

#{code}\`

conversation [
    { role assistant, content #voice }
    { role user, content \`Here it is: #{code}\` }
]

private \`Nobody asked for this: #{unused}\`

{
    review Review code for quality and bugs
    conversation \`A review, as a conversation\`
}
`;

const library = path.join(scratch, 'prompts.deon');
writeFileSync(library, LIBRARY);

const connect = async (options) => {
    const server = createServer(options);
    const client = new Client({ name: 'test', version: '0' });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
    ]);

    return { server, client };
};

const text = (result) => result.content[0].text;
const json = (result) => JSON.parse(text(result));


describe('deon-mcp tools', () => {
    let client;

    before(async () => {
        ({ client } = await connect({}));
    });

    it('offers every tool', async () => {
        const { tools } = await client.listTools();
        const names = tools.map(tool => tool.name).sort();

        assert.deepEqual(names, [
            'deon_canonical',
            'deon_entities',
            'deon_lint',
            'deon_parse',
            'deon_stringify',
            'deon_typed',
        ]);
    });

    it('parses a document into the Deon data model, where everything is a string', async () => {
        const result = await client.callTool({
            name: 'deon_parse',
            arguments: { source: '{\n    a 1\n    b true\n    c [x, y]\n}\n' },
        });

        assert.equal(result.isError, undefined);
        assert.deepEqual(json(result), { a: '1', b: 'true', c: ['x', 'y'] });
    });

    /**
     * The whole point of the tools. A model that writes bad Deon has to be told *what* is wrong and
     * *where*, or it cannot fix it.
     */
    it('reports a failure as a code and a position, not as a stack trace', async () => {
        const result = await client.callTool({
            name: 'deon_parse',
            arguments: { source: "{\n    key 'unterminated\n}\n" },
        });

        assert.equal(result.isError, true);

        const failure = json(result);

        assert.equal(failure.ok, false);
        assert.equal(failure.code, 'DEON_LEX_UNTERMINATED');
        assert.equal(failure.diagnostics[0].line, 2);
        assert.equal(failure.diagnostics[0].column, 9);
    });

    it('lints what is legal but questionable', async () => {
        const result = await client.callTool({
            name: 'deon_lint',
            arguments: { source: '{\n    key one\n    key two\n}\n' },
        });

        const diagnostics = json(result);

        assert.equal(diagnostics.length, 1);
        assert.equal(diagnostics[0].code, 'DEON_LINT_DUPLICATE_KEY');
        assert.equal(diagnostics[0].severity, 'warning');
    });

    it('types conservatively, and says so', async () => {
        const result = await client.callTool({
            name: 'deon_typed',
            arguments: { source: '{\n    a 1.50\n    b true\n    c 007\n}\n' },
        });

        // `007` has a leading zero, so it is not a number it could be written back from.
        assert.deepEqual(json(result), { a: 1.5, b: true, c: '007' });
    });

    it('writes a value back out, and reads it back the same', async () => {
        const written = await client.callTool({
            name: 'deon_stringify',
            arguments: { value: { a: 'one', b: ['x', 'y'] } },
        });

        const read = await client.callTool({
            name: 'deon_parse',
            arguments: { source: text(written) },
        });

        assert.deepEqual(json(read), { a: 'one', b: ['x', 'y'] });
    });

    it('lists what a document declares, and what each would demand', async () => {
        const result = await client.callTool({
            name: 'deon_entities',
            arguments: { source: 'greet `Hi #{name}, you are #{role}.`\n\n{\n    a b\n}\n' },
        });

        assert.deepEqual(json(result), [
            { name: 'greet', parameters: ['name', 'role'], kind: 'scalar' },
        ]);
    });

    /**
     * A document handed to a tool came from the *model*. It is not trusted, and it may reach nothing:
     * not the filesystem, not the network. The refusal is a diagnostic rather than a surprise.
     */
    it('denies a document that a model asked it to read from the filesystem', async () => {
        const result = await client.callTool({
            name: 'deon_parse',
            arguments: { source: 'import x from /etc/passwd\n\n{\n    #x\n}\n' },
        });

        assert.equal(result.isError, true);
        assert.equal(json(result).code, 'DEON_CAPABILITY_DENIED');
    });

    it('denies a document that a model asked it to fetch', async () => {
        const result = await client.callTool({
            name: 'deon_parse',
            arguments: { source: 'import x from https://example.invalid/a.deon\n\n{\n    #x\n}\n' },
        });

        assert.equal(result.isError, true);
        assert.equal(json(result).code, 'DEON_CAPABILITY_DENIED');
    });
});


describe('deon-mcp prompts', () => {
    let client;

    before(async () => {
        ({ client } = await connect({ prompts: library, roots: [scratch] }));
    });

    /**
     * The mapping is mechanical: an MCP prompt's arguments are exactly the interpolation names the
     * entity carries, which the language already computes. Nothing here decides what they are.
     */
    it('exposes an entity as a prompt, with the arguments the entity would demand', async () => {
        const { prompts } = await client.listPrompts();
        const names = prompts.map(prompt => prompt.name).sort();

        // Only what the root names. `secret` and `private` are declared but not exposed — a leaflink
        // is a private detail of a document, and so it stays.
        assert.deepEqual(names, ['conversation', 'review']);

        const review = prompts.find(prompt => prompt.name === 'review');

        assert.equal(review.description, 'Review code for quality and bugs');
        assert.deepEqual(
            review.arguments.map(argument => argument.name).sort(),
            ['code', 'focus', 'language'],
        );
        assert.ok(review.arguments.every(argument => argument.required));
    });

    it('renders a prompt by evaluating the entity call', async () => {
        const result = await client.getPrompt({
            name: 'review',
            arguments: { language: 'Rust', focus: 'safety', code: 'fn main() {}' },
        });

        assert.equal(result.messages.length, 1);
        assert.equal(result.messages[0].role, 'user');
        assert.equal(
            result.messages[0].content.text,
            'Review this Rust code, focusing on safety:\n\nfn main() {}',
        );
    });

    /**
     * A conversation needs no new syntax either: it is a Deon list of Deon maps.
     *
     * And it composes a private leaflink, `#voice`, which is a *link* rather than an interpolation —
     * so the library resolves it for itself and it never becomes an argument. That is the distinction
     * the whole argument schema rests on, and the next test pins the other half of it.
     */
    it('renders a list of role and content as a conversation, composing a private leaflink', async () => {
        const { prompts } = await client.listPrompts();
        const conversation = prompts.find(prompt => prompt.name === 'conversation');

        assert.deepEqual(conversation.arguments.map(argument => argument.name), ['code']);

        const result = await client.getPrompt({
            name: 'conversation',
            arguments: { code: 'fn main() {}' },
        });

        assert.deepEqual(
            result.messages.map(message => [message.role, message.content.text]),
            [
                ['assistant', 'You are terse.'],
                ['user', 'Here it is: fn main() {}'],
            ],
        );
    });

    /**
     * The other half: an *interpolation* is a hole, and it is a parameter even when a leaflink of the
     * same name is right there. `#{voice}` does not quietly resolve to the `voice` declaration — the
     * client must supply it, and an entity call which omits it is a `DEON_ENTITY_ARGUMENT`.
     *
     * This is what makes the published schema trustworthy: it is the set the evaluator will demand,
     * because it is the same rule, read out of the same template.
     */
    it('makes an interpolation an argument even where a leaflink of that name exists', async () => {
        const source = 'voice `You are terse.`\n\nask `#{voice} Do #{task}.`\n\n{\n    ask An ask\n}\n';

        const { client: bare } = await connect({});

        const entities = JSON.parse((await bare.callTool({
            name: 'deon_entities',
            arguments: { source },
        })).content[0].text);

        const ask = entities.find(entity => entity.name === 'ask');

        assert.deepEqual(ask.parameters, ['voice', 'task']);

        // And the evaluator says the same thing, which is the point.
        const called = await bare.callTool({
            name: 'deon_parse',
            arguments: { source: source.replace('{\n    ask An ask\n}', '{\n    a #ask(task it)\n}') },
        });

        assert.equal(called.isError, true);
        assert.equal(JSON.parse(called.content[0].text).code, 'DEON_ENTITY_ARGUMENT');
    });

    /**
     * An argument is *text*, typed by whoever is driving the model. It is not Deon source, and it
     * must not be read as any: `#{secret}` is some characters a user typed, not a link into the
     * library's private declarations.
     *
     * Without the escape, this test reads `the-hidden-value` out of the library and hands it to the
     * model. That is the whole reason the escape exists.
     */
    it('does not let an argument interpolate its way into the library', async () => {
        const result = await client.getPrompt({
            name: 'review',
            arguments: {
                language: 'Rust',
                focus: 'safety',
                code: 'leak: #{secret}',
            },
        });

        const rendered = result.messages[0].content.text;

        assert.ok(
            !rendered.includes('the-hidden-value'),
            `an argument read a leaflink out of the library: ${rendered}`,
        );

        // And it arrives as the text it was: unchanged, not swallowed.
        assert.ok(rendered.includes('leak: #{secret}'), rendered);
    });

    it('refuses a call that is missing an argument the entity demands', async () => {
        // The schema and the evaluator agree because they are the same rule: an entity's parameters
        // are the interpolation names it carries, and every one of them is required.
        await assert.rejects(() => client.getPrompt({
            name: 'review',
            arguments: { language: 'Rust' },
        }));
    });
});


describe('deon-mcp resources', () => {
    it('serves the .deon files under a root, and nothing else', async () => {
        const { client } = await connect({ roots: [scratch] });

        const { resources } = await client.listResources();
        const uris = resources.map(resource => resource.uri);

        assert.ok(uris.some(uri => uri.endsWith('prompts.deon')), uris.join(', '));

        const read = await client.readResource({ uri: `deon://${library}` });

        // Served canonically, so what a model reads is the document's meaning rather than its layout.
        assert.equal(read.contents[0].mimeType, 'application/deon');
        assert.ok(read.contents[0].text.includes('conversation'));
    });

    /**
     * A server given no root does not offer an empty list of resources — it does not offer resources
     * at all. The capability is absent, so a client is told there is nothing here by the protocol
     * rather than by an empty answer it had to ask for.
     */
    it('does not even offer the capability when it was given no root', async () => {
        const { client } = await connect({});

        assert.equal(client.getServerCapabilities().resources, undefined);
        await assert.rejects(() => client.listResources());
    });
});
// #endregion module
