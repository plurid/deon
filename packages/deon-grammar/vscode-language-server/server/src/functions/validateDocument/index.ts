// #region imports
	// #region libraries
	import {
		Diagnostic,
		DiagnosticSeverity,
	} from 'vscode-languageserver/node';

	import {
		TextDocument
	} from 'vscode-languageserver-textdocument';
	// #endregion libraries


	// #region external
	import connection from '../../connection';

	import {
		getDocumentSettings,
	} from '../../settings';

	let {
		hasDiagnosticRelatedInformationCapability,
	} = require('../../document');
	// #endregion external
// #endregion imports



// #region module
async function validateDocument(
	textDocument: TextDocument,
): Promise<void> {
	// In this simple example we get the settings for every validate run.
	let settings = await getDocumentSettings(textDocument.uri);

	// The validator creates diagnostics for all uppercase words length 2 and more
	let text = textDocument.getText();
	let pattern = /\b[A-Z]{2,}\b/g;
	let m: RegExpExecArray | null;

	let problems = 0;
	let diagnostics: Diagnostic[] = [];
	while ((m = pattern.exec(text)) && problems < settings.maxNumberOfProblems) {
		problems++;
		let diagnostic: Diagnostic = {
			severity: DiagnosticSeverity.Warning,
			range: {
				start: textDocument.positionAt(m.index),
				end: textDocument.positionAt(m.index + m[0].length)
			},
			message: `${m[0]} is all uppercase.`,
			source: 'ex'
		};
		if (hasDiagnosticRelatedInformationCapability) {
			diagnostic.relatedInformation = [
				{
					location: {
						uri: textDocument.uri,
						range: Object.assign({}, diagnostic.range)
					},
					message: 'Spelling matters'
				},
				{
					location: {
						uri: textDocument.uri,
						range: Object.assign({}, diagnostic.range)
					},
					message: 'Particularly for names'
				}
			];
		}
		diagnostics.push(diagnostic);
	}

	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}
// #endregion module



// #region exports
export default validateDocument;
// #endregion exports
