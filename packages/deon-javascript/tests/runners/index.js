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
        const start = Date.now();

        const deon = new Deon();
        const parsed = await deon.parse(data);

        const end = Date.now();

        expect(
            parsed[access],
            value,
        );

        timeBenchmark(
            start,
            end,
            'instant',
            `name`,
        );
    } catch (error) {
        console.log(error);
    }
}


const timeBenchmark = (
    start,
    end,
    kind, // 'instant' | 'fast' | 'network'
    id,
) => {
    const timeBenchmarkValues = {
        instant: 0,
        fast: 10,
        network: 500,
    };
    const timeTolerance = 5;

    const duration = end - start;
    const benchmark = typeof timeBenchmarkValues[kind] !== 'undefined'
        ? timeBenchmarkValues[kind]
        : timeBenchmarkValues.instant;
    const maximum = benchmark + timeTolerance;

    if (duration > maximum) {
        console.log(`\n\tExecution time of '${id}' exceeded: (${duration} ms instead of ${maximum} ms).`);
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
