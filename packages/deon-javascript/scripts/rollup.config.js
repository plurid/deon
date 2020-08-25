const resolve = require('@rollup/plugin-node-resolve').default;
const sourceMaps = require('rollup-plugin-sourcemaps');
const typescript = require('rollup-plugin-typescript2');



export default {
    input: `source/index.ts`,
    output: [
        {
            file: './distribution/index.js',
            format: 'cjs',
            sourcemap: true,
        },
    ],
    external: [
        'fs',
        'path',
        'readline',
    ],
    watch: {
        include: 'source/**',
    },
    plugins: [
        typescript({
            file: '../tsconfig.json',
            useTsconfigDeclarationDir: true,
        }),
        resolve({
            preferBuiltins: true,
        }),
        sourceMaps(),
    ],
}
