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
describe(suites.stringify, () => {
    it('simple stringify', async () => {
        const dataValues = {
            key: 'value',
        };

        const start = Date.now();
        const deon = new Deon();
        const dataStringified = deon.stringify(dataValues);
        const end = Date.now();
        // log(dataStringified);
        const data = await deon.parse(dataStringified);
        // log(data);


        expect(data.key).toEqual('value');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.stringify} - simple stringify`,
        );
    });



    it('simple stringify - nested map', async () => {
        const dataValues = {
            one: {
                two: 'three',
            },
        };

        const start = Date.now();
        const deon = new Deon();
        const dataStringified = deon.stringify(dataValues);
        const end = Date.now();
        // log(dataStringified);
        const data = await deon.parse(dataStringified);
        // log(data);


        expect(data.one.two).toEqual('three');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.stringify} - simple stringify - nested map`,
        );
    });



    it('simple stringify - nested list', async () => {
        const dataValues = [
            [
                [
                    'one',
                    'two',
                ],
            ],
        ];

        const start = Date.now();
        const deon = new Deon();
        const dataStringified = deon.stringify(dataValues);
        const end = Date.now();
        // log(dataStringified);
        const data = await deon.parse(dataStringified);
        // log(data);


        expect(data[0][0][0]).toEqual('one');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.stringify} - simple stringify - nested list`,
        );
    });



    it('simple stringify - nested list map', async () => {
        const dataValues = [
            {
                key: [],
            },
        ];

        const start = Date.now();
        const deon = new Deon();
        const dataStringified = deon.stringify(dataValues);
        const end = Date.now();
        // log(dataStringified);
        const data = await deon.parse(dataStringified);
        // log(data);


        expect(data[0].key).toEqual([]);

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.stringify} - simple stringify - nested list map`,
        );
    });



    it('simple stringify - null and undefined', async () => {
        const dataValues = {
            one: null,
            two: undefined,
        };

        const start = Date.now();
        const deon = new Deon();
        const dataStringified = deon.stringify(dataValues);
        const end = Date.now();
        // log(dataStringified);
        const data = await deon.parse(dataStringified);
        // log(data);


        expect(data.one).toEqual('');
        expect(data.two).toEqual('');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.stringify} - simple stringify - null and undefined`,
        );
    });



    it('simple stringify - boolean', async () => {
        const dataValues = {
            one: true,
            two: false,
        };

        const start = Date.now();
        const deon = new Deon();
        const dataStringified = deon.stringify(dataValues);
        const end = Date.now();
        // log(dataStringified);
        const data = await deon.parse(dataStringified);
        // log(data);


        expect(data.one).toEqual('true');
        expect(data.two).toEqual('false');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.stringify} - simple stringify - boolean`,
        );
    });



    it('simple stringify - number', async () => {
        const dataValues = {
            one: 1,
            two: 2,
        };

        const start = Date.now();
        const deon = new Deon();
        const dataStringified = deon.stringify(dataValues);
        const end = Date.now();
        // log(dataStringified);
        const data = await deon.parse(dataStringified);
        // log(data);

        expect(data.one).toEqual('1');
        expect(data.two).toEqual('2');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.stringify} - simple stringify - number`,
        );
    });



    it('simple stringify - levels', async () => {
        const dataValues = {
            one: {
                two: {
                    three: {
                        four: {
                            five: {
                                key: 'value',
                            },
                        },
                    },
                },
            },
        };

        const start = Date.now();
        const deon = new Deon();
        const dataStringified = deon.stringify(dataValues);
        const end = Date.now();
        // log(dataStringified);
        const data = await deon.parse(dataStringified);
        // log(data);

        expect(data.one.two.three.four.five.key).toEqual('value');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.stringify} - simple stringify - levels`,
        );
    });



    it('simple stringify - list', async () => {
        const dataValues = [
            {
                one: {
                    two: {
                        three: {
                            four: {
                                five: {
                                    key: 'value',
                                },
                            },
                        },
                    },
                },
            },
            {
                one: {
                    two: {
                        three: {
                            four: {
                                five: {
                                    key: 'value',
                                },
                            },
                        },
                    },
                },
            },
        ];

        const start = Date.now();
        const deon = new Deon();
        const dataStringified = deon.stringify(dataValues);
        const end = Date.now();
        // log(dataStringified);
        const data = await deon.parse(dataStringified);
        // log(data);

        expect(data[0].one.two.three.four.five.key).toEqual('value');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.stringify} - simple stringify - list`,
        );
    });


    it('simple stringify - list multiple items', async () => {
        const dataValues = [
            {
                one: 'two'
            },
            {
                three: 'four',
            },
            {
                five: 'six',
            },
            {
                seven: 'eight',
            },
        ];

        const start = Date.now();
        const deon = new Deon();
        const dataStringified = deon.stringify(dataValues);
        const end = Date.now();
        // log(dataStringified);
        const data = await deon.parse(dataStringified);
        // log(data);

        expect(data[0].one).toEqual('two');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.stringify} - simple stringify - list multiple items`,
        );
    });
});
// #endregion module
