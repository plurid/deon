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
describe.only(suites.simple, () => {
    it('pure empty map - new lines', async () => {
        const dataValues = `
{
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(Object.keys(data).length).toEqual(0);

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.simple} - pure empty map - new lines`,
        );
    });



    it('pure empty list - new lines', async () => {
        const dataValues = `
[

]
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);

        expect(data.length).toEqual(0);

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.simple} - pure empty list - new lines`,
        );
    });



    it('pure empty map - same line', async () => {
        const dataValues = `
{}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(Object.keys(data).length).toEqual(0);

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.simple} - pure empty map - same line`,
        );
    });



    it('pure empty list - same line', async () => {
        const dataValues = `
[]
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.length).toEqual(0);

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.simple} - pure empty list - same line`,
        );
    });



    it('empty key', async () => {
        const dataValues = `
{
    key
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.key).toEqual('');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.simple} - empty key`,
        );
    });



    it('empty - with leaflinks', async () => {
        const dataValues = `
{}

key value

map {
    key value
}

list [
    one
    two
]
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(Object.keys(data).length).toEqual(0);

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.simple} - empty - with leaflinks`,
        );
    });



    it('simple key value', async () => {
        const dataValues = `
{
    key value
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.key).toEqual('value');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.simple} - simple key value`,
        );
    });



    it('simple key value spaced', async () => {
        const dataValues = `
{
    key value1 value2
}
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
            `${suites.simple} - simple key value spaced`,
        );
    });



    it('simple key value string', async () => {
        const dataValues = `
{
    key 'value1 value2'
}
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
            `${suites.simple} - simple key value string`,
        );
    });



    it('simple key value escaped', async () => {
        const dataValues = `
{
    key 'valu\\'e'
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.key).toEqual('valu\\\'e');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.simple} - simple key value escaped`,
        );
    });



    it('simple key value escaped multiline', async () => {
        const dataValues = `
{
    key \`
    valu\\'e
    \`
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.key).toEqual('valu\\\'e');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.simple} - simple key value escaped multiline`,
        );
    });



    it('simple key value spaced words', async () => {
        const dataValues = `
{
    key value with spaces in name
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.key).toEqual('value with spaces in name');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.simple} - simple key value spaced words`,
        );
    });



    it('simple key value special characters', async () => {
        const dataValues = `
{
    key 'value with 4 trailing spaces    '
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.key).toEqual('value with 4 trailing spaces    ');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.simple} - simple key value special characters`,
        );
    });



    it('simple key value multi-string', async () => {
        const dataValues = `
{
    key \`
a
   multi-line
value
\`
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.key.split('\n').length).toEqual(3);

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.simple} - simple key value multi-string`,
        );
    });



    it('simple map as key', async () => {
        const dataValues = `
{
    map {
        key value
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


        expect(data.map.key).toEqual('value');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.simple} - simple map as key`,
        );
    });



    it('simple map as key - multiple values, comma separated', async () => {
        const dataValues = `
{
    map {
        key1 value1, key2 value2
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


        expect(data.map.key1).toEqual('value1');
        expect(data.map.key2).toEqual('value2');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.simple} - simple map as key - multiple values, comma separated`,
        );
    });



    it('simple list - as root', async () => {
        const dataValues = `
[
    one
    two
]
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data[0]).toEqual('one');
        expect(data[1]).toEqual('two');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.simple} - simple list - as root`,
        );
    });


    it('simple list - new lines', async () => {
        const dataValues = `
{
    list [
        one
        two
    ]
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.list[0]).toEqual('one');
        expect(data.list[1]).toEqual('two');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.simple} - simple list - new lines`,
        );
    });



    it('simple list - comma separated', async () => {
        const dataValues = `
{
    list [
        one, two
    ]
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.list[0]).toEqual('one');
        expect(data.list[1]).toEqual('two');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.simple} - simple list - comma separated`,
        );
    });



    it('simple list - spaced words', async () => {
        const dataValues = `
{
    list [
        one two three
        four five six
        seven
    ]
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.list.length).toEqual(3);
        expect(data.list[0]).toEqual('one two three');
        expect(data.list[1]).toEqual('four five six');
        expect(data.list[2]).toEqual('seven');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.simple} - simple list - spaced words`,
        );
    });



    it('multiple values - key-value, map, list', async () => {
        const dataValues = `
{
    key value
    map {
        one two
        three four
    }
    list [
        one
        two
    ]
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.key).toEqual('value');
        expect(data.map.one).toEqual('two');
        expect(data.map.three).toEqual('four');
        expect(data.list[0]).toEqual('one');
        expect(data.list[1]).toEqual('two');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.simple} - multiple values - key-value, map, list`,
        );
    });



    it('simple comments', async () => {
        const dataValues = `
// comment outside root
{
    // comment inside root
    key value // comment inline
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.key).toEqual('value');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            'simple',
        );
    });



    it('simple comments - multi-line', async () => {
        const dataValues = `
/*
    multi
    line
    comment outside root
*/
{
    /*
        multi
        line
        comment inside root
    */
    key value /*
        multi
        line
        comment starting inline
    */
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(data.key).toEqual('value');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            'simple',
        );
    });
});
// #endregion module
