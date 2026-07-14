// #region imports
    // #region external
    import Deon from '../';

    import {
        DeonError,
        DiagnosticCode,
    } from '../../Diagnostic';
    // #endregion external
// #endregion imports



// #region module
/**
 * A document is data, and data can come from somewhere that does not wish the reader well.
 *
 * The parser recurses on how deeply a document nests, so without a limit a hostile document exhausts
 * the stack, and what comes back is a host `RangeError` — an error with no code, no position, and
 * nothing a caller can do about it. Past the limit, the parser now stops and raises an ordinary
 * `deon` diagnostic, which says what happened and where.
 *
 * The limit is the same one the `Rust` implementation keeps, so a document is either read by both or
 * refused by both.
 */
const nested = (
    depth: number,
) => '{ a ' + '['.repeat(depth) + ']'.repeat(depth) + ' }';


const parseError = (data: string) => {
    const deon = new Deon();

    try {
        deon.parseSynchronous(data);
    } catch (error) {
        return error;
    }

    return undefined;
}


describe('nesting depth', () => {
    it('reads a document that merely nests', () => {
        // The limit is far past anything a person would write, so an ordinarily deep document is read.
        // `nested(64)` is a list inside a list, sixty-four deep, with nothing at the bottom of it.
        let expected: unknown = [];

        for (let depth = 1; depth < 64; depth++) {
            expected = [expected];
        }

        const deon = new Deon();

        expect(deon.parseSynchronous(nested(64))).toEqual({ a: expected });
    });


    it('refuses a document that nests too deeply, rather than dying on it', () => {
        const error = parseError(nested(5000));

        // A `RangeError` is the bug this exists to catch, so it is not enough that something threw.
        expect(error instanceof DeonError).toBeTruthy();
        expect((error as DeonError).code).toEqual(DiagnosticCode.PARSE_EXPECTED);
        expect(
            (error as DeonError).message.includes('nests more deeply'),
        ).toBeTruthy();
    });


    /**
     * And it says where. The source opens with `{ a ` — four characters — and the guard trips on the
     * value which would sit one past the limit, so it points at the 129th `[`.
     */
    it('says where it stopped', () => {
        const error = parseError(nested(200));
        const diagnostic = (error as DeonError).diagnostics[0];

        expect(diagnostic.range.start.line).toEqual(1);
        expect(diagnostic.range.start.column).toEqual(4 + 128 + 1);
    });
});
// #endregion module
