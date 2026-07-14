// A test runner, rather than a dependency on one. Deon ships nothing at runtime, and the suite is
// small enough that the whole of it fits here: `describe`, `it`, and an `expect` carrying the two
// assertions the tests actually make.
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';


const tests = [];
const suites = [];


globalThis.describe = (name, body) => {
    suites.push(name);

    try {
        body();
    } finally {
        suites.pop();
    }
};

globalThis.it = (name, body) => tests.push({
    name: [...suites, name].join(' > '),
    body,
    skipped: false,
});

globalThis.xit = (name, body) => tests.push({
    name: [...suites, name].join(' > '),
    body,
    skipped: true,
});

globalThis.expect = (actual) => ({
    toBeTruthy: () => assert.ok(actual),
    toEqual: (expected) => assert.deepStrictEqual(actual, expected),
});


const findTests = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });

    const found = await Promise.all(entries.map((entry) => {
        const target = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            return findTests(target);
        }

        return entry.name.endsWith('.test.js') ? [target] : [];
    }));

    return found.flat();
};


// Importing a test file is what registers its tests.
for (const file of await findTests(path.resolve('.test-build'))) {
    await import(pathToFileURL(file).href);
}


let passed = 0;
let failures = 0;
let skipped = 0;

for (const test of tests) {
    if (test.skipped) {
        skipped += 1;
        console.log(`- SKIP ${test.name}`);
        continue;
    }

    try {
        await test.body();
        passed += 1;
        console.log(`✓ ${test.name}`);
    } catch (error) {
        failures += 1;
        console.error(`✗ ${test.name}`);
        console.error(error);
    }
}

console.log(`\n${passed} passed, ${failures} failed, ${skipped} skipped`);

if (failures) {
    process.exitCode = 1;
}
