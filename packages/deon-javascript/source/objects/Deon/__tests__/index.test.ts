// #region imports
import Deon from '../';
// #endregion imports



// #region module
describe('Deon', () => {
    it('works', () => {
        const dataSimple = `
{
    name data
}
        `;

        const dataComplex = `
{
    mapKey {
        mapList [
            listItem1, listItem2
        ]
        stringValue value
        longLink #arbitraryLink
        #shortLink
        'long name' A name with multiple Spaces
    }
}

arbitraryLink data

shortLink [
    linkValue
]
        `;

        Deon.parse(
            dataComplex,
        );
    });
});
// #endregion module
