// #region imports
    // #region libraries
    import os from 'node:os';
    import path from 'path';
    // #endregion libraries
// #endregion imports



// #region module
// Node-only. This lives here rather than in `data/constants` because the browser `pure` bundle
// imports that module, and a static `node:os` import would follow it into the browser.
const defaultCacheDirectory = () => path.join(os.homedir(), './.deon-cache');


const resolveAbsolutePath = (
    value: string,
) => {
    const absolutePath = path.isAbsolute(value);
    const filepath = absolutePath
        ? value
        : path.join(
            process.cwd(),
            value,
        );

    return filepath;
}
// #endregion module



// #region exports
export {
    defaultCacheDirectory,
    resolveAbsolutePath,
};
// #endregion exports
