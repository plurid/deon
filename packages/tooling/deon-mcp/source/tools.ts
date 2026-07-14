// #region imports
    // #region libraries
    import type {
        McpServer,
    } from '@modelcontextprotocol/sdk/server/mcp.js';

    import {
        z,
    } from 'zod';
    // #endregion libraries


    // #region external
    import Deon, {
        DeonError,
        typer,
    } from '@plurid/deon';

    import type {
        ServerOptions,
    } from './options.js';

    import {
        parseOptions,
    } from './options.js';
    // #endregion external
// #endregion imports



// #region module
/**
 * A model that writes Deon gets it wrong, and today has no way to find out. Everything here exists to
 * close that loop: a Deon diagnostic carries a code, a line, and a column, so a refusal says exactly
 * what is wrong and exactly where — which is enough to fix it.
 */


/**
 * What went wrong, in the shape a model can act on. A `DeonError` is not an accident to be reported
 * as a stack trace; it is a *finding*, and it is worth as much as the value would have been.
 */
const failure = (
    error: unknown,
) => {
    if (!(error instanceof DeonError)) {
        return {
            isError: true,
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    ok: false,
                    message: error instanceof Error ? error.message : String(error),
                }, null, 4),
            }],
        };
    }

    return {
        isError: true,
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                ok: false,
                code: error.code,
                message: error.message,
                diagnostics: error.diagnostics.map(diagnostic => ({
                    code: diagnostic.code,
                    severity: diagnostic.severity,
                    message: diagnostic.message,
                    line: diagnostic.range.start.line,
                    column: diagnostic.range.start.column,
                })),
            }, null, 4),
        }],
    };
}


const success = (
    value: unknown,
) => ({
    content: [{
        type: 'text' as const,
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 4),
    }],
});


const attempt = (
    run: () => unknown,
) => {
    try {
        return success(run());
    } catch (error) {
        return failure(error);
    }
}


export const registerTools = (
    server: McpServer,
    options: ServerOptions,
) => {
    const deon = new Deon();

    server.registerTool(
        'deon_parse',
        {
            title: 'Parse Deon',
            description: 'Read a Deon document and return its value as JSON. '
                + 'Every Deon value is a string, a list, or a map: there is no number and no boolean, '
                + 'so `1` comes back as the string "1". Use deon_typed for the typed view. '
                + 'On failure, returns the diagnostic code and the line and column of the error.',
            inputSchema: {
                source: z.string().describe('The Deon document.'),
            },
        },
        async ({ source }) => attempt(
            () => deon.parseSynchronous(source, parseOptions(options)),
        ),
    );

    server.registerTool(
        'deon_lint',
        {
            title: 'Lint Deon',
            description: 'Report what is questionable but legal in a Deon document — a map key '
                + 'written more than once, for instance, where the last write is the one that holds. '
                + 'Returns an empty list when there is nothing to say.',
            inputSchema: {
                source: z.string().describe('The Deon document.'),
            },
        },
        async ({ source }) => attempt(() => deon.lint(source).map(diagnostic => ({
            code: diagnostic.code,
            severity: diagnostic.severity,
            message: diagnostic.message,
            line: diagnostic.range.start.line,
            column: diagnostic.range.start.column,
        }))),
    );

    server.registerTool(
        'deon_canonical',
        {
            title: 'Canonical Deon',
            description: 'Rewrite a Deon document into its canonical form: four spaces, map keys '
                + 'sorted by code point, no leaflinks. Reading the canonical form back gives the '
                + 'value it was written from, so this is how two documents are compared for meaning '
                + 'rather than for layout.',
            inputSchema: {
                source: z.string().describe('The Deon document.'),
            },
        },
        async ({ source }) => attempt(() => deon.canonical(source)),
    );

    server.registerTool(
        'deon_stringify',
        {
            title: 'Write Deon',
            description: 'Turn a JSON value into a Deon document. A number or a boolean becomes the '
                + 'string it was written as, because the Deon data model has neither.',
            inputSchema: {
                value: z.unknown().describe('Any JSON value: a string, a list, or an object.'),
                readable: z.boolean().optional()
                    .describe('One entry per line. Default true.'),
                indentation: z.number().int().min(0).optional()
                    .describe('Spaces per level. Default 4.'),
                leaflinks: z.boolean().optional()
                    .describe('Lift nested containers out into named declarations. Default false.'),
            },
        },
        async ({ value, readable, indentation, leaflinks }) => attempt(() => deon.stringify(value, {
            ...(readable === undefined ? {} : { readable }),
            ...(indentation === undefined ? {} : { indentation }),
            ...(leaflinks === undefined ? {} : { leaflinks }),
        })),
    );

    server.registerTool(
        'deon_typed',
        {
            title: 'Parse Deon, typed',
            description: 'Read a Deon document and apply the conservative typer: a value becomes a '
                + 'number or a boolean only when there is exactly one type it could have meant and '
                + 'the string it was written as can be recovered from it. So `true` becomes true, '
                + '`1.5` becomes 1.5, and `007` stays the string "007".',
            inputSchema: {
                source: z.string().describe('The Deon document.'),
            },
        },
        async ({ source }) => attempt(
            () => typer(deon.parseSynchronous(source, parseOptions(options))),
        ),
    );

    server.registerTool(
        'deon_entities',
        {
            title: 'List Deon entities',
            description: 'List what a Deon document declares, and the arguments each would demand if '
                + 'it were called. An entity carrying interpolations — `#{name}` — is a template: '
                + 'calling it as `#entity(name value)` fills them in. This reads the document rather '
                + 'than running it, so it reaches nothing.',
            inputSchema: {
                source: z.string().describe('The Deon document.'),
            },
        },
        async ({ source }) => attempt(() => deon.entities(source)),
    );
}
// #endregion module
