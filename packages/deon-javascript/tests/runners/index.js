const Deon = require('../../distribution').default;



const expect = (
    value,
    expected,
) => {
    if (value !== expected) {
        throw `\n\tExpected not met '${value}' : '${expected}'`;
    }
}


const run = async (
    data,
    access,
    value,
) => {
    try {
        const deon = new Deon();
        const parsed = await deon.parse(data);

        expect(
            parsed[access],
            value,
        );
    } catch (error) {
        console.log(error);
    }
}


const main = async () => {
    await run(
        `
            {
                key value
            }
        `,
        'key',
        'value',
    );

    console.log('\n\tRunners finished.');
}


main();
