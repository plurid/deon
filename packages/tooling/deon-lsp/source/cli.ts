#!/usr/bin/env node
// The runnable server: it speaks the protocol over standard input and standard output, which is how
// every editor launches a language server. An editor's client starts this, and the two exchange
// framed JSON-RPC over the pipe between them.

import { createServer } from './server.js';

createServer({
    input: process.stdin,
    output: process.stdout,
});
