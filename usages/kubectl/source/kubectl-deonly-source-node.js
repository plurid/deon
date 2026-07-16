#!/usr/local/bin/node


const {
    execSync,
    execFileSync,
} = require('node:child_process');



const typeData = (
    data,
    Deon,
) => {
    const {
        typer,
    } = Deon;

    return typer(data);
}


/**
 * Parse and render a single `.deon` file into the manifest string that will be
 * handed to `kubectl` on stdin.
 *
 * This intentionally does NOT swallow errors: a file that fails to parse or
 * render must be surfaced to the caller so the run can fail closed instead of
 * silently applying a partial set (see `run`).
 */
const handleFile = async (
    file,
    Deon,
) => {
    const deon = new Deon.default();
    const parsedData = await deon.parseFile(file);
    const typedData = typeData(
        parsedData,
        Deon,
    );

    return JSON.stringify(typedData);
}


/**
 * Apply a single rendered manifest with `kubectl`.
 *
 * The manifest is passed on stdin via `execFileSync` (no shell). This is the
 * security-critical part: the manifest is attacker-influenceable data, so it
 * must never be interpolated into a shell command string. `execFileSync` spawns
 * `kubectl` directly with a fixed argument vector, so single quotes and shell
 * metacharacters in the manifest are inert.
 */
const applyManifest = (
    data,
) => {
    execFileSync(
        'kubectl',
        ['apply', '-f', '-'],
        {
            input: data,
            // stdin is a pipe (so `input` reaches kubectl); stdout/stderr are
            // inherited to preserve the original streaming-to-terminal behavior.
            stdio: ['pipe', 'inherit', 'inherit'],
        },
    );
}


/**
 * Resolve the globally installed `@plurid/deon` package.
 */
const loadDeon = () => {
    const root = execSync('npm root -g')
        .toString()
        .trim();

    return require(`${root}/@plurid/deon`);
}


/**
 * Core logic, factored out of `main` so it can be exercised in tests with an
 * injected `Deon` and/or `apply` seam (no real cluster, no global package).
 *
 * Fail-closed contract: every file is parsed/rendered first. If ANY file fails,
 * the errors are reported and a non-zero code is returned WITHOUT applying a
 * single manifest — a partial or empty deploy must never look successful.
 *
 * Returns a process exit code (0 on success, 1 on failure).
 */
const run = async ({
    files,
    Deon,
    apply = applyManifest,
    logger = console,
} = {}) => {
    if (!files || files.length === 0) {
        logger.log(`No .deon files specified to be applied to the cluster.`);

        return 0;
    }

    const manifests = [];
    const failures = [];

    for (const file of files) {
        try {
            const data = await handleFile(
                file,
                Deon,
            );
            manifests.push(data);
        } catch (error) {
            failures.push({ file, error });
        }
    }

    if (failures.length > 0) {
        for (const { file, error } of failures) {
            const detail = error && error.message
                ? error.message
                : String(error);
            logger.error(`Could not read file: ${file}`);
            logger.error(`  ${detail}`);
        }
        logger.error(
            `Aborting: ${failures.length} of ${files.length} file(s) failed to parse. No manifests were applied.`,
        );

        return 1;
    }

    for (const data of manifests) {
        apply(data);
    }

    return 0;
}


const main = async () => {
    let Deon;

    try {
        Deon = loadDeon();
    } catch (error) {
        console.error(
            `Something went wrong. Ensure that '@plurid/deon' is installed and functional · https://manual.plurid.com/deon/getting-started`,
        );
        process.exit(1);
    }

    let code = 1;

    try {
        code = await run({
            files: process.argv.slice(2),
            Deon,
        });
    } catch (error) {
        // A `kubectl apply` failure (execFileSync throws on non-zero exit) or any
        // other unexpected error must fail closed, never exit 0.
        const detail = error && error.message
            ? error.message
            : String(error);
        console.error(`Failed to apply manifests: ${detail}`);
        code = 1;
    }

    process.exit(code);
}


module.exports = {
    typeData,
    handleFile,
    applyManifest,
    loadDeon,
    run,
    main,
};


if (require.main === module) {
    main();
}
