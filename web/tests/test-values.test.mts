import assert from 'node:assert/strict';
import test from 'node:test';
import { present, record } from './test-values.mts';

test('present preserves falsy values and rejects absent values', () => {
  for (const value of [false, 0, '', {}, []]) assert.equal(present(value), value);
  for (const value of [null, undefined]) assert.throws(() => present(value), /Expected a present value/);
});

test('record validates object records without accepting arrays or primitives', () => {
  const value = { title: 'A book' };
  assert.equal(record(value), value);
  for (const invalid of [null, undefined, 1, 'book', [], false]) {
    assert.throws(() => record(invalid), /Expected an object record/);
  }
});
