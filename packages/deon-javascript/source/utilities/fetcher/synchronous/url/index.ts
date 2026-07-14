// #region imports
    // #region libraries
    import {
        execFileSync,
    } from 'node:child_process';
    // #endregion libraries


    // #region external
    import {
        FetcherType,
    } from '../../../../data/interfaces';

    import resolveFetchURL from '../../logic/resolveFetchURL';
    // #endregion external
// #endregion imports



// #region module
const fetchFromURL = (
    url: string,
    token?: string,
    type?: FetcherType,
) => {
    const {
        headers,
        filetype,
    } = resolveFetchURL(
        url,
        token,
        type,
    );

    // The platform has no synchronous fetch, so a child process performs the request and hands the
    // text back. The request is written to its input rather than onto its command line, so that an
    // authenticator never appears in the process list.
    const script = `
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);

        const { url, headers } = JSON.parse(Buffer.concat(chunks).toString('utf8'));

        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error('HTTP ' + response.status);

        process.stdout.write(await response.text());
    `;

    const data = execFileSync(
        process.execPath,
        ['--input-type=module', '--eval', script],
        {
            encoding: 'utf8',
            input: JSON.stringify({ url, headers }),
            maxBuffer: 64 * 1024 * 1024,
        },
    );

    return {
        data,
        filetype,
        resourceId: url,
    };
}
// #endregion module



// #region exports
export {
    fetchFromURL,
};
// #endregion exports
