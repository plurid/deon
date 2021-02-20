declare class Deon {
    demand(
        args: string[],
    ): any;
    parseFile: (
        file: any,
        options: any,
    ) => any;
    parse: (
        data: any,
        options: any,
    ) => any;
    parseSynchronous: (
        data: any,
        options: any,
    ) => any;
    stringify: (
        data: any,
        options: any,
    ) => any;
    canonical: (
        data: any,
        options: any,
    ) => any;
}

declare class DeonPure {
    parse: (
        data: any,
        options: any,
    ) => any;
    parseSynchronous: (
        data: any,
        options: any,
    ) => any;
    stringify: (
        data: any,
        options: any,
    ) => any;
    canonical: (
        data: any,
        options: any,
    ) => any;
}

declare module 'sync-fetch';
