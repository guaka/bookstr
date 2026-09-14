import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const filename = new URL('../index.html', import.meta.url).pathname;
const html = fs.readFileSync(filename, 'utf8');
function setup() {
  const disabled = new Set();
  const inputs = [];
  const target = { innerHTML: '', classList: { add() {}, remove() {} }, replaceChildren() {}, querySelectorAll: () => inputs };
  const sources = [{ id: 'libcat', name: 'Libcat', search: async () => [{ id: 'same', searchSourceId: 'libcat' }] },
    { id: 'public', name: 'Public', search: async () => [{ id: 'same' }, { id: 'public' }] }];
  const context = vm.createContext({ document: { getElementById: () => target }, searchSourceRegistry: () => sources,
    isSearchSourceEnabled: id => !disabled.has(id), setSearchSourceEnabled: (id, enabled) => enabled ? disabled.delete(id) : disabled.add(id),
    startSearch: options => { context.options = options; }, escapeHtml: String,
    SEARCH_RESULT_LIMIT: 200, dedupeBooks: books => books.filter((b, i) => books.findIndex(a => a.id === b.id) === i),
    cachedBookKeys: new Set(['cached']), bookCacheKey: b => b.id,
    BookMetadata: { canonicalReadUrl: b => b.readUrl }, BOOKS_API_BASE: '' });
  for (const [start, end] of [
    ['      function defaultSearchResultRank', '      let unglueItUnavailable'],
    ['      function renderSearchSourceProgress', '      function searchOutcomeSummary'],
  ]) {
    const offset = html.indexOf(start);
    vm.runInContext('\n'.repeat(html.slice(0, offset).split('\n').length - 1) + html.slice(offset, html.indexOf(end, offset)), context, { filename });
  }
  return { context, disabled, inputs, target, sources };
}

test('Libcat outranks cached and downloadable public results, with stable ties', () => {
  const { context: c } = setup();
  const books = [{ id: 'plain' }, { id: 'download', readUrl: 'url' }, { id: 'cached' },
    { id: 'catalog1', searchSourceId: 'libcat' }, { id: 'catalog2', searchSourceId: 'libcat' }];
  assert.deepEqual(Array.from(c.rankSearchResults(books), b => b.id), ['catalog1', 'catalog2', 'cached', 'download', 'plain']);
});

test('progress toggles persist changes and refresh without using stale cache', () => {
  const { context: c, sources, target, inputs, disabled } = setup();
  let change;
  inputs.push({ addEventListener: (name, handler) => { assert.equal(name, 'change'); change = handler; } });
  c.renderSearchSourceProgress([]);
  for (const entry of [{ state: 'pending' }, { state: 'failed' }, { state: 'done', count: 1 }, { count: 2 }, { error: true }, { state: 'cached' }]) {
    c.renderSearchSourceProgress([{ source: sources[0], ...entry }]);
    assert.match(target.innerHTML, /type="checkbox"/);
  }
  change({ currentTarget: { dataset: { sourceId: 'libcat' }, checked: false } });
  assert.ok(disabled.has('libcat'));
  assert.equal(c.options.bypassCache, true);
  assert.equal(c.options.updateHash, false);
  c.renderSearchSourceProgress([{ source: sources[0], state: 'done' }]);
  assert.match(target.innerHTML, />Off</);
  change({ currentTarget: { dataset: { sourceId: 'libcat' }, checked: true } });
  assert.ok(!disabled.has('libcat'));
  c.document.getElementById = () => null;
  c.renderSearchSourceProgress([]);
});

test('Libcat wins duplicates regardless of completion order and disabled sources never run', async () => {
  const { context: c, sources, disabled } = setup();
  let release;
  sources[0].search = () => new Promise(resolve => { release = resolve; });
  const updates = [];
  const pending = c.searchAvailableBookSources('book', (progress, books) => updates.push(books));
  await Promise.resolve();
  release([{ id: 'same', searchSourceId: 'libcat' }]);
  const result = await pending;
  assert.equal(result.books[0].searchSourceId, 'libcat');
  assert.equal(result.books.length, 2);
  assert.ok(updates.some(books => books[0]?.id === 'same' && !books[0].searchSourceId));
  disabled.add('libcat');
  sources[0].search = () => { throw Error('disabled source ran'); };
  assert.equal((await c.searchAvailableBookSources('book')).outcomes.length, 1);
  sources[1].search = async () => { throw Error('offline'); };
  await assert.rejects(c.searchAvailableBookSources('book'), /Public: offline/);
  disabled.add('public');
  assert.equal((await c.searchAvailableBookSources('book')).books.length, 0);
});

test('initial and additional Libcat pages retain their search origin', async () => {
  const { context: c } = setup();
  Object.assign(c, { activeSearchGeneration: 1, searchType: { value: 'all' }, nostrSigner: {}, publishRelayEvent() {},
    normalizeSearchBooks: response => response.books,
    searchLoadMore: { disabled: false, classList: { toggle() {} } },
    searchResultBooks: [], searchResultFilter: {}, searchResultPage: 1, replaceSearchHash() {},
    renderResults: books => { c.searchResultBooks = books; },
    nip17FetchModule: Promise.resolve({ searchLibcat: async (_query, _type, options) => ({
      books: [{ id: options.offset ? 'second' : 'first' }], next_offset: options.offset ? null : 50,
    }) }),
  });
  const offset = html.indexOf('      async function searchLibcatSource');
  vm.runInContext('\n'.repeat(html.slice(0, offset).split('\n').length - 1) + html.slice(offset, html.indexOf('      function searchSourceRegistry', offset)), c, { filename });
  const books = await c.searchLibcatSource('query');
  assert.equal(books[0].searchSourceId, 'libcat');
  c.searchResultBooks = books;
  await c.loadMoreLibcat();
  assert.deepEqual(Array.from(c.searchResultBooks, b => b.searchSourceId), ['libcat', 'libcat']);
});
