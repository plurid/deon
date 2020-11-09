// #region imports
    // #region libraries
    import path from 'path';
    // #endregion libraries
// #endregion imports



// #region module
const resolveBasePath = (
    parsedFile: string | undefined,
    filebase: string,
) => {
    if (!parsedFile) {
        return filebase;
    }

    if (path.isAbsolute(parsedFile)) {
        return path.dirname(parsedFile);
    }

    return path.dirname(
        path.join(
            filebase,
            path.basename(parsedFile)
        ),
    );
}
// #endregion module



// #region exports
export {
    resolveBasePath,
};
// #endregion exports
