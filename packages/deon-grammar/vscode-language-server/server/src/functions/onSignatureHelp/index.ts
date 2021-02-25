// #region imports
	// #region libraries
	import {
		SignatureHelp,
	} from 'vscode-languageserver/node';
	// #endregion libraries


	// #region external
	import connection from '../../connection';
	// #endregion external
// #endregion imports



// #region module
connection.onSignatureHelp(
	(data): SignatureHelp | undefined => {
		try {
			return;

			// return {
			// 	activeParameter: 0,
			// 	activeSignature: 0,
			// 	signatures: [
			// 		{
			// 			label: 'sign',
			// 		},
			// 	],
			// };
		} catch (error) {
			return;
		}
	},
);
// #endregion module
