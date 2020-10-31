// #region imports
    // #region external
    import {
        deon,
    } from '../';
    // #endregion external
// #endregion imports



// #region module
describe('template literal', () => {
    it('simple', async () => {
        const anotherValue = 'anotherValue';

        const data = await deon`
            {
                aKey aValue
                #anotherKey
            }

            anotherKey ${anotherValue}
        `;

        expect(data.aKey).toEqual('aValue');
        expect(data.anotherKey).toEqual('anotherValue');
    });
});
// #endregion module
