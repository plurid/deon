import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import sourceMaps from 'rollup-plugin-sourcemaps';
import typescript from 'rollup-plugin-typescript2';



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
        'util',
        'http',
        'stream',
        'https',
        'url',
        'zlib',
    ],
    watch: {
        include: 'source/**',
    },
    plugins: [
        commonjs(),
        resolve({
            preferBuiltins: true,
        }),
        sourceMaps(),
        typescript({
            file: '../tsconfig.json',
            useTsconfigDeclarationDir: true,
        }),
    ],
}
