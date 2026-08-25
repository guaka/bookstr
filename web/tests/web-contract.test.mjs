import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const readerHtml = await readFile(new URL('../reader.html', import.meta.url), 'utf8');
const pdfReaderHtml = await readFile(new URL('../pdf-reader.html', import.meta.url), 'utf8');
const pdfReaderJs = await readFile(new URL('../pdf-reader.js', import.meta.url), 'utf8');

test('People loads the connected user follow list and public book lists', () => {
  assert.match(html, /id="people-tab-btn"/);
  assert.match(html, /id="people-list"/);
  assert.match(html, /const NOSTR_FOLLOW_KIND = 3/);
  assert.match(html, /async function pullNostrFollows\(pubkey\)/);
  assert.match(html, /NostrSocial\.latestFollowEvent\(verified, pubkey\)/);
  assert.match(html, /NostrSocial\.followsFromEvent/);
  assert.match(html, /async function pullFollowedPublicLists\(follows\)/);
  assert.match(html, /NOSTR_NIP51_LIST_KINDS/);
  assert.match(html, /NostrSocial\.publicNip51Lists\(verified, pubkeys\)/);
  assert.match(html, /async function pullFollowedProfiles\(follows\)/);
  assert.match(html, /kinds: \[0\]/);
  assert.match(html, /NostrSocial\.trustrootsProfiles\(verified, pubkeys, TRUSTROOTS_IMPORT_PUBKEY\)/);
  assert.match(html, /hintedAuthorsByRelay\.get\(follow\.relay\)/);
  assert.match(html, /NostrSocial\.nip05Matches\(document, parts\.name, profile\.pubkey\)/);
  assert.match(html, /profile\?\.verifiedNip05/);
  assert.match(html, /const NOSTR_SOCIAL_RELAYS = \['wss:\/\/relay\.trustroots\.org'\]/);
  assert.match(html, /const NOSTR_TRUSTROOTS_PROFILE_RELAY = 'wss:\/\/nip42\.trustroots\.org'/);
  assert.match(html, /NostrSocial\.nip42AuthTemplate\(relayUrl, id\)/);
  assert.match(html, /socket\.send\(JSON\.stringify\(\['AUTH', signed\]\)\);[\s\S]*?authenticatedRequestSent = true;[\s\S]*?sendRequest\(\)/);
  assert.match(html, /readRelayEvents\(NOSTR_TRUSTROOTS_PROFILE_RELAY, \[[\s\S]*?kinds: \[0, 10390\][\s\S]*?\], \{ authenticate: true \}/);
  assert.match(html, /kinds: \[0, 10390\]/);
  assert.match(html, /kinds: \[30390\],[\s\S]*?'#p': authors/);
  assert.match(html, /new Set\(\[\.\.\.NOSTR_RELAYS, \.\.\.NOSTR_SOCIAL_RELAYS\]\)/);
  assert.match(html, /tools\.verifyEvent\(event\)/);
  assert.match(html, /setHashRoute\('people'\)/);
});

test('served web app remains React- and bundle-free', () => {
  assert.doesNotMatch(html, /react(?:-dom)?(?:\.production)?/i);
  assert.doesNotMatch(html, /node_modules|bookstr-dist/i);
});

test('Home independently discovers featured and connected-user public NIP-51 reading lists', () => {
  assert.match(html, /<script src="public-lists\.js"><\/script>/);
  assert.match(html, /id="public-lists-section"[\s\S]*?<h3>Reading lists<\/h3>[\s\S]*?id="public-lists"/);
  assert.match(html, /const FEATURED_PUBLIC_LIST_D_TAGS = \['abundance-in-commons', 'hitchwiki-books'\]/);
  assert.match(html, /async function queryPublicNostrEvents\(filters\)/);
  assert.match(html, /async function pullNostrPublicLists\(pubkey = ''\)[\s\S]*?'#d': FEATURED_PUBLIC_LIST_D_TAGS[\s\S]*?BookstrPublicLists\.parseEvents/);
  assert.match(html, /async function revealPrivateNostrList\(pubkey, event\)[\s\S]*?window\.nostr\.nip44\.decrypt\(pubkey, event\.content\)[\s\S]*?privateTags/);
  assert.match(html, /ownEvents\.map\(event => revealPrivateNostrList\(pubkey, event\)\)/);
  assert.match(html, /async function syncNostrPublicLists\(pubkey = ''\)/);
  assert.match(html, /void syncNostrPublicLists\(state\.nip7\.pubkey \|\| ''\);/);
  assert.match(html, /const \[favorites, reading, words\] = await Promise\.all/);
  assert.doesNotMatch(html, /const \[favorites, reading, words, publicLists\] = await Promise\.all/);
  assert.match(html, /function renderPublicLists\(\)[\s\S]*?state\.publicLists[\s\S]*?className = 'public-list'/);
  assert.match(html, /void openBook\(book, \{ addToReading: false \}\)/);
});

test('footer links to the latest released Android APK', () => {
  assert.match(html, /github\.com\/guaka\/bookstr\/releases\/latest/);
  assert.match(html, /Download the latest Bookstr Android APK/);
});

test('browser traffic uses the Cloudflare books API', () => {
  assert.match(html, /const BOOKS_API_BASE = 'https:\/\/books-api\.guaka\.org\/api'/);
  assert.doesNotMatch(html, /localhost:11111\/api|books\.guaka\.org\/api\/search/);
});

test('search tries private LibVault NIP-17 before the HTTP catalog fallback', () => {
  assert.match(html, /async function searchViaNostr\(query\)/);
  assert.match(html, /module\.searchLibVault\(query, searchType\.value \|\| 'all'/);
  assert.match(html, /books = await searchViaNostr\(query\)/);
  assert.match(html, /Private search unavailable; trying the HTTP catalog/);
  assert.match(html, /books = await searchAllBooksParty\(query\)/);
  assert.match(html, /source = 'HTTP fallback'/);
  assert.match(html, /const NOSTR_SEARCH_READY_TIMEOUT_MS = 8000/);
  assert.match(html, /const NOSTR_SEARCH_RESPONSE_TIMEOUT_MS = 20000/);
  assert.match(html, /responseTimeoutMs: NOSTR_SEARCH_RESPONSE_TIMEOUT_MS/);
  assert.match(html, /const SEARCH_RESULT_LIMIT = 200/);
  assert.match(html, /limit: SEARCH_RESULT_LIMIT/);
  assert.match(html, /limit=\$\{SEARCH_RESULT_LIMIT\}/);
  assert.doesNotMatch(html, /search\?q=\$\{encodeURIComponent\(query\)\}&limit=20/);
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

test('favorite fetch progress uses a calm static marker', () => {
  assert.match(html, /\.favorite-fetch-progress\.pending::before[\s\S]*?background:/);
  assert.doesNotMatch(html, /favorite-fetch-spin/);
});

test('Search requires whole query tokens instead of prefix matches', () => {
  assert.match(html, /function matchesExactSearchTokens\(book, query, type = 'all'\)/);
  assert.match(html, /new Set\(exactSearchTokens\(selected\.filter\(Boolean\)\.join\(' '\)\)\)/);
  assert.match(html, /every\(term => available\.has\(term\)\)/);
  assert.match(html, /books = books\.filter\(book => matchesExactSearchTokens\(book, query, searchType\.value \|\| 'all'\)\)/);
});

test('availability is reduced to one priority label', () => {
  assert.match(html, /const availability = isCached\(book\)[\s\S]*?availabilitySources\.includes\('Blossom'\)[\s\S]*?availabilitySources\.includes\('Gutenberg'\)[\s\S]*?: '—'/);
  assert.match(html, /class="availability-primary"/);
  assert.doesNotMatch(html, /secondaryAvailability/);
  assert.doesNotMatch(html, /class="availability-detail"/);
});

test('book opening canonicalizes stable Gutenberg IDs', () => {
  assert.match(html, /const readPath = BookMetadata\.canonicalReadUrl\(book, BOOKS_API_BASE\)/);
});

test('LibVault books use MD5 hash routes and resolve through Blossom', () => {
  assert.match(html, /return isMd5\(md5\) \? md5/);
  assert.match(html, /legacyMd5 = routeValue\.match/);
  assert.match(html, /const suppliedUrl = String\(book\.blossomUrl \|\| readPath \|\| ''\)/);
  assert.match(html, /candidate\.protocol === 'https:' && candidate\.hostname\.toLowerCase\(\) === 'blossom\.bfr\.ee'/);
  assert.match(html, /blossomUrl \|\|= `https:\/\/blossom\.bfr\.ee\/\$\{sha256\}`/);
  assert.match(html, /fetch\(blossomUrl/);
  assert.match(html, /BookMetadata\.mergeLibraryState\(state\.reading, state\.favorites\)/);
  assert.match(html, /pendingReadBookId = String\(bookRef\)\.toLowerCase\(\)/);
  assert.match(html, /function bookCacheKey\(book, readUrl\)[\s\S]*?isMd5\(md5\) \? md5/);
});

test('reading mode forwards global Left and Right keys to the EPUB reader', () => {
  assert.match(html, /event\.key === 'ArrowLeft' \? 'prevPage' : 'nextPage'/);
  assert.match(html, /readerFrame\.contentWindow\?\.\[command\]\?\.\(\)/);
});

test('Home and empty Search use distinct hash routes', () => {
  assert.match(html, /class="app-header-left app-home" href="#home"/);
  assert.match(html, /setHashRoute\('home'\)/);
  assert.match(html, /setHashRoute\(query\.length >= 2 \? searchHashRoute\(\{ query \}\) : 'search'\)/);
  assert.match(html, /if \(route === 'search'\)/);
});

test('search results expose publication year in a sortable table', () => {
  assert.match(html, /className = 'book-table'/);
  assert.match(html, /\['Year', 'year'\]/);
  assert.match(html, /function renderBookTable\(target, books, options = \{\}\)/);
  assert.match(html, /escapeHtml\(book\.year \|\| '—'\)/);
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

test('read links remain addressable when a book has no MD5', () => {
  assert.match(html, /return direct \|\| `book:\$\{BookMetadata\.bookIdentity\(book\)\}`/);
  assert.match(html, /if \(bookId\.startsWith\('book:'\)\)/);
  assert.match(html, /BookMetadata\.bookIdentity\(book\) === identity/);
});

test('Home titles use the same read hash resolver as Search titles', () => {
  assert.match(html, /label: 'Library',[\s\S]*?routeOnly: true/);
  assert.doesNotMatch(html, /label: 'Library',[\s\S]*?onOpen: book => void openLibraryBook/);
});

test('Home and Search share tables with covers and author search links', () => {
  assert.match(html, /renderBookTable\(target, books/);
  assert.match(html, /bookCoverUrl\(book\)/);
  assert.match(html, /const LIBVAULT_COVER_BASE = 'https:\/\/lib\.b\.bfr\.ee\/api\/covers'/);
  assert.match(html, /return isMd5\(md5\) \? `\$\{LIBVAULT_COVER_BASE\}\/\$\{md5\}` : ''/);
  assert.match(html, /const cover = payload\?\.covers\?\.\[rawId\] \|\| \{\}/);
  assert.match(html, /coverUrl: item\.cover_url \|\| item\.coverUrl \|\| item\.thumbnail \|\| cover\.url/);
  assert.match(html, /data-action="author-search"/);
  assert.match(html, /requestAnimationFrame\(\(\) => homeQueryInput\.focus\(\)\)/);
});

test('cover hover previews are substantially enlarged', () => {
  assert.match(html, /\.result-cover-slot:hover \.result-cover[\s\S]*?transform: scale\(6\)/);
  assert.match(html, /\.result-cover[\s\S]*?pointer-events: none/);
  assert.match(html, /transition: transform 160ms ease 180ms/);
});

test('table authors are green and only unavailable titles are red', () => {
  assert.match(html, /\.result-author:visited[\s\S]*?color: var\(--reading-progress\)/);
  assert.match(html, /\.result-title\.readable:visited[\s\S]*?color: var\(--reading-progress\)/);
  assert.match(html, /\.result-title\.unavailable:visited[\s\S]*?color: var\(--link-hover\)/);
  assert.match(html, /Boolean\(BookMetadata\.canonicalReadUrl\(book, BOOKS_API_BASE\)\)/);
  assert.match(html, /const readableNow = isBookReadableNow\(book\)/);
  assert.match(html, /titleAvailabilityClass = readableNow \? 'readable' : 'unavailable'/);
  assert.match(html, /<span class="result-author">\$\{escapeHtml\(book\.authors \|\| ''\)\}<\/span>/);
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

test('the complete merged library refreshes newly available Blossom copies', () => {
  assert.match(html, /function refreshFavoriteBlossomCopies\(\)/);
  assert.match(html, /BookMetadata\.dedupeLibraryBooks\(\[\.\.\.state\.favorites, \.\.\.state\.reading\]\)/);
  assert.match(html, /lookupLibVaultBlossomState\(book\.md5\)/);
  assert.match(html, /state\.favorites = state\.favorites\.map\(update\)/);
  assert.match(html, /state\.reading = state\.reading\.map\(update\)/);
  assert.match(html, /const newlyReadable = found \+ cachedFound/);
  assert.match(html, /Found \$\{newlyReadable\} newly readable library book/);
  assert.match(html, /await refreshFavoriteBlossomCopies\(\)/);
  assert.match(html, /void refreshFavoriteBlossomCopies\(\)/);
});

test('Home retries LibVault books that are still publishing to Blossom', () => {
  assert.match(html, /lookupLibVaultBlossomState\(book\.md5\)/);
  assert.match(html, /if \(blossom\?\.status === 'publishing'\) \{[\s\S]*?publishing \+= 1/);
  assert.match(html, /favoriteBlossomRefreshRetryTimer = setTimeout/);
  assert.match(html, /}, 5000\)/);
});

test('reader recovers legacy LibVault lookup URLs to the canonical Blossom server', () => {
  assert.match(html, /candidate\.hostname\.toLowerCase\(\) === 'blossom\.bfr\.ee'/);
  assert.match(html, /blossomUrl \|\|= `https:\/\/blossom\.bfr\.ee\/\$\{sha256\}`/);
});

test('EPUBs use persistent IndexedDB caching', () => {
  assert.match(html, /indexedDB\.open\(BOOK_CACHE_DB_NAME/);
  assert.match(html, /cachedBookBlob\(book, readPath\)/);
  assert.match(html, /cacheBookBlob\(book, readPath, blob\)/);
  assert.match(html, /function cacheRecordMatches\(record, book, readUrl\)/);
  assert.match(html, /if \(record\.key !== key\) await bookCacheDelete\(record\.key\)/);
  assert.match(html, /records\.forEach\(rememberCachedRecord\)/);
  assert.match(html, /const openGeneration = \+\+readerOpenGeneration/);
  assert.match(html, /if \(openGeneration !== readerOpenGeneration\) return/);
  assert.match(html, /async function readerFrameLoader\(kind, openGeneration\)/);
  assert.match(html, /readerFrameNavigation\?\.cancel\(\)/);
  assert.match(html, /readerFrame\.src = `\$\{readerPath\}\?load=\$\{navigationId\}`/);
  assert.match(html, /const readerLoad = await readerFrameLoader\('epub', openGeneration\)/);
  assert.match(html, /const routeGeneration = \+\+readRouteGeneration/);
  assert.match(html, /if \(routeGeneration !== readRouteGeneration\) return/);
});

test('PDFs are fetched and displayed inside the Bookstr reader pane', () => {
  assert.match(html, /async function displayPdf\(blob, book, openGeneration\)/);
  assert.match(html, /new Blob\(\[blob\], \{ type: 'application\/pdf' \}\)/);
  assert.match(html, /PDF download failed/);
  assert.match(html, /await displayPdf\(blob, book, openGeneration\)/);
  assert.match(html, /const readerPath = kind === 'pdf' \? 'pdf-reader\.html' : 'reader\.html'/);
  assert.match(html, /const readerLoad = await readerFrameLoader\('pdf', openGeneration\)/);
  assert.match(html, /filename: pdfDownloadFilename\(book\)/);
  assert.match(html, /return `\$\{safeTitle \|\| 'Bookstr book'\}\.pdf`/);
  assert.match(html, /String\.fromCharCode\(\.\.\.bytes\) === '%PDF-'/);
  assert.match(html, /const cachedFormat = await bookFormatForBlob\(cached\)/);
  assert.match(html, /const blossomFormat = await bookFormatForBlob\(blossomBlob\)/);
  assert.match(html, /api\\\/files\\\/\[a-f0-9\]\{32\}/);
  assert.match(html, /if \(format === 'pdf'\) await displayPdf\(blob, book, openGeneration\)/);
});

test('EPUB reader destroys the previous rendition without transform flicker', () => {
  assert.match(readerHtml, /const generation = \+\+bookLoadGeneration/);
  assert.match(readerHtml, /if \(rendition\) rendition\.destroy\(\)/);
  assert.match(readerHtml, /if \(book\) book\.destroy\(\)/);
  assert.match(readerHtml, /document\.getElementById\("viewer"\)\.replaceChildren\(\)/);
  assert.doesNotMatch(readerHtml, /#viewer\.page-forward/);
  assert.doesNotMatch(readerHtml, /viewer\.offsetWidth/);
});

test('PDF reader uses local PDF.js, lazy page rendering, and an explicit download name', () => {
  assert.match(pdfReaderHtml, /<main id="pages" aria-label="PDF pages">/);
  assert.match(pdfReaderJs, /from '\.\/vendor\/pdfjs\/pdf\.mjs'/);
  assert.match(pdfReaderJs, /GlobalWorkerOptions\.workerSrc = '\.\/vendor\/pdfjs\/pdf\.worker\.mjs'/);
  assert.match(pdfReaderJs, /new IntersectionObserver/);
  assert.match(pdfReaderJs, /download\.download = filename/);
  assert.match(pdfReaderJs, /pdf\?\.destroy\(\)/);
});

test('favorites are not truncated to fifty items', () => {
  assert.doesNotMatch(html, /state\.favorites[^;]*slice\(0,\s*50\)/s);
});

test('favoriting requests the book privately from LibVault over NIP-17', () => {
  assert.match(html, /import\('\.\/nip17-fetch\.js'\)/);
  assert.match(html, /requestFavoriteFromLibVault\(book\)/);
  assert.match(html, /publish: publishRelayEvent/);
});

test('favorite fetch progress stays visible through download and Blossom publication', () => {
  assert.match(html, /monitorLibVaultFetch\(book\.md5/);
  assert.match(html, /favorite-fetch-progress/);
  assert.match(html, /Fetching \$\{title\}: \$\{percent\}%/);
  assert.match(html, /publishing it to Blossom/);
  assert.match(html, /saveReadyFavorite\(book, progress\.blossom\)/);
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
  assert.match(html, /const visibleCount = matchingBooks\.length === library\.length/);
  assert.match(html, /`\$\{library\.length\} \$\{library\.length === 1 \? 'book' : 'books'\}`/);
  assert.match(html, /`\$\{matchingBooks\.length\} of \$\{library\.length\} books`/);
  assert.match(html, /const readableCount = matchingBooks\.filter\(isBookReadableNow\)\.length/);
  assert.match(html, /`\$\{visibleCount\} · \$\{readableCount\} readable now`/);
});

test('Home readable count uses the same availability rule as title coloring', () => {
  assert.match(html, /function isBookReadableNow\(book\)/);
  assert.match(html, /cachedBookKeys\.has\(bookCacheKey\(book, book\.readUrl \|\| book\.url\)\)/);
  assert.match(html, /Boolean\(BookMetadata\.canonicalReadUrl\(book, BOOKS_API_BASE\)\)/);
  assert.match(html, /const readableNow = isBookReadableNow\(book\)/);
});

test('Home uses cached LibVault files while their Blossom copies publish', () => {
  assert.match(html, /const localReadUrl = `\$\{LIBVAULT_API_BASE\}\/files\/\$\{book\.md5\}`/);
  assert.match(html, /\? \{ \.\.\.item, readUrl: localReadUrl \}/);
  assert.match(html, /some are using LibVault while Blossom finishes/);
  assert.match(html, /favoriteBlossomRefreshRetryCount < 6/);
});

test('Home can delete a book locally and across synced clients', () => {
  assert.match(html, /data-action="delete-library"/);
  assert.match(html, /aria-label="Delete \$\{escapeHtml\(book\.title \|\| 'book'\)\} from library"/);
  assert.match(html, /async function deleteLibraryBook\(book\)/);
  assert.match(html, /state\.favorites = state\.favorites\.filter\(item => !BookMetadata\.sameLibraryBook\(item, book\)\)/);
  assert.match(html, /state\.reading = state\.reading\.filter\(item => !BookMetadata\.sameLibraryBook\(item, book\)\)/);
  assert.match(html, /if \(wasFavorite\) tasks\.push\(syncFavoritesToNostr\(\)\)/);
  assert.match(html, /if \(wasReading\) tasks\.push\(publishReadingDeletion\(book\)\)/);
  assert.match(html, /content: JSON\.stringify\(\{ bookId, deleted: true, updatedAt: now \* 1000 \}\)/);
  assert.match(html, /if \(payload\.deleted === true\)/);
});

test('Home can refresh and sync merged LibVault and Open Library metadata', () => {
  assert.match(html, /data-action="refresh-library"/);
  assert.match(html, /async function refreshLibraryBookMetadata\(book\)/);
  assert.match(html, /async function libVaultMetadataForBook\(book\)/);
  assert.match(html, /window\.location\.origin !== new URL\(LIBVAULT_API_BASE\)\.origin/);
  assert.match(html, /`\$\{LIBVAULT_API_BASE\}\/books\/\$\{md5\}`/);
  assert.match(html, /async function openLibraryMetadataForBook\(book\)/);
  assert.match(html, /Refreshing metadata for \$\{title\} from LibVault, Open Library, and all\.books/);
  assert.match(html, /openlibrary\.org\/works\/\$\{workId\}\.json/);
  assert.match(html, /year: edition\?\.publish_date[\s\S]*?work\?\.first_publish_date[\s\S]*?source\.first_publish_year/);
  assert.match(html, /function isMissingAuthor\(value\)[\s\S]*?unknown\(\?: author\)\?/);
  assert.match(html, /function authorMatchKey\(value\)[\s\S]*?commaParts\.length === 2/);
  assert.match(html, /authors,\s*year: BookMetadata\.yearForBook/);
  assert.match(html, /const mergeOpenLibraryMetadata = \(\) => merge\(openLibraryMetadata, 'openlibrary'\)/);
  assert.match(html, /const knownReadUrl = BookMetadata\.canonicalReadUrl\(combined \|\| book, BOOKS_API_BASE\)/);
  assert.match(html, /if \(openLibraryMetadata && knownReadUrl/);
  assert.match(html, /const wantedAuthor = authorMatchKey\(book\.authors \|\| book\.author\)/);
  assert.match(html, /merge\(matched, matched\?\.source \|\| 'remote'\);\s*mergeOpenLibraryMetadata\(\)/);
  assert.match(html, /if \(refreshed\.isFavorite\) syncTasks\.push\(syncFavoritesToNostr\(\)\)/);
  assert.match(html, /if \(refreshed\.isReading\) syncTasks\.push\(publishReadingMetadata\(refreshed\)\)/);
});

test('Home offers result-driven language and format filters', () => {
  assert.match(html, /id="home-language-filter"/);
  assert.match(html, /id="home-format-filter"/);
  assert.match(html, /const languages = \[\.\.\.new Set\(enrichedLibrary\.map\(resultLanguage\)\.filter\(Boolean\)\)\]/);
  assert.match(html, /const formats = \[\.\.\.new Set\(enrichedLibrary\.map\(resultFormat\)\.filter\(Boolean\)\)\]/);
  assert.match(html, /const visible = values\.length > 1/);
  assert.match(html, /resultLanguage\(book\) === homeLibraryFilter\.language/);
  assert.match(html, /resultFormat\(book\) === homeLibraryFilter\.format/);
  assert.match(html, /value => value\.toUpperCase\(\)/);
  assert.match(html, /value => value\.toLowerCase\(\)/);
  assert.match(html, /`\$\{matchingBooks\.length\} of \$\{library\.length\} books`/);
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
  assert.match(html, /--reading-progress:\s*#2f5d50/);
  assert.match(html, /background:\s*#e7c766/);
});

test('footer APK and GitHub icons stay green', () => {
  assert.match(html, /body \.footer a\.footer-icon-link:any-link[\s\S]*?color: var\(--reading-progress\)/);
  assert.match(html, /body \.footer a\.footer-icon-link:visited/);
  assert.match(html, /body \.footer a\.footer-icon-link:hover/);
});

test('settings groups Nostr controls and connection status together', () => {
  assert.match(html, /settings-section settings-nostr[\s\S]*?<h3>Nostr<\/h3>[\s\S]*?id="nip7-enabled"[\s\S]*?id="nip7-status"/);
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
  assert.match(html, /activeTab = \['home', 'search', 'reading', 'words', 'people', 'settings'\]\.includes\(tab\) \? tab : 'home';/);
  assert.match(html, /setHashRoute\(routeValue \? `read=\$\{encodeURIComponent\(routeValue\)\}` : 'reading'\);/);
  assert.match(html, /setHashRoute\('words'\);/);
  assert.match(html, /setHashRoute\('people'\);/);
  assert.match(html, /setHashRoute\('settings'\);/);
});

test('reader-open route always updates hash with encoded book identity', () => {
  assert.match(html, /setHashRoute\(`read=\$\{encodeURIComponent\(readRouteValue\(book, readPath\)\)\}`\);/);
  assert.match(html, /const readPath = BookMetadata\.canonicalReadUrl\(book, BOOKS_API_BASE\);/);
});
