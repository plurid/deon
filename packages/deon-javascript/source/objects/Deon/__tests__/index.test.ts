// #region imports
    // #region external
    import Deon from '../';

    import {
        log,
    } from '../../../utilities/log';
    // #endregion external
// #endregion imports



// #region module
describe('Deon', () => {
    it('works', async () => {
        const dataImport = `
import deonFile from ./deonPath
        `;


        const dataEmpty = `
{
    c [
        20 44
        30
    ]
    c {
        20 30
    }
    c 20 30
}
        `;

        const dataIdentify2 = `
{
    a b c d
    'one two' three four
    e fg h
}

a { a b, c d, e f}
        `;

        const dataIdentify = `
{
    one two three four
    five six seven
    eight nine
}
        `;

//         const dataSimple = `
// {
//     simpleKey simpleValue
// }

// link {
//     aaa bbb
// }
//         `;

        const dataComplex = `
{
    mapKey {
        // root comment
        mapList [
            listItem1, listItem2
            listItem 3
        ]
        stringValue value // inline comment
        longLink #arbitraryLink
        #shortLink
        'long name' A name with multiple Spaces
        multiLine \`
        example
of multiline
value
        \`
    }
}

/*
    multiline
    comment
*/

arbitraryLink data

shortLink [
    linkValue
]
        `;

        const expectedDataSimple = {
            name: 'data',
        };

        const expectedDataComplex = {
            mapKey: {
                mapList: [
                    'listItem1',
                    'listItem2',
                ],
                strinValue: 'value',
                longLink: 'data',
                shortLink: [
                    'linkValue',
                ],
                'long name': 'A name with multiple Spaces',
            },
        };

        const deon = new Deon();
        const data = await deon.parse(
            dataImport,
            // dataEmpty,
            // dataSimple,
            // dataComplex,
        );
    });
});


describe('Deon imports', () => {
    it('works', async () => {
        const dataImport = `
import deonFile from ./deonPath

{
    field #deonFile.field
    import import
    ...#deonFile
}

import deonFile2 from ./deonPath2

        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataImport,
        );
    });
});


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



//     it('multiple key value', async () => {
//         const dataValues = `
// key1 value one
// key2 value two
//         `;

        // const deon = new Deon();
//         const data = await deon.parse(
//             dataValues,
//         );

//         expect(data.key1).toEqual('value one');
//         expect(data.key2).toEqual('value two');
//     });

//     it('simple root map', async () => {
//         const dataValues = `
// import keyValue from https://raw.githubusercontent.com/plurid/deon/master/packages/deon-javascript/tests/simple/key-value.deon

// {
//     key value
// }

// one two
// three four
//         `;

//         const deon = new Deon();
//         const data = await deon.parse(
//             dataValues,
//         );

//         expect(data.key).toEqual('value');
//     });

//     it('complex root map', async () => {
//         const dataValues = `
// {
//     key1 value1
//     key2 {
//         aa bb
//         cc dd
//     }
//     key3 value3
//     key4 value4
//     one [
//         two four five six
//         three seven
//         two
//         'nine ten    '
//     ]
//     // key5 value5
//     // key6 value6
//     // key7 value7
//     // key8 value8
//     // key9 value9
//     // key3 {
//     //     one two
//     // //     three four
//     //     three {
//     //         four five six seven
//     //         nine [
//     //             foo
//     //             boo too coo
//     //         ]
//     // //     //     eight {
//     // //     //         nine foo
//     // //     //         ten {
//     // //     //             asd fff
//     // //     //             hhh jjj
//     // //     //             zz nm
//     // //     //         }
//     // //     //     }
//     //     }
//     // }
// }
//         `;

//         const start = Date.now();
//         const deon = new Deon();
//         const data = await deon.parse(
//             dataValues,
//         );
//         const end = Date.now();
//         console.log('data', data);
//         console.log('time', end - start);

//         // expect(data.key).toEqual('value');
//     });

//     it('simple root list', async () => {
//         const dataValues = `
// [
//     value
// ]
//         `;

        // const deon = new Deon();
//         const data = await deon.parse(
//             dataValues,
//         );

//         expect(data.key).toEqual('value');
//     });
});


describe.only('Deon nested', () => {
    xit('simple nest - map level 3', async () => {
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
        console.log(data);

        expect(data.map1.map2.map3.key).toEqual('value');
    });



    xit('simple nest - map level 7', async () => {
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



    xit('simple nest - map level 14', async () => {
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



    xit('simple nest - list level 3', async () => {
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
        console.log(data);

        expect(data.list1[0].list2[0].list3[0]).toEqual('itemOne');
    });



    it('simple nest - list level 3', async () => {
        const dataValues = `
// [
//     a
//     b
//     c
// ]

aMap {
    key value
}

aList [
    one
    two
]

// {
//     map1 {
//         map2 {
//             list [
//                 {
//                     one {
//                         two [
//                             three
//                             four
//                         ]
//                     }
//                 }
//                 two
//                 three
//             ]
//         }
//     }
// }
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        log(data);

    });
});
// #endregion module
