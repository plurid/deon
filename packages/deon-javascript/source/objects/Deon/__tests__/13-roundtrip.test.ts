// #region imports
    // #region external
    import Deon from '../';

    import {
        suites,
    } from '../../../utilities/test';
    // #endregion external
// #endregion imports



// #region module
// Specification 13: for every value `v`, `parse(canonical(v))` must equal `v`.
//
// The values that made this false were the ones carrying whitespace at their boundaries: a backtick
// string trims what sits outside its first and last non-whitespace character, so `alpha\n` came back
// as `alpha`. Every text file ends in a newline, which is why `confile` silently truncated each file
// it packaged. The line-break escapes are what close that hole.
const values: [string, any][] = [
    ['a plain map', { key: 'value' }],
    ['a trailing newline', { file: 'alpha\n' }],
    ['leading and trailing whitespace', { x: '  indented\n  block  ' }],
    ['a laid-out multiline value', { key: 'a\nmulti\nline\nvalue' }],
    ['an interior tab beside a newline', { t: 'a\tb\nc' }],
    ['tabs at the boundaries', { t: '\tcolumn\t' }],
    ['a carriage return', { r: 'a\r\nb' }],
    ['a lone carriage return', { r: 'a\rb' }],
    ['a backslash-n written as text', { s: 'a\\nb' }],
    ['quotes and backticks', { q: 'a \'foo\' ` b' }],
    ['a literal interpolation opener', { i: 'hash #{x} brace' }],
    ['a key holding a newline', { 'a\nb': 'value' }],
    ['an empty string and the word null', { e: '', n: 'null' }],
    ['a nested map and list', { a: { b: ['x\n', ' y '] } }],
    ['a list root', ['one', 'two words', 'three\n']],
    ['a value that looks like a link', { k: '#notALink' }],
    ['a value that looks like a spread', { k: '...#notASpread' }],
    ['a value that looks like a comment', { k: '// not a comment' }],
];


describe(suites.stringify, () => {
    for (const [label, value] of values) {
        it(`round-trips ${label}`, () => {
            const deon = new Deon();

            expect(deon.parseSynchronous(deon.stringify(value))).toEqual(value);
            expect(deon.parseSynchronous(deon.canonical(value))).toEqual(value);
        });
    }


    it('canonical output is idempotent', () => {
        const deon = new Deon();

        for (const [, value] of values) {
            const canonical = deon.canonical(value);
            expect(deon.canonical(deon.parseSynchronous(canonical))).toEqual(canonical);
        }
    });


    it('canonical output ends with exactly one newline', () => {
        const deon = new Deon();

        for (const [, value] of values) {
            const canonical = deon.canonical(value);
            expect(canonical.endsWith('\n') && !canonical.endsWith('\n\n')).toBeTruthy();
        }
    });


    // `readable: false` was declared in the options and in the README, and never read.
    it('readable: false emits one line, and reads back', () => {
        const deon = new Deon();
        const value = { a: 'b', c: ['d', 'e'], f: { g: 'h' } };
        const compact = deon.stringify(value, { readable: false });

        expect(compact).toEqual('{a b, c [d, e], f {g h}}\n');
        expect(deon.parseSynchronous(compact)).toEqual(value);
    });


    it('readable: false still round-trips awkward values', () => {
        const deon = new Deon();
        const value = { file: 'alpha\n', list: ['a, b', 'c'] };

        expect(deon.parseSynchronous(deon.stringify(value, { readable: false }))).toEqual(value);
    });
});
// #endregion module
