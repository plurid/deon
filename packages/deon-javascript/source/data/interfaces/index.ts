// #region module
export interface DeonParseOptions {
    filebase: string;
    absolutePaths: Record<string, string>,
    authorization: Record<string, string>,
    datasignFiles: string[];
    datasignMap: Record<string, string>;
    allowFilesystem: boolean;
    allowNetwork: boolean;
}

export type PartialDeonParseOptions = Partial<DeonParseOptions>;


export interface DeonLoadEnvironmentOptions {
    overwrite?: boolean;
}


export interface DeonStringifyOptions {
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
