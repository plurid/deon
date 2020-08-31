// #region imports
    // #region external
    import Deon from '../';

    import {
        log,
    } from '../../../utilities/log';
    // #endregion external
// #endregion imports



// #region module
describe('Deon simple', () => {
    it('pure empty - new lines', async () => {
        const dataValues = `
{
}
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // console.log(data);

        expect(Object.keys(data).length).toEqual(0);
    });



    it('pure empty - same line', async () => {
        const dataValues = `
{}
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // console.log(data);

        expect(Object.keys(data).length).toEqual(0);
    });

    it('empty - with leaflinks', async () => {
        const dataValues = `
{}

key value
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // console.log(data);

        expect(Object.keys(data).length).toEqual(0);
    });



    it('simple key value', async () => {
        const dataValues = `
{
    key value
}
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // console.log(data);

        expect(data.key).toEqual('value');
    });



    it('simple map', async () => {
        const dataValues = `
{
    map {
        key value
    }
}
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // console.log(data);

        expect(data.map.key).toEqual('value');
    });



    it('simple map - multiple values, comma separated', async () => {
        const dataValues = `
{
    map {
        key1 value1, key2 value2
    }
}
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // console.log(data);

        expect(data.map.key1).toEqual('value1');
        expect(data.map.key2).toEqual('value2');
    });



    it('simple list - as root', async () => {
        const dataValues = `
[
    one
    two
]
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // console.log(data);

        expect(data[0]).toEqual('one');
        expect(data[1]).toEqual('two');
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

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // console.log(data);

        expect(data.list[0]).toEqual('one');
        expect(data.list[1]).toEqual('two');
    });



    it('simple list - comma separated', async () => {
        const dataValues = `
{
    list [
        one, two
    ]
}
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // console.log(data);

        expect(data.list[0]).toEqual('one');
        expect(data.list[1]).toEqual('two');
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

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // console.log(data);

        expect(data.key).toEqual('value');
        expect(data.map.one).toEqual('two');
        expect(data.map.three).toEqual('four');
        expect(data.list[0]).toEqual('one');
        expect(data.list[1]).toEqual('two');
    });
});


describe('Deon nested', () => {
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

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // console.log(data);

        expect(data.map1.map2.map3.key).toEqual('value');
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

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // console.log(data);

        expect(data.map1.map2.map3.map4.map5.map6.map7.key).toEqual('value');
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

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // console.log(data);

        expect(data.map1.map2.map3.map4.map5.map6.map7.map8.map9.map10.map11.map12.map13.map14.key).toEqual('value');
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

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // console.log(data);

        expect(data.list1[0].list2[0].list3[0]).toEqual('itemOne');
    });



    it('simple nest - list level 3', async () => {
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

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        log(data);

    });
});


describe('Deon lealinks', () => {
    it('simple - named map', async () => {
        const dataValues = `
{
    key #arbitraryName
}

arbitraryName aValue
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // log(data);

        expect(data.key).toEqual('aValue');
    });



    it('simple - shortened map', async () => {
        const dataValues = `
{
    #key
}

key aValue
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // log(data);

        expect(data.key).toEqual('aValue');
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

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // log(data);

        expect(data.aKey.anotherKey.key).toEqual('aValue');
    });



    it('simple - named list', async () => {
        const dataValues = `
[
    #arbitraryName
]

arbitraryName aValue
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // log(data);

        expect(data[0]).toEqual('aValue');
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

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // log(data);

        expect(data.name).toEqual('aValue');
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

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // log(data);

        expect(data.name).toEqual('aValue');
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

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // log(data);

        expect(data[0]).toEqual('aValue');
        expect(data[1]).toEqual('anotherValue');
    });
});


describe('Deon imports', () => {
    it('simple import', async () => {
        const dataValues = `
import keyValue from https://raw.githubusercontent.com/plurid/deon/master/packages/deon-javascript/tests/simple/key-value.deon

{
    key #keyValue.aKey
}
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );

        expect(data.key).toEqual('aValue');
    });
});


describe('Deon testings', () => {
    it('simple', async () => {
        const dataValues = `
{
    rootKey1 rootValue2
    rootKey2 root Value 2
    rootKey3 {
        key value
    }
    rootKey4 'root Value 4'
    rootKey5 [
        one
        two three

        // buggy
        // {
        //     four five
        // }
    ]

    // buggy
    // 'root key 4' root Value 4
}

map {
    key1 value1
}
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        log(data);

        // expect(data.map1.map2.map3.key).toEqual('value');
    });
})
// #endregion module
