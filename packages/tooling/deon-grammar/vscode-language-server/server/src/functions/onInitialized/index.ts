// #region imports
	// #region libraries
	import {
		DidChangeConfigurationNotification,
	} from 'vscode-languageserver/node';
	// #endregion libraries


	// #region external
	import connection from '../../connection';

	let {
		hasConfigurationCapability,
		hasWorkspaceFolderCapability,
	} = require('../../document');
	// #endregion external
// #endregion imports



// #region module
connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});
// #endregion module
