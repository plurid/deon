// #region imports
	// #region libraries
	import {
		InitializeParams,
		TextDocumentSyncKind,
		InitializeResult,
	} from 'vscode-languageserver/node';
	// #endregion libraries


	// #region external
	import connection from '../../connection';

	let {
		globalSettings,
	} = require('../../settings');

	let {
		hasConfigurationCapability,
		hasWorkspaceFolderCapability,
		hasDiagnosticRelatedInformationCapability,
	} = require('../../document');
	// #endregion external
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
			hoverProvider: true,
			signatureHelpProvider: {
				triggerCharacters: [ '(' ],
			},
			definitionProvider: true,
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
// #endregion module
