// #region module
export interface DeonParseOptions {
    absolutePaths: Record<string, string>,
    authorization: Record<string, string>,
    datasignFiles: string[];
    datasignMap: Record<string, string>;
}

export type PartialDeonParseOptions = Partial<DeonParseOptions>;


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
// #endregion module
