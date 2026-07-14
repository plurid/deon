import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';


const pkg = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);


/**
 * Deon has no runtime dependencies, so the only thing left out of the bundle is the platform.
 */
const external = [
    /^node:/,
    /^fs$/,
    /^path$/,
    /^os$/,
    /^child_process$/,
];


/**
 * A candidate must be a file, not merely present: `./data/constants` names a directory as well as
 * the module inside it, and resolving to the directory hands rollup something it cannot read.
 */
const isFile = async (candidate) => {
    try {
        return (await stat(candidate)).isFile();
    } catch {
        return false;
    }
};


/**
 * The compiler emits the imports as they were written, without an extension, which is valid
 * TypeScript and not something rollup can resolve on its own.
 */
const resolveLocalModules = {
    name: 'resolve-local-modules',

    async resolveId(source, importer) {
        if (!importer || !source.startsWith('.')) {
            return null;
        }

        const base = path.resolve(path.dirname(importer), source);

        const candidates = [
            `${base}.js`,
            path.join(base, 'index.js'),
            base,
        ];

        for (const candidate of candidates) {
            if (await isFile(candidate)) {
                return candidate;
            }
        }

        return null;
    },
};


/**
 * The CLI reports the version it was published as, which is only known here.
 */
const version = {
    name: 'deon-version',

    transform(code) {
        if (!code.includes('#DEON_CLI_VERSION')) {
            return null;
        }

        return {
            code: code.replaceAll('#DEON_CLI_VERSION', pkg.version),
            map: null,
        };
    },
};


const output = (name, format) => ({
    file: `distribution/${name}.${format === 'es' ? 'mjs' : 'cjs'}`,
    format,
    sourcemap: true,
    exports: 'named',
});


const bundle = (name) => ({
    input: `.build/${name}.js`,
    external,
    plugins: [
        resolveLocalModules,
        version,
    ],
    output: [
        output(name, 'es'),
        output(name, 'cjs'),
    ],
});


export default [
    bundle('index'),
    bundle('pure'),
];
