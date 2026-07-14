import { spawn } from 'node:child_process';


// The compiler writes the JavaScript, and rollup bundles what it writes, so the two run together
// and neither outlives the other.
const compile = spawn(
    process.execPath,
    [
        'node_modules/typescript/bin/tsc',
        '-p', 'tsconfig.build.json',
        '--watch',
        '--preserveWatchOutput',
    ],
    { stdio: 'inherit' },
);

const bundle = spawn(
    process.execPath,
    [
        'node_modules/rollup/dist/bin/rollup',
        '-c', 'scripts/rollup.config.mjs',
        '--watch',
    ],
    { stdio: 'inherit' },
);


const stop = (signal) => {
    compile.kill(signal);
    bundle.kill(signal);
};

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));

compile.once('exit', (code) => {
    bundle.kill();
    process.exitCode = code ?? 1;
});

bundle.once('exit', (code) => {
    compile.kill();
    process.exitCode = code ?? 1;
});
