// #region imports
    // #region libraries
    import {
        createConnection,
        ProposedFeatures,
    } from 'vscode-languageserver/node';
    // #endregion libraries
// #endregion imports



// #region module
// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);
// #endregion module



// #region exports
export default connection;
// #endregion exports
