// #region imports
    // #region external
    import Deon from '../';
    // #endregion external
// #endregion imports



// #region module
/**
 * An entity's parameters are exactly the interpolation names it carries (specification 11). That is a
 * rule of the language, so it is asserted here rather than left to whatever asks the question — an
 * editor, or a prompt server, which must not answer it a second time and drift.
 */
const library = `import base from ./base.deon

review \`Review this #{language} code, focusing on #{focus}:

#{code}\`

plain a value with no interpolation

envy \`Uses #{$HOME}, which is the environment, and #{real}, which is not.\`

nested {
    a \`one #{alpha}\`
    b [\`two #{beta}\`, \`three #{alpha}\`]
}

tabled <id, note> [
    1, \`note #{gamma}\`
]

{
    review Review code for quality and bugs
}
`;


describe('Deon entities', () => {
    it('reports the arguments an entity would demand', () => {
        const deon = new Deon();
        const entities = deon.entities(library);

        const named = (
            name: string,
        ) => entities.find(entity => entity.name === name);

        // In the order they are written, so a prompt's arguments do not shuffle between runs.
        expect(named('review')?.parameters).toEqual(['language', 'focus', 'code']);
        expect(named('review')?.kind).toEqual('scalar');

        // An entity with no interpolation takes no arguments: it is a value, not a template.
        expect(named('plain')?.parameters).toEqual([]);

        // An environment name is read from the environment rather than passed in, so it is not a
        // parameter. This is the one a naive `#{...}` scan gets wrong.
        expect(named('envy')?.parameters).toEqual(['real']);

        // The walk goes through maps, lists, and structures, and a name carried twice is one
        // parameter.
        expect(named('nested')?.parameters).toEqual(['alpha', 'beta']);
        expect(named('nested')?.kind).toEqual('map');
        expect(named('tabled')?.parameters).toEqual(['gamma']);
        expect(named('tabled')?.kind).toEqual('structure');

        // A resource shares the one declaration namespace, so leaving it out would make the list a
        // lie about which names are taken.
        expect(named('base')?.kind).toEqual('resource');
        expect(named('base')?.parameters).toEqual([]);
    });


    it('needs no capabilities, because it reads rather than runs', () => {
        const deon = new Deon();
        const source = 'import secret from https://example.invalid/x.deon\n\n'
            + 'greet `Hi #{name}`\n\n{\n    a b\n}\n';

        // Evaluating this document would refuse it outright: it may not reach the network.
        let denied = false;

        try {
            deon.parseSynchronous(source);
        } catch (error) {
            denied = (error as { code?: string }).code === 'DEON_CAPABILITY_DENIED';
        }

        expect(denied).toBeTruthy();

        // Reading what it declares does not need to reach anything at all.
        const entities = deon.entities(source);

        expect(entities.length).toEqual(2);
        expect(entities[0].name).toEqual('secret');
        expect(entities[1].parameters).toEqual(['name']);
    });


    /**
     * The parameter set is what an entity call is checked against, so the inventory and the evaluator
     * have to agree: an argument the inventory did not name is an error, and one it named and did not
     * receive is an error too.
     */
    it('names exactly the arguments a call must be given', () => {
        const deon = new Deon();
        const source = 'greet `Hello #{name}, you are #{role}.`\n\n{\n    a b\n}\n';

        const parameters = deon.entities(source)[0].parameters;

        expect(parameters).toEqual(['name', 'role']);

        const call = (
            args: string,
        ) => {
            try {
                return deon.parseSynchronous(
                    `greet \`Hello #{name}, you are #{role}.\`\n\n{\n    out #greet(${args})\n}\n`,
                );
            } catch (error) {
                return (error as { code?: string }).code;
            }
        };

        // Exactly the named arguments: accepted.
        expect(call('name Ada, role a pioneer')).toEqual({ out: 'Hello Ada, you are a pioneer.' });

        // One missing, and one that was never a parameter: refused.
        expect(call('name Ada')).toEqual('DEON_ENTITY_ARGUMENT');
        expect(call('name Ada, role a pioneer, extra x')).toEqual('DEON_ENTITY_ARGUMENT');
    });
});
// #endregion module
