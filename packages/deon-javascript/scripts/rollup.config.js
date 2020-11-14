import sourceMaps from 'rollup-plugin-sourcemaps';
import typescript from 'rollup-plugin-typescript2';



export default {
    input: `source/index.ts`,
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
    external: [
        'fs',
        'path',
        'util',
        'http',
        'stream',
        'https',
        'url',
        'zlib',
        'child_process',
        'events',
        'commander',
        'cross-fetch',
        'sync-request',
    ],
    watch: {
        include: 'source/**',
    },
    plugins: [
        sourceMaps(),
        typescript({
            file: '../tsconfig.json',
            useTsconfigDeclarationDir: true,
        }),
    ],
}
