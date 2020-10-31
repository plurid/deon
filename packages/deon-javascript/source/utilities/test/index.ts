// #region imports
    // #region libraries
    import {
        log,
    } from '../log';
    // #endregion libraries
// #endregion imports



// #region module
const timeBenchmark = {
    instant: 0,
    fast: 10,
    network: 500,
};

const timeTolerance = 5;

const compareTimeBenchmark = (
    start: number,
    end: number,
    kind: 'instant' | 'fast' | 'network',
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
    injects: 'Deon injects',
    stringify: 'Deon stringify',
    examples: 'Deon examples',
    testings: 'Deon testings',
    synchronous: 'Deon synchronous',
    template: 'Deon template literals',
};
// #endregion module



// #region exports
export {
    timeBenchmark,
    compareTimeBenchmark,
    suites,
};
// #endregion exports
