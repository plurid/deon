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
describe(suites.testings, () => {
    it('various', async () => {
        const dataValues = `
{
    a [
        0
        -1
        12b
        1.2
    ]
    c {
        d 12
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
        // console.log('typer', typer(data));


        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.examples} - various`,
        );
    });



    it('various', async () => {
        const dataValues = `
{
    a b!c
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.examples} - various`,
        );
    });



    it('various', async () => {
        const dataValues = `
{
    b c d
    #a
    #f
}

a b c df g
f ' aa '
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        compareTimeBenchmark(
            start,
            end,
            'fast',
            `${suites.examples} - initial`,
        );
    });



    it('various', async () => {
        const data = {
            a: [
                {
                    b: {
                        c: [
                            {
                                d: [
                                    {
                                        e: {
                                            f: {
                                            }
                                        }
                                    }
                                ]
                            }
                        ]
                    },
                },
            ],
        }

        const deon = new Deon();
        const stringified = deon.stringify(data);
        // log(stringified);
    });



    it('various', async () => {
        const dataValues = `
[
    {
        a [
        ]
        b {}
    }
]
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // log(data);
        // console.log('typer', typer(data));
    });



    it('various', async () => {
        const dataValues = `
{
    key
}
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // log(data);
    });



    it('various', async () => {
        const dataValues = `
// {
//     key value

//     // key #map
//     // key #list

//     // buggy
//     // 'root key 4' root Value 4
// }

// map {
//     key1 value1
// }

// list [
//     one
//     two
// ]

// key value

// nestedMap {
//     key {
//         one two
//     }
// }

// nestedList [
//     one
//     two
//     {
//         one two
//     }
//     [
//         one
//         two
//     ]
// ]



{
    key #linkedList
}

two three

linkedList [
    #listItem1
    #listItem2
]

listItem1 #one
listItem2 [
    #two
]

one #two



// {
//     #one
// }

// one #two

// two three
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // log(data);
    });



    it('deep nesting', async () => {
        const dataValues = `
{
    key value
    map {
        one two
        two two
        three four
        five {
            seven eight
            six {
                seven eight
                nine [
                    six
                    seven
                ]
            }
            nine eight
        }
    }
    list [
        one
        two
        {
            two [
                three
                four
            ]
        }
    ]
}

one {
    two three
    four {
        five six
    }
}

list [
    one
    two
    {
        three [
            four five
            six
        ]
    }
]
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // log(data);
    });



    it('linkings', async () => {
        const dataValues = `
// {
//     one {
//         two {
//             // three #key
//             // three #'key with spaces'

//             // #key
//             // #'key with spaces'

//             // ...#key
//             // ...#'key with spaces'

//             // three #key.one
//             // three #'key with spaces'.one
//             // #'key with spaces'.one
//             // #key.one

//             // three #key[one]
//             // three #'key with spaces'[one]
//             // #'key with spaces'[one]
//             // #key[one]
//         }
//         // three [
//         //     #key
//         //     ...#list
//         // ]
//         four #list[0]
//         // five {
//         //     ...#spread
//         // }
//         // six [
//         //     ...#spread
//         // ]
//     }
// }


{
    ...#map[entities]
}

map {
    entities {
        one two
        three four
    }
}


// {
//     ...#map.entities
// }

// map {
//     entities {
//         one two
//         three four
//     }
// }


// key {
//     one two
//     three four
// }

// 'key with spaces' {
//     one two
//     three four
//     five six
// }

// list [
//     one
//     two
// ]

// spread abc
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // log(data);
    });
});
// #endregion module
