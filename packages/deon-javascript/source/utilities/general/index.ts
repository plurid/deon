// #region imports
    // #region external
    import {
        DEON_FILENAME_EXTENSION,
    } from '../../data/constants';

    import {
        TokenType,
    } from '../../data/enumerations';

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


const isURL = (
    path: string,
) => {
    return path.startsWith('http');
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
// #endregion module



// #region exports
export {
    mapToObject,
    isURL,
    solveExtensionName,
    inGroupClassify,
};
// #endregion exports
