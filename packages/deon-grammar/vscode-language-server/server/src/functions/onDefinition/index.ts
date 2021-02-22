// #region imports
	// #region libraries
	import {
		Location,
	} from 'vscode-languageserver/node';
	// #endregion libraries


	// #region internal
	import connection from '../../connection';
	// #endregion internal
// #endregion imports



// #region module
connection.onDefinition(
	(data): Location => {
		return {
			uri: data.textDocument.uri,
			range: {
				start: {
					character: 0,
					line: 15,
				},
				end: {
					character: 2,
					line: 15,
				},
			}
		};
	},
);
// #endregion module
