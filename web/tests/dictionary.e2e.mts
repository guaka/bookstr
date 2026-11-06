import { test, expect } from '@playwright/test';

test('dictionary packs persist across reloads through the extracted browser module', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const moduleURL = new URL('/dictionary-store.js', location.href).href;
    const { openDictionaryStore } = await import(moduleURL) as typeof import('../src/dictionary-store.js');
    await openDictionaryStore().put({
      id: 'en-es', source: 'en', target: 'es', label: 'Dictionary fixture',
      bytes: new Uint8Array([1, 2, 3, 4]).buffer, size: 4, lastUsed: 12,
    });
  });
  await page.reload();
  const records = await page.evaluate(async () => {
    const moduleURL = new URL('/dictionary-store.js', location.href).href;
    const { openDictionaryStore } = await import(moduleURL) as typeof import('../src/dictionary-store.js');
    const store = openDictionaryStore();
    const saved = await store.records();
    await store.delete('en-es');
    return { saved: saved.map(pack => ({ id: pack.id, bytes: [...new Uint8Array(pack.bytes)] })), remaining: await store.records() };
  });
  expect(records).toEqual({ saved: [{ id: 'en-es', bytes: [1, 2, 3, 4] }], remaining: [] });
});
