// #region imports
    // #region internal
	import connection from './connection';

	let {
		hasConfigurationCapability,
	} = require('./document');
    // #endregion internal
// #endregion imports



// #region module
// The deon settings
export interface DeonSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: DeonSettings = { maxNumberOfProblems: 1000 };
let globalSettings: DeonSettings = defaultSettings;

// Cache the settings of all open documents
let documentSettings: Map<string, Thenable<DeonSettings>> = new Map();


function getDocumentSettings(resource: string): Thenable<DeonSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'languageServerDeon'
		});
		documentSettings.set(resource, result);
	}
	return result;
}
// #endregion module



// #region exports
export {
    defaultSettings,
    globalSettings,
    documentSettings,
    getDocumentSettings,
};
// #endregion exports
