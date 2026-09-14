import { test, expect } from '@playwright/test';

async function setup(page) {
  await page.route('**/nip17-fetch.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    export async function searchLibcat(query, type, options) {
      window.catalogCalls ||= [];
      window.catalogCalls.push({query, type, offset: options.offset || 0});
      if (window.failCatalogPage && options.offset) throw new Error('Catalog disconnected');
      return {books: [{md5: (options.offset ? 'b' : 'a').repeat(32), title: options.offset ? 'History Volume Two' : 'History Volume One', author: 'Catalog Author', extension: 'epub', language: 'en', id: options.offset ? 2 : 1}], next_offset: options.offset ? undefined : 50};
    }
    export async function sendLibVaultFavoritesSync() { return {}; }
  ` }));
  await page.route('https://books-api.guaka.org/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ books: [], results: [], data: [], response: { docs: [] } }) }));
  await page.addInitScript(() => {
    window.nostr = {
      getPublicKey: async () => '7'.repeat(64),
      signEvent: async event => ({ ...event, id: '1'.repeat(64), pubkey: '7'.repeat(64), sig: 'f'.repeat(128) }),
      nip44: { encrypt: async (_peer, text) => text, decrypt: async () => '[]' },
    };
  });
  await page.goto('/#settings');
  await page.locator('#nip7-connect').click();
  await expect(page.locator('#nip7-status')).toContainText('Connected as');
  await page.goto('/#search');
  await expect(page.locator('tr[data-source="libcat"]')).toBeVisible();
  for (const id of await page.locator('[data-action="toggle-search-source"]:not([data-source-id="libcat"])').evaluateAll(inputs => inputs.map(input => input.dataset.sourceId))) await page.locator(`[data-source-id="${id}"]`).uncheck();
}

test('Libcat loads private catalog pages and keeps failed pages retryable', async ({ page }) => {
  await setup(page);
  const query = page.getByRole('textbox', { name: 'Book search query' });
  await query.fill('history');
  await query.press('Enter');
  await expect(page.locator('#results')).toContainText('History Volume One');
  const more = page.getByRole('button', { name: 'Load more Libcat results' });
  await expect(more).toBeVisible();
  await page.evaluate(() => { window.failCatalogPage = true; });
  await more.click();
  await expect(page.locator('#status')).toContainText('Catalog disconnected');
  await expect(more).toBeEnabled();
  await page.evaluate(() => { window.failCatalogPage = false; });
  await more.click();
  await expect(page.locator('#results')).toContainText('History Volume Two');
  await expect(page.locator('#results')).toContainText('History Volume One');
  await expect(more).toBeHidden();
  expect(await page.evaluate(() => window.catalogCalls.map(call => call.offset))).toEqual([0, 50, 50]);
  expect(await page.evaluate(() => localStorage.getItem('bookstr_search_cache_v1'))).toBeNull();
});
