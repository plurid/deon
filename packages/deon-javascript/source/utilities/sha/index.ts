// #region module
/**
 * Modified from `@plurid/plurid-functions.sha`.
 *
 * Uses the Web Crypto API, which is present in both Node (18+) and the browser. The previous
 * `require('crypto')` was unreachable from the ESM bundle, where `require` is not defined.
 *
 * Specification 9: a cache identifier is a digest, so a credential never appears in it in plain text.
 *
 * @param data
 * @param algorithm
 * @returns
 */
const compute = async (
    data: string,
    algorithm: string = 'sha256',
): Promise<string | undefined> => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        return;
    }

    const name = algorithm.toUpperCase().replace(/^SHA-?(\d+)$/, 'SHA-$1');
    const digest = await subtle.digest(
        name,
        new TextEncoder().encode(data),
    );

    return Array.from(
        new Uint8Array(digest),
        byte => byte.toString(16).padStart(2, '0'),
    ).join('');
}
// #endregion module



// #region exports
export default {
    compute,
};
// #endregion exports
