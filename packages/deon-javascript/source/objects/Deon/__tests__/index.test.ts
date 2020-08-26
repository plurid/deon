// #region imports
import Deon from '../';
// #endregion imports



// #region module
describe('Deon', () => {
    it('works', () => {
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

        Deon.parse(
            dataImport,
            // dataEmpty,
            // dataSimple,
            // dataComplex,
        );
    });
});


describe('Deon imports', () => {
    it('works', () => {
        const dataImport = `
import deonFile from ./deonPath

{
    field #deonFile.field
    import import
    ...#deonFile
}

import deonFile2 from ./deonPath2

        `;

        Deon.parse(
            dataImport,
        );
    });
});


describe.only('Deon values', () => {
    it('works', () => {
        const dataValues = `
{
    key value
}
        `;

        Deon.parse(
            dataValues,
        );
    });
});
// #endregion module
