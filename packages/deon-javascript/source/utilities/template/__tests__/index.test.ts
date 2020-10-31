// #region imports
    // #region external
    import {
        deon,
        deonSynchronous,
    } from '../';

    import {
        log,
    } from '../../log';

    import {
        typer,
    } from '../../typer';

    import {
        compareTimeBenchmark,
        suites,
    } from '../../test';
    // #endregion external
// #endregion imports



// #region module
describe(suites.template, () => {
    it('simple', async () => {
        const anotherValue = 'anotherValue';

        const start = Date.now();
        const data = await deon<{
            aKey: string;
            anotherKey: string
        }>`
            {
                aKey aValue
                #anotherKey
            }

            anotherKey ${anotherValue}
        `;
        const end = Date.now();
        // log(data);


        expect(data.aKey).toEqual('aValue');
        expect(data.anotherKey).toEqual('anotherValue');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.template} - simple`,
        );
    });



    it('simple synchronous', () => {
        const anotherValue = 'anotherValue';

        const start = Date.now();
        const data = deonSynchronous<{
            aKey: string;
            anotherKey: string
        }>`
            {
                aKey aValue
                #anotherKey
            }

            anotherKey ${anotherValue}
        `;
        const end = Date.now();
        // log(data);


        expect(data.aKey).toEqual('aValue');
        expect(data.anotherKey).toEqual('anotherValue');

        compareTimeBenchmark(
            start,
            end,
            'instant',
            `${suites.template} - simple synchronous`,
        );
    });
});
// #endregion module
