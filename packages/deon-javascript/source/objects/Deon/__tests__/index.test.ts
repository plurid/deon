// #region imports
import Deon from '../';
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


describe.only('Deon values', () => {
//     it('simple key value', async () => {
//         const dataValues = `
// key value
//         `;

        // const deon = new Deon();
//         const data = await deon.parse(
//             dataValues,
//         );

//         expect(data.key).toEqual('value');
//     });

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

    it('complex root map', async () => {
        const dataValues = `
{
    key1 value1
    key2 {
        aa bb
        cc dd
    }
    key3 value3
    key4 value4
    one [
        two four five six
        three seven
        two
        'nine ten    '
    ]
    // key5 value5
    // key6 value6
    // key7 value7
    // key8 value8
    // key9 value9
    // key3 {
    //     one two
    // //     three four
    //     three {
    //         four five six seven
    //         nine [
    //             foo
    //             boo too coo
    //         ]
    // //     //     eight {
    // //     //         nine foo
    // //     //         ten {
    // //     //             asd fff
    // //     //             hhh jjj
    // //     //             zz nm
    // //     //         }
    // //     //     }
    //     }
    // }
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        console.log('data', data);
        console.log('time', end - start);

        // expect(data.key).toEqual('value');
    });

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
// #endregion module
