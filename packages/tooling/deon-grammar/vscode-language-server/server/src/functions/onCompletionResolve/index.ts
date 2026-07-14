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

	import completionHandler from '../../objects/CompletionHandler';
	// #endregion external
// #endregion imports



// #region module
// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	async (item: CompletionItem): Promise<CompletionItem> => {
		try {
			const completionValue = completionHandler.get();

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
