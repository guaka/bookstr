import assert from 'node:assert/strict';

export function present<T>(value: T): NonNullable<T> {
  assert.ok(value != null, 'Expected a present value');
  return value;
}

export function record(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected an object record');
  return value as Record<string, unknown>;
}
