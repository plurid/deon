declare function describe(name: string, body: () => void): void;
declare function it(name: string, body: () => unknown | Promise<unknown>): void;
declare function xit(name: string, body: () => unknown | Promise<unknown>): void;
declare function expect<T>(actual: T): { toBeTruthy(): void; toEqual(expected: unknown): void };
