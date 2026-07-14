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
        const dataValues = `a`;

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
a
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
});
// #endregion module
