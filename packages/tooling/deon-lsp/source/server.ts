// The server: the protocol wired to the analyser. It announces what it can do, keeps its copy of
// every open document current, and answers each request by asking the analyser — which asks
// `@plurid/deon`. It holds no capability, reaches no disk, and speaks only over the two streams it
// was handed.

// #region imports
    import type { Readable, Writable } from 'node:stream';

    import { Connection } from './transport.js';
    import { Documents } from './documents.js';
    import { Analysis } from './analysis.js';
    import {
        TextDocumentSyncKind,
        type TextDocumentPositionParams,
    } from './protocol.js';
// #endregion imports



// #region module
export interface ServerOptions {
    input: Readable;
    output: Writable;
    /**
     * What to do on the protocol's `exit` notification. Defaults to ending the process; a test passes
     * its own, so driving a server does not end the test runner.
     */
    onExit?: () => void;
}


/**
 * Wire a server over a pair of streams and begin listening. Returns the connection, so a caller that
 * built its own streams can keep speaking to it.
 */
export const createServer = (
    options: ServerOptions,
): Connection => {
    const connection = new Connection(options.input, options.output);
    const documents = new Documents();
    const analysis = new Analysis();

    const publish = (uri: string): void => {
        const document = documents.get(uri);
        if (!document) {
            return;
        }
        connection.sendNotification('textDocument/publishDiagnostics', {
            uri,
            version: document.version,
            diagnostics: analysis.diagnostics(uri, document.text),
        });
    };

    const at = (params: TextDocumentPositionParams) => {
        const document = documents.get(params.textDocument.uri);
        return document ? { document } : null;
    };


    connection.onRequest('initialize', () => ({
        capabilities: {
            // Full-text sync: every change carries the whole document. The simplest thing that is
            // always correct, and a Deon document is small.
            textDocumentSync: TextDocumentSyncKind.Full,
            documentSymbolProvider: true,
            definitionProvider: true,
            hoverProvider: true,
            completionProvider: {
                // `#` opens a reference, so it is where a name is most wanted.
                triggerCharacters: ['#'],
            },
        },
        serverInfo: {
            name: 'deon-lsp',
            version: '0.0.0-1',
        },
    }));

    connection.onNotification('initialized', () => {
        // Nothing to register: the server watches no files and pulls no configuration.
    });

    connection.onRequest('shutdown', () => null);

    connection.onNotification('exit', () => {
        (options.onExit ?? (() => process.exit(0)))();
    });


    connection.onNotification('textDocument/didOpen', (params: any) => {
        const document = params.textDocument;
        documents.opened(document.uri, document.version ?? 0, document.text ?? '');
        publish(document.uri);
    });

    connection.onNotification('textDocument/didChange', (params: any) => {
        const uri = params.textDocument.uri;
        const version = params.textDocument.version ?? 0;
        // Full sync: the last change in the list carries the whole text.
        const changes = params.contentChanges ?? [];
        const text = changes.length ? changes[changes.length - 1].text : '';
        documents.changed(uri, version, text);
        publish(uri);
    });

    connection.onNotification('textDocument/didClose', (params: any) => {
        const uri = params.textDocument.uri;
        documents.closed(uri);
        analysis.forget(uri);
        // Clearing the list retracts the squiggles the editor was showing for a now-closed document.
        connection.sendNotification('textDocument/publishDiagnostics', {
            uri,
            diagnostics: [],
        });
    });


    connection.onRequest('textDocument/documentSymbol', (params: any) => {
        const found = at(params);
        return found ? analysis.symbols(params.textDocument.uri, found.document.text) : null;
    });

    connection.onRequest('textDocument/definition', (params: TextDocumentPositionParams) => {
        const found = at(params);
        return found
            ? analysis.definition(params.textDocument.uri, found.document.text, params.position)
            : null;
    });

    connection.onRequest('textDocument/hover', (params: TextDocumentPositionParams) => {
        const found = at(params);
        return found
            ? analysis.hover(params.textDocument.uri, found.document.text, params.position)
            : null;
    });

    connection.onRequest('textDocument/completion', (params: TextDocumentPositionParams) => {
        const found = at(params);
        return found
            ? analysis.completion(params.textDocument.uri, found.document.text, params.position)
            : null;
    });

    return connection;
};
// #endregion module
