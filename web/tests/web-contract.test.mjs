import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const designTokens = await readFile(new URL('../design-tokens.css', import.meta.url), 'utf8');
const desktopProgress = await readFile(new URL('../desktop-progress.js', import.meta.url), 'utf8');
const readerHtml = await readFile(new URL('../reader.html', import.meta.url), 'utf8');
const pdfReaderHtml = await readFile(new URL('../pdf-reader.html', import.meta.url), 'utf8');
const pdfReaderJs = await readFile(new URL('../pdf-reader.js', import.meta.url), 'utf8');
const desktopMain = await readFile(new URL('../../desktop/main.js', import.meta.url), 'utf8');
const desktopPreload = await readFile(new URL('../../desktop/preload.js', import.meta.url), 'utf8');
const desktopWebTorrent = await readFile(new URL('../../desktop/webtorrent-bridge.js', import.meta.url), 'utf8');
const webtorrentDevBridge = await readFile(new URL('../webtorrent-dev-bridge.mjs', import.meta.url), 'utf8');
const coverAssets = await readFile(new URL('../cover-assets.js', import.meta.url), 'utf8');
const bookMetadata = await readFile(new URL('../book-metadata.js', import.meta.url), 'utf8');
const webdev = await readFile(new URL('../../webdev.py', import.meta.url), 'utf8');

test('Electron catalog search uses the allowlisted app protocol without a private signer', () => {
  assert.match(html, /const BOOKS_API_BASE = window\.location\.protocol === 'app:'[\s\S]*?typeof window\.bookstrDesktop\?\.openReader === 'function'[\s\S]*?\? 'app:\/\/bookstr\/api'/);
  assert.match(html, /const isDesktopMode = window\.location\.protocol === 'app:' && Boolean\(desktopBridge\?\.openReader\)/);
  assert.doesNotMatch(html, /function privateBookSearchAvailable\(\)/);
  assert.match(desktopMain, /const \{ proxyCatalogRequest \} = require\('\.\/catalog-proxy'\)/);
  assert.match(desktopMain, /const catalogResponse = await proxyCatalogRequest\(request, net\.fetch\)/);
  assert.match(html, /async function searchProjectGutenberg\(query\)/);
  assert.match(html, /name: 'Project Gutenberg'/);
  assert.match(html, /name: 'OAPEN'/);
  assert.match(html, /name: 'Open Textbook Library'/);
  assert.match(html, /async function searchOapen\(query\)/);
  assert.match(html, /async function searchOpenTextbookLibrary\(query\)/);
  assert.match(html, /name: 'DOAB'/);
  assert.match(html, /name: 'Global Digital Library'/);
  assert.match(html, /async function searchDoab\(query\)/);
  assert.match(html, /async function searchGlobalDigitalLibrary\(query\)/);
  assert.match(html, /\/gdl-epub\?id=/);
  assert.match(html, /\/oapen-file\?id=/);
});

