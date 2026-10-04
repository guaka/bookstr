import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const docs = fs.readFileSync(new URL('../../docs/ELECTRON_SOURCES.md', import.meta.url), 'utf8');

function sourceIds(isDesktopMode) {
  const start = html.indexOf('      function searchSourceRegistry()');
  const end = html.indexOf('      function disabledSearchSourceIds()', start);
  const context = vm.createContext({
    isDesktopMode,
    state: { nip7: { pubkey: 'connected' }, settings: { opdsFeeds: [{ name: 'Custom', url: 'https://books.example/opds' }] } },
    nostrSigner: { nip44: { decrypt() {} } },
    searchLibcatSource() {}, searchAllBooksPartySource() {}, searchUnglueIt() {},
    searchProjectGutenberg() {}, searchOapen() {}, searchOpenTextbookLibrary() {},
    searchDoab() {}, searchGlobalDigitalLibrary() {}, searchInternetArchive() {},
    normalizePublicOPDSFeedSettings: feeds => feeds,
    searchCustomOPDSFeed() {},
  });
  vm.runInContext(html.slice(start, end), context, { filename: 'web/index.html' });
  return Array.from(vm.runInContext('searchSourceRegistry().map(source => source.id)', context));
}

test('Electron exposes only Libcat while web keeps its configured catalog sources', () => {
  assert.deepEqual(sourceIds(true), ['libcat']);
  const webSources = sourceIds(false);
  assert.ok(webSources.includes('libcat'));
  assert.ok(webSources.includes('all-books-party'));
  assert.ok(webSources.includes('opds-https://books.example/opds'));
});

test('Electron source documentation records deferred public providers', () => {
  assert.match(docs, /Electron currently searches Libcat/);
  const normalizedDocs = docs.replace(/\s+/g, ' ');
  for (const source of ['all.books.party', 'Unglue.it', 'Project Gutenberg', 'OAPEN', 'Open Textbook Library', 'DOAB', 'Global Digital Library', 'Internet Archive', 'custom OPDS']) {
    assert.ok(normalizedDocs.includes(source), `missing deferred source: ${source}`);
  }
});
