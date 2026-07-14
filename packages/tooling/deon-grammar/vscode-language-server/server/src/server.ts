// #region imports
	// #region internal
	import connection from './connection';

	import {
		documents,
	} from './document';

	import './events';
	// #endregion internal
// #endregion imports



// #region module
// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
// #endregion module
