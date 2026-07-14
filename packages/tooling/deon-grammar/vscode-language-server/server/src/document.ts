// #region imports
	// #region libraries
	import {
		TextDocuments,
	} from 'vscode-languageserver/node';

	import {
		TextDocument
	} from 'vscode-languageserver-textdocument';
	// #endregion libraries


	// #region internal
	import {
		documentSettings,
	} from './settings';

	import {
		validateDocument,
	} from './functions';
	// #endregion internal
// #endregion imports



// #region module
// Create a simple text document manager.
let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;
let hasDiagnosticRelatedInformationCapability: boolean = false;


// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
	validateDocument(change.document);
});
// #endregion module



// #region exports
export {
    documents,
    hasConfigurationCapability,
    hasWorkspaceFolderCapability,
    hasDiagnosticRelatedInformationCapability,
};
// #endregion exports
