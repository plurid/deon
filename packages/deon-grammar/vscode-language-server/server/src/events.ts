// #region imports
	// #region libraries
	import {
		InitializeParams,
		DidChangeConfigurationNotification,
		CompletionItem,
		CompletionItemKind,
		TextDocumentPositionParams,
		TextDocumentSyncKind,
		InitializeResult
	} from 'vscode-languageserver/node';

	import Deon from '@plurid/deon';
	// #endregion libraries


	// #region internal
	import connection from './connection';

	import {
		DeonSettings,
		defaultSettings,
		documentSettings,
	} from './settings';

	import {
		documents,
	} from './document';

	import {
		validateDocument,
	} from './functions';

	let {
		globalSettings,
	} = require('./settings');

	let {
		hasConfigurationCapability,
		hasWorkspaceFolderCapability,
		hasDiagnosticRelatedInformationCapability,
	} = require('./document');
	// #endregion internal
// #endregion imports



// #region module
connection.onInitialize((params: InitializeParams) => {
	let capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that this server supports code completion.
			completionProvider: {
				resolveProvider: true,
				triggerCharacters: [
					'#',
					'.'
				]
			}
		}
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}
	return result;
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <DeonSettings>(
			(change.settings.languageServerDeon || defaultSettings)
		);
	}

	// Revalidate all open text documents
	documents.all().forEach(validateDocument);
});

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
	async (textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
		const document = documents.get(textDocumentPosition.textDocument.uri);

		if (!document) {
			return [];
		}

		const offset = document.offsetAt(textDocumentPosition.position);
		const text = document.getText();

		const deon = new Deon();
		const parsedData = await deon.parse(text);


		return [
			{
				label: JSON.stringify(parsedData),
				kind: CompletionItemKind.Field,
				data: 1
			},
			{
				label: 'two',
				kind: CompletionItemKind.Value,
				data: 2
			},
			{
				label: 'three',
				kind: CompletionItemKind.Variable,
				data: 3
			},
			{
				label: 'four',
				kind: CompletionItemKind.Text,
				data: 4
			}
		];
	}
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	async (item: CompletionItem): Promise<CompletionItem> => {
		if (item.data === 1) {
			item.detail = 'TypeScript details';
			item.documentation = 'TypeScript documentation';
		} else if (item.data === 2) {
			item.detail = 'JavaScript details';
			item.documentation = 'JavaScript documentation';
		}
		return item;
	}
);
// #endregion module
