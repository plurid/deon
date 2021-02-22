// #region imports
	// #region libraries
	import {
		Hover,
	} from 'vscode-languageserver/node';
	// #endregion libraries


	// #region internal
	import connection from '../../connection';
	// #endregion internal
// #endregion imports



// #region module
connection.onHover(
	(data): Hover => {
		return {
			contents: {
				kind: 'markdown',
				language: 'deon',
				value: `## heading`
			},
		};
	}
);
// #endregion module
