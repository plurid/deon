// #region imports
	// #region internal
	import connection from '../../connection';

	import {
		DeonSettings,
		defaultSettings,
		documentSettings,
	} from '../../settings';

	import {
		documents,
	} from '../../document';

	import {
		validateDocument,
	} from '../../functions';

	let {
		globalSettings,
	} = require('../../settings');

	let {
		hasConfigurationCapability,
	} = require('../../document');
	// #endregion internal
// #endregion imports



// #region module
connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <DeonSettings>(
			(change.settings.languageServerDeon || defaultSettings)
		);
	}

	// Revalidate all open text documents
	documents.all().forEach(validateDocument);
});
// #endregion module
