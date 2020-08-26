// #region module
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
