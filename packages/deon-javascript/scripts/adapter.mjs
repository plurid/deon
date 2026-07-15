// The cross-implementation harness adapter (`spec/harness/README.md`).
//
// A filter: newline-delimited JSON in, newline-delimited JSON out. Nothing escapes it but a
// response — a host exception crossing this boundary would be reported as a disagreement, and it
// would be one.

import { createInterface } from 'node:readline';

import Deon, { typer } from '../distribution/index.mjs';


const flag = (request, name, fallback = false) =>
    (request[name] ?? (fallback ? 'true' : 'false')) === 'true';


const optionsOf = (request) => ({
    sourceName: request.sourceName ?? '<memory>',
    filebase: request.filebase ?? '',
    resources: request.files ?? {},
    absolutePaths: request.absolutePaths ?? {},
    environment: request.environment ?? {},
    allowFilesystem: flag(request, 'allowFilesystem'),
    allowNetwork: flag(request, 'allowNetwork'),

    // The contracts of specification 14.1. They arrive through `files` like every other resource, so
    // no adapter reaches a disk.
    datasignFiles: request.datasignFiles ?? [],
    datasignMap: request.datasignMap ?? {},
});


const stringifyOptionsOf = (given = {}) => ({
    canonical: given.canonical === 'true',
    readable: (given.readable ?? 'true') === 'true',
    indentation: Number(given.indentation ?? '4'),
    leaflinks: given.leaflinks === 'true',
    leaflinkLevel: Number(given.leaflinkLevel ?? '1'),
    leaflinkShortening: (given.leaflinkShortening ?? 'true') === 'true',
    generatedHeader: given.generatedHeader === 'true',
    generatedComments: given.generatedComments === 'true',
});


const run = (request) => {
    const deon = new Deon();
    const options = optionsOf(request);
    const { op, source } = request;

    if (op === 'entities') {
        return JSON.stringify(
            deon.entities(source, options.sourceName).map(entity => ({
                name: entity.name,
                parameters: entity.parameters,
                kind: entity.kind,
            })),
        );
    }

    if (op === 'lint') {
        return JSON.stringify(
            deon.lint(source, options.sourceName).map(diagnostic => ({
                code: diagnostic.code,
                line: String(diagnostic.range.start.line),
                column: String(diagnostic.range.start.column),
            })),
        );
    }

    const value = deon.parseSynchronous(source, options);

    if (op === 'canonical') {
        return deon.canonical(value);
    }

    if (op === 'stringify') {
        return deon.stringify(value, stringifyOptionsOf(request.stringifyOptions));
    }

    if (op === 'typed') {
        return JSON.stringify(typer(value));
    }

    if (op === 'datasign') {
        // `parseSynchronous` has already applied the contracts.
        return JSON.stringify(value);
    }

    throw new Error(`unknown operation '${op}'`);
};


const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of lines) {
    if (!line.trim()) {
        continue;
    }

    const request = JSON.parse(line);

    let answer;

    try {
        answer = { id: request.id, ok: 'true', result: run(request) };
    } catch (failure) {
        const diagnostic = failure?.diagnostics?.[0];

        answer = diagnostic
            ? {
                id: request.id,
                ok: 'false',
                code: failure.code,
                line: String(diagnostic.range.start.line),
                column: String(diagnostic.range.start.column),
            }
            : {
                id: request.id,
                ok: 'false',
                code: `HOST_${failure?.constructor?.name ?? 'Error'}`,
                line: '0',
                column: '0',
            };
    }

    process.stdout.write(JSON.stringify(answer) + '\n');
}
