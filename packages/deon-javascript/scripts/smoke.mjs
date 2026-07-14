import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const commonjs = require('../distribution/index.cjs');
const module = await import('../distribution/index.mjs');
const pureCommonjs = require('../distribution/pure.cjs');
const pureModule = await import('../distribution/pure.mjs');

assert.equal(typeof commonjs.default, 'function');
assert.equal(typeof module.default, 'function');
assert.equal(typeof pureCommonjs.DeonPure, 'function');
assert.equal(typeof pureModule.DeonPure, 'function');
assert.deepEqual(new commonjs.default().parseSynchronous('{ key value }'), { key: 'value' });
