// The VS Code side of the extension. It contributes the grammar and the snippets declaratively (see
// the extension manifest); the only thing it does in code is start the language server and connect to
// it. That server is `@plurid/deon-lsp` — a standalone, zero-dependency Deon language server that
// speaks the protocol over stdio — resolved from this extension's own dependencies, so the two ship
// and version together. The earlier bundled `server/` is retired.

import { ExtensionContext } from 'vscode';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(_context: ExtensionContext) {
	// `@plurid/deon-lsp`'s runnable entry, resolved from node_modules. `require.resolve` only finds
	// the path; VS Code launches it as its own Node process and talks to it over that process's
	// standard input and output.
	const server = require.resolve('@plurid/deon-lsp/cli');

	const serverOptions: ServerOptions = {
		run: {
			module: server,
			transport: TransportKind.stdio,
		},
		debug: {
			module: server,
			transport: TransportKind.stdio,
			options: { execArgv: ['--nolazy', '--inspect=6009'] },
		},
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'deon' }],
	};

	client = new LanguageClient(
		'deonLanguageServer',
		'Deon Language Server',
		serverOptions,
		clientOptions,
	);

	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	return client ? client.stop() : undefined;
}
