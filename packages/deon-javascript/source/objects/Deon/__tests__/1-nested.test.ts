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
describe(suites.nested, () => {
    it('simple nest - map level 3', async () => {
        const dataValues = `
{
    map1 {
        map2 {
            map3 {
                key value
            }
        }
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


        expect(data.map1.map2.map3.key).toEqual('value');

        compareTimeBenchmark(
            start,
            end,
            'fast',
            `${suites.nested} - simple nest - map level 3`,
        );
    });



    it('simple nest - map level 7', async () => {
        const dataValues = `
{
    map1 {
        map2 {
            map3 {
                map4 {
                    map5 {
                        map6 {
                            map7 {
                                key value
                            }
                        }
                    }
                }
            }
        }
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


        expect(data.map1.map2.map3.map4.map5.map6.map7.key).toEqual('value');

        compareTimeBenchmark(
            start,
            end,
            'fast',
            `${suites.nested} - simple nest - map level 7`,
        );
    });



    it('simple nest - map level 14', async () => {
        const dataValues = `
{
    map1 {
        map2 {
            map3 {
                map4 {
                    map5 {
                        map6 {
                            map7 {
                                map8 {
                                    map9 {
                                        map10 {
                                            map11 {
                                                map12 {
                                                    map13 {
                                                        map14 {
                                                            key value
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
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


        expect(data.map1.map2.map3.map4.map5.map6.map7.map8.map9.map10.map11.map12.map13.map14.key).toEqual('value');

        compareTimeBenchmark(
            start,
            end,
            'fast',
            `${suites.nested} - simple nest - map level 14`,
        );
    });



    it('simple nest - list level 3', async () => {
        const dataValues = `
{
    list1 [
        {
            list2 [
                {
                    list3 [
                        itemOne
                    ]
                }
            ]
        }
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


        expect(data.list1[0].list2[0].list3[0]).toEqual('itemOne');

        compareTimeBenchmark(
            start,
            end,
            'fast',
            `${suites.nested} - simple nest - list level 3`,
        );
    });



    it('simple nest - list level 3 with children', async () => {
        const dataValues = `
{
    map1 {
        map2 {
            list [
                {
                    one {
                        two [
                            three
                            four
                        ]
                    }
                }
                two
                three
            ]
        }
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


        expect(data.map1.map2.list[0].one.two[0]).toEqual('three');
        expect(data.map1.map2.list[0].one.two[1]).toEqual('four');
        expect(data.map1.map2.list[1]).toEqual('two');
        expect(data.map1.map2.list[2]).toEqual('three');

        compareTimeBenchmark(
            start,
            end,
            'fast',
            `${suites.nested} - simple nest - list level 3 with children`,
        );
    });
});
// #endregion module
