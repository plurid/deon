import { rm } from 'node:fs/promises';

await rm(new URL('../.test-build', import.meta.url), { force: true, recursive: true });
