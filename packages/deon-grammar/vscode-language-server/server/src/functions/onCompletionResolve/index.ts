// #region imports
	// #region libraries
	import {
		CompletionItem,
		CompletionItemKind,
		TextDocumentPositionParams,
	} from 'vscode-languageserver/node';
	// #endregion libraries


	// #region external
	import connection from '../../connection';

	import {
		documents,
	} from '../../document';

	import getLeaflinks from '../../utilities/getLeaflinks';
	// #endregion external


	// #region internal
	let {
		completionValue,
	} = require('../onCompletion');
	// #endregion internal
// #endregion imports



// #region module
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
// #endregion module
