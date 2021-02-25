// #region imports
	// #region libraries
	// #endregion libraries


	// #region external
	import connection from '../../connection';
	// #endregion external
// #endregion imports



// #region module
connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
});
// #endregion module
