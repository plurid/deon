// #region imports
    // #region external
    import Deon from '../';

    import {
        DeonError,
        DiagnosticCode,
    } from '../../Diagnostic';

    import {
        compareTimeBenchmark,
        suites,
    } from '../../../utilities/test';
    // #endregion external
// #endregion imports



// #region module
// Specification 11: evaluation returns the root or a structured error carrying every diagnostic it
// could collect. Malformed input is a diagnostic, not an empty map — before 1.0 these three
// documents all parsed "successfully" into `{}`, which is how a broken file reached production as
// an empty configuration.
const parseError = async (data: string) => {
    const deon = new Deon();

    try {
        await deon.parse(data);
    } catch (error) {
        return error;
    }

    return undefined;
}


describe(suites.errors, () => {
    it('no root line', async () => {
        // A valid leaflink with no root map or list: the fault is the missing root, not the
        // declaration. A bare `a` with no value is instead `DEON_PARSE_EXPECTED` (§4, deon.ebnf).
        const dataValues = `a 1`;

        const start = Date.now();
        const error = await parseError(dataValues);
        const end = Date.now();


        expect(error instanceof DeonError).toBeTruthy();
        expect((error as DeonError).code).toEqual(DiagnosticCode.PARSE_ROOT);

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.errors} - no root line`,
        );
    });



    it('no root', async () => {
        const dataValues = `
a 1
        `;

        const start = Date.now();
        const error = await parseError(dataValues);
        const end = Date.now();


        expect(error instanceof DeonError).toBeTruthy();
        expect((error as DeonError).code).toEqual(DiagnosticCode.PARSE_ROOT);

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.errors} - no root`,
        );
    });



    it('no closing bracket', async () => {
        const dataValues = `
{
    key value
        `;

        const start = Date.now();
        const error = await parseError(dataValues);
        const end = Date.now();


        expect(error instanceof DeonError).toBeTruthy();
        expect((error as DeonError).code).toEqual(DiagnosticCode.PARSE_EXPECTED);

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.errors} - no closing bracket`,
        );
    });



    it('diagnostics carry a code, a source, and a position', async () => {
        const error = await parseError(`{ #missing }`) as DeonError;

        expect(error instanceof DeonError).toBeTruthy();
        expect(error.code).toEqual(DiagnosticCode.UNRESOLVED_LINK);
        expect(error.diagnostics.length).toEqual(1);

        const [diagnostic] = error.diagnostics;
        expect(diagnostic.severity).toEqual('error');
        expect(diagnostic.source).toEqual('<memory>');
        expect(diagnostic.range.start.line).toEqual(1);
    });



    // spec/diagnostics.md: a position is one-based Unicode *code-point* line/column. An astral
    // character (above the Basic Multilingual Plane) is a single code point, though JavaScript
    // stores it as a two-code-unit surrogate pair, so a diagnostic reported after it must not drift
    // by one per astral character. Every other implementation places the `#y` in `{ a 😀 #y }` at
    // column 7; before the code-point fix, the JavaScript port said 8.
    it('reports a diagnostic column in code points, not UTF-16 units, after an astral character', () => {
        const deon = new Deon();

        const columnOf = (source: string) => {
            try {
                deon.parseSynchronous(source);
            } catch (error) {
                if (error instanceof DeonError) {
                    return {
                        code: error.code,
                        column: error.diagnostics[0].range.start.column,
                    };
                }
            }

            return undefined;
        };

        // `{`1 ` `2 `a`3 ` `4 `😀`5 ` `6 `#`7 — the link is the seventh code point, not the eighth.
        const parseExpected = columnOf('{ a 😀 #y }');
        expect(parseExpected?.code).toEqual(DiagnosticCode.PARSE_EXPECTED);
        expect(parseExpected?.column).toEqual(7);
        expect(parseExpected?.column).toEqual([...'{ a 😀 '].length + 1);

        // An unterminated-string diagnostic lands the same way. A `'` after interior whitespace is
        // literal (4.3), so the unterminated string is one that *opens* a value; the astral key here
        // carries the `😀`, leaving the value's opening quote the seventh code point, not the eighth.
        const unterminated = columnOf("{ '😀' 'oops }");
        expect(unterminated?.code).toEqual(DiagnosticCode.LEX_UNTERMINATED);
        expect(unterminated?.column).toEqual(7);
        expect(unterminated?.column).toEqual([..."{ '😀' "].length + 1);
    });



    it('places a duplicate-key lint in code points after an astral value', () => {
        const deon = new Deon();

        const duplicate = deon.lint('{ k 😀, k two }').find(
            diagnostic => diagnostic.code === DiagnosticCode.LINT_DUPLICATE_KEY,
        );

        expect(duplicate !== undefined).toBeTruthy();
        // `{`1 ` `2 `k`3 ` `4 `😀`5 `,`6 ` `7 `k`8 — the repeated key is the eighth code point.
        expect(duplicate?.range.start.column).toEqual(8);
        expect(duplicate?.range.start.column).toEqual([...'{ k 😀, '].length + 1);
    });
});
// #endregion module
