// #region imports
    // #region libraries
    import path from 'node:path';
    // #endregion libraries


    // #region external
    import Deon from '../';

    import {
        DeonError,
        DiagnosticCode,
    } from '../../Diagnostic';

    import {
        parseDatasign,
    } from '../../../utilities/datasign';

    import {
        suites,
    } from '../../../utilities/test';
    // #endregion external
// #endregion imports



// #region module
// Deon values are only strings, lists, and maps. A datasign contract supplies the intent a value
// cannot carry on its own: looking at `007` will never say whether it is an identifier or a count.
const entityDatasign = `
// ./Entity.datasign
data Entity {
    name: string;
    age: number;
}
`;

const entityDeon = `
// ./entity.deon
{
    entities [
        {
            name Entity One
            age 1
        }
        {
            name Entity Two
            age 1.3
        }
    ]
}
`;

// The datasign files resolve on the filesystem, so they are injected here instead — the same
// hermetic resolver the resource tests use.
const injected = (source: string, file = 'Entity.datasign') => ({
    datasignFiles: [file],
    datasignMap: {
        entities: 'Entity[]',
    },
    resources: {
        [file]: source,
    },
});


describe(suites.datasign, () => {
    it('reads the datasign contract', () => {
        expect(parseDatasign(entityDatasign)).toEqual({
            Entity: [
                { name: 'name', type: 'string', required: true },
                { name: 'age', type: 'number', required: true },
            ],
        });
    });


    it('types the parsed data through datasignMap', async () => {
        const deon = new Deon();
        const data = await deon.parse(entityDeon, injected(entityDatasign));

        expect(data).toEqual({
            entities: [
                { name: 'Entity One', age: 1 },
                { name: 'Entity Two', age: 1.3 },
            ],
        });
    });


    it('types synchronously as well', () => {
        const deon = new Deon();
        const data = deon.parseSynchronous(entityDeon, injected(entityDatasign));

        expect(data).toEqual({
            entities: [
                { name: 'Entity One', age: 1 },
                { name: 'Entity Two', age: 1.3 },
            ],
        });
    });


    // The README's worked example, run against the real files rather than a paraphrase of them.
    it('parseFile resolves datasignFiles beside the deon file', async () => {
        const deon = new Deon();
        const deonFile = path.join(__dirname, '../../../../tests/datasign/entity.deon');

        const data = await deon.parseFile(deonFile, {
            datasignFiles: ['./Entity.datasign'],
            datasignMap: {
                entities: 'Entity[]',
            },
        });

        expect(data).toEqual({
            entities: [
                { name: 'Entity One', age: 1 },
                { name: 'Entity Two', age: 1.3 },
            ],
        });
    });


    // The whole point: the contract knows what the value cannot say. The heuristic typer turns
    // `1.0` into the number 1 and `true` into a boolean; a declaration keeps them strings.
    it('a declaration beats a guess', () => {
        const deon = new Deon();
        const contract = `data Release {
            version: string;
            answer: string;
            id: number;
        }`;

        const data = deon.parseSynchronous(`{ release { version 1.0, answer true, id 007 } }`, {
            datasignFiles: ['c.datasign'],
            datasignMap: { release: 'Release' },
            resources: { 'c.datasign': contract },
        });

        expect(data).toEqual({
            release: { version: '1.0', answer: 'true', id: 7 },
        });
    });


    it('optional fields may be absent, unknown keys pass through', () => {
        const deon = new Deon();
        const contract = `data Entity {
            name: string;
            nickname?: string;
        }`;

        const data = deon.parseSynchronous(`{ entity { name One, extra kept } }`, {
            datasignFiles: ['c.datasign'],
            datasignMap: { entity: 'Entity' },
            resources: { 'c.datasign': contract },
        });

        expect(data).toEqual({
            entity: { name: 'One', extra: 'kept' },
        });
    });


    it('a value that contradicts its contract is an error', () => {
        const deon = new Deon();
        const contract = 'data Entity {\n    age: number;\n}';

        let thrown: unknown;
        try {
            deon.parseSynchronous(`{ entity { age old } }`, {
                datasignFiles: ['c.datasign'],
                datasignMap: { entity: 'Entity' },
                resources: { 'c.datasign': contract },
            });
        } catch (error) {
            thrown = error;
        }

        expect(thrown instanceof DeonError).toBeTruthy();
        expect((thrown as DeonError).code).toEqual(DiagnosticCode.TYPE_MISMATCH);
    });


    it('a missing required field is an error', () => {
        const deon = new Deon();
        const contract = 'data Entity {\n    name: string;\n    age: number;\n}';

        let thrown: unknown;
        try {
            deon.parseSynchronous(`{ entity { name One } }`, {
                datasignFiles: ['c.datasign'],
                datasignMap: { entity: 'Entity' },
                resources: { 'c.datasign': contract },
            });
        } catch (error) {
            thrown = error;
        }

        expect(thrown instanceof DeonError).toBeTruthy();
        expect((thrown as DeonError).code).toEqual(DiagnosticCode.TYPE_MISMATCH);
    });


    // Reading a datasign file is filesystem access, and a raw-text parser grants none.
    it('reading a datasign file needs the filesystem capability', () => {
        const deon = new Deon();

        let thrown: unknown;
        try {
            deon.parseSynchronous(`{ entity { name One } }`, {
                datasignFiles: ['./Entity.datasign'],
                datasignMap: { entity: 'Entity' },
            });
        } catch (error) {
            thrown = error;
        }

        expect(thrown instanceof DeonError).toBeTruthy();
        expect((thrown as DeonError).code).toEqual(DiagnosticCode.CAPABILITY_DENIED);
    });


    it('no datasignMap leaves the data as strings', async () => {
        const deon = new Deon();
        const data = await deon.parse(entityDeon);

        expect(data).toEqual({
            entities: [
                { name: 'Entity One', age: '1' },
                { name: 'Entity Two', age: '1.3' },
            ],
        });
    });
});
// #endregion module
