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
// #endregion module
