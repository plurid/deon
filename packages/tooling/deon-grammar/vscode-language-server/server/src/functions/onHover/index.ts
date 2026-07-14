// #region imports
	// #region libraries
	import {
		Hover,
	} from 'vscode-languageserver/node';
	// #endregion libraries


	// #region external
	import connection from '../../connection';

	import {
		documents,
	} from '../../document';
	// #endregion external
// #endregion imports



// #region module
connection.onHover(
	(data): Hover | undefined => {
		try {
			const document = documents.get(data.textDocument.uri);

			if (!document) {
				return;
			}

			return;

			// get text from position
			// check if key
			// resolve value

			// return {
			// 	contents: {
			// 		kind: 'markdown',
			// 		language: 'deon',
			// 		value: `## heading`,
			// 	},
			// };
		} catch (error) {
			return;
		}
	}
);
// #endregion module
