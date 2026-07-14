// #region imports
	// #region libraries
	import {
		Location,
	} from 'vscode-languageserver/node';
	// #endregion libraries


	// #region external
	import connection from '../../connection';
	// #endregion external
// #endregion imports



// #region module
connection.onDefinition(
	(data): Location | undefined => {
		try {
			return;

			// return {
			// 	uri: data.textDocument.uri,
			// 	range: {
			// 		start: {
			// 			character: 0,
			// 			line: 15,
			// 		},
			// 		end: {
			// 			character: 2,
			// 			line: 15,
			// 		},
			// 	}
			// };
		} catch (error) {
			return;
		}
	},
);
// #endregion module
