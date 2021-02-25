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
// This handler provides the initial list of the completion items.
connection.onCompletion(
	async (textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
		try {
			const document = documents.get(textDocumentPosition.textDocument.uri);

			if (!document) {
				return [];
			}

			const offset = document.offsetAt(textDocumentPosition.position);
			const text = document.getText();

			const data = await getLeaflinks(
				text,
				document.uri,
			);

			const textPartial = text.slice(0, offset);

			if (!textPartial) {
				return [];
			}

			let textValue = '';

			// read the textPartial slice from the end until the #
			for (let i = textPartial.length - 1; i > 0; i -= 1) {
				const char = textPartial[i];
				if (char === '#') {
					textValue = textPartial.slice(i);
					break;
				}
			}

			if (!textValue) {
				return [];
			}

			// based on textValue navigate the leaflinks data
			const links = textValue.replace('#', '').split('.');

			let value = {
				...data,
			};
			for (const link of links) {
				const current = value[link];

				if (!current) {
					continue;
				}

				if (typeof current === 'object' && !Array.isArray(current)) {
					value = {
						...current,
					};
				} else {
					value = undefined;
				}
			}

			if (!value) {
				return [];
			}

			completionHandler.set(value);

			return Object.keys(value).sort().map(key => {
				const selection = value[key];
				let kind: any = CompletionItemKind.Text;

				if (Array.isArray(selection)) {
					kind = CompletionItemKind.Unit;
				}

				if (typeof selection === 'string') {
					kind = CompletionItemKind.Text;
				}

				if (typeof selection === 'object' && !Array.isArray(selection)) {
					kind = CompletionItemKind.Struct;
				}

				return {
					label: key,
					data: key,
					kind,
				};
			});
		} catch (error) {
			return [];
		}
	},
);
// #endregion module
