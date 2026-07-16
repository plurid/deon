// The library surface: everything a host needs to run the server over streams of its choosing, or to
// reuse the position adapter and the analyser on their own.

export { createServer, type ServerOptions } from './server.js';
export { Analysis } from './analysis.js';
export { Connection, encodeMessage } from './transport.js';
export {
    lineStarts,
    toLspPosition,
    toLspRange,
    toDeonPosition,
    type LspPosition,
    type LspRange,
} from './positions.js';
