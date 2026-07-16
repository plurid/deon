const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');


// Requiring the script does NOT run `main()` — it is guarded by
// `require.main === module` — so importing it here is side-effect free and does
// not attempt to resolve the global `@plurid/deon`.
const {
    run,
    applyManifest,
} = require(path.join(__dirname, '..', 'source', 'kubectl-deonly-source-node.js'));


/**
 * A stand-in for the `@plurid/deon` module. It mirrors the exact shape the
 * script depends on:
 *   - `Deon.default`   -> a class whose instances expose `parseFile(file)`
 *   - `Deon.typer`     -> a function applied to the parsed data
 *
 * `parseFile` reads the file and `JSON.parse`s it, so a malformed fixture throws
 * just like a real parse failure would.
 */
const makeFakeDeon = () => ({
    default: class FakeDeon {
        async parseFile(file) {
            const content = fs.readFileSync(file, 'utf8');
            return JSON.parse(content);
        }
    },
    typer: (data) => data,
});


const mkTmp = (t, prefix) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
};

const silentLogger = () => {
    const messages = { log: [], error: [] };
    return {
        logger: {
            log: (m) => messages.log.push(String(m)),
            error: (m) => messages.error.push(String(m)),
        },
        messages,
    };
};


test('manifest with single quotes / shell metacharacters is passed verbatim to kubectl on stdin (no shell)', async (t) => {
    const dir = mkTmp(t, 'kubectl-deonly-inject-');

    // A fake `kubectl` placed early on PATH. It records its argv and the exact
    // bytes it received on stdin, then exits 0 — no real cluster involved.
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(binDir);
    const fakeKubectl = path.join(binDir, 'kubectl');
    fs.writeFileSync(
        fakeKubectl,
        [
            '#!/bin/sh',
            'printf "%s\\n" "$@" > "$KUBECTL_ARGS_FILE"',
            'cat > "$KUBECTL_STDIN_FILE"',
            '',
        ].join('\n'),
    );
    fs.chmodSync(fakeKubectl, 0o755);

    const argsFile = path.join(dir, 'args.txt');
    const stdinFile = path.join(dir, 'stdin.txt');

    // A manifest whose values are packed with characters that would break out of
    // — or be mangled by — a `echo '...' | kubectl` shell pipeline.
    const manifestObject = {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: "evil'; rm -rf / #" },
        data: {
            inject: '$(whoami)',
            backtick: '`id`',
            pipe: 'a | b & c > d',
            quote: "it's a 'quoted' value",
            newline: 'line1\nline2',
        },
    };
    const fixture = path.join(dir, 'payload.deon');
    fs.writeFileSync(fixture, JSON.stringify(manifestObject));

    // The script renders via JSON.stringify(typer(parseFile(...))). With our fake
    // Deon that is JSON.stringify(JSON.parse(fileContents)).
    const expected = JSON.stringify(JSON.parse(fs.readFileSync(fixture, 'utf8')));

    const savedPath = process.env.PATH;
    process.env.PATH = binDir + path.delimiter + savedPath;
    process.env.KUBECTL_ARGS_FILE = argsFile;
    process.env.KUBECTL_STDIN_FILE = stdinFile;
    t.after(() => {
        process.env.PATH = savedPath;
        delete process.env.KUBECTL_ARGS_FILE;
        delete process.env.KUBECTL_STDIN_FILE;
    });

    // NOTE: `apply` is NOT injected here — we exercise the real `applyManifest`
    // (execFileSync) so this test genuinely guards against a regression back to a
    // shell pipeline.
    const code = await run({ files: [fixture], Deon: makeFakeDeon() });
    assert.equal(code, 0, 'a valid manifest should apply and exit 0');

    const capturedStdin = fs.readFileSync(stdinFile, 'utf8');
    assert.equal(
        capturedStdin,
        expected,
        'kubectl must receive the manifest byte-for-byte on stdin',
    );
    // Belt-and-braces: the dangerous substrings survived intact. A shell pipeline
    // would have truncated at the first `'` or executed the injected commands.
    assert.ok(capturedStdin.includes("evil'; rm -rf / #"));
    assert.ok(capturedStdin.includes('$(whoami)'));
    assert.ok(capturedStdin.includes('`id`'));
    assert.ok(capturedStdin.includes('a | b & c > d'));

    const capturedArgs = fs
        .readFileSync(argsFile, 'utf8')
        .split('\n')
        .filter(Boolean);
    assert.deepEqual(
        capturedArgs,
        ['apply', '-f', '-'],
        'kubectl must be invoked as `kubectl apply -f -`',
    );
});


test('one unparseable .deon file aborts with a non-zero exit and applies nothing (no partial apply)', async (t) => {
    const dir = mkTmp(t, 'kubectl-deonly-failclosed-');

    fs.writeFileSync(
        path.join(dir, 'good.deon'),
        JSON.stringify({ kind: 'Pod', metadata: { name: 'ok' } }),
    );
    // Malformed contents -> fake Deon's JSON.parse throws, exactly like a real
    // parse failure.
    fs.writeFileSync(
        path.join(dir, 'bad.deon'),
        '{ this is : not valid deon/json',
    );

    const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.deon'))
        .map((f) => path.join(dir, f))
        .sort();

    let applyCalls = 0;
    const apply = () => { applyCalls += 1; };
    const { logger, messages } = silentLogger();

    const code = await run({ files, Deon: makeFakeDeon(), apply, logger });

    assert.equal(code, 1, 'exit code must be non-zero when any file fails to parse');
    assert.equal(
        applyCalls,
        0,
        'no manifest may be applied when any file fails to parse (no partial apply)',
    );
    assert.ok(
        messages.error.some((m) => m.includes('bad.deon')),
        'the failing file must be reported on stderr',
    );
});


test('all valid files are each applied and the run exits 0', async (t) => {
    const dir = mkTmp(t, 'kubectl-deonly-ok-');

    const a = { kind: 'ConfigMap', metadata: { name: 'a' } };
    const b = { kind: 'ConfigMap', metadata: { name: 'b' } };
    fs.writeFileSync(path.join(dir, 'a.deon'), JSON.stringify(a));
    fs.writeFileSync(path.join(dir, 'b.deon'), JSON.stringify(b));
    const files = [path.join(dir, 'a.deon'), path.join(dir, 'b.deon')];

    const applied = [];
    const apply = (data) => applied.push(data);
    const { logger } = silentLogger();

    const code = await run({ files, Deon: makeFakeDeon(), apply, logger });

    assert.equal(code, 0);
    assert.deepEqual(
        applied,
        [JSON.stringify(a), JSON.stringify(b)],
        'each manifest is applied once, in order, rendered as JSON',
    );
});


test('no files specified is a graceful no-op that exits 0 and applies nothing', async () => {
    let applyCalls = 0;
    const apply = () => { applyCalls += 1; };
    const { logger } = silentLogger();

    const code = await run({ files: [], Deon: makeFakeDeon(), apply, logger });

    assert.equal(code, 0);
    assert.equal(applyCalls, 0);
});


test('applyManifest is exported and is the real execFileSync-based seam', () => {
    // Guards the module contract the tests and the plugin rely on.
    assert.equal(typeof applyManifest, 'function');
    assert.equal(typeof run, 'function');
});
