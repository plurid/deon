// #region imports
    // #region external
    import Deon from '../';

    import {
        log,
    } from '../../../utilities/log';
    // #endregion external
// #endregion imports



// #region module
const timeBenchmark = {
    instant: 0,
    fast: 10,
};

const timeTolerance = 5;

const compareTimeBenchmark = (
    start: number,
    end: number,
    kind: 'instant' | 'fast',
    id: string,
) => {
    const duration = end - start;
    const benchmark = timeBenchmark[kind] ?? timeBenchmark.instant;
    const maximum = benchmark + timeTolerance;

    if (duration > maximum) {
        log(`Execution time of '${id}' exceeded: (${duration} ms instead of ${maximum} ms).`);
    }
}

const suites = {
    simple: 'Deon simple',
    nested: 'Deon nested',
    leaflinks: 'Deon leaflinks',
    imports: 'Deon imports',
    stringify: 'Deon stringify',
    examples: 'Deon examples',
    testings: 'Deon testings',
};


describe(suites.simple, () => {
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
});


describe(suites.imports, () => {
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


describe(suites.stringify, () => {
    it('simple stringify', async () => {
        const dataValues = {
            key: 'value',
        };

        const deon = new Deon();
        const dataStringified = deon.stringify(dataValues);
        const data = await deon.parse(dataStringified);
        // log(data);

        expect(data.key).toEqual('value');
    });
});


describe(suites.examples, () => {
    it('initial', async () => {
        const dataValues = `
{
    entities [
        {
            id 01
            name One
            active true
        }
        {
            id 02
            name Two
            active false
        }
    ]
    #time
}

time 1598439736
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // log(data);

        expect(Object.keys(data).length).toEqual(2);
        expect(data.time).toEqual('1598439736');
        expect(data.entities.length).toEqual(2);
        expect(data.entities[0].id).toEqual('01');
        expect(data.entities[0].name).toEqual('One');
        expect(data.entities[0].active).toEqual('true');
        expect(data.entities[1].id).toEqual('02');
    });


    it('performer', async () => {
        const dataValues = `
// a .deon file
{
    stages [
        {
            name Setup NPM Private Access
            directory /path/to/package
            imagene ubuntu
            command [
                /bin/bash
                ./configurations/.npmrc.sh
            ]
            secretsEnvironment [
                NPM_TOKEN
            ]
        }
        {
            name Generate the Imagene
            directory /path/to/package
            imagene docker
            command [
                build
                -f
                ./configurations/docker.development.dockerfile
                -t
                hypod.cloud/package-name:$SHORT_SHA
                .
            ]
        }
        {
            name Push Imagene to Registry
            directory /path/to/package
            imagene docker
            command [
                push
                hypod.cloud/package-name:$SHORT_SHA
            ]
        }
    ]
    timeout 720
}
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // log(data);

        expect(Object.keys(data).length).toEqual(2);
        expect(data.timeout).toEqual('720');
        expect(data.stages.length).toEqual(3);
        expect(data.stages[1].command[3]).toEqual('-t');
    });


    it('linked performer', async () => {
        const dataValues = `
// a .deon file

// the root
{
    stages [
        #stage1
        #stage2
        #stage3
    ]
    timeout 720
}


// the leaflinks
stage1 {
    name Setup NPM Private Access
    #directory
    imagene ubuntu
    command #stage1Command
    #secretsEnvironment
}

stage2 {
    name Generate the Imagene
    #directory
    imagene docker
    command #stage2Command
}

stage3 {
    name Push Imagene to Registry
    #directory
    imagene docker
    command #stage3Command
}

directory /path/to/package

stage1Command [
    /bin/bash
    ./configurations/.npmrc.sh
]

stage2Command [
    build
    -f
    ./configurations/docker.development.dockerfile
    -t
    #imageneName
    .
]

stage3Command [
    push
    #imageneName
]

secretsEnvironment [
    NPM_TOKEN
]

imageneName hypod.cloud/package-name:$SHORT_SHA
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // log(data);

        expect(Object.keys(data).length).toEqual(2);
        expect(data.timeout).toEqual('720');
        expect(data.stages.length).toEqual(3);
        expect(data.stages[1].command[3]).toEqual('-t');
    });
});


describe.only(suites.testings, () => {
    xit('various', async () => {
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
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        // log(data);
    });



    xit('deep nesting', async () => {
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
{
    one {
        two {
            // three #key
            // three #'key with spaces'

            #key
            // #'key with spaces'

            // ...#key
            // ...#'key with spaces'

            // three #key.one
            // three #'key with spaces'.one
            // #'key with spaces'.one
            // #key.one

            // three #key[one]
            // three #'key with spaces'[one]
            // #'key with spaces'[one]
            // #key[one]
        }
        // three [
        //     // #key
        //     // ...#list
        // ]
        // four #list[0]
        // five {
        //     ...#spread
        // }
        // six [
        //     ...#spread
        // ]
    }
}

key {
    one two
    three four
}

'key with spaces' {
    one two
    three four
    five six
}

list [
    one
    two
]

spread abc
        `;

        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        log(data);
    });
});
// #endregion module
