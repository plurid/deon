// #region imports
    // #region external
    import Deon from '../';

    import {
        log,
    } from '../../../utilities/log';

    import {
        typer,
    } from '../../../utilities/typer';

    import {
        compareTimeBenchmark,
        suites,
    } from '../../../utilities/test';
    // #endregion external
// #endregion imports



// #region module
describe(suites.leaflinks, () => {
    it('simple - named map', async () => {
        const dataValues = `
{
    key #arbitraryName
}

arbitraryName aValue
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.key).toEqual('aValue');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.leaflinks} - simple - named map`,
        );
    });



    it('simple - shortened map', async () => {
        const dataValues = `
{
    #key
}

key aValue
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.key).toEqual('aValue');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.leaflinks} - simple - shortened map`,
        );
    });



    it('simple - shortened key spaced', async () => {
        const dataValues = `
{
    #key
}

key value1 value2
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.key).toEqual('value1 value2');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.leaflinks} - simple - shortened key spaced`,
        );
    });



    it('simple - shortened key string', async () => {
        const dataValues = `
{
    #key
}

key 'value1 value2'
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.key).toEqual('value1 value2');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.leaflinks} - simple - shortened key string`,
        );
    });



    it('nested - shortened map', async () => {
        const dataValues = `
{
    aKey {
        anotherKey {
            #key
        }
    }
}

key aValue
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.aKey.anotherKey.key).toEqual('aValue');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.leaflinks} - nested - shortened map`,
        );
    });



    it('simple - chained strings', async () => {
        const dataValues = `
{
    #one
}

one #two

two three
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.one).toEqual('three');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.leaflinks} - simple - chained strings`,
        );
    });



    it('simple - named list', async () => {
        const dataValues = `
[
    #arbitraryName
]

arbitraryName aValue
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data[0]).toEqual('aValue');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.leaflinks} - simple - named list`,
        );
    });



    it('simple - shortened map dot-access', async () => {
        const dataValues = `
{
    #keys.name
}

keys {
    name aValue
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.name).toEqual('aValue');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.leaflinks} - simple - shortened map dot-access`,
        );
    });



    it('simple - shortened map name-access', async () => {
        const dataValues = `
{
    #keys[name]
}

keys {
    name aValue
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.name).toEqual('aValue');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.leaflinks} - simple - shortened map name-access`,
        );
    });



    it('simple - list name-access', async () => {
        const dataValues = `
[
    #list[0]
    #list[1]
]

list [
    aValue
    anotherValue
]
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data[0]).toEqual('aValue');
        expect(data[1]).toEqual('anotherValue');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.leaflinks} - simple - list name-access`,
        );
    });



    it('simple - leaflink dot-access', async () => {
        const dataValues = `
{
    #one
}

one #two.three

two {
    three four
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.one).toEqual('four');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.leaflinks} - simple - leaflink dot-access`,
        );
    });



    it('simple - leaflink name-access', async () => {
        const dataValues = `
{
    #one
}

one #two[three]

two {
    three four
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.one).toEqual('four');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.leaflinks} - simple - leaflink name-access`,
        );
    });



    it('simple - map spread', async () => {
        const dataValues = `
{
    ...#map
}

map {
    one two
    three four
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.one).toEqual('two');
        expect(data.three).toEqual('four');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.leaflinks} - simple - map spread`,
        );
    });



    it('simple - list spread', async () => {
        const dataValues = `
[
    ...#list
]

list [
    one two
    three four
]
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.length).toEqual(2);
        expect(data[0]).toEqual('one two');
        expect(data[1]).toEqual('three four');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.leaflinks} - simple - list spread`,
        );
    });



    it('simple - map spread dot-accessed', async () => {
        const dataValues = `
{
    ...#map.entities
}

map {
    entities {
        one two
        three four
    }
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.one).toEqual('two');
        expect(data.three).toEqual('four');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.leaflinks} - simple - map spread dot-accessed`,
        );
    });



    it('simple - map spread name-accessed', async () => {
        const dataValues = `
{
    ...#map[entities]
}

map {
    entities {
        one two
        three four
    }
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.one).toEqual('two');
        expect(data.three).toEqual('four');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.leaflinks} - simple - map spread name-accessed`,
        );
    });



    it('simple - string spread in map', async () => {
        const dataValues = `
{
    entity {
        ...#spread
    }
}

spread abc
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.entity['0']).toEqual('a');
        expect(data.entity['1']).toEqual('b');
        expect(data.entity['2']).toEqual('c');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.leaflinks} - simple - string spread in map`,
        );
    });



    it('simple - string spread in list', async () => {
        const dataValues = `
{
    entity [
        ...#spread
    ]
}

spread abc
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.entity[0]).toEqual('a');
        expect(data.entity[1]).toEqual('b');
        expect(data.entity[2]).toEqual('c');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.leaflinks} - simple - string spread in list`,
        );
    });



    it('simple - environment variables', async () => {
        process.env.ENV_ONE = 'aValue';
        process.env.ENV_TWO = 'anotherValue';
        process.env.ENV_THREE = 'threeValue';

        const dataValues = `
{
    key #$ENV_ONE
    #envTwo
    #$ENV_THREE
}

envTwo #$ENV_TWO
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.key).toEqual('aValue');
        expect(data.envTwo).toEqual('anotherValue');
        expect(data.ENV_THREE).toEqual('threeValue');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.leaflinks} - simple - environment variables`,
        );
    });



    it('complex - nested leaflinks', async () => {
        const dataValues = `
{
    key #one
}

one #two

two three

four {
    five {
        six [
            #two
        ]
    }
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        // expect(data.key).toEqual('three');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.leaflinks} - complex - nested leaflinks`,
        );
    });
});
// #endregion module
