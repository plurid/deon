// #region imports
	// #region libraries
	import {
		SignatureHelp,
	} from 'vscode-languageserver/node';
	// #endregion libraries


	// #region internal
	import connection from '../../connection';
	// #endregion internal
// #endregion imports



// #region module
connection.onSignatureHelp(
	(data): SignatureHelp => {
		return {
			activeParameter: 0,
			activeSignature: 0,
			signatures: [
				{
					label: 'sign',
				},
			],
		};
	},
);
// #endregion module
