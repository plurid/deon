// #region imports
    // #region external
    import type {
        DatasignReader,
    } from '../../utilities/datasign';
    // #endregion external
// #endregion imports



// #region module
export interface DeonParseOptions {
    sourceName: string;
    filebase: string;
    absolutePaths: Record<string, string>,
    authorization: Record<string, string>,

    /** Paths of the `.datasign` files whose contracts type the parsed data. */
    datasignFiles: string[];
    /** Root keys of the `.deon` file mapped to the datasign types expected of them. */
    datasignMap: Record<string, string>;
    /** Replaces the built-in `.datasign` reader. */
    datasignReader?: DatasignReader;
    allowFilesystem: boolean;
    allowNetwork: boolean;
    cache: boolean;
    cacheDuration: number;
    cacheDirectory: string;
    token: string;
    environment: Record<string, string | undefined>;
    resources: Record<string, string>;
    resourceStack: string[];

    /**
     * The maximum number of code points substitution may produce — across every interpolation and
     * every string spread — before evaluation stops with `DEON_LIMIT_EXCEEDED` (specification 11).
     * It bounds the doubling blow-up by which a few lines of interpolation assemble gigabytes. Zero
     * or absent is the host default.
     */
    expansion: number;
}

export type PartialDeonParseOptions = Partial<DeonParseOptions>;


export interface DeonLoadEnvironmentOptions {
    overwrite?: boolean;
}


export interface DeonStringifyOptions {
    canonical: boolean;
    readable: boolean;
    indentation: number;
    leaflinks: boolean;
    leaflinkLevel: number;
    leaflinkShortening: boolean;
    generatedHeader: boolean;
    generatedComments: boolean;
}

export type PartialDeonStringifyOptions = Partial<DeonStringifyOptions>;


export type RootKind = 'map' | 'list';


export interface DeonInterpreterOptions {
    file: string | undefined;
    parseOptions: PartialDeonParseOptions | undefined;
}


export type FetcherType = 'inject' | 'import';


export type ScanMode = 'MAP' | 'LIST' | '';



export interface ConfiledFile {
    data: string;
}


/**
 * A declaration, and the arguments it would demand if it were called.
 *
 * An entity that carries interpolations is a template: `#name(parameter value)` fills them in. The
 * parameters are exactly the interpolation names it carries (specification 11) — an environment name
 * is read from the environment rather than passed in, so it is not one of them.
 */
export interface DeonEntity {
    name: string;
    parameters: string[];
    kind: 'scalar' | 'map' | 'list' | 'structure' | 'link' | 'call' | 'resource';
}
// #endregion module
