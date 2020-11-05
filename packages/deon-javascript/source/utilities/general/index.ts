// #region imports
    // #region external
    import {
        DEON_FILENAME_EXTENSION,
    } from '../../data/constants';
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
// #endregion module



// #region exports
export {
    mapToObject,
    isURL,
    solveExtensionName,
};
// #endregion exports
