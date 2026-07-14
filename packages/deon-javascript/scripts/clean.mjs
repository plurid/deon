import { rm } from 'node:fs/promises';


// `.build` holds the compiled JavaScript that rollup bundles, `.test-build` the compiled tests, and
// `distribution` the bundle itself. None of them is source, and all of them are rebuilt.
const generated = [
    '.build',
    '.test-build',
    'distribution',
];


await Promise.all(generated.map(directory => rm(
    new URL(`../${directory}`, import.meta.url),
    { force: true, recursive: true },
)));
