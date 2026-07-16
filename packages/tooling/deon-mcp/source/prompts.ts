// #region imports
    // #region libraries
    import { readFileSync } from 'node:fs';

    import type {
        McpServer,
    } from '@modelcontextprotocol/sdk/server/mcp.js';

    import {
        z,
    } from 'zod';
    // #endregion libraries


    // #region external
    import Deon, {
        ESCAPED_INTERPOLATION,
        internals,
    } from '@plurid/deon';

    import type {
        CallArgumentNode,
        DeonValue,
        DocumentNode,
        MapNode,
        Token,
        ValueNode,
    } from '@plurid/deon';

    import type {
        ServerOptions,
    } from './options.js';

    import {
        fileOptions,
    } from './options.js';
    // #endregion external
// #endregion imports



// #region module
/**
 * A `.deon` file *is* a prompt library, and it needs no new syntax to be one.
 *
 * An MCP prompt takes named string arguments. A Deon entity call — `#review(language Rust)` — takes
 * named arguments that *must* be strings, and the set it demands is exactly the interpolation names
 * it carries, which the language already computes. The two are the same shape, so the mapping is
 * mechanical rather than a convention that could be got wrong:
 *
 *     review `Review this #{language} code:      ->   name: review
 *                                                     arguments: [language, code]
 *     #{code}`
 *
 *     {                                          ->   the root names which entities are exposed,
 *         review Review code for bugs                 and describes them
 *     }
 *
 * The root is the manifest: a key names an entity to expose, and its value is the description. An
 * entity the root does not name is a private detail of the library, exactly as a leaflink is a
 * private detail of a document.
 */


/**
 * An MCP argument is *text*, supplied by whoever is driving the model. It is not Deon source, and it
 * must not be read as any: a value containing `#{secret}` is a user who typed some characters, not a
 * link into the library's declarations.
 *
 * So the opener is neutralized before evaluation. The interpolator turns the sentinel back into `#{`
 * on the way out, and the text arrives as it was written.
 */
const literal = (
    value: string,
) => value.split('#{').join(ESCAPED_INTERPOLATION);


/**
 * A prompt, as the library declares it.
 */
export interface PromptDefinition {
    name: string;
    description: string;
    parameters: string[];
}


export const readLibrary = (
    file: string,
    options: ServerOptions,
): { source: string; prompts: PromptDefinition[] } => {
    const source = readFileSync(file, 'utf8');
    const deon = new Deon();

    // The root is the manifest. It is evaluated, so a description may itself be a leaflink or an
    // interpolation — it is an ordinary Deon value like any other.
    const manifest = deon.parseSynchronous<Record<string, DeonValue>>(
        source,
        fileOptions(file, options),
    );

    if (typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error(
            `The prompt library '${file}' must have a root map naming the prompts it exposes.`,
        );
    }

    const entities = new Map(
        deon.entities(source, file).map(entity => [entity.name, entity]),
    );

    const prompts: PromptDefinition[] = [];

    for (const [name, description] of Object.entries(manifest)) {
        const entity = entities.get(name);

        if (!entity) {
            throw new Error(
                `The prompt library '${file}' exposes '${name}', which it does not declare.`,
            );
        }

        if (typeof description !== 'string') {
            throw new Error(
                `The description of the prompt '${name}' in '${file}' must be a string.`,
            );
        }

        prompts.push({
            name,
            description,
            parameters: entity.parameters,
        });
    }

    return { source, prompts };
}


/**
 * Renders a prompt by calling its entity with the arguments the client supplied.
 *
 * The library's own root is the manifest, so it is replaced with one that calls the entity — which is
 * what makes this an *evaluation* of the language rather than a second template engine that could
 * disagree with the first. Whatever `#review(...)` would mean written by hand, it means here.
 */
export const render = (
    source: string,
    file: string,
    name: string,
    args: Record<string, string>,
    options: ServerOptions,
): DeonValue => {
    const deon = new Deon();
    const document: DocumentNode = deon.parseSyntax(source, file);

    // A synthesized node has no text of its own, so it borrows the root's position: a diagnostic
    // raised inside a call points at the document it came from rather than at nothing.
    const token: Token = document.root.token;

    const callArguments: CallArgumentNode[] = Object.entries(args).map(([argument, value]) => ({
        name: argument,
        value: {
            type: 'scalar',
            value: literal(value),
            token,
        } as ValueNode,
        token,
    }));

    const root: MapNode = {
        type: 'map',
        entries: [{
            type: 'entry',
            name: 'prompt',
            value: {
                type: 'call',
                reference: { head: name, access: [] },
                arguments: callArguments,
                token,
            },
            token,
        }],
        token,
    };

    // A library named by the operator may read the filesystem, so that it can be composed out of
    // imported pieces. It reaches the network only if the operator said it may.
    const interpreter = new internals.Interpreter(Deon, undefined, { pure: !options.roots.length });

    const value = interpreter.interpretSynchronous(
        { ...document, root },
        { file, parseOptions: fileOptions(file, options) },
    ) as Record<string, DeonValue>;

    return value.prompt;
}


/**
 * The rendered value, as MCP messages.
 *
 * A string is one message from the user — the ordinary case, and the one a library will almost always
 * want. A list of `{ role, content }` maps is a conversation, which needs no new syntax either: it is
 * just a Deon list of Deon maps.
 */
export interface PromptMessage {
    role: 'user' | 'assistant';
    content: {
        type: 'text';
        text: string;
    };
}


export const messages = (
    value: DeonValue,
): PromptMessage[] => {
    if (typeof value === 'string') {
        return [{
            role: 'user',
            content: { type: 'text', text: value },
        }];
    }

    if (!Array.isArray(value)) {
        throw new Error(
            'A prompt must render to a string, or to a list of maps with a role and a content.',
        );
    }

    return value.map(entry => {
        if (typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error('Each message of a prompt must be a map with a role and a content.');
        }

        const role = entry.role;
        const content = entry.content;

        if (typeof content !== 'string') {
            throw new Error('The content of a prompt message must be a string.');
        }

        if (role !== 'user' && role !== 'assistant') {
            throw new Error(
                `The role of a prompt message must be 'user' or 'assistant', not '${String(role)}'.`,
            );
        }

        return {
            role,
            content: { type: 'text', text: content },
        };
    });
}


export const registerPrompts = (
    server: McpServer,
    options: ServerOptions,
) => {
    if (!options.prompts) {
        return;
    }

    const file = options.prompts;
    const { source, prompts } = readLibrary(file, options);

    for (const prompt of prompts) {
        // Every parameter is required, and every one is a string, because that is what an entity call
        // demands: an argument that is missing, extra, repeated, or not a string is an error
        // (specification 11). The schema says exactly what the evaluator would say.
        const schema = Object.fromEntries(
            prompt.parameters.map(parameter => [
                parameter,
                z.string().describe(`The '${parameter}' interpolation of the '${prompt.name}' entity.`),
            ]),
        );

        server.registerPrompt(
            prompt.name,
            {
                title: prompt.name,
                description: prompt.description,
                argsSchema: schema,
            },
            (given: Record<string, string>) => ({
                messages: messages(render(source, file, prompt.name, given ?? {}, options)),
            }),
        );
    }
}
// #endregion module
