// #region imports
	// #region libraries
	import {
		InitializeParams,
		DidChangeConfigurationNotification,
		CompletionItem,
		CompletionItemKind,
		TextDocumentPositionParams,
		TextDocumentSyncKind,
		InitializeResult,
		// Hover,
		// SignatureHelp,
		// Location,
	} from 'vscode-languageserver/node';
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

	import getLeaflinks from './utilities/getLeaflinks';

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
			completionProvider: {
				resolveProvider: true,
				triggerCharacters: [
					'#',
					'.',
				],
			},
			// hoverProvider: true,
			// signatureHelpProvider: {
			// 	triggerCharacters: [ '(' ],
			// },
			// definitionProvider: true,
		},
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
let completionValue: null | any = null;

connection.onCompletion(
	async (textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
		try {
			const document = documents.get(textDocumentPosition.textDocument.uri);

			if (!document) {
				return [];
			}

			const offset = document.offsetAt(textDocumentPosition.position);
			const text = document.getText();

			const data = await getLeaflinks(
				text,
				document.uri,
			);

			const textPartial = text.slice(0, offset);

			if (!textPartial) {
				return [];
			}

			let textValue = '';

			// read the textPartial slice from the end until the #
			for (let i = textPartial.length - 1; i > 0; i -= 1) {
				const char = textPartial[i];
				if (char === '#') {
					textValue = textPartial.slice(i);
					break;
				}
			}

			if (!textValue) {
				return [];
			}

			// based on textValue navigate the leaflinks data
			const links = textValue.replace('#', '').split('.');

			let value = {
				...data,
			};
			for (const link of links) {
				const current = value[link];

				if (!current) {
					continue;
				}

				if (typeof current === 'object' && !Array.isArray(current)) {
					value = {
						...current,
					};
				} else {
					value = undefined;
				}
			}

			if (!value) {
				return [];
			}

			completionValue = value;

			return Object.keys(value).sort().map(key => {
				const selection = value[key];
				let kind: any = CompletionItemKind.Text;

				if (Array.isArray(selection)) {
					kind = CompletionItemKind.Unit;
				}

				if (typeof selection === 'string') {
					kind = CompletionItemKind.Text;
				}

				if (typeof selection === 'object' && !Array.isArray(selection)) {
					kind = CompletionItemKind.Struct;
				}

				return {
					label: key,
					data: key,
					kind,
				};
			});
		} catch (error) {
			return [];
		}
	},
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	async (item: CompletionItem): Promise<CompletionItem> => {
		try {
			if (!completionValue) {
				return item;
			}

			const selection = completionValue[item.data];

			if (Array.isArray(selection)) {
				item.detail = 'list';
				return item;
			}

			if (typeof selection === 'string') {
				item.detail = 'string';
				return item;
			}

			if (typeof selection === 'object') {
				item.detail = 'map';
				return item;
			}

			return item;
		} catch (error) {
			return item;
		}
	}
);


// connection.onHover(
// 	(data): Hover => {
// 		return {
// 			contents: {
// 				kind: 'markdown',
// 				language: 'deon',
// 				value: `## heading`
// 			},
// 		};
// 	}
// );


// connection.onSignatureHelp(
// 	(data): SignatureHelp => {
// 		return {
// 			activeParameter: 0,
// 			activeSignature: 0,
// 			signatures: [
// 				{
// 					label: 'sign',
// 				},
// 			],
// 		};
// 	}
// );


// connection.onDefinition(
// 	(data): Location => {
// 		return {
// 			uri: data.textDocument.uri,
// 			range: {
// 				start: {
// 					character: 0,
// 					line: 15,
// 				},
// 				end: {
// 					character: 2,
// 					line: 15,
// 				},
// 			}
// 		};
// 	}
// );
// #endregion module
