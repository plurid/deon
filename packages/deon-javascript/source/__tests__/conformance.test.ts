// #region imports
    // #region libraries
    import assert from 'node:assert/strict';

    import {
        readFileSync,
    } from 'node:fs';

    import path from 'node:path';
    // #endregion libraries


    // #region external
    import Deon from '../objects/Deon';

    import {
        DeonError,
    } from '../objects/Diagnostic';

    import {
        typer,
    } from '../utilities/typer';

    import type {
        PartialDeonParseOptions,
        PartialDeonStringifyOptions,
    } from '../data/interfaces';
    // #endregion external
// #endregion imports



// #region module
/**
 * The normative conformance suite. An implementation conforms to Deon 1.0 only when it passes every
 * required fixture in `spec/conformance/cases.json` (specification 15).
 *
 * The fixtures are language-neutral and shared by every implementation, so they are read from the
 * repository rather than copied out into this port, where they could drift away from it. A case
 * that needs a resource is given the manifest's virtual files, so nothing here touches a network.
 */


interface ConformanceCase {
    id: string;
    required?: boolean;

    /**
     * An optional feature this fixture belongs to (specification 14.1 marks datasign optional). A
     * fixture tagged with a feature runs only where the feature is supported, and is filtered out
     * everywhere else — so an implementation that omits it skips these fixtures rather than failing
     * them.
     */
    feature?: string;

    source?: string;
    file?: string;
    files?: Record<string, string>;
    environment?: Record<string, string>;
    options?: PartialDeonParseOptions;
    expected?: unknown;
    error?: string;

    /**
     * Conformance requires the position of a diagnostic, and not only its code (specification 15),
     * so a fixture may say where the error is: one-based line and column.
     */
    position?: {
        line: number;
        column: number;
    };

    canonical?: string;

    /**
     * The value is stringified with these options, and must come back as `expected`.
     */
    stringify?: {
        options?: PartialDeonStringifyOptions;
        expected: string;
    };

    /**
     * The conservative typer of section 14, applied to the evaluated root.
     */
    typed?: unknown;

    lint?: string[];

    /**
     * A datasign fixture (specification 14.1): the contract files and the root-key map to apply, and
     * the typed value the document must become. Errors reuse `error` and `position`.
     */
    datasign?: {
        files: string[];
        map: Record<string, string>;
        typed?: unknown;
    };
}

const casesFile = path.resolve(__dirname, '../../../../spec/conformance/cases.json');
const allCases = (JSON.parse(readFileSync(casesFile, 'utf8')) as { cases: ConformanceCase[] }).cases;

//: The optional features this implementation offers.
const SUPPORTED_FEATURES = new Set(['datasign']);

const cases = allCases.filter(
    testCase => !testCase.feature || SUPPORTED_FEATURES.has(testCase.feature),
);


const optionsFor = (
    testCase: ConformanceCase,
) => {
    const options: PartialDeonParseOptions = {};

    // Any `files` are served from the manifest, with the host denied — a datasign contract lives
    // here too, so it is loaded whether or not the document itself is served from a file.
    if (testCase.files) {
        options.resources = testCase.files;
        options.allowFilesystem = false;
        options.allowNetwork = false;
    }

    if (testCase.file) {
        options.sourceName = testCase.file;
        options.filebase = path.posix.dirname(testCase.file);
    }

    if (testCase.datasign) {
        options.datasignFiles = testCase.datasign.files;
        options.datasignMap = testCase.datasign.map;
    }

    if (testCase.environment) {
        options.environment = testCase.environment;
    }

    return {
        ...options,
        ...testCase.options,
    };
}


const sourceFor = (
    testCase: ConformanceCase,
) => (testCase.file
    ? (testCase.files as Record<string, string>)[testCase.file]
    : testCase.source as string);


describe('Deon conformance', () => {
    assert.ok(cases.length > 0, 'the conformance manifest is empty');

    for (const testCase of cases) {
        it(testCase.id, () => {
            const deon = new Deon();
            const source = sourceFor(testCase);
            const options = optionsFor(testCase);

            if (testCase.error) {
                let thrown: unknown;

                try {
                    deon.parseSynchronous(source, options);
                } catch (error) {
                    thrown = error;
                }

                assert.ok(
                    thrown instanceof DeonError,
                    `expected ${testCase.error}, but the document evaluated successfully`,
                );

                const error = thrown as DeonError;
                expect(error.code).toEqual(testCase.error);

                if (testCase.position) {
                    const { start } = error.diagnostics[0].range;

                    assert.deepStrictEqual(
                        { line: start.line, column: start.column },
                        testCase.position,
                        `${testCase.error} reported at ${start.line}:${start.column}`,
                    );
                }

                return;
            }

            if (testCase.datasign) {
                // `parseSynchronous` applies the contract when a datasign map is set (specification
                // 14.1), so the value it returns is already typed.
                expect(
                    deon.parseSynchronous(source, options),
                ).toEqual(testCase.datasign.typed);
            }

            if (testCase.canonical) {
                expect(deon.canonical(source)).toEqual(testCase.canonical);
            }

            if (testCase.stringify) {
                const value = deon.parseSynchronous(source, options);

                expect(
                    deon.stringify(value, testCase.stringify.options),
                ).toEqual(testCase.stringify.expected);
            }

            if (testCase.typed !== undefined) {
                expect(
                    typer(deon.parseSynchronous(source, options)),
                ).toEqual(testCase.typed);
            }

            if (testCase.expected !== undefined) {
                expect(deon.parseSynchronous(source, options)).toEqual(testCase.expected);
            }

            if (testCase.lint) {
                const codes = deon.lint(source).map(diagnostic => diagnostic.code as string);

                for (const expected of testCase.lint) {
                    assert.ok(
                        codes.includes(expected),
                        `expected lint ${expected}, got [${codes.join(', ') || 'none'}]`,
                    );
                }
            }

            // A fixture that asserts nothing would pass no matter what the implementation did.
            assert.ok(
                testCase.canonical !== undefined
                    || testCase.stringify !== undefined
                    || testCase.typed !== undefined
                    || testCase.expected !== undefined
                    || testCase.lint !== undefined
                    || testCase.datasign !== undefined,
                `the fixture '${testCase.id}' asserts nothing`,
            );
        });
    }
});
// #endregion module
