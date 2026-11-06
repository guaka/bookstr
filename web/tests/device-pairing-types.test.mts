/// <reference path="../types/migrated-esm-dependencies.d.ts" />
import assert from 'node:assert/strict';
import test from 'node:test';

type BrowserOptions = NonNullable<ConstructorParameters<typeof import('../shared/contracts/device-pairing-client.mjs').DevicePairingClient>[0]>;
type SharedOptions = NonNullable<ConstructorParameters<typeof import('../../shared/contracts/device-pairing-client.mts').DevicePairingClient>[0]>;
type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
// Compilation checks that the browser ambient constructor mirrors the canonical source.
const optionsMatch: Equal<BrowserOptions, SharedOptions> = true;
test('browser pairing constructor options match the canonical shared contract', () => {
  assert.equal(optionsMatch, true);
});