test('Search explains active sources and fans out without private-first fallback', () => {
  assert.match(html, /<h2 class="search-title">Search books<\/h2>/);
  assert.match(html, /<table id="search-sources-table" class="search-sources-table">/);
  assert.match(html, /<th>Source<\/th><th>Coverage<\/th><th>Delivers<\/th><th>Use<\/th>/);
  assert.match(html, /name: 'all\.books\.party'/);
  assert.match(html, /name: 'Unglue\.it'/);
  assert.doesNotMatch(html, /name: 'LibVault'/);
  assert.match(
    html,
    /async function searchAvailableBookSources\(query, onUpdate = \(\) => \{\}\)/,
  );
  assert.match(html, /await Promise\.all\(sources\.map/);
  assert.match(html, /id="search-source-progress" class="search-source-progress hidden"/);
  assert.match(html, /Done · \$\{Number\(entry\.count \|\| 0\)\} result/);
  assert.match(html, /onUpdate\([\s\S]*progress\.slice\(\),[\s\S]*mergedBooks\(\)/);
  assert.match(html, /if \(!query\) \{\s*renderSearchSources\(\)/);
  assert.doesNotMatch(html, /Private search unavailable; trying the HTTP catalog/);
  assert.match(html, /@media \(max-width: 600px\)[\s\S]*\.search-sources-table td::before/);
});

test('Search sources are default-on, locally toggleable, and excluded from fan-out and cache identity', () => {
  assert.match(html, /const SEARCH_SOURCE_SETTINGS_KEY = 'bookstr_search_sources_v1'/);
  assert.match(html, /function disabledSearchSourceIds\(\)[\s\S]*?new Set\(Array\.isArray\(stored\)/);
  assert.match(html, /data-action="toggle-search-source"[\s\S]*?\$\{enabled \? 'checked' : ''\}/);
  assert.match(html, /setSearchSourceEnabled\(event\.currentTarget\.dataset\.sourceId, event\.currentTarget\.checked\)/);
  assert.match(html, /searchSourceRegistry\(\)\.filter\(source => isSearchSourceEnabled\(source\.id\)\)/);
  assert.match(html, /sources: searchSourceRegistry\(\)\.filter\(source => isSearchSourceEnabled\(source\.id\)\)\.map\(source => source\.id\)\.sort\(\)/);
  assert.match(html, /if \(!sources.length\) \{[\s\S]*?return \{ books: \[\], outcomes: \[\] \}/);
});

test('search retains synced public OPDS sources without exposing feed editing in settings', () => {
  assert.doesNotMatch(html, /async function searchLitresPublicDomain\(query\)/);
  assert.doesNotMatch(html, /\/litres\/search\?q=/);
  assert.doesNotMatch(html, /name: 'LitRes Public Domain'/);
  assert.match(html, /async function searchCustomOPDSFeed\(feed, query\)/);
  assert.match(html, /getOPDSSourcesModule\(\)/);
  assert.match(html, /opds-/);
  assert.match(html, /deliveries: \['Metadata', 'FB2'\]/);
  assert.doesNotMatch(html, /id="opds-feeds"|Public OPDS feeds|settings-opds|opds-feed-input/);
  assert.match(html, /function normalizePublicOPDSFeedSettings\(value\)/);
  assert.match(html, /bookstr-opds-feeds/);
  assert.match(html, /bookstr-opds-feed/);
  assert.match(html, /function applySharedOPDSFeedTags\(tags\)/);
  assert.match(html, /opdsFeeds: normalizePublicOPDSFeedSettings\(payload\.opdsFeeds\)/);
});

test('People loads the connected user follow list and public book lists', () => {
  assert.match(html, /id="people-tab-btn"/);
  assert.match(html, /id="people-list"/);
  assert.match(html, /const NOSTR_FOLLOW_KIND = 3/);
  assert.match(html, /async function pullNostrFollows\(pubkey\)/);
  assert.match(html, /NostrSocial\.latestFollowEvent\(verified, pubkey\)/);
  assert.match(html, /NostrSocial\.followsFromEvent/);
  assert.match(html, /async function pullFollowedPublicBookLists\(follows\)/);
  assert.match(html, /NostrSocial\.publicBookLists\(verified, pubkeys\)/);
  assert.match(html, /async function pullFollowedProfiles\(follows\)/);
  assert.match(html, /kinds: \[0\]/);
  assert.match(html, /NostrSocial\.latestProfiles\(verified, pubkeys\)/);
  assert.match(html, /hintedAuthorsByRelay\.get\(follow\.relay\)/);
  assert.match(html, /NostrSocial\.nip05Matches\(document, parts\.name, profile\.pubkey\)/);
  assert.match(html, /profile\?\.verifiedNip05/);
  assert.match(html, /const NOSTR_SOCIAL_RELAYS = \['wss:\/\/relay\.trustroots\.org'\]/);
  assert.match(html, /const NOSTR_TRUSTROOTS_PROFILE_RELAY = 'wss:\/\/nip42\.trustroots\.org'/);
  assert.match(html, /NostrSocial\.nip42AuthTemplate\(relayUrl, id\)/);
  assert.match(html, /socket\.send\(JSON\.stringify\(\['AUTH', signed\]\)\)/);
  assert.match(html, /socket\.send\(JSON\.stringify\(\['AUTH', signed\]\)\);[\s\S]*?authenticatedRequestSent = true;[\s\S]*?sendRequest\(\)/);
  assert.match(html, /readRelayEvents\(NOSTR_TRUSTROOTS_PROFILE_RELAY,[\s\S]*?kinds: \[0\],[\s\S]*?\{ authenticate: true \}/);
  assert.match(html, /new Set\(\[\.\.\.NOSTR_RELAYS, \.\.\.NOSTR_SOCIAL_RELAYS\]\)/);
  assert.match(html, /tools\.verifyEvent\(event\)/);
  assert.match(html, /setHashRoute\(isDesktopMode \? 'devices' : 'people'\)/);
});

test('served web app remains React- and bundle-free', () => {
  assert.doesNotMatch(html, /react(?:-dom)?(?:\.production)?/i);
  assert.doesNotMatch(html, /node_modules|bookstr-dist/i);
});

test('cross-device favorites retain iOS metadata and expose retryable Home sync', async () => {
  const agents = await readFile(new URL('../../AGENTS.md', import.meta.url), 'utf8');
  assert.match(agents, /All new and changed executable lines must be covered by automated tests/);
  assert.match(html, /id="home-sync-refresh"/);
  assert.match(html, /id="home-sync-state"/);
  assert.match(html, /name === 'bookstr' && tag\[1\]/);
  assert.match(html, /entry\.title = tag\[2\]/);
  assert.match(html, /function nextFavoritesCreatedAt\(\)/);
  assert.match(html, /setTimeout\(\(\) => void connectNip7\(\{ silent: true, quick: false \}\), 1500\)/);
  assert.match(html, /window\.addEventListener\('focus', scheduleFocusedNostrSync\)/);
  assert.match(html, /Nostr library sync failed:/);
  assert.match(html, /const rootEvents = await verifiedNostrEvents\(rawRootEvents\)/);
  assert.match(html, /const chunkEvents = await verifiedNostrEvents\(rawChunkEvents\)/);
  assert.match(html, /syncNostrLibraryFromNip7\(\{ useCache: false \}\)/);
  assert.match(html, /Showing cached library · sync failed · retry/);
  assert.doesNotMatch(html, /lastFavoritePullInfo\.id\.slice/);
  assert.doesNotMatch(html, /lastFavoritePullInfo\.createdAt/);
  assert.doesNotMatch(html, /toLocaleString\(\)/);
});

test('footer links to the latest released Android APK', () => {
  assert.match(html, /github\.com\/guaka\/bookstr\/releases\/latest/);
  assert.match(html, /Download the latest Bookstr Android APK/);
});

test('browser traffic uses the Cloudflare books API', () => {
  assert.match(html, /const BOOKS_API_BASE = window\.location\.protocol === 'app:'[\s\S]*?: 'https:\/\/books-api\.guaka\.org\/api'/);
  assert.doesNotMatch(html, /localhost:11111\/api|books\.guaka\.org\/api\/search/);
});

test('search uses public catalog sources without private LibVault search', () => {
  assert.doesNotMatch(html, /async function searchViaNostr\(query\)/);
  assert.doesNotMatch(html, /id: 'libvault'[\s\S]*?search:/);
  assert.match(html, /const outcomes = await Promise\.all\(sources\.map/);
  assert.match(html, /const books = await source\.search\(query\)/);
  assert.match(html, /const SEARCH_RESULT_LIMIT = 200/);
  assert.match(html, /limit=\$\{SEARCH_RESULT_LIMIT\}/);
  assert.doesNotMatch(html, /search\?q=\$\{encodeURIComponent\(query\)\}&limit=20/);
});

test('Search no longer exposes LibVault inside-book search', () => {
  assert.doesNotMatch(html, /<option value="content">/);
  assert.doesNotMatch(html, /searchType\.value === 'content'/);
  assert.doesNotMatch(html, /Searching privately through LibVault/);
  assert.match(html, /Searching book catalogs/);
});

test('authors stay green on Home and Search even when links are globally red', () => {
  assert.match(html, /body a\.result-author:any-link[\s\S]*?color: var\(--reading-progress\)/);
  assert.match(html, /body a\.result-author:visited/);
  assert.match(html, /body a\.result-author:hover/);
  assert.match(html, /body a\.result-author:focus-visible/);
});

test('Search visibly shows the sent and received NIP-17 exchange', () => {
  assert.match(html, /id="nip17-exchange"/);
  assert.match(html, /id="nip17-sent"/);
  assert.match(html, /id="nip17-received"/);
  assert.match(html, /decrypted_payload: trace\.payload/);
  assert.match(html, /gift_wrap_event: trace\.event/);
  assert.match(html, /recipient_nip05: trace\.recipientNip05/);
  assert.match(html, /onTrace: showNip17Trace/);
  assert.match(html, /id="results"[\s\S]*?id="nip17-exchange"/);
});

test('Search offers result-driven language and format filters', () => {
  assert.match(html, /id="search-language-filter"/);
  assert.match(html, /id="search-format-filter"/);
  assert.match(html, /const visible = values\.length > 1/);
  assert.match(html, /searchResultBooks\.map\(resultLanguage\)/);
  assert.match(html, /searchResultBooks\.map\(resultFormat\)/);
  assert.match(html, /resultLanguage\(book\) === searchResultFilter\.language/);
  assert.match(html, /resultFormat\(book\) === searchResultFilter\.format/);
  assert.match(html, /<form id="search-form"[\s\S]*?id="query-input"[\s\S]*?id="search-result-filters"[\s\S]*?<\/form>/);
  assert.doesNotMatch(html, /id="search-language-filter-wrap"[^>]*>\s*Language/);
  assert.doesNotMatch(html, /id="search-format-filter-wrap"[^>]*>\s*Format/);
});

test('Search paginates the fully filtered and sorted result set', () => {
  assert.match(html, /const SEARCH_RESULT_PAGE_SIZE = 50/);
  assert.match(html, /id="results"[\s\S]*?id="search-pagination"[\s\S]*?id="nip17-exchange"/);
  assert.match(html, /const filteredBooks = filteredSearchResultBooks\(\)[\s\S]*?const sortedBooks = searchResultSort\.key[\s\S]*?const pageBooks = sortedBooks\.slice\(start, start \+ SEARCH_RESULT_PAGE_SIZE\)/);
  assert.match(html, /searchPagination\.classList\.toggle\('hidden', totalPages <= 1\)/);
  assert.match(html, /\.search-pagination\.hidden\s*\{[\s\S]*?display: none/);
  assert.match(html, /searchPageLabel\.textContent = `Page \$\{searchResultPage\} of \$\{totalPages\} · \$\{sortedBooks\.length\} results`/);
  assert.match(html, /searchPagePrev\.addEventListener\('click', openSearchResultPage\)/);
  assert.match(html, /searchPageNext\.addEventListener\('click', openSearchResultPage\)/);
  assert.match(html, /searchResultPage = requestedPage[\s\S]*?renderResults\(searchResultBooks, \{ preserveResults: true \}\)/);
  assert.match(html, /id="search-page-prev"[^>]*aria-label="Previous page"[\s\S]*?<svg/);
  assert.match(html, /id="search-page-next"[^>]*aria-label="Next page"[\s\S]*?<svg/);
});

test('Search keeps a persistent result count beside the paged results', () => {
  assert.match(html, /id="search-result-count"[^>]*>0 results<\/p>/);
  assert.match(html, /searchResultCount\.textContent = sortedBooks\.length === searchResultBooks\.length/);
  assert.match(html, /`\$\{sortedBooks\.length\} of \$\{searchResultBooks\.length\} results`/);
  assert.doesNotMatch(html, /searchResultCount\.classList\.add\('hidden'\)/);
});

test('Search owns one control for adding opened books to the Library', () => {
  assert.equal((html.match(/class="search-auto-reading"/g) || []).length, 1);
  assert.equal((html.match(/Add opened books to Library/g) || []).length, 1);
  assert.match(html, /id="search-auto-reading-top"[\s\S]*?id="results"/);
  assert.match(html, /const autoReadingInputs = \[\.\.\.document\.querySelectorAll\('\.search-auto-reading'\)\]/);
  assert.match(html, /for \(const peer of autoReadingInputs\) peer\.checked = input\.checked/);
  assert.doesNotMatch(html, /id="auto-reading"/);
  assert.doesNotMatch(html, /<strong>Reading library<\/strong><small>Add books when you open them\.<\/small>/);
});

test('Search stores result filters and paging in bookmarkable hash parameters', () => {
  assert.match(html, /function searchHashRoute\(/);
  assert.match(html, /params\.set\('language', language\)/);
  assert.match(html, /params\.set\('format', format\)/);
  assert.match(html, /params\.set\('page', String\(page\)\)/);
  assert.match(html, /const params = new URLSearchParams\(route\)/);
  assert.match(html, /language: params\.get\('language'\) \|\| ''/);
  assert.match(html, /format: params\.get\('format'\) \|\| ''/);
  assert.match(html, /page: Math\.max\(1, Number\(params\.get\('page'\)\) \|\| 1\)/);
  assert.match(html, /replaceSearchHash\(\)/);
});

test('favorites do not show LibVault fetch progress', () => {
  assert.doesNotMatch(html, /favorite-fetch-progress/);
});

test('Search requires whole query tokens instead of prefix matches', () => {
  assert.match(html, /function matchesExactSearchTokens\(book, query, type = 'all'\)/);
  assert.match(html, /new Set\(exactSearchTokens\(selected\.filter\(Boolean\)\.join\(' '\)\)\)/);
  assert.match(html, /every\(term => available\.has\(term\)\)/);
  assert.match(html, /books = books\.filter\(book => matchesExactSearchTokens\(book, query, searchType\.value \|\| 'all'\)\)/);
});

test('desktop availability only marks records with resolved torrent metadata as available', () => {
  assert.doesNotMatch(html, /source !== 'Blossom'/);
  assert.match(html, /const hasTorrent = BookMetadata\.torrentMetadataForBook\(book\)[\s\S]*?BookMetadata\.libgenTorrentMetadataForBook\(book\)/);
  assert.match(html, /return isDesktopMode && hasTorrent \? 'Available' : ''/);
  assert.doesNotMatch(html, /availabilitySources\.unshift\('Torrent'\)/);
  assert.match(html, /function torrentStatusForBook\(book\)[\s\S]*?const hasTorrent = BookMetadata\.torrentMetadataForBook\(book\)[\s\S]*?BookMetadata\.libgenTorrentMetadataForBook\(book\)/);
  assert.match(html, /const availability = availabilityLabel\(book\)/);
  assert.match(html, /class="availability-primary\$\{availabilityClass/);
  assert.doesNotMatch(html, /secondaryAvailability/);
  assert.doesNotMatch(html, /class="availability-detail"/);
});

test('Electron opens LibGen catalog records through their repository torrent batch', () => {
  assert.match(html, /const libgenId = isMd5\(rawId\)/);
  assert.match(html, /resolveLibcatBook\(torrentBook/);
  assert.match(html, /Resolving torrent metadata for/);
  assert.match(html, /desktopBridge\.library\.acquireLibgen\(torrentBook, \{/);
  assert.match(html, /!readPath && !cached && !torrentAvailable/);
  assert.match(desktopPreload, /acquireLibgen\(book, options = \{\}\)/);
  assert.match(desktopMain, /bookstr-desktop-library-acquire-libgen/);
  assert.match(desktopMain, /await resolveRegisteredLibraryFile\(bookId\)/);
  assert.match(desktopMain, /source: 'local'/);
  assert.match(desktopMain, /getAcquisitionManager\(\)\.acquireLibgen\(request\.book/);
  assert.match(html, /if \(result\.sha256\) book\.sha256 = result\.sha256/);
  assert.match(html, /updateDesktopDownloadSummary\(\)/);
});

test('simultaneous torrent progress is combined into one stable status', () => {
  assert.match(html, /function activeDesktopDownloads\(\)/);
  assert.match(html, /function desktopDownloadSummary\(\)/);
  assert.match(html, /return `\$\{active\.length\} torrent downloads\$\{details\.length \? ` · \$\{details\.join\(' · '\)\}` : ''\}`/);
  assert.match(html, /details\.push\(`\$\{percent\}% overall`\)/);
  assert.match(html, /details\.push\(`\$\{waiting\} waiting`\)/);
  assert.match(html, /details\.push\(`\$\{peers\} peers`\)/);
  assert.match(html, /desktopDownloadStatusTimer = setTimeout\(updateDesktopDownloadSummary, 180\)/);
  assert.doesNotMatch(html, /status\.textContent = peers > 0[\s\S]*?Downloading \$\{torrentBook\.title/);
});

test('book opening canonicalizes stable Gutenberg IDs', () => {
  assert.match(html, /const readPath = BookMetadata\.canonicalReadUrl\(book, BOOKS_API_BASE\)/);
  assert.match(html, /isDesktopGutenbergDownload = \/\^app:\\\/\\\/bookstr\\\/api\\\/books\\\/\\d\+\\\/download/);
  assert.match(html, /\|\| isDesktopGutenbergDownload\) \{[\s\S]*?openResolvedReadRoute\(bookRef\)/);
});

test('LibVault books keep stable MD5 routes without a Blossom download fallback', () => {
  assert.match(html, /return isMd5\(md5\) \? md5/);
  assert.match(html, /legacyMd5 = routeValue\.match/);
  assert.doesNotMatch(html, /fetchBlossomCopy|desktopBlossomProxyUrl/);
  assert.doesNotMatch(desktopMain, /proxyBlossomRequest|BLOSSOM_PROXY_BASE_URL/);
  assert.match(html, /BookMetadata\.mergeLibraryState\(state\.reading, state\.favorites\)/);
  assert.match(html, /pendingReadBookId = String\(bookRef\)\.toLowerCase\(\)/);
  assert.match(html, /function bookCacheKey\(book, readUrl\)[\s\S]*?isMd5\(md5\) \? md5/);
});

test('reading mode forwards global Left and Right keys to the EPUB reader', () => {
  assert.match(html, /event\.key === 'ArrowLeft' \? 'prevPage' : 'nextPage'/);
  assert.match(html, /readerFrame\.contentWindow\?\.\[command\]\?\.\(\)/);
});

test('Home and empty Search use distinct hash routes', () => {
  assert.match(html, /id="home-tab-btn"/);
  assert.match(html, /setHashRoute\(homeHashRoute\(\)\)/);
  assert.match(html, /setHashRoute\(query\.length >= 2 \? searchHashRoute\(\{ query \}\) : 'search'\)/);
  assert.match(html, /if \(route === 'search'\)/);
});

test('search results expose separately sortable license and publication year columns', () => {
  assert.match(html, /className = 'book-table'/);
  assert.match(html, /\['Rights', 'rights'\], \['Year', 'year'\]/);
  assert.match(html, /\['Year', 'year'\]/);
  assert.match(html, /function renderBookTable\(target, books, options = \{\}\)/);
	assert.match(html, /result-rights[\s\S]*?rightsMarkerMarkup\(book\)[\s\S]*?result-year[\s\S]*?escapeHtml\(book\.year \|\| '—'\)/);
});

test('rights metadata is visible and preserved through library and Nostr flows', () => {
	assert.match(html, /function rightsMarkerMarkup\(book\)/);
	assert.match(bookMetadata, /No open license identified/);
	assert.match(html, /\['bookstr-publications', '2'\]/);
	assert.match(html, /rights\.rights_status, rights\.license, rights\.license_url, rights\.rights_source/);
	assert.match(html, /\.\.\.BookMetadata\.normalizeRights\(book\)/);
	assert.match(html, /bookstr-reader-metadata/);
});

test('Open Library result metadata links to its canonical record', () => {
  assert.match(html, /sourceNativeId: item\.source_native_id \|\| item\.sourceNativeId/);
  assert.match(html, /class="result-source"[\s\S]*?target="_blank"/);
  assert.match(html, /BookMetadata\.canonicalCatalogUrl\(book\)/);
});

test('every search result title links through the read hash route', () => {
  assert.match(html, /const canOpen = options\.routeOnly/);
  assert.match(html, /const searchBook = searchResultBooks\.find/);
  assert.match(html, /label: 'Book search results',[\s\S]*?routeOnly: true/);
});

test('torrent acquisition does not fall back to LibVault managed copies', () => {
  assert.doesNotMatch(html, /fetchLibVaultManagedCopy/);
  assert.doesNotMatch(html, /LIBVAULT_API_BASE\}\/read/);
  assert.doesNotMatch(html, /LIBVAULT_API_BASE\}\/fetch/);
  assert.doesNotMatch(html, /LIBVAULT_API_BASE\}\/jobs/);
  assert.match(html, /result = await desktopBridge\.library\.acquireLibgen\(torrentBook, \{/);
});

test('the web client never turns Blossom response data into readable content', () => {
  assert.doesNotMatch(html, /payload\?\.blossoms/);
  assert.doesNotMatch(html, /payload\?\.covers/);
  assert.doesNotMatch(html, /\|\| blossom\.url/);
  assert.doesNotMatch(html, /book\?\.blossomUrl[\s\S]{0,80}bookCache/);
  assert.doesNotMatch(bookMetadata, /source\.blossomUrl/);
  assert.doesNotMatch(bookMetadata, /book\?\.readUrl \|\| book\?\.url \|\| book\?\.blossomUrl/);
});

test('read links remain addressable when a book has no MD5', () => {
  assert.match(html, /return direct \|\| `book:\$\{BookMetadata\.bookIdentity\(book\)\}`/);
  assert.match(html, /if \(bookId\.startsWith\('book:'\)\)/);
  assert.match(html, /BookMetadata\.bookIdentity\(book\) === identity/);
  assert.match(html, /\^\(\?:book:\|https\?:\|blob:\)/);
});

test('Home titles use the same read hash resolver as Search titles', () => {
  assert.match(html, /label: 'Library',[\s\S]*?routeOnly: true/);
  assert.doesNotMatch(html, /label: 'Library',[\s\S]*?onOpen: book => void openLibraryBook/);
});

test('Home and Search share tables with covers and author search links', () => {
  assert.match(html, /renderBookTable\(target, books/);
  assert.match(html, /bookCoverUrls\(book\)/);
  assert.doesNotMatch(html, /const LIBVAULT_COVER_BASE/);
  assert.match(html, /CoverAssets\.bookCoverCandidates\(book/);
  assert.doesNotMatch(html, /payload\?\.covers/);
  assert.match(html, /coverUrl: item\.cover_url \|\| item\.coverUrl \|\| item\.thumbnail \|\| ''/);
  assert.match(html, /data-action="author-search"/);
  assert.match(html, /requestAnimationFrame\(\(\) => homeQueryInput\.focus\(\)\)/);
});

test('cover hover previews are substantially enlarged', () => {
  assert.match(html, /\.result-cover-slot\.has-real-cover:hover \.result-cover\.is-real-cover[\s\S]*?transform: scale\(6\)/);
  assert.match(html, /\.result-cover[\s\S]*?pointer-events: none/);
  assert.match(html, /transform 160ms ease 180ms/);
});

test('table authors are green and only unavailable titles are red', () => {
  assert.match(html, /\.result-author:visited[\s\S]*?color: var\(--reading-progress\)/);
  assert.match(html, /\.result-title\.readable:visited[\s\S]*?color: var\(--reading-progress\)/);
  assert.match(html, /\.result-title\.unavailable:visited[\s\S]*?color: var\(--link-hover\)/);
  assert.match(html, /Boolean\(BookMetadata\.canonicalReadUrl\(book, BOOKS_API_BASE\)\)/);
  assert.match(html, /const readableNow = isBookReadableNow\(book\)/);
  assert.match(html, /titleAvailabilityClass = readableNow \? 'readable' : 'unavailable'/);
  assert.match(html, /<span class="result-author" title="\$\{escapeHtml\(fullAuthors\)\}" aria-label="\$\{escapeHtml\(fullAuthors\)\}">\$\{escapeHtml\(fullAuthors\)\}<\/span>/);
  assert.match(html, /\.result-author:focus-visible[\s\S]*?color: var\(--reading-progress\)/);
});

test('table languages use short codes instead of full names', () => {
  assert.match(html, /nl: 'Dutch'/);
  assert.match(html, /name\.toLowerCase\(\) === rawLanguage/);
  assert.match(html, /\{ eng: 'en', por: 'pt' \}/);
  assert.match(html, /languageCode\.toUpperCase\(\)/);
  assert.doesNotMatch(html, /String\(book\.language\)\.toUpperCase\(\)/);
});

test('table formats use lowercase names', () => {
  assert.match(html, /String\(book\.extension \|\| book\.format \|\| '—'\)\.toLowerCase\(\)/);
  assert.doesNotMatch(html, /String\(book\.extension \|\| book\.format \|\| '—'\)\.toUpperCase\(\)/);
});

test('library sync does not poll LibVault or Blossom publication jobs', () => {
  assert.doesNotMatch(html, /function refreshFavoriteBlossomCopies\(\)/);
  assert.doesNotMatch(html, /lookupLibVaultBlossomState\(book\.md5\)/);
  assert.doesNotMatch(html, /favoriteBlossomRefreshRetryTimer/);
});

test('reader no longer uses legacy Blossom cache identities or constructs Blossom URLs', () => {
  assert.doesNotMatch(html, /book\?\.blossomUrl/);
  assert.doesNotMatch(html, /blossomUrl \|\|= `https:\/\/blossom\.bfr\.ee/);
});

test('browser EPUBs use IndexedDB while Electron purges the legacy cache and keeps library metadata', () => {
  assert.match(html, /indexedDB\.open\(BOOK_CACHE_DB_NAME/);
  assert.match(html, /cachedBookBlob\(book, readPath\)/);
  assert.match(html, /cacheBookBlob\(book, readPath, blob\)/);
  assert.match(html, /async function cachedBookBlob\(book, readUrl\) \{\s*if \(isDesktopMode\) return null/);
  assert.match(html, /async function cacheBookBlob\(book, readUrl, blob\) \{\s*if \(isDesktopMode\) return/);
  assert.match(html, /async function purgeLegacyBookCache\(\)/);
  assert.match(html, /indexedDB\.deleteDatabase\(BOOK_CACHE_DB_NAME\)/);
  assert.match(html, /if \(isDesktopMode\) \{\s*void purgeLegacyBookCache\(\)/);
  assert.match(html, /function cacheRecordMatches\(record, book, readUrl\)/);
  assert.match(html, /if \(record\.key !== key\) await bookCacheDelete\(record\.key\)/);
  assert.match(html, /records\.forEach\(rememberCachedRecord\)/);
  assert.match(html, /const openGeneration = \+\+readerOpenGeneration/);
  assert.match(html, /if \(openGeneration !== readerOpenGeneration\) return/);
  assert.match(html, /async function readerFrameLoader\(kind, openGeneration, bookId\)/);
  assert.match(html, /readerFrameNavigation\?\.cancel\(\)/);
  assert.match(html, /readerFrameBookId === requestedBookId/);
  assert.match(html, /readinessTimer = setInterval\(resolveWhenReady, 50\)/);
  assert.match(html, /clearInterval\(readinessTimer\)/);
  assert.match(html, /readerFrame\.src = `\$\{readerPath\}\?load=\$\{navigationId\}`/);
  assert.match(html, /const readerLoad = await readerFrameLoader\('epub', openGeneration, book\.md5 \|\| BookMetadata\.bookIdentity\(book\)\)/);
  assert.match(html, /const routeGeneration = \+\+readRouteGeneration/);
  assert.match(html, /if \(routeGeneration !== readRouteGeneration\) return/);
});

test('octet-stream ZIPs with an EPUB container are not mistaken for comics just because they contain images', () => {
  const signatureBranch = html.slice(html.indexOf("if (bytes[0] === 0x50 && bytes[1] === 0x4b)"));
  assert.ok(signatureBranch.includes("const names = Object.keys(zip.files).map(name => name.replaceAll('\\\\', '/'));"));
  assert.ok(signatureBranch.includes("if (names.some(name => /(^|\\/)META-INF\\/container\\.xml$/i.test(name))) return 'epub';"));
  assert.ok(signatureBranch.includes("return names.some(name => isComicImageName(name)) ? 'cbz' : 'epub';"));
});

test('library formats avoid an EPUB default and trust inspected local bytes', () => {
  assert.match(html, /const explicitFormat = String\(ref\.format \|\| ref\.extension \|\| ''\)/);
  assert.match(html, /const normalizedFormat = trustExplicitFormat \|\| formatProvenance \? explicitFormat : ''/);
  assert.match(html, /extension: String\(payload\.extension \|\| payload\.format \|\| ''\)\.toLowerCase\(\)/);
  assert.match(html, /trustExplicitFormat && explicitFormat && !formatProvenance \? \{ extension: 'nostr' \}/);
  assert.match(html, /normalizeFavoriteFromRemote\(item, \{ trustExplicitFormat: false \}\)/);
  assert.match(html, /if \(!remoteHasExplicitFormat && !knownFormatProvenance\)/);
  assert.match(html, /provenance === 'local-file' && metadata\?\.extension/);
  assert.match(html, /function rememberDetectedBookFormat\(book, format\)/);
  assert.match(html, /extension: 'detected-local'/);
  assert.match(html, /rememberDetectedBookFormat\(book, torrentFormat\)/);
});

test('settings persist Arial and justified reader typography by default', () => {
  assert.match(html, /id="reader-font"/);
  assert.match(html, /id="reader-alignment"/);
  assert.match(html, /<option value="arial">Arial<\/option>/);
  assert.match(html, /<option value="justified">Justified<\/option>/);
  assert.match(html, /readerFont: 'arial'/);
  assert.match(html, /readerAlignment: 'justified'/);
  assert.match(html, /<script src="reader-typography\.js"><\/script>/);
  assert.match(html, /function applyOpenReaderTypography\(\)/);
  assert.match(html, /applyOpenReaderTypography\(\)/);
  assert.match(html, /BookstrTypography\.normalizeFont\(state\.settings\.readerFont\)/);
  assert.match(html, /BookstrTypography\.normalizeAlignment\(state\.settings\.readerAlignment\)/);
});

test('PDFs are fetched and displayed inside the Bookstr reader pane', () => {
  assert.match(html, /async function displayPdf\(blob, book, readPath, openGeneration\)/);
  assert.match(html, /new Blob\(\[blob\], \{ type: 'application\/pdf' \}\)/);
  assert.match(html, /PDF download failed/);
  assert.match(html, /await displayPdf\(blob, book, readPath, openGeneration\)/);
  assert.match(html, /const readerPath = kind === 'pdf' \? 'pdf-reader\.html' : kind === 'fb2' \? 'fb2-reader\.html' : kind === 'comic' \? 'comic-reader\.html' : 'reader\.html'/);
  assert.match(html, /const readerLoad = await readerFrameLoader\('pdf', openGeneration, book\.md5 \|\| BookMetadata\.bookIdentity\(book\)\)/);
  assert.match(html, /filename: pdfDownloadFilename\(book\)/);
  assert.match(html, /return `\$\{safeTitle \|\| 'Bookstr book'\}\.pdf`/);
  assert.match(html, /String\.fromCharCode\(\.\.\.bytes\) === '%PDF-'/);
  assert.match(html, /const cachedFormat = await bookFormatForBlob\(cached\)/);
  assert.match(html, /const torrentFormat = await bookFormatForBlob\(torrentBlob\)/);
  assert.match(html, /\/\\\.epub\(\?:\\\?\|\$\)\/i\.test\(readPath\)/);
  assert.match(html, /api\\\/files\\\/\[a-f0-9\]\{32\}/);
  assert.match(html, /if \(format === 'pdf'\) await displayPdf\(blob, book, readPath, openGeneration\)/);
  assert.doesNotMatch(html, /openInDesktopReader/);
  assert.doesNotMatch(html, /desktopBridge\.openReader\(payload\)/);
});

test('desktop EPUB and PDF readers stay inside the main reading pane', () => {
  assert.match(html, /const readerLoad = await readerFrameLoader\('epub', openGeneration, book\.md5 \|\| BookMetadata\.bookIdentity\(book\)\)/);
  assert.match(html, /const readerLoad = await readerFrameLoader\('pdf', openGeneration, book\.md5 \|\| BookMetadata\.bookIdentity\(book\)\)/);
  assert.doesNotMatch(html, /async function openInDesktopReader/);
  assert.equal((desktopMain.match(/new BrowserWindow\(/g) || []).length, 1);
  assert.match(desktopMain, /mainWindow\.once\('ready-to-show',[\s\S]*?mainWindow\.maximize\(\);[\s\S]*?mainWindow\.show\(\)/);
  assert.match(desktopMain, /void webContents\.loadURL\(url\);\r?\n\s*return \{ action: 'deny' \}/);
});

test('desktop main process enforces reader payloads and returns explicit open results', () => {
  assert.match(desktopMain, /function normalizePayload\(payload\)/);
  assert.match(desktopMain, /font: String\(payload\.font \|\| 'arial'\)\.toLowerCase\(\)/);
  assert.match(desktopMain, /alignment: String\(payload\.alignment \|\| 'justified'\)\.toLowerCase\(\)/);
  assert.match(desktopMain, /return \{ ok: false, error: 'Invalid reader payload\.' \}/);
  assert.match(desktopMain, /return \{ ok: true, key, reused: currentURL === readerURL, kind: requestedKind \}/);
  assert.match(desktopMain, /ALLOWED_EXTERNAL_URL_PROTOCOLS/);
  assert.match(desktopMain, /function focusLibraryWindow\(\)/);
  assert.match(desktopMain, /function setupApplicationMenu\(\)/);
  assert.match(desktopMain, /isExternalUrlAllowed\(/);
  assert.match(desktopMain, /setupApplicationMenu\(\);/);
  assert.match(desktopMain, /async function loadNostrTools\(\)/);
  assert.match(desktopMain, /async function resolveNostrSignerSecret\(\)/);
  assert.match(desktopMain, /async function resolveNostrSignerPublicKey\(\)/);
  assert.match(desktopMain, /function normalizeNostrEventPayload\(payload\)/);
  assert.match(desktopMain, /function normalizeNip44Payload\(payload\)/);
  assert.match(desktopMain, /ipcMain\.handle\('bookstr-desktop-nostr-get-public-key'/);
  assert.match(desktopMain, /ipcMain\.handle\('bookstr-desktop-nostr-sign-event'/);
  assert.match(desktopMain, /ipcMain\.handle\('bookstr-desktop-nostr-nip44-encrypt'/);
  assert.match(desktopMain, /ipcMain\.handle\('bookstr-desktop-nostr-nip44-decrypt'/);
  assert.match(desktopMain, /ipcMain\.handle\('bookstr-desktop-nostr-nip19-npub'/);
  assert.doesNotMatch(desktopMain, /Nostr signer is not configured\./);
});

test('desktop preload exposes a deterministic openReader contract', () => {
  assert.match(desktopPreload, /const desktopBridge = \{/);
  assert.match(desktopPreload, /openReader\(payload\) \{/);
  assert.match(desktopPreload, /ipcRenderer\s*\.invoke\('bookstr-desktop-open-reader', payload\)/);
  assert.match(desktopPreload, /Boolean\(result && result\.ok\)/);
  assert.match(desktopPreload, /focusLibrary\(\) \{/);
  assert.match(desktopPreload, /const desktopSigner = \{/);
  assert.match(desktopPreload, /getPublicKey\(\)/);
  assert.match(desktopPreload, /signEvent\(event\)/);
  assert.match(desktopPreload, /nip19: \{/);
});

test('EPUB reader destroys the previous rendition without transform flicker', () => {
  assert.match(readerHtml, /const generation = \+\+bookLoadGeneration/);
  assert.match(readerHtml, /if \(rendition\) rendition\.destroy\(\)/);
  assert.match(readerHtml, /if \(book\) book\.destroy\(\)/);
  assert.match(readerHtml, /document\.getElementById\("viewer"\)\.replaceChildren\(\)/);
  assert.doesNotMatch(readerHtml, /#viewer\.page-forward/);
  assert.doesNotMatch(readerHtml, /viewer\.offsetWidth/);
});

test('EPUB reader registers desktop open-reader and progress handlers', () => {
  assert.match(readerHtml, /const desktopBridge = window\.bookstrDesktop \|\| window\.parent\?\.bookstrDesktop \|\| null;/);
  assert.match(readerHtml, /desktopBridge\.onOpenReader/);
  assert.match(readerHtml, /reportDesktopProgress\(/);
  assert.match(readerHtml, /window\.addEventListener\("beforeunload", function\(\) \{/);
});

test('EPUB reader exposes read-aloud controls and speech helpers', () => {
  assert.match(readerHtml, /<script src="reader-speech\.js"><\/script>/);
  assert.match(readerHtml, /id="reader-speech-controls"/);
  assert.match(readerHtml, /id="reader-speech-play"/);
  assert.match(readerHtml, /id="reader-speech-pause"/);
  assert.match(readerHtml, /id="reader-speech-stop"/);
  assert.match(readerHtml, /function setReaderSpeechState\(state\)/);
  assert.match(readerHtml, /function hasSpeechSupport\(\)/);
  assert.match(readerHtml, /function collectReaderSpeechPlan\(\)/);
  assert.match(readerHtml, /window\.BookstrSpeech\.speakableBlocks/);
  assert.match(readerHtml, /collectFromViews\(""\)/);
  assert.match(readerHtml, /window\.BookstrSpeech\.visibleText\(element\)/);
  assert.match(readerHtml, /window\.setReaderTypography/);
  assert.match(readerHtml, /locatorSkipDecision/);
  assert.match(readerHtml, /lastSpeechCfi/);
  assert.match(readerHtml, /<script src="reader-typography\.js"><\/script>/);
  assert.match(readerHtml, /BookstrTypography\.css/);
  assert.match(readerHtml, /Arial, Helvetica, sans-serif/);
  assert.match(readerHtml, /window\.BookstrSpeech\.buildPlan\(paragraphs,\s*\{/);
  assert.match(readerHtml, /desktopBridge &&/);
  assert.match(readerHtml, /function stopReaderSpeech\(\)/);
  assert.match(readerHtml, /function startReaderSpeech\(\)/);
  assert.match(readerHtml, /function pauseReaderSpeech\(\)/);
});

test('PDF reader uses local PDF.js, lazy page rendering, and an explicit download name', () => {
  assert.match(pdfReaderHtml, /<main id="pages" aria-label="PDF pages">/);
  assert.match(pdfReaderJs, /from '\.\/vendor\/pdfjs\/pdf\.mjs'/);
  assert.match(pdfReaderJs, /GlobalWorkerOptions\.workerSrc = '\.\/vendor\/pdfjs\/pdf\.worker\.mjs'/);
  assert.match(pdfReaderJs, /new IntersectionObserver/);
  assert.match(pdfReaderJs, /download\.download = String\(filename \|\| 'Book\.pdf'\)\.replace/);
  assert.match(pdfReaderJs, /pdf\?\.destroy\(\)/);
  assert.match(pdfReaderJs, /const desktopBridge = window\.bookstrDesktop \|\| window\.parent\?\.bookstrDesktop \|\| null;/);
  assert.match(pdfReaderJs, /if \(desktopBridge\?\.onOpenReader\)/);
  assert.match(pdfReaderJs, /desktopBridge\.reportProgress/);
  assert.match(pdfReaderJs, /normalizeDesktopReaderPayload/);
  assert.match(pdfReaderJs, /window\.addEventListener\('beforeunload',/);
  assert.match(pdfReaderJs, /const pdfSpeechControls = document\.getElementById\("pdf-speech-controls"\);/);
  assert.match(pdfReaderJs, /const pdfSpeechPlayButton = document\.getElementById\("pdf-speech-play"\);/);
  assert.match(pdfReaderHtml, /id="pdf-speech-controls"/);
  assert.match(pdfReaderHtml, /<script src="reader-speech\.js"><\/script>/);
  assert.match(pdfReaderJs, /function startPdfSpeech\(\)/);
  assert.match(pdfReaderJs, /function setPdfSpeechState\(state\)/);
  assert.match(pdfReaderJs, /collectPdfSpeechPlan/);
  assert.match(pdfReaderJs, /window\.BookstrSpeech\.buildPlan\(paragraphs,\s*\{/);
  assert.match(pdfReaderJs, /desktopBridge &&/);
  assert.match(pdfReaderJs, /pausePdfSpeech/);
});

test('favorites are not truncated to fifty items', () => {
  assert.doesNotMatch(html, /state\.favorites[^;]*slice\(0,\s*50\)/s);
});

test('favoriting syncs only through the user Nostr collection', () => {
  assert.doesNotMatch(html, /requestFavoriteFromLibVault\(book\)/);
  assert.doesNotMatch(html, /sendLibVaultFavoritesSync\(/);
  assert.doesNotMatch(html, /monitorLibVaultFetch\(book\.md5/);
  assert.doesNotMatch(html, /favorite-fetch-progress/);
  assert.match(html, /queueFavoriteSync\(\)/);
});

test('compact favorites retain cached metadata and resolve LibVault IDs', () => {
  assert.match(html, /function preserveFavoriteMetadata\(remote\)/);
  assert.match(html, /\.map\(preserveFavoriteMetadata\)/);
  assert.match(html, /sourceNativeId: ref\.sourceNativeId \|\| ref\.source_native_id \|\| ''/);
  assert.doesNotMatch(html, /fetch\([^)]*lib\.b\.bfr\.ee\/api\/books/);
  assert.doesNotMatch(html, /new URL\(`\/api\/books\/\$\{/);
});

test('compact favorites retain Blossom cover descriptors', () => {
  assert.match(html, /favorite\.coverUrl \|\| '', favorite\.coverSha256 \|\| ''/);
  assert.match(html, /entry\.coverUrl = tag\[9\]/);
  assert.match(html, /entry\.coverSha256 = tag\[10\]/);
});

test('desktop covers skip private HTTP fallbacks and retry public cover candidates', () => {
  assert.match(html, /CoverAssets\.bookCoverCandidates\(book,[\s\S]*?desktop: isDesktopMode/);
  assert.match(html, /CoverAssets\.attachImageFallback\(row\.querySelector\('\.result-cover'\), realCoverUrls, \{ key: coverKey \}\)/);
  assert.doesNotMatch(coverAssets, /blossom\.bfr\.ee|blossomBase/);
  assert.ok(coverAssets.includes('lib\\.b\\.bfr\\.ee'));
  assert.match(coverAssets, /data:image\/svg\+xml/);
});

test('an incomplete new favorites generation falls back to an older root', () => {
  assert.match(html, /for \(const rootEvent of rootEvents\)/);
  assert.match(html, /A partial new generation must not hide an older complete snapshot/);
});

test('legacy LibVault URL tags restore their embedded favorite ID', () => {
  assert.match(html, /new URLSearchParams\(url\.hash\.split\('\?'\)\[1\] \|\| ''\)\.get\('md5'\)/);
});

test('Home title links do not use the catalog-search workaround', () => {
  assert.match(html, /label: 'Library',[\s\S]*?routeOnly: true/);
  assert.doesNotMatch(html, /onOpen: book => void openLibraryBook\(book\)/);
});

test('Home shows the deduplicated library book count inline after its heading', () => {
  assert.match(html, /homeLibraryHeading\?\.append\(homeLibraryCount\)/);
  assert.match(html, /\.library-book-count[\s\S]*?font-size: 0\.68rem/);
  assert.match(html, /const visibleCount = matchingBooks\.length === enrichedLibrary\.length/);
  assert.match(html, /`\$\{enrichedLibrary\.length\} \$\{enrichedLibrary\.length === 1 \? 'book' : 'books'\}`/);
  assert.match(html, /`\$\{matchingBooks\.length\} of \$\{enrichedLibrary\.length\} books`/);
  assert.match(html, /const readableCount = matchingBooks\.filter\(isBookReadableNow\)\.length/);
  assert.match(html, /`\$\{visibleCount\} · \$\{readableCount\} readable now · \$\{downloadingCount\} downloading · \$\{seedingCount\} seeding\$\{transferRates\}`/);
});

test('Home readable count uses the same availability rule as title coloring', () => {
  assert.match(html, /function isBookReadableNow\(book\)/);
  assert.match(html, /cachedBookKeys\.has\(bookCacheKey\(book, book\.readUrl \|\| book\.url\)\)/);
  assert.match(html, /String\(download\?\.status \|\| ''\)\.toLowerCase\(\) === 'ready'/);
  assert.match(html, /Boolean\(BookMetadata\.canonicalReadUrl\(book, BOOKS_API_BASE\)\)/);
  assert.doesNotMatch(html, /function isBookReadableNow\(book\)[\s\S]{0,500}isMd5\(book\?\.md5\)/);
  assert.match(html, /const readableNow = isBookReadableNow\(book\)/);
});

test('Home reports live seeded books in each row and in the total', () => {
  assert.match(html, /const desktopSeededBookIds = new Set\(\)/);
  assert.match(html, /if \(isBookSeeded\(book\)\) return 'Seeding'/);
  assert.match(html, /transfer\?\.seeding !== true/);
  assert.match(html, /Array\.isArray\(transfer\?\.bookIds\) \? transfer\.bookIds : \[transfer\?\.bookId\]/);
  assert.match(html, /const seedingCount = enrichedLibrary\.filter\(isBookSeeded\)\.length/);
  assert.match(html, /setInterval\(\(\) => void refreshDesktopDownloadStates\(\), 5000\)/);
});

test('book details show live torrent state while the file is not ready', () => {
  assert.match(html, /id = 'read-metadata-fallback-torrent'/);
  assert.match(html, /torrent\.textContent = statusLabel/);
  assert.match(html, /statusLabel = torrentStatusForBook\(book\)/);
  assert.match(html, /updateReadTorrentStatus\(activeReadingBook\)/);
  assert.match(html, /!desktopDownloadStatesReady\) return 'Looking for torrents'/);
  assert.match(html, /desktopDownloadStatesReady = true/);
  assert.match(html, /torrent\.className = \['read-torrent-status', 'status-with-dot', torrentStatusClass\(statusLabel\)\]/);
  assert.match(html, /title = 'Downloading this book'/);
  assert.match(html, /It will open automatically when the file is ready\./);
  assert.doesNotMatch(html, /Source URL:/);
  assert.doesNotMatch(html, /function diagnosticUrl\(/);
});

test('torrent messages use colored state dots', () => {
  assert.match(html, /function torrentStatusClass\(label\)/);
  assert.match(html, /status-dot-waiting::before \{ background: #d89b2b; \}/);
  assert.match(html, /status-dot-downloading::before \{ background: #3887d6; \}/);
  assert.match(html, /status-dot-success::before \{ background: #2c9b63; \}/);
  assert.match(html, /status-dot-error::before \{ background: #d24d49; \}/);
  assert.match(html, /availability-primary\$\{availabilityClass \? ` status-with-dot \$\{availabilityClass\}` : ''\}/);
});

test('book details use a compact metadata grid with human-readable digest and rights labels', () => {
  assert.match(html, /metadata\.className = 'read-metadata-grid'/);
  assert.match(html, /\^\[a-f0-9\]\{32\}\$\/i\.test\(digest\)[\s\S]*?\? 'MD5'/);
  assert.match(html, /\^openlibrary:\/i\.test\(digest\)[\s\S]*?\? 'Open Library'/);
  assert.match(html, /link\.href = catalogUrl;[\s\S]*?replace\(\/\^openlibrary:\/i, ''\)/);
  assert.match(html, /epub_opf: 'EPUB metadata'/);
  assert.match(html, /\.read-metadata-grid dd\.metadata-digest/);
  assert.match(html, /font-size: clamp\(1\.45rem, 2\.3vw, 2\.15rem\)/);
  assert.match(html, /\.read-metadata-grid dd\.metadata-authors[\s\S]*?-webkit-line-clamp: 2/);
  assert.match(html, /link\.href = `#search=\$\{encodeURIComponent\(authorSearchName\(value\)\)\}`/);
  assert.match(html, /link\.addEventListener\('click',[\s\S]*?searchForAuthor\(book\)/);
});

test('constrained author lists stay compact while retaining their full accessible value', () => {
  assert.match(html, /\.result-author,[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap/);
  assert.match(html, /const fullAuthors = String\(book\.authors \|\| book\.author \|\| ''\)\.trim\(\)/);
  assert.match(html, /class="result-author"[\s\S]*?title="\$\{escapeHtml\(fullAuthors\)\}"[\s\S]*?aria-label="\$\{escapeHtml\(fullAuthors\)\}"/);
  assert.match(html, /function compactAuthorLabel\(value, limit = 120\)/);
});

test('hovering a placeholder retries public covers and performs a debounced metadata lookup', () => {
  assert.match(html, /coverSlot\?\.addEventListener\('mouseenter', \(\) => void lookupCoverOnHover\(book, coverSlot\)\)/);
  assert.match(html, /CoverAssets\.retryBookCover\(key\)/);
  assert.match(html, /const metadata = await remoteMetadataForBook\(book\)\.catch/);
  assert.match(html, /Date\.now\(\) - Number\(previous\?\.attemptedAt \|\| 0\) < 60_000/);
  assert.match(html, /provenance: 'cover-hover'/);
});

test('metadata-only books resolve repository torrent metadata through private NIP-17', () => {
  assert.match(html, /async function resolvePrivateTorrentBook\(book, \{ onAttempt \} = \{\}\)/);
  assert.match(html, /if \(query\) \{[\s\S]*?module\.searchLibcat\(query, isbn \? 'isbn' : 'title'/);
  assert.match(html, /module\.resolveLibcatBook\(\{ \.\.\.book, md5 \}, options\)/);
  assert.match(html, /module\.searchLibcat\(query, isbn \? 'isbn' : 'title'/);
  assert.doesNotMatch(html, /LIBVAULT_API_BASE/);
  assert.doesNotMatch(html, /fetch\([^\n]*lib\.b\.bfr\.ee/);
  assert.match(html, /function matchingTorrentCatalogRecord\(book, candidates\)/);
  assert.match(html, /BookMetadata\.matchingTorrentCatalogRecord\(book, candidates\)/);
  assert.match(bookMetadata, /const titleRank = candidate =>/);
  assert.match(bookMetadata, /overlap \/ candidateTokens\.length >= 0\.6/);
  assert.match(bookMetadata, /const formatRank = \{ epub: 4, pdf: 3, fb2: 2/);
  assert.match(bookMetadata, /candidateYear === wantedYear/);
  assert.match(bookMetadata, /right\.formatRank - left\.formatRank/);
  assert.match(html, /signer: nostrSigner,[\s\S]*?publish: publishRelayEvent,[\s\S]*?onTrace: showNip17Trace/);
  assert.match(bookMetadata, /candidates\.filter\(candidate => libgenTorrentMetadataForBook\(candidate\)\)/);
  assert.match(bookMetadata, /sameLibraryBook\(book, candidate\)/);
  assert.match(html, /Looking for a torrent for \$\{book\.title \|\| 'book'\}/);
  assert.match(html, /resolvePrivateTorrentBook\(book, \{ onAttempt: setAttempt \}\)\.catch/);
  assert.match(html, /rememberResolvedTorrentMetadata\(book, resolvedTorrentBook\)/);
  assert.match(html, /libvaultMd5, libgenId/);
  assert.doesNotMatch(html, /searchPublicTorrentCatalog/);
  assert.match(html, /torrentBook = \{ \.\.\.torrentBook, md5: libgenTorrent\.md5, libgenId: libgenTorrent\.libgenId \}/);
  assert.match(html, /if \(!readPath && !cached && !torrentAvailable\) \{[\s\S]*?No readable download or torrent is available/);
});

test('unavailable book details explain each acquisition attempt', () => {
  assert.match(html, /What Libstr tried/);
  assert.match(html, /label: 'Local library'/);
  assert.match(html, /label: 'Direct download'/);
  assert.match(html, /label: 'Private Nostr lookup'/);
  assert.match(html, /className = 'read-file-attempts'/);
  assert.match(html, /attempts: safeJSONRead\(note\.dataset\.attempts, \[\]\)/);
});

test('Internet Archive search excludes borrow-only and encrypted derivatives', () => {
  assert.match(html, /function internetArchiveFile\(files, metadata = \{\}\)/);
  assert.match(html, /BookMetadata\.internetArchiveFile\(files, metadata\)/);
  assert.match(bookMetadata, /access-restricted-item/);
  assert.match(bookMetadata, /String\(file\.private \|\| ''\)\.toLowerCase\(\)/);
  assert.match(bookMetadata, /\(\?:encrypted\|lcp\|acsm\)/);
  assert.match(html, /internetArchiveFile\(metadataPayload\.files, metadata\)/);
});

test('Home does not inject LibVault files during background library sync', () => {
  assert.doesNotMatch(html, /const localReadUrl = `\$\{LIBVAULT_API_BASE\}\/files\/\$\{book\.md5\}`/);
  assert.doesNotMatch(html, /some are using LibVault while Blossom finishes/);
});

test('Home can delete a book locally and across synced clients', () => {
  assert.match(html, /data-action="delete-library"/);
  assert.match(html, /aria-label="Delete \$\{escapeHtml\(book\.title \|\| 'book'\)\} from library"/);
  assert.match(html, /async function deleteLibraryBook\(book\)/);
  assert.match(html, /state\.favorites = state\.favorites\.filter\(item => !BookMetadata\.sameLibraryBook\(item, book\)\)/);
  assert.match(html, /state\.reading = state\.reading\.filter\(item => !BookMetadata\.sameLibraryBook\(item, book\)\)/);
  assert.match(html, /if \(wasFavorite && !isDesktopMode\) tasks\.push\(syncFavoriteDeletionToNostr\(\)\)/);
  assert.match(html, /async function syncFavoriteDeletionToNostr\(\)/);
  assert.match(html, /const previousEvents = await previousFavoriteSnapshotEvents\(pubkey\)/);
  assert.match(html, /kind: 5,[\s\S]*?tags: deletedIds\.map\(id => \['e', id\]\)/);
  assert.match(html, /if \(wasReading\) tasks\.push\(publishReadingDeletion\(book\)\)/);
  assert.match(html, /content: JSON\.stringify\(\{ bookId, deleted: true, updatedAt: now \* 1000 \}\)/);
  assert.match(html, /if \(parsed\.deleted\)/);
});

test('Library membership retains its explicit action and active downloads stay in Downloads', () => {
  assert.doesNotMatch(html, /id="reading-favorite-btn"/);
  assert.doesNotMatch(html, /class="favorite-status"/);
  assert.match(html, /data-action="add-library"/);
  assert.doesNotMatch(html, /rememberDownloadingBooks/);
  assert.match(html, /activeStatuses = new Set\(\['queued', 'finding-peers', 'downloading', 'retrying'\]\)/);
  assert.match(html, /addBookToLibrary\(torrentBook\)/);
});

test('Home can refresh and sync Open Library and all.books metadata without LibVault', () => {
  assert.doesNotMatch(html, /data-action="refresh-library"/);
  assert.match(html, /async function refreshLibraryBookMetadata\(book\)/);
  assert.doesNotMatch(html, /async function libVaultMetadataForBook\(book\)/);
  assert.match(html, /async function openLibraryMetadataForBook\(book\)/);
  assert.match(html, /Refreshing metadata for \$\{title\} from Open Library and all\.books/);
  assert.match(html, /openlibrary\.org\/works\/\$\{workId\}\.json/);
  assert.match(html, /year: edition\?\.publish_date[\s\S]*?work\?\.first_publish_date[\s\S]*?source\.first_publish_year/);
  assert.match(html, /function isMissingAuthor\(value\)[\s\S]*?unknown\(\?: author\)\?/);
  assert.match(html, /function authorMatchKey\(value\)[\s\S]*?commaParts\.length === 2/);
  assert.match(html, /authors,\s*year: BookMetadata\.yearForBook/);
  assert.match(html, /const mergeOpenLibraryMetadata = \(\) => merge\(openLibraryMetadata, 'openlibrary'\)/);
  assert.match(html, /const knownReadUrl = BookMetadata\.canonicalReadUrl\(combined \|\| book, BOOKS_API_BASE\)/);
  assert.match(html, /if \(openLibraryMetadata && \(/);
  assert.match(html, /const wantedAuthor = authorMatchKey\(book\.authors \|\| book\.author\)/);
  assert.match(html, /merge\(matched, matched\?\.source \|\| 'remote'\);\s*mergeOpenLibraryMetadata\(\)/);
  assert.match(html, /if \(refreshed\.isFavorite && !isDesktopMode\) syncTasks\.push\(syncFavoritesToNostr\(\)\)/);
  assert.match(html, /if \(refreshed\.isReading\) syncTasks\.push\(publishReadingMetadata\(refreshed\)\)/);
});

test('background metadata enrichment avoids OPDS fan-out and remembers a missing Unglue endpoint', () => {
  assert.match(html, /results = await searchAllBooksPartySource\(query\)/);
  assert.match(html, /let unglueItUnavailable = false/);
  assert.match(html, /if \(unglueItUnavailable\) return \[\]/);
  assert.match(html, /if \(resp\.status === 404\) \{\s*unglueItUnavailable = true;\s*return \[\]/);
});

test('Home offers result-driven language and format filters', () => {
  assert.match(html, /id="home-language-filter"/);
  assert.match(html, /id="home-format-filter"/);
  assert.match(html, /const languages = \[\.\.\.new Set\(enrichedLibrary\.map\(resultLanguage\)\.filter\(Boolean\)\)\]/);
  assert.match(html, /const formats = \[\.\.\.new Set\(enrichedLibrary\.map\(resultFormat\)\.filter\(Boolean\)\)\]/);
  assert.match(html, /const matchesQuery = BookMetadata\.createBookFilterMatcher\(\s*needle,/);
  assert.match(html, /&& matchesQuery\(book\)/);
  assert.match(html, /homeQueryInput\.addEventListener\('input', \(\) => \{\s*clearTimeout\(homeLibraryFilterTimer\);\s*homeLibraryFilterTimer = setTimeout\(renderHome, 80\);/);
  assert.match(html, /const visible = values\.length > 1/);
  assert.match(html, /resultLanguage\(book\) === homeLibraryFilter\.language/);
  assert.match(html, /resultFormat\(book\) === homeLibraryFilter\.format/);
  assert.match(html, /value => value\.toUpperCase\(\)/);
  assert.match(html, /value => value\.toLowerCase\(\)/);
  assert.match(html, /`\$\{matchingBooks\.length\} of \$\{enrichedLibrary\.length\} books`/);
});

test('Home filter choices are bookmarkable hash parameters', () => {
  assert.match(html, /function homeHashRoute\(\)/);
  assert.match(html, /params\.set\('language', homeLibraryFilter\.language\)/);
  assert.match(html, /params\.set\('format', homeLibraryFilter\.format\)/);
  assert.match(html, /route === 'home' \|\| route\.startsWith\('home\?'\)/);
  assert.match(html, /homeLibraryFilter\.language = params\.get\('language'\) \|\| ''/);
  assert.match(html, /homeLibraryFilter\.format = params\.get\('format'\) \|\| ''/);
  assert.match(html, /replaceHomeHash\(\)/);
});

test('Home leaves reading progress to the EPUB reader footer', () => {
  assert.doesNotMatch(html, /function readingProgressMarkup\(book\)/);
});

test('web chrome uses the shared Bookstr identity', () => {
  assert.match(html, /public\/favicon\.svg/);
  assert.doesNotMatch(html, /class="app-title"/);
  assert.match(html, /\.brand-mark\s*\{[\s\S]*?height:\s*2\.4rem/);
  assert.match(html, /public\/apple-touch-icon\.png/);
  assert.match(html, /<link rel="stylesheet" href="design-tokens\.css"/);
  assert.match(designTokens, /body\.theme-paper\s*\{[\s\S]*?--reading-progress:\s*#2F5D50/);
  assert.match(designTokens, /body\.theme-dark\s*\{[\s\S]*?--reading-progress:\s*#7FB8A7/);
  assert.match(html, /background:\s*#e7c766/);
});

test('desktop reading progress uses the shared browser-safe normalizer', () => {
  assert.match(html, /<script src="desktop-progress\.js"><\/script>/);
  assert.match(html, /BookstrDesktopProgress\.normalizeProgressPayload\(value, 'web'\)/);
  assert.match(desktopProgress, /function normalizeProgressPayload\(payload, profile = 'main'\)/);
});

test('footer APK and GitHub icons stay green', () => {
  assert.match(html, /body \.footer a\.footer-icon-link:any-link[\s\S]*?color: var\(--reading-progress\)/);
  assert.match(html, /body \.footer a\.footer-icon-link:visited/);
  assert.match(html, /body \.footer a\.footer-icon-link:hover/);
});

test('desktop mode proxies dictionaries and anchors the footer without changing web layout', () => {
  assert.match(html, /document\.body\.classList\.toggle\('desktop-mode', isDesktopMode\)/);
  assert.match(html, /isDesktopMode[\s\S]*?\/api\/dictionaries\/\$\{id\}\.sqlite3[\s\S]*?WIKDICT_BASE/);
  assert.match(html, /body\.desktop-mode \.footer\s*\{[\s\S]*?position:\s*fixed/);
  assert.match(html, /body\.desktop-mode:not\(\.book-open\) \.wrap/);
  assert.match(desktopMain, /proxyDictionaryRequest\(request, net\.fetch, DICTIONARY_PROXY_BASE_URL\)/);
});

test('desktop content security policy permits secure Nostr relay sockets', async () => {
  const desktopPolicy = await readFile(new URL('../../desktop/security-policy.js', import.meta.url), 'utf8');
  const desktopPackage = JSON.parse(await readFile(new URL('../../desktop/package.json', import.meta.url), 'utf8'));
  const desktopFiles = desktopPackage.build.files.flatMap(entry =>
    typeof entry === 'string' ? [entry] : entry.to === 'desktop' ? entry.filter || [] : []);
  assert.match(desktopPolicy, /connect-src 'self' https: wss:;/);
  assert.ok(desktopFiles.includes('security-policy.js'));
  assert.ok(desktopFiles.includes('device-pairing.js'));
});

test('desktop pane shortcuts use the constrained preload callback', () => {
  assert.match(desktopMain, /pane: 'home', accelerator: 'CmdOrCtrl\+1'/);
  assert.match(desktopMain, /pane: 'reading', accelerator: 'CmdOrCtrl\+2'/);
  assert.match(desktopMain, /pane: 'search', accelerator: 'CmdOrCtrl\+3'/);
  assert.match(desktopMain, /pane: 'people', accelerator: 'CmdOrCtrl\+4'/);
  assert.match(desktopMain, /pane: 'words', accelerator: 'CmdOrCtrl\+5'/);
  assert.match(desktopPreload, /const ALLOWED_PANES = new Set\(\['reading', 'home', 'search', 'people', 'words'\]\)/);
  assert.match(desktopPreload, /const PANE_SHORTCUTS = new Map/);
  assert.match(desktopPreload, /\['5', 'words'\]/);
  assert.match(html, /onOpenPane\?\.\(\(pane\) => activateTab\(pane, \{ updateHash: true \}\)\)/);
  assert.match(html, /id="home-tab-btn"[\s\S]*?id="reading-tab-btn"[\s\S]*?id="search-tab-btn"[\s\S]*?id="people-tab-btn"[\s\S]*?id="words-tab-btn"[^>]*Command 5/);
  assert.doesNotMatch(html, /class="app-header-left app-home"/);
});

test('long reading metadata cannot shrink the header buttons', () => {
  assert.match(html, /\.app-header-right \{[\s\S]*?flex: 0 0 auto;[\s\S]*?min-width: max-content;/);
  assert.match(html, /\.header-tab \{[\s\S]*?flex: 0 0 auto;/);
  assert.match(html, /\.header-book-meta \{[\s\S]*?min-width: 0;[\s\S]*?text-overflow: ellipsis;/);
});

test('embedded readers persist progress, debounce Nostr publication, and ask before advancing to Nostr', () => {
  assert.match(html, /event\.data\?\.type === 'bookstr-reader-progress'/);
  assert.match(html, /queueReadingProgressPublish\(merged\)/);
  assert.match(html, /}, 2000\)/);
  assert.match(html, /const remoteIsAhead = remote/);
  assert.match(html, /reason: 'remote-ahead'/);
  assert.match(html, /const nostrAheadReadingByBook = new Map\(\)/);
  assert.match(html, /BookstrDesktopProgress\.isProgressAhead\(existing, normalized\)/);
  assert.match(html, /function bookWithChosenNostrReadingState\(book\)/);
  assert.match(html, /Nostr has a further position/);
  assert.match(html, /Continue from the Nostr position\?/);
  assert.match(html, /if \(!useRemote\) return book/);
  assert.match(html, /applyDesktopReadingProgress\(\{ \.\.\.local, \.\.\.remote/);
  assert.match(html, /bookWithSavedReadingState\(book\)/);
  assert.match(html, /bookWithChosenNostrReadingState\(book\)/);
  assert.match(html, /initialCfi: book\.cfi \|\| ''/);
});

test('desktop application menu preserves native editing commands', () => {
  assert.match(desktopMain, /label: 'Edit',[\s\S]*?role: 'undo'[\s\S]*?role: 'redo'[\s\S]*?role: 'cut'[\s\S]*?role: 'copy'[\s\S]*?role: 'paste'[\s\S]*?role: 'selectAll'/);
});

test('desktop NIP-46 QR image stays hidden until it has a source', () => {
  assert.match(html, /id="desktop-nip46-qr-image"[^>]*hidden/);
  assert.match(html, /\.desktop-signer-qr\.hidden\s*\{\s*display:\s*none/);
  assert.match(html, /desktopNip46QrImage\.src = qrSession\.qrDataUrl;[\s\S]*?desktopNip46QrImage\.hidden = false/);
});

test('desktop NIP-46 approval activates and persists the signer with all Bookstr permissions', () => {
  assert.match(desktopMain, /const NIP46_CONNECTION_RELAYS = \[[\s\S]*?relay\.nomadwiki\.org[\s\S]*?relay\.damus\.io[\s\S]*?relay\.primal\.net/);
  for (const permission of ['get_public_key', 'nip44_encrypt', 'nip44_decrypt', 'sign_event:3', 'sign_event:5', 'sign_event:22242', 'sign_event:30003', 'sign_event:30078']) {
    assert.match(desktopMain, new RegExp(`'${permission}'`));
  }
  assert.doesNotMatch(desktopMain, /'sign_event:24242'/);
  assert.match(desktopMain, /status: 'authorizing'/);
  assert.match(desktopMain, /nip46SignerParams\(\{ skipSwitchRelays: true \}\)/);
  assert.match(html, /function enableDesktopNostrSigner\(\)[\s\S]*?localStorage\.setItem\(SETTINGS_KEY, JSON\.stringify\(state\.settings\)\)/);
  assert.match(html, /qrState\.status === 'authorizing'[\s\S]*?Signer approved\. Finishing the secure connection/);
});

test('desktop signer npubs are encoded synchronously without rendering a Promise', () => {
  assert.doesNotMatch(html, /return nostrSigner\.nip19\.npubEncode\(hex\)/);
  assert.match(html, /function publicKeyToNpub\(pubkey\)[\s\S]*?const bytes = \[\][\s\S]*?bech32Encode\('npub', values\)/);
});

test('Electron windows and packages use the Bookstr app icon', async () => {
  const desktopPackage = JSON.parse(await readFile(new URL('../../desktop/package.json', import.meta.url), 'utf8'));
  const macIcon = await readFile(new URL('../../desktop/assets/icon-macos.png', import.meta.url));
  const macIconSvg = await readFile(new URL('../../desktop/assets/icon-macos.svg', import.meta.url), 'utf8');
  const idatChunks = [];
  for (let offset = 8; offset < macIcon.length; ) {
    const length = macIcon.readUInt32BE(offset);
    const type = macIcon.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') idatChunks.push(macIcon.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const pixels = inflateSync(Buffer.concat(idatChunks));
  assert.match(desktopMain, /const APP_ICON_PATH = path\.join\(__dirname, 'assets', 'icon-macos\.png'\)/);
  assert.match(desktopMain, /title: 'libstr',[\s\S]*?icon: APP_ICON_PATH/);
  assert.equal((desktopMain.match(/new BrowserWindow\(/g) || []).length, 1);
  assert.match(desktopMain, /app\.dock\.setIcon\(APP_ICON_PATH\)/);
  assert.equal(desktopPackage.build.icon, 'assets/icon-macos.png');
  assert.equal(desktopPackage.build.win.icon, 'assets/icon-macos.png');
  assert.equal(desktopPackage.build.linux.icon, 'assets/icon-macos.png');
  assert.equal(desktopPackage.desktopName, 'app.bookstr.desktop.desktop');
  assert.equal(desktopPackage.build.linux.syncDesktopName, true);
  assert.equal(desktopPackage.build.linux.desktop.entry.StartupWMClass, 'app.bookstr.desktop');
  assert.match(desktopMain, /const DESKTOP_APP_ID = 'app\.bookstr\.desktop'/);
  assert.match(desktopMain, /process\.platform === 'linux'[\s\S]*?app\.setDesktopName\(`\$\{DESKTOP_APP_ID\}\.desktop`\)/);
  assert.match(desktopMain, /process\.platform === 'win32'[\s\S]*?app\.setAppUserModelId\(DESKTOP_APP_ID\)/);
  assert.equal(macIcon.toString('ascii', 1, 4), 'PNG');
  assert.equal(macIcon.readUInt32BE(16), 1024);
  assert.equal(macIcon.readUInt32BE(20), 1024);
  assert.equal(macIcon[25], 6);
  assert.equal(pixels[4], 0, 'macOS icon corner should be transparent');
  assert.match(macIconSvg, /linearGradient id="gloss"/);
  assert.match(macIconSvg, /clip-path="url\(#tile-clip\)"/);
});

test('Electron identifies development builds with a Bookstr timestamp version', () => {
  assert.match(desktopMain, /return `0\.1-\$\{now\.getFullYear\(\)\}.*-\$\{part\(now\.getHours\(\)\)\}\$\{part\(now\.getMinutes\(\)\)\}`/s);
  assert.match(desktopMain, /const DESKTOP_VERSION = process\.env\.BOOKSTR_DESKTOP_VERSION \|\| timestampVersion\(\)/);
  assert.match(desktopMain, /app\.setAboutPanelOptions\(\{[\s\S]*applicationName: 'libstr',[\s\S]*applicationVersion: DESKTOP_VERSION,[\s\S]*version: DESKTOP_VERSION/);
});

test('settings groups Nostr controls and connection status together', () => {
  const openSettingsSource = html.match(/function openSettings[\s\S]*?\n      function closeSettings/)?.[0] || '';
  assert.match(html, /settings-section settings-nostr[\s\S]*?<h3>Nostr<\/h3>[\s\S]*?id="nip7-enabled"[\s\S]*?id="nip7-status"/);
  assert.match(html, /class="browser-nip7"[\s\S]*?Browser extension \(NIP-07\)[\s\S]*?id="nip7-connect"/);
  assert.match(html, /nip7ConnectButton\.addEventListener\('click', \(\) => void connectNip7\(\)\)/);
  assert.match(html, /let nostrSigner = isDesktopMode \? desktopBridge\?\.signer : globalThis\.nostr/);
  assert.match(html, /function currentNostrSigner\(\)[\s\S]*?globalThis\.nostr !== nostrSigner[\s\S]*?nostrSigner = globalThis\.nostr/);
  assert.match(html, /if \(state\.nip7\.pubkey\) \{\s*void connectNip7\(\{ silent: true, quick: hasFreshNip7Status \}\)/);
  assert.doesNotMatch(openSettingsSource, /connectNip7\(/);
  assert.match(html, /\.settings-tab \.settings-panel \{[\s\S]*?width: min\(46rem, calc\(100vw - 2\.5rem\)\);[\s\S]*?border-radius: 1\.15rem/);
  assert.match(html, /\.settings-tab \.settings-nostr,[\s\S]*?\.settings-tab \.settings-dictionaries[\s\S]*?border-top:/);
  assert.match(html, /#desktop-signer-status\.signer-connected::before\s*\{[\s\S]*?content: '✓';[\s\S]*?color: #16803c/);
  assert.match(html, /desktopSignerStatus\.classList\.toggle\('signer-connected', connected\)/);
  assert.match(html, /desktopSignerPanel\.classList\.toggle\('signer-connected', connected\)/);
  assert.match(html, /\.desktop-signer\.signer-connected \.desktop-signer-primary,[\s\S]*?\.desktop-signer\.signer-connected details[\s\S]*?display: none;/);
  assert.doesNotMatch(html, /\.desktop-signer\.signer-connected \.settings-status/);
  assert.match(html, /id="desktop-signer-method"/);
  assert.match(html, /id="desktop-signer-npub"/);
  assert.match(html, /const npub = signerState\.pubkey \? publicKeyToNpub\(signerState\.pubkey\)/);
  assert.match(html, /desktopSignerMethod\.textContent = message \|\| modeLabel/);
  assert.match(html, /desktopSignerNpub\.textContent = npub/);
  assert.match(html, /desktopNip46QrStart\.classList\.toggle\('hidden', connected\)/);
});

test('offline dictionary destinations populate before storage responds', () => {
  assert.match(html, /function populateDictionaryTargetOptions\(preferredTarget = '', installed = new Set\(\)\)/);
  assert.match(html, /dictionarySource\.addEventListener\('change',[\s\S]*?populateDictionaryTargetOptions\(\);[\s\S]*?refreshDictionaryTargetOptions\(\)/);
  assert.match(html, /populateDictionaryTargetOptions\('en'\);[\s\S]*?refreshDictionaryTargetOptions\('en'\)/);
  assert.match(html, /try \{[\s\S]*?await dictionaryRecords\(\)[\s\S]*?\} catch \{\}[\s\S]*?populateDictionaryTargetOptions/);
});

test('Electron settings expose opt-in language voices and reader typography', () => {
  assert.match(html, /desktop-reader-settings settings-speech[\s\S]*?id="speech-language"[\s\S]*?id="speech-voice"[\s\S]*?id="speech-rate"/);
  assert.match(html, /id="speech-model-kokoro_en"[\s\S]*?id="speech-model-piper_pt_pt"[\s\S]*?id="speech-model-status"/);
  assert.match(html, /speech-model-delete[\s\S]*?color: #b42318/);
  assert.match(html, /button\.hidden = button\.dataset\.language !== selectedLanguage/);
  assert.match(html, /speech-settings\.js/);
  assert.match(html, /id="reader-font"[\s\S]*?<option value="arial">Arial<\/option>[\s\S]*?id="reader-alignment"[\s\S]*?<option value="justified">Justified<\/option>[\s\S]*?id="reader-font-size"[\s\S]*?id="reader-padding"/);
  assert.match(html, /readerPadding: 24/);
  assert.match(html, /BookstrTypography\.normalizePadding\(readerPaddingInput\.value\)/);
  assert.match(html, /speechVoices:[\s\S]*?speechLanguage:[\s\S]*?speechRate:/);
  assert.match(html, /notifyOpenReaderSettings\(\)/);
  assert.match(readerHtml, /voiceIdentifier: selectedSpeechVoice\(plan\.language\)/);
  assert.match(readerHtml, /BookstrTypography\.normalizeFont\([\s\S]*?currentReaderSettings\.readerFont/);
  assert.match(readerHtml, /BookstrTypography\.css\(readerFontFamily, readerAlignment, readerPadding\)/);
  assert.match(pdfReaderJs, /voiceIdentifier: selectedPdfSpeechVoice\(plan\.language\)/);
  assert.match(html, /BookMetadata\.mergeLibraryState\(state\.reading, state\.favorites\)[\s\S]*?BookstrSpeechSettings\.languagesForCodes\(\[\.\.\.bookLanguages, 'en', 'pt'\], displayNames\)/);
});

test('Electron settings expose default-on automatic torrent downloading and seeding', () => {
  assert.match(html, /settings-torrents[\s\S]*?<h3>Torrents<\/h3>[\s\S]*?id="torrent-auto-download"[^>]*checked[\s\S]*?id="torrent-auto-seed"[^>]*checked/);
  assert.match(html, /autoDownloadTorrents: true,[\s\S]*?autoSeedTorrents: true/);
  assert.match(html, /Automatic torrent downloads are disabled in Settings/);
  assert.match(html, /acquireLibgen\(torrentBook, \{[\s\S]*?autoSeed: state\.settings\.autoSeedTorrents/);
  assert.match(html, /downloadPublic\(\{[\s\S]*?autoSeed: state\.settings\.autoSeedTorrents/);
  assert.match(desktopPreload, /setPreferences\(preferences\)[\s\S]*?bookstr-desktop-transfer-preferences/);
  assert.match(desktopMain, /resumeLibgenSeeds\(\{ autoSeed: preferences\.autoSeed \}\)/);
  assert.match(desktopMain, /if \(!next\.autoSeed\) await getTorrentBridge\(\)\.stopSeeding\(\)/);
  assert.match(html, /body\.desktop-mode \.settings-tab \.settings-section h3 \{[\s\S]*?font-size: 0\.82rem/);
});

test('torrent download percentages cannot render below zero or above one hundred', () => {
  assert.match(html, /const bytes = Math\.max\(0, Number\(download\.bytes \|\| 0\)\);[\s\S]*?Math\.max\(0, Math\.min\(100, Math\.round\(bytes \/ total \* 100\)\)\)/);
  assert.match(desktopWebTorrent, /bytes: safeCounter\(file\.downloaded\)/);
  assert.match(desktopWebTorrent, /progress: Math\.min\(1, safeCounter\(torrent\.progress\)\)/);
});

test('the browser reader downloads a selected repository book with visible WebTorrent progress', () => {
  assert.match(html, /const BROWSER_WEBTORRENT_MODULE = '\/__webdev__\/webtorrent\.min\.js'/);
  assert.match(html, /async function fetchBrowserTorrentCopy\(book\)/);
  assert.match(html, /fetch\(`\/api\/libgen-torrent\?libgen_id=/);
  assert.match(html, /fetch\(`\/api\/libgen-file\?libgen_id=/);
  assert.match(html, /downloadPublicTorrentFile\(client, torrentId/);
  assert.match(html, /function showBrowserWebTorrentStatus\(label\)/);
  assert.match(html, /torrentStatus\.textContent = `WebTorrent: \$\{label\}`/);
  assert.match(html, /Downloading · \$\{percent\}%/);
  assert.match(html, /Seeding \$\{torrentBook\.title \|\| 'book'\} while this page stays open/);
  assert.match(html, /isDesktopMode[\s\S]*?fetchDesktopTorrentCopy\(book\)[\s\S]*?fetchBrowserTorrentCopy\(book\)/);
  assert.match(html, /let torrentAvailable = Boolean\([\s\S]*?BookMetadata\.torrentMetadataForBook\(book\)[\s\S]*?BookMetadata\.libgenTorrentMetadataForBook\(book\)/);
  assert.match(html, /if \(!readPath && !cached && !torrentAvailable\) \{[\s\S]*?resolvePrivateTorrentBook/);
  assert.match(webdev, /WEBTORRENT_BUNDLE = .*webtorrent\/dist\/webtorrent\.min\.js/);
  assert.match(webdev, /parsed\.path in \("\/api\/libgen-torrent", "\/api\/libgen-file"\)/);
  assert.match(webdev, /WEBTORRENT_DOWNLOAD_BRIDGE = "http:\/\/127\.0\.0\.1:11112\/download"/);
  assert.match(webtorrentDevBridge, /url\.pathname === '\/download'/);
  assert.match(webtorrentDevBridge, /bridge\.downloadSelected\(torrentBytes/);
  assert.match(webdev, /r_\{batch\}\.torrent/);
  assert.match(webdev, /subprocess\.run\([\s\S]*?"curl"[\s\S]*?check=False[\s\S]*?capture_output=True/);
});

test('downloaded book state keeps its SHA-256 bridge when the repository MD5 becomes available', () => {
  assert.match(html, /const sha256 = normalizeSha256\(ref\.sha256 \|\| ''\)/);
  assert.match(html, /stableId = md5 \|\| sha256/);
  assert.match(html, /sha256: book\.sha256 \|\| ''/);
});

test('Nostr library sync presents a compact state and resulting counts', () => {
  assert.match(html, /Syncing with \$\{relayNames\}…/);
  assert.match(html, /\$\{favorites\.length\} favorites · \$\{reading\.length\} reading · \$\{words\.length\} words/);
  assert.match(html, /\? `Synced · \$\{reading\.length\} reading · \$\{words\.length\} words`/);
  assert.match(html, /: `Synced · \$\{nostrSyncCounts\(favorites, reading, words\)\}`\)/);
  assert.doesNotMatch(html, /account\.slice\(0, 16\)/);
  assert.doesNotMatch(html, /eventDetail/);
  assert.match(html, /homeLibraryHeading\.append\(homeSync\)/);
});

test('vocabulary deletion publishes a durable encrypted tombstone before best-effort NIP-09 cleanup', () => {
  assert.match(html, /deleted:\s*true,[\s\S]*?nip44\.encrypt\(pubkey, JSON\.stringify/);
  assert.match(html, /kind:\s*NOSTR_PROGRESS_KIND,[\s\S]*?tags:\s*\[\['d', dTag\]\]/);
  assert.match(html, /kind:\s*5,[\s\S]*?content:\s*''/);
  assert.doesNotMatch(html, /Delete vocabulary word:/);
  assert.match(html, /state\.words\.push\(tombstone\)/);
  assert.match(html, /saveNostrSyncCache\(pubkey/);
});

test('deleting the word used as the exact Words filter clears that filter', () => {
  assert.match(html, /wordsFilter\.value\.trim\(\)\.toLowerCase\(\) === entry\.word\.trim\(\)\.toLowerCase\(\)/);
  assert.match(html, /wordsFilter\.value = ''/);
});

test('deleted vocabulary remains cached but is not rendered', () => {
  assert.match(html, /return sortByUpdatedAt\(Array\.from\(latestByWord\.values\(\)\)\);/);
  assert.match(html, /filter\(entry => entry && !entry\.deleted\)/);
});

test('Words definitions are expanded by default', () => {
  assert.match(html, /<div class="word-lookup" aria-live="polite" data-loaded=/);
  assert.doesNotMatch(html, /<div class="word-lookup hidden"/);
  assert.match(html, /if \(!entry\.definitions\.length\) \{[\s\S]*?row\.querySelector\('\.word-definition'\)\.click\(\)/);
  assert.doesNotMatch(html, /requestAnimationFrame\(\(\) => wordsList\.querySelector\('\.word-definition'\)\?\.click\(\)\)/);
});

test('Words stay off Home and the header link only appears for active synced words', () => {
  assert.doesNotMatch(html, /id="home-words-list"/);
  assert.match(html, /id="words-tab-btn" class="header-tab words-tab-icon hidden"/);
  assert.match(html, /const activeWords = state\.words\.map\(normalizeVocabularyWord\)\.filter\(entry => entry && !entry\.deleted\)/);
  assert.match(html, /wordsTabBtn\.classList\.toggle\('hidden', activeWords\.length === 0\)/);
  assert.match(html, /function hasActiveWords\(\)/);
  assert.match(html, /if \(tab === 'words' && !hasActiveWords\(\)\) tab = 'home'/);
  assert.match(html, /if \(!hasActiveWords\(\)\) \{[\s\S]*?#home/);
});

test('hash route parsing restores filters and tab selection for Home and Settings', () => {
  assert.match(html, /window\.addEventListener\('hashchange', applyHashRoute\)/);
  assert.match(html, /function applyHashRoute\(/);
  assert.match(html, /route === 'home' \|\| route\.startsWith\('home\?'\)/);
  assert.match(html, /route === 'settings'/);
  assert.match(html, /homeLibraryFilter\.language = params\.get\('language'\) \|\| ''/);
  assert.match(html, /homeLibraryFilter\.format = params\.get\('format'\) \|\| ''/);
  assert.match(html, /activateTab\('home'\);/);
});

test('home search submit updates the route and triggers search pagination state', () => {
  assert.match(html, /homeSearchForm\.addEventListener\('submit', \(event\) => \{/);
  assert.match(html, /const query = homeQueryInput\.value\.trim\(\);/);
  assert.match(html, /setHashRoute\(searchHashRoute\(\{ query, language: '', format: '', page: 1 \}\)\);/);
  assert.match(html, /searchPageLabel\.textContent = `Page \$\{searchResultPage\} of \$\{totalPages\} · \$\{sortedBooks\.length\} results`;/);
});

test('tabs persist selection in route hash transitions', () => {
  assert.match(html, /function activateTab\(tab, \{ updateHash = false \} = \{\}\) {/);
  assert.match(html, /activeTab = \['home', 'search', 'reading', 'words', 'people', 'settings', \.\.\.\(isDesktopMode \? \['downloads'\] : \[\]\)\]\.includes\(tab\) \? tab : 'home';/);
  assert.match(html, /setHashRoute\(routeValue \? `read=\$\{encodeURIComponent\(routeValue\)\}` : 'reading'\);/);
  assert.match(html, /setHashRoute\('words'\);/);
  assert.match(html, /setHashRoute\(isDesktopMode \? 'devices' : 'people'\);/);
  assert.match(html, /setHashRoute\('settings'\);/);
});

test('reader-open route always updates hash with encoded book identity', () => {
  assert.match(html, /setHashRoute\(`read=\$\{encodeURIComponent\(readRouteValue\(book, readPath\)\)\}`\);/);
  assert.match(html, /const readPath = BookMetadata\.canonicalReadUrl\(book, BOOKS_API_BASE\);/);
});

test('reader never navigates its iframe to an untrusted book URL', () => {
  assert.doesNotMatch(html, /readerFrame\.src\s*=\s*readPath/);
  assert.match(html, /throw new Error\('Only EPUB, PDF, FB2, CBZ, and CBR book files can be opened\.'\)/);
});
