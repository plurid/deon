// #region module
/**
 * Modified from `@plurid/plurid-functions.sha`.
 *
 * @param data
 * @param algorithm
 * @returns
 */
const compute = async (
    data: string,
    algorithm: string = 'sha256',
): Promise<string | undefined> => {
    if (typeof window !== 'undefined') {
        return;
    }

    const crypto = require('crypto');
    return crypto
        .createHash(algorithm)
        .update(data)
        .digest('hex');
}
// #endregion module



// #region exports
export default {
    compute,
};
// #endregion exports
