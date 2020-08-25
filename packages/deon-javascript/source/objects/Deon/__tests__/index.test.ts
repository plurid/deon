// #region imports
import Deon from '../';
// #endregion imports



// #region module
describe('Deon', () => {
    it('works', () => {
        const dataSimple = `
{
    simpleKey simpleValue
}
        `;

        const dataComplex = `
{
    mapKey {
        // root comment
        mapList [
            listItem1, listItem2
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
            // dataSimple,
            dataComplex,
        );
    });
});
// #endregion module
