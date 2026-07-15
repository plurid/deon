// #region imports
    // #region external
    import Deon from '../';

    import {
        DeonError,
        DiagnosticCode,
    } from '../../Diagnostic';

    import {
        typer,
    } from '../../../utilities/typer';
    // #endregion external
// #endregion imports



// #region module
/**
 * A value handed to the writers is data, and data can come from somewhere that does not wish the
 * reader well. Built deep enough by hand, it would drive the recursion in the stringifier and the
 * typer past the host stack and back out as a `RangeError` — an error with no code and no position.
 *
 * The writers now refuse it first, on the same limit and with the same code the parser uses, so a
 * caller who can act on `DEON_PARSE_EXPECTED` from the parser can act on it here too.
 */
const nestedMaps = (
    depth: number,
): any => {
    let value: any = {};

    for (let level = 0; level < depth; level += 1) {
        value = { k: value };
    }

    return value;
};


const nestedArrays = (
    depth: number,
): any => {
    let value: any = [];

    for (let level = 0; level < depth; level += 1) {
        value = [value];
    }

    return value;
};


const codeOf = (
    act: () => unknown,
) => {
    try {
        act();
    } catch (error) {
        if (error instanceof DeonError) {
            return error.code;
        }

        // A `RangeError` is the bug this exists to catch, so returning its name makes the failure read
        // plainly rather than as an undefined mismatch.
        return (error as Error).name;
    }

    return undefined;
};


describe('writers nesting depth', () => {
    it('refuses a hand-built value that nests too deeply, rather than dying on it', () => {
        const deon = new Deon();

        for (const build of [nestedMaps, nestedArrays]) {
            const value = build(200);

            expect(codeOf(() => deon.stringify(value))).toEqual(DiagnosticCode.PARSE_EXPECTED);
            expect(codeOf(() => deon.canonical(value))).toEqual(DiagnosticCode.PARSE_EXPECTED);
            expect(codeOf(() => typer(value))).toEqual(DiagnosticCode.PARSE_EXPECTED);
        }
    });


    it('still writes an ordinarily shallow value', () => {
        const deon = new Deon();
        const value = { a: ['1', '2', { b: 'c' }] };

        // No throw is success: `codeOf` returns the caught error's code or name, and `undefined` only
        // when the call returned.
        expect(codeOf(() => deon.stringify(value))).toEqual(undefined);
        expect(codeOf(() => deon.canonical(value))).toEqual(undefined);
        expect(typer({ a: '1', b: ['2', 'true'] })).toEqual({ a: 1, b: [2, true] });
    });
});
// #endregion module
