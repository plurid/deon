// #region imports
    // #region external
    import {
        TokenType,
    } from '../../data/enumerations';

    import {
        DEON_FILENAME_EXTENSION,
    } from '../../data/constants';

    import Token from '../../objects/Token';
    // #endregion external
// #endregion imports



// #region module
const mapToObject = <K, V>(
    map: Map<K, V>,
) => {
    let obj: any = {};

    for (let [k,v] of map) {
        obj[k] = v;
    }

    return obj;
}


const inGroupClassify = (
    tokens: Token[],
) => {
    if (tokens.length === 0) {
        return 'LEAFLINK';
    }

    const curlyBrackets = {
        left: 0,
        right: 0,
    };
    const squareBrackets = {
        left: 0,
        right: 0,
    };

    for (const token of tokens) {
        switch (token.type) {
            case TokenType.LEFT_CURLY_BRACKET:
                curlyBrackets.left += 1;
                break;
            case TokenType.RIGHT_CURLY_BRACKET:
                curlyBrackets.right += 1;
                break;
            case TokenType.LEFT_SQUARE_BRACKET:
                squareBrackets.left += 1;
                break;
            case TokenType.RIGHT_SQUARE_BRACKET:
                squareBrackets.right += 1;
                break;
        }

        if (curlyBrackets.left > curlyBrackets.right) {
            return 'MAP';
        }

        if (squareBrackets.left > squareBrackets.right) {
            return 'LIST';
        }
    }

    /**
     * TODO
     * to find a less expensive way to check for leaflinks
     */
    if (
        curlyBrackets.left === curlyBrackets.right
        && squareBrackets.left === squareBrackets.right
    ) {
        return 'LEAFLINK';
    }

    return;
}


const removeEndDoubleNewline = (
    value: string,
) => {
    return value.slice(
        0,
        value.length - 1,
    );
}


const isURL = (
    path: string,
) => {
    return /^https?:\/\//i.test(path);
}


const solveExtensionName = (
    type: string,
    extname: string,
) => {
    if (type === 'inject') {
        return {
            filetype: extname,
            concatenate: false,
        };
    }

    if (type === 'import') {
        if (extname === '.deon') {
            return {
                filetype: extname,
                concatenate: false,
            };
        }

        if (extname === '.json') {
            return {
                filetype: extname,
                concatenate: false,
            };
        }

        if (!extname) {
            return {
                filetype: DEON_FILENAME_EXTENSION,
                concatenate: true,
            };
        }

        return {
            filetype: extname,
            concatenate: false,
        };
    }

    return {
        filetype: extname,
        concatenate: false,
    };
}


/**
 * Absolute in the sense the language means it, rather than the sense a particular host means it: a
 * rooted path, or a path on a named drive.
 */
const isAbsolutePath = (
    value: string,
) => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);


/**
 * Maps a logical absolute target onto the host path that actually holds it (specification 9).
 *
 * An exact key wins before any wildcard. Among the wildcards, which end in `/*`, the longest prefix
 * wins, and whatever of the target the prefix did not match is appended to the mapped directory.
 *
 * This lives here, rather than beside the filesystem that reads the file, because the mapping is a
 * property of the target and not of whoever resolves it: a resource handed over through `resources`
 * must map exactly as one read from the disk, or the same document would mean two different things.
 */
const resolveMappedAbsolutePath = (
    file: string,
    mappings: Record<string, string>,
) => {
    // Only an absolute target is logical. A relative one resolves against the document holding it.
    if (!isAbsolutePath(file)) {
        return file;
    }

    if (Object.prototype.hasOwnProperty.call(mappings, file)) {
        return mappings[file];
    }

    const wildcard = Object.keys(mappings)
        .filter(key => key.endsWith('/*') && file.startsWith(key.slice(0, -1)))
        .sort((left, right) => right.length - left.length)[0];

    if (!wildcard) {
        return file;
    }

    const prefix = wildcard.slice(0, -1);
    const suffix = file.slice(prefix.length);
    const directory = mappings[wildcard].replace(/\/+$/, '');

    return `${directory}/${suffix}`;
}
// #endregion module



// #region exports
export {
    mapToObject,
    inGroupClassify,
    removeEndDoubleNewline,
    isURL,
    isAbsolutePath,
    solveExtensionName,
    resolveMappedAbsolutePath,
};
// #endregion exports
