// #region imports
    // #region libraries
    import {
        McpServer,
    } from '@modelcontextprotocol/sdk/server/mcp.js';
    // #endregion libraries


    // #region external
    import type {
        ServerOptions,
    } from './options.js';

    import {
        defaultOptions,
    } from './options.js';

    import {
        registerTools,
    } from './tools.js';

    import {
        registerPrompts,
    } from './prompts.js';

    import {
        registerResources,
    } from './resources.js';
    // #endregion external
// #endregion imports



// #region module
/**
 * Deon over the Model Context Protocol.
 *
 * Three things, in order of how much they are worth:
 *
 * - **Tools.** A model that writes Deon gets it wrong and has no way to find out. A Deon diagnostic
 *   carries a code, a line, and a column, so `deon_parse` and `deon_lint` close the loop: a refusal
 *   says what is wrong and where, which is enough to fix it.
 * - **Prompts.** A `.deon` file is a prompt library as it stands. An entity call takes named string
 *   arguments and already computes the set it demands; an MCP prompt takes named string arguments.
 *   Same shape, so the mapping is mechanical rather than a convention.
 * - **Resources.** The `.deon` files under the roots the operator named, and nothing else.
 *
 * Nothing is granted that was not asked for. A document handed to a *tool* came from the model, is
 * not trusted, and may reach nothing at all. A document under a *root* was named by the operator, and
 * may read the filesystem. The network is off unless it is turned on — a document's text becomes
 * prompt text, so one that may fetch from an arbitrary URL is a way to put words a model will read
 * into a channel nobody is watching.
 */
export const createServer = (
    options: Partial<ServerOptions> = {},
) => {
    const resolved: ServerOptions = {
        ...defaultOptions(),
        ...options,
    };

    const server = new McpServer({
        name: 'deon',
        version: '0.0.0-1',
    });

    registerTools(server, resolved);
    registerPrompts(server, resolved);
    registerResources(server, resolved);

    return server;
}
// #endregion module



// #region exports
export type {
    ServerOptions,
} from './options.js';

export {
    defaultOptions,
} from './options.js';
// #endregion exports
