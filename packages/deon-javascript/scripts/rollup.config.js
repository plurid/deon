// #region imports
    // #region libraries
    import { nodeResolve } from '@rollup/plugin-node-resolve';
    import commonjs from '@rollup/plugin-commonjs';
    import sourceMaps from 'rollup-plugin-sourcemaps';
    import typescript from 'rollup-plugin-typescript2';
    import { terser } from 'rollup-plugin-terser';
    import replace from '@rollup/plugin-replace';
    // #endregion libraries


    // #region external
    import pkg from '../package.json';
    // #endregion external
// #endregion imports



// #region module
const common = {
    external: [
        'commander',
        'cross-fetch',
        'encoding',
        'sync-fetch',
    ],
    plugins: [
        nodeResolve(),
        commonjs(),
        sourceMaps(),
        typescript({
            file: '../tsconfig.json',
            useTsconfigDeclarationDir: true,
        }),
        terser({
            mangle: false,
            compress: false,
            format: {
                beautify: true,
                comments: false,
            },
        }),
        replace({
            "#DEON_CLI_VERSION": JSON.stringify(pkg.version),
            delimiters: ["'", "';"],
            preventAssignment: true,
        }),
    ],
};


const node = {
    input: 'source/index.ts',
    output: [
        {
            file: './distribution/index.js',
            format: 'cjs',
            sourcemap: true,
            exports: 'named',
        },
        {
            file: './distribution/index.es.js',
            format: 'es',
            sourcemap: true,
            exports: 'named',
        },
    ],
    watch: {
        include: 'source/**',
    },
    ...common,
};


const pure = {
    input: `source/pure.ts`,
    output: [
        {
            file: './distribution/pure.js',
            format: 'cjs',
            sourcemap: true,
            exports: 'named',
        },
    ],
    ...common,
};
// #endregion module



// #region exports
export default [
    node,
    pure,
];
// #endregion exports
