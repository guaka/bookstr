const FAVORITES_KEY = 'bookstr_nostr_favorites_v1';

type DictionaryPack = {
  id: string;
  source: string;
  target: string;
  label: string;
  bytes: ArrayBuffer;
  size: number;
  lastUsed: number;
};
type DictionarySqlRuntime = {
  Database: new (bytes?: Uint8Array) => {
    exec(sql: string): unknown;
    close(): void;
    prepare(sql: string): { bind(values: unknown[]): void; step(): boolean; get(): unknown[]; getAsObject(): Record<string, unknown>; free(): void };
  };
};
type PageBook = BrowserBook & { [key: string]: unknown; url?: string; coverUrl?: string; publisher?: string; sha256?: string; cfi?: string; progression?: number | null; furthestProgression?: number; updatedAt?: number; metadataProvenance?: Record<string, unknown>; };
type VocabularyEntry = Record<string, unknown> & {
  word: string;
  language: string;
  deleted?: boolean;
  updatedAt?: number;
  bookId?: string;
  bookTitle?: string;
  firstSeenAt: number;
  lastSeenAt: number;
  lookupCount: number;
  definitions: string[];
  contextSentence: string;
  partOfSpeech?: string;
  cfi?: string;
  sourceUrl?: string;
  syncId?: string;
};
type FollowEntry = { pubkey: string; relay?: string; petname?: string };
type ReadAttempt = { label: string; state: string; detail: string };
type ReaderDiagnostics = { readPath?: string | null; cacheStatus?: string; error?: unknown; attempts?: ReadAttempt[] };
type CachedBookRecord = PageBook & { key: string; blob: Blob; size: number; lastUsed: number };
type ReaderLoader = (...args: unknown[]) => unknown;
type ReaderFrameNavigation = { kind: string; bookId: string; cancel: () => void; promise: Promise<boolean> };
type SearchSource = { id: string; name: string; coverage: string; deliveries: string[]; access: 'Public' | 'Private'; search: (query: string) => Promise<PageBook[]> };
type SearchSourceProgress = { source: SearchSource; state: string; count?: number; error?: unknown };
type SearchOutcome = { source: SearchSource; books: PageBook[]; error: unknown | null };
type SearchCacheEntry = { key: string; ts: number; books: PageBook[] };
type SearchRouteState = { language: string; format: string; page: number };
type SpeechModel = {
  id: string;
  label?: string;
  language?: string;
  approximateBytes?: number;
  completedFiles?: number;
  fileCount?: number;
  error?: string;
  installing?: boolean;
  installed?: boolean;
  available?: boolean;
};
type PageNostrSigner = MigratedNostrSigner & { enable?: () => void | Promise<void> };


type OpenLibraryDocument = { title?: string; author_name?: string[]; cover_i?: number; isbn?: string[]; first_publish_year?: number | string; publisher?: string[]; language?: string[]; edition_count?: number; key?: string };
type MetadataCache = Record<string, { book?: PageBook; [key: string]: unknown }>;

type PageElements = {
  'bookstr-epub-type': HTMLElement;
  'build-time': HTMLElement;
  'desktop-downloads-button': HTMLButtonElement;
  'desktop-downloads-list': HTMLElement;
  'desktop-downloads-notice': HTMLElement;
  'desktop-downloads-summary': HTMLElement;
  'desktop-kindle-books': HTMLElement;
  'desktop-kindle-device': HTMLSelectElement;
  'desktop-kindle-filter': HTMLInputElement;
  'desktop-kindle-offer': HTMLElement;
  'desktop-kindle-select-visible': HTMLInputElement;
  'desktop-kindle-selection': HTMLDialogElement;
  'desktop-kindle-selection-close': HTMLButtonElement;
  'desktop-kindle-selection-send': HTMLButtonElement;
  'desktop-kindle-summary': HTMLElement;
  'desktop-kindle-transfer': HTMLButtonElement;
  'desktop-nip46-connect': HTMLButtonElement;
  'desktop-nip46-input': HTMLInputElement;
  'desktop-nip46-qr': HTMLElement;
  'desktop-nip46-qr-cancel': HTMLButtonElement;
  'desktop-nip46-qr-copy': HTMLButtonElement;
  'desktop-nip46-qr-image': HTMLImageElement;
  'desktop-nip46-qr-start': HTMLButtonElement;
  'desktop-nsec-connect': HTMLButtonElement;
  'desktop-nsec-input': HTMLInputElement;
  'desktop-signer': HTMLElement;
  'desktop-signer-disconnect': HTMLButtonElement;
  'desktop-signer-method': HTMLElement;
  'desktop-signer-npub': HTMLElement;
  'desktop-signer-status': HTMLElement;
  'desktop-signer-storage': HTMLElement;
  'device-kindle-list': HTMLElement;
  'device-kindle-panel': HTMLElement;
  'device-private-peer': HTMLInputElement;
  'device-private-torrent': HTMLInputElement;
  'device-private-transfer-form': HTMLFormElement;
  'device-public-torrent': HTMLInputElement;
  'device-public-transfer-form': HTMLFormElement;
  'device-transfer-announce': HTMLButtonElement;
  'device-transfer-devices': HTMLElement;
  'device-transfer-panel': HTMLElement;
  'device-transfer-refresh': HTMLButtonElement;
  'device-transfer-result': HTMLElement;
  'device-transfer-summary': HTMLElement;
  'dictionary-install': HTMLButtonElement;
  'dictionary-packs': HTMLElement;
  'dictionary-source': HTMLSelectElement;
  'dictionary-status': HTMLElement;
  'dictionary-target': HTMLSelectElement;
  'downloads-tab': HTMLElement;
  'favorites-heading': HTMLElement;
  'favorites-list': HTMLUListElement;
  'favorites-sync-note': HTMLElement;
  'header-book-title': HTMLElement;
  'home-favorites-list': HTMLUListElement;
  'home-format-filter': HTMLSelectElement;
  'home-format-filter-wrap': HTMLLabelElement;
  'home-language-filter': HTMLSelectElement;
  'home-language-filter-wrap': HTMLLabelElement;
  'home-query-input': HTMLInputElement;
  'home-reading-list': HTMLElement;
  'home-result-filters': HTMLElement;
  'home-search-form': HTMLFormElement;
  'home-sync-refresh': HTMLButtonElement;
  'home-sync-state': HTMLElement;
  'home-tab': HTMLElement;
  'home-tab-btn': HTMLButtonElement;
  'kindle-transfer-count': HTMLElement;
  'kindle-transfer-dismiss': HTMLButtonElement;
  'kindle-transfer-items': HTMLUListElement;
  'kindle-transfer-overview': HTMLElement;
  'kindle-transfer-progress': HTMLProgressElement;
  'kindle-transfer-status': HTMLElement;
  'nip17-exchange': HTMLDetailsElement;
  'nip17-received': HTMLElement;
  'nip17-sent': HTMLElement;
  'nip46-approval-copy': HTMLElement;
  'nip7-connect': HTMLButtonElement;
  'nip7-enabled': HTMLInputElement;
  'nip7-status': HTMLElement;
  'npub-button': HTMLButtonElement;
  'npub-display': HTMLElement;
  'people-list': HTMLElement;
  'people-tab': HTMLElement;
  'people-tab-btn': HTMLButtonElement;
  'query-input': HTMLInputElement;
  'read-metadata-fallback': HTMLElement;
  'read-metadata-fallback-status': HTMLElement;
  'read-metadata-fallback-torrent': HTMLElement;
  'reader-alignment': HTMLSelectElement;
  'reader-font': HTMLSelectElement;
  'reader-font-size': HTMLInputElement;
  'reader-font-size-value': HTMLOutputElement;
  'reader-frame': HTMLIFrameElement;
  'reader-padding': HTMLInputElement;
  'reader-padding-value': HTMLOutputElement;
  'reader-section': HTMLElement;
  'reading-library-tab': HTMLElement;
  'reading-list': HTMLUListElement;
  'reading-tab-btn': HTMLButtonElement;
  'results': HTMLElement;
  'search-form': HTMLFormElement;
  'search-format-filter': HTMLSelectElement;
  'search-format-filter-wrap': HTMLLabelElement;
  'search-language-filter': HTMLSelectElement;
  'search-language-filter-wrap': HTMLLabelElement;
  'search-load-more': HTMLButtonElement;
  'search-page-label': HTMLElement;
  'search-page-next': HTMLButtonElement;
  'search-page-prev': HTMLButtonElement;
  'search-pagination': HTMLElement;
  'search-result-count': HTMLElement;
  'search-result-filters': HTMLElement;
  'search-source-progress': HTMLUListElement;
  'search-tab': HTMLElement;
  'search-tab-btn': HTMLButtonElement;
  'search-type': HTMLSelectElement;
  'settings-backdrop': HTMLElement;
  'settings-btn': HTMLButtonElement;
  'settings-close': HTMLButtonElement;
  'settings-modal': HTMLElement;
  'settings-panel': HTMLElement;
  'speech-language': HTMLSelectElement;
  'speech-model-status': HTMLElement;
  'speech-rate': HTMLInputElement;
  'speech-rate-value': HTMLOutputElement;
  'speech-voice': HTMLSelectElement;
  'status': HTMLElement;
  'theme-mode': HTMLSelectElement;
  'torrent-auto-download': HTMLInputElement;
  'torrent-auto-seed': HTMLInputElement;
  'torrent-download-limit': HTMLSelectElement;
  'torrent-upload-limit': HTMLSelectElement;
  'words-filter': HTMLInputElement;
  'words-list': HTMLElement;
  'words-sort': HTMLSelectElement;
  'words-tab': HTMLElement;
  'words-tab-btn': HTMLButtonElement;
};
      const READING_KEY = 'bookstr_reading_library_v1';
      const WORDS_KEY = 'bookstr_words_v1';
      const WORDS_SORT_KEY = 'bookstr_words_sort_v1';
      const SETTINGS_KEY = 'bookstr_reader_settings_v1';
      const LOCAL_APPEARANCE_KEY = 'bookstr_local_appearance_v1';
      const NIP7_STATUS_KEY = 'bookstr_nip7_pubkey_v1';
      const NOSTR_FAVORITES_PUBLISH_TIME_KEY = 'bookstr_nostr_favorites_publish_time_v1';
      const NOSTR_RELAYS = ['wss://relay.nomadwiki.org'];
      const NOSTR_SOCIAL_RELAYS = ['wss://relay.trustroots.org'];
      const NOSTR_TRUSTROOTS_PROFILE_RELAY = 'wss://nip42.trustroots.org';
      const NOSTR_FAVORITES_KIND = BookstrNostrConstants.kinds.favorites;
      const NOSTR_FOLLOW_KIND = 3;
      const NOSTR_PROGRESS_KIND = BookstrNostrConstants.kinds.progress;
      const FAVORITES_D_TAG = BookstrNostrConstants.dTags.favorites;
      const FAVORITES_CHUNK_PREFIX = BookstrNostrConstants.prefixes.favoritesChunk;
      const FAVORITES_CHUNK_LIMIT = 6000;
      const READING_D_PREFIX = 'app.bookstr.progress.';
      const WORDS_D_PREFIX = BookstrNostrConstants.prefixes.vocabulary;
      const NOSTR_SYNC_CACHE_PREFIX = 'bookstr_nostr_sync_v1_';
      const NOSTR_SYNC_CACHE_TTL_MS = 30 * 60 * 1000;
      const NIP7_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
      const BOOKS_API_BASE = window.location.protocol === 'app:'
        && typeof window.bookstrDesktop?.openReader === 'function'
        ? 'app://bookstr/api'
        : 'https://books-api.guaka.org/api';
      const WIKDICT_BASE = `${BOOKS_API_BASE}/dictionaries`;
      const DICTIONARY_DB_NAME = 'bookstr_dictionaries_v1';
      const DICTIONARY_STORAGE_LIMIT = 250 * 1024 * 1024;
      const BOOK_CACHE_DB_NAME = 'bookstr_epub_cache_v1';
      const BOOK_CACHE_STORAGE_LIMIT = 300 * 1024 * 1024;
      const BROWSER_WEBTORRENT_MODULE = '/__webdev__/webtorrent.min.js';
      const MAX_BROWSER_TORRENT_BOOK_BYTES = 512 * 1024 * 1024;
      const LIBGEN_RS_REPOSITORY_ID_LIMIT = 10_000_000;
      const BOOK_METADATA_CACHE_KEY = 'bookstr_metadata_cache_v1';
      const SEARCH_SOURCE_SETTINGS_KEY = 'bookstr_search_sources_v1';
      const BOOK_METADATA_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
      const SEARCH_CACHE_KEY = 'bookstr_search_cache_v1';
      const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
      const SEARCH_CACHE_MAX_ENTRIES = 6;
      const DICTIONARY_LANGUAGES: Record<string, string> = {
        bg: 'Bulgarian', ca: 'Catalan', cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek',
        en: 'English', es: 'Spanish', fi: 'Finnish', fr: 'French', ga: 'Irish', id: 'Indonesian',
        it: 'Italian', ja: 'Japanese', ku: 'Kurdish', la: 'Latin', lt: 'Lithuanian', mg: 'Malagasy',
        nl: 'Dutch', no: 'Norwegian', pl: 'Polish', pt: 'Portuguese', ru: 'Russian', sv: 'Swedish',
        tr: 'Turkish', zh: 'Chinese'
      };
      const NOSTR_QUERY_TIMEOUT_MS = 5000;
      const NOSTR_AUTH_QUERY_TIMEOUT_MS = 30000;
      const SEARCH_RESULT_LIMIT = 200;
      const SEARCH_RESULT_PAGE_SIZE = 50;
export type IndexAppPageBindings = {
  lookupOfflineWord: typeof lookupOfflineWord;
  desktopBridgeVersion: typeof desktopBridgeVersion;
  removeById: typeof removeById;
  refreshLibraryBookMetadata: typeof refreshLibraryBookMetadata;
  openLibraryBook: typeof openLibraryBook;
  improveEpubTypography: typeof improveEpubTypography;
};

      const status = (document.getElementById('status') as PageElements['status']);
      let statusFadeTimer: ReturnType<typeof setTimeout> | undefined;
      new MutationObserver(() => {
        clearTimeout(statusFadeTimer);
        if (!status.textContent.trim()) {
          status.classList.remove('toast-visible');
          return;
        }
        status.classList.add('toast-visible');
        statusFadeTimer = setTimeout(() => {
          status.classList.remove('toast-visible');
        }, 3200);
      }).observe(status, { childList: true, characterData: true, subtree: true });
      const queryInput = (document.getElementById('query-input') as PageElements['query-input']);
      const homeTab = (document.getElementById('home-tab') as PageElements['home-tab']);
      const homeSearchForm = (document.getElementById('home-search-form') as PageElements['home-search-form']);
      const homeQueryInput = (document.getElementById('home-query-input') as PageElements['home-query-input']);
      const homeResultFilters = (document.getElementById('home-result-filters') as PageElements['home-result-filters']);
      const homeLanguageFilterWrap = (document.getElementById('home-language-filter-wrap') as PageElements['home-language-filter-wrap']);
      const homeLanguageFilter = (document.getElementById('home-language-filter') as PageElements['home-language-filter']);
      const homeFormatFilterWrap = (document.getElementById('home-format-filter-wrap') as PageElements['home-format-filter-wrap']);
      const homeFormatFilter = (document.getElementById('home-format-filter') as PageElements['home-format-filter']);
      const homeSyncState = (document.getElementById('home-sync-state') as PageElements['home-sync-state']);
      const homeSyncRefresh = (document.getElementById('home-sync-refresh') as PageElements['home-sync-refresh']);
      const homeSync = homeSyncState.closest('.home-sync');
      homeQueryInput.placeholder = 'Filter here · press Enter to search all books';
      const homeReadingList = (document.getElementById('home-reading-list') as PageElements['home-reading-list']);
      const homeFavoritesList = (document.getElementById('home-favorites-list') as PageElements['home-favorites-list']);
      const homeReadingSection = homeReadingList.closest('.home-column');
      const homeFavoritesSection = homeFavoritesList.closest('.home-column');
      const homeLibraryHeading = homeReadingSection?.querySelector('h3');
      if (homeLibraryHeading) homeLibraryHeading.textContent = 'Library';
      const homeLibraryCount = document.createElement('span');
      homeLibraryCount.className = 'library-book-count';
      homeLibraryCount.setAttribute('aria-live', 'polite');
      homeLibraryHeading?.append(homeLibraryCount);
      if (homeLibraryHeading && homeSync) homeLibraryHeading.append(homeSync);
      homeFavoritesSection?.remove();
      const homeBookSorts: Record<string, { key: string; direction: string }> = Object.create(null) as Record<string, { key: string; direction: string }>;
      const homeLibraryFilter = { language: '', format: '' };
      let homeLibraryFilterTimer: ReturnType<typeof setTimeout> | null = null;
      const desktopDownloadByBook = new Map<string, BrowserDownloadRow>();
      let desktopReadyEditions: BrowserDownloadRow[] = [];
      let desktopDownloadStateSignature = '';
      const desktopSeededBookIds = new Set<string>();
      const desktopTransferRates = { download: 0, upload: 0 };
      const coverHoverLookups = new Map();
      let desktopDownloadStatesReady = false;
      let desktopDownloadRenderTimer: ReturnType<typeof setTimeout> | 0 = 0;
      let desktopDownloadStatusTimer: ReturnType<typeof setTimeout> | 0 = 0;
      const searchType = (document.getElementById('search-type') as PageElements['search-type']);
      const searchForm = (document.getElementById('search-form') as PageElements['search-form']);
      const resultsEl = (document.getElementById('results') as PageElements['results']);
      const desktopDownloadsButton = (document.getElementById('desktop-downloads-button') as PageElements['desktop-downloads-button']);
      const desktopDownloadsPane = (document.getElementById('downloads-tab') as PageElements['downloads-tab']);
      const desktopDownloadsSummary = (document.getElementById('desktop-downloads-summary') as PageElements['desktop-downloads-summary']);
      let desktopHiddenCompletedIds = new Set<string>();
      let desktopDownloadsRenderGeneration = 0;
      let desktopDownloadEntryNeedsSnapshot = false;
      const desktopDownloadsList = (document.getElementById('desktop-downloads-list') as PageElements['desktop-downloads-list']);
      const desktopDownloadsNotice = (document.getElementById('desktop-downloads-notice') as PageElements['desktop-downloads-notice']);
      const desktopKindleOffer = (document.getElementById('desktop-kindle-offer') as PageElements['desktop-kindle-offer']);
      const desktopKindleDevice = (document.getElementById('desktop-kindle-device') as PageElements['desktop-kindle-device']);
      const desktopKindleSummary = (document.getElementById('desktop-kindle-summary') as PageElements['desktop-kindle-summary']);
      const desktopKindleTransfer = (document.getElementById('desktop-kindle-transfer') as PageElements['desktop-kindle-transfer']);
      const kindleSelectionDialog = (document.getElementById('desktop-kindle-selection') as PageElements['desktop-kindle-selection']);
      const kindleSelectionList = (document.getElementById('desktop-kindle-books') as PageElements['desktop-kindle-books']);
      const kindleSelectionFilter = (document.getElementById('desktop-kindle-filter') as PageElements['desktop-kindle-filter']);
      const kindleSelectVisible = (document.getElementById('desktop-kindle-select-visible') as PageElements['desktop-kindle-select-visible']);
      const kindleSelectionSend = (document.getElementById('desktop-kindle-selection-send') as PageElements['desktop-kindle-selection-send']);
      let kindleSelectionJobs: BrowserDownloadRow[] = [];
      const kindleSelectedBooks = new Set<string>();
      let currentKindleId = '';
      const kindleTransferOverview = BookstrDesktopKindle.createTransferOverview();
      const kindleTransferPanel = (document.getElementById('kindle-transfer-overview') as PageElements['kindle-transfer-overview']);
      const kindleTransferStatus = (document.getElementById('kindle-transfer-status') as PageElements['kindle-transfer-status']);
      const kindleTransferProgress = (document.getElementById('kindle-transfer-progress') as PageElements['kindle-transfer-progress']);
      const kindleTransferCount = (document.getElementById('kindle-transfer-count') as PageElements['kindle-transfer-count']);
      const kindleTransferItems = (document.getElementById('kindle-transfer-items') as PageElements['kindle-transfer-items']);
      const kindleTransferDismiss = (document.getElementById('kindle-transfer-dismiss') as PageElements['kindle-transfer-dismiss']);
      kindleTransferDismiss.addEventListener('click', () => kindleTransferPanel.classList.add('hidden'));
      let kindleTransferRunning = false;
      let kindleLibraryButton: HTMLButtonElement | null = null;
      let kindleLibraryBookId = '';
      const kindleLibraryPresence = BookstrDesktopKindle.createLibraryPresence();
      let kindlePresenceRequest: ReturnType<typeof kindleLibraryPresence.begin> | null = null;
      let kindleOfferRefreshing = false;
      let kindleOfferQueued = false;
      const searchResultFilters = (document.getElementById('search-result-filters') as PageElements['search-result-filters']);
      const searchResultCount = (document.getElementById('search-result-count') as PageElements['search-result-count']);
      const searchLanguageFilterWrap = (document.getElementById('search-language-filter-wrap') as PageElements['search-language-filter-wrap']);
      const searchLanguageFilter = (document.getElementById('search-language-filter') as PageElements['search-language-filter']);
      const searchFormatFilterWrap = (document.getElementById('search-format-filter-wrap') as PageElements['search-format-filter-wrap']);
      const searchFormatFilter = (document.getElementById('search-format-filter') as PageElements['search-format-filter']);
      const searchPagination = (document.getElementById('search-pagination') as PageElements['search-pagination']);
      const searchLoadMore = (document.getElementById('search-load-more') as PageElements['search-load-more']);
      const searchPagePrev = (document.getElementById('search-page-prev') as PageElements['search-page-prev']);
      const searchPageNext = (document.getElementById('search-page-next') as PageElements['search-page-next']);
      const searchPageLabel = (document.getElementById('search-page-label') as PageElements['search-page-label']);
      const nip17Exchange = (document.getElementById('nip17-exchange') as PageElements['nip17-exchange']);
      const nip17Sent = (document.getElementById('nip17-sent') as PageElements['nip17-sent']);
      const nip17Received = (document.getElementById('nip17-received') as PageElements['nip17-received']);
      const favoritesList = (document.getElementById('favorites-list') as PageElements['favorites-list']);
      const readingList = (document.getElementById('reading-list') as PageElements['reading-list']);
      const wordsList = (document.getElementById('words-list') as PageElements['words-list']);
      const wordsFilter = (document.getElementById('words-filter') as PageElements['words-filter']);
      const wordsSort = (document.getElementById('words-sort') as PageElements['words-sort']);
      const buildTime = (document.getElementById('build-time') as PageElements['build-time']);
      const readerFrame = (document.getElementById('reader-frame') as PageElements['reader-frame']);
      const readerSection = (document.getElementById('reader-section') as PageElements['reader-section']);
      const searchTab = (document.getElementById('search-tab') as PageElements['search-tab']);
      const readingLibraryTab = (document.getElementById('reading-library-tab') as PageElements['reading-library-tab']);
      for (const heading of readingLibraryTab.querySelectorAll('h1, h2, h3')) {
        if (heading.textContent.trim() !== 'Words') continue;
        const section = heading.closest('section');
        if (section && section !== readingLibraryTab) section.remove();
      }
      const wordsTab = (document.getElementById('words-tab') as PageElements['words-tab']);
      const peopleTab = (document.getElementById('people-tab') as PageElements['people-tab']);
      const peopleList = (document.getElementById('people-list') as PageElements['people-list']);
      const deviceTransferPanel = (document.getElementById('device-transfer-panel') as PageElements['device-transfer-panel']);
      const deviceKindlePanel = (document.getElementById('device-kindle-panel') as PageElements['device-kindle-panel']);
      const deviceKindleList = (document.getElementById('device-kindle-list') as PageElements['device-kindle-list']);
      const deviceTransferSummary = (document.getElementById('device-transfer-summary') as PageElements['device-transfer-summary']);
      const deviceTransferDevices = (document.getElementById('device-transfer-devices') as PageElements['device-transfer-devices']);
      const deviceTransferRefresh = (document.getElementById('device-transfer-refresh') as PageElements['device-transfer-refresh']);
      const deviceTransferAnnounce = (document.getElementById('device-transfer-announce') as PageElements['device-transfer-announce']);
      const devicePrivateTransferForm = (document.getElementById('device-private-transfer-form') as PageElements['device-private-transfer-form']);
      const devicePrivateTorrent = (document.getElementById('device-private-torrent') as PageElements['device-private-torrent']);
      const devicePrivatePeer = (document.getElementById('device-private-peer') as PageElements['device-private-peer']);
      const devicePublicTransferForm = (document.getElementById('device-public-transfer-form') as PageElements['device-public-transfer-form']);
      const devicePublicTorrent = (document.getElementById('device-public-torrent') as PageElements['device-public-torrent']);
      const deviceTransferResult = (document.getElementById('device-transfer-result') as PageElements['device-transfer-result']);
      const homeTabBtn = (document.getElementById('home-tab-btn') as PageElements['home-tab-btn']);
      const searchTabBtn = (document.getElementById('search-tab-btn') as PageElements['search-tab-btn']);
      const peopleTabBtn = (document.getElementById('people-tab-btn') as PageElements['people-tab-btn']);
      const readingTabBtn = (document.getElementById('reading-tab-btn') as PageElements['reading-tab-btn']);
      const wordsTabBtn = (document.getElementById('words-tab-btn') as PageElements['words-tab-btn']);
      const headerBookTitle = (document.getElementById('header-book-title') as PageElements['header-book-title']);
      const headerBookMeta = document.createElement('span');
      headerBookMeta.className = 'header-book-meta hidden';
      document.querySelector('.app-header-right')!.after(headerBookTitle, headerBookMeta);
      let activeReadingBook: PageBook | null = null;
      let pendingReadBookId = '';
      let activeTab = 'home';
      const desktopBridge = window.bookstrDesktop || null;
      const isDesktopMode = window.location.protocol === 'app:' && Boolean(desktopBridge?.openReader);
      desktopDownloadsButton.classList.toggle('hidden', !isDesktopMode);
      if (isDesktopMode) {
        peopleTabBtn.setAttribute('aria-label', 'Devices, Command 4');
        peopleTabBtn.title = 'Devices · ⌘4';
        peopleTabBtn.querySelector('.social-nav-icon')!.classList.add('hidden');
        peopleTabBtn.querySelector('.device-nav-icon')!.classList.remove('hidden');
        peopleList.classList.add('hidden');
        deviceKindlePanel.classList.remove('hidden');
        (document.getElementById('favorites-heading') as PageElements['favorites-heading']).textContent = 'Favorites';
        (document.getElementById('favorites-sync-note') as PageElements['favorites-sync-note']).classList.add('hidden');
        homeSyncRefresh.setAttribute('aria-label', 'Refresh reading and words');
        homeSyncRefresh.title = 'Refresh reading and words';
      }
      document.body.classList.toggle('desktop-mode', isDesktopMode);
      if (isDesktopMode) {
        document.title = 'libstr';
        const brandMark = document.querySelector<HTMLImageElement>('.brand-mark')!;
        brandMark.src = 'public/apple-touch-icon.png';
        brandMark.alt = 'libstr';
        (document.getElementById('nip46-approval-copy') as PageElements['nip46-approval-copy']).textContent = 'Scan this with your remote signer and approve libstr.';
      }
      const nostrSignerName = isDesktopMode ? 'Nostr signer' : 'NIP-07';
      let nostrSigner: PageNostrSigner | undefined = (isDesktopMode ? desktopBridge?.signer : globalThis.nostr) as PageNostrSigner | undefined;

      function currentNostrSigner(): PageNostrSigner | undefined {
        if (!isDesktopMode && globalThis.nostr && globalThis.nostr !== nostrSigner) {
          nostrSigner = globalThis.nostr;
        }
        return nostrSigner;
      }
      const desktopBridgeVersion = Number(desktopBridge?.version || 0);
      const desktopSyncKeys = new Set<string | null>([
        FAVORITES_KEY,
        READING_KEY,
        WORDS_KEY,
        SETTINGS_KEY,
        NIP7_STATUS_KEY,
      ]);
      const settingsBtn = (document.getElementById('settings-btn') as PageElements['settings-btn']);
      document.querySelector('.app-header')!.append(settingsBtn);
      const settingsModal = (document.getElementById('settings-modal') as PageElements['settings-modal']);
      const settingsPanel = (document.getElementById('settings-panel') as PageElements['settings-panel']);
      const settingsBackdrop = (document.getElementById('settings-backdrop') as PageElements['settings-backdrop']);
      const settingsCloseBtn = (document.getElementById('settings-close') as PageElements['settings-close']);
      const autoReadingInputs = [...document.querySelectorAll<HTMLInputElement>('.search-auto-reading')];
      const torrentAutoDownloadInput = (document.getElementById('torrent-auto-download') as PageElements['torrent-auto-download']);
      const torrentAutoSeedInput = (document.getElementById('torrent-auto-seed') as PageElements['torrent-auto-seed']);
      const nip7EnabledInput = (document.getElementById('nip7-enabled') as PageElements['nip7-enabled']);
      const nip7ConnectButton = (document.getElementById('nip7-connect') as PageElements['nip7-connect']);
      const desktopSignerPanel = (document.getElementById('desktop-signer') as PageElements['desktop-signer']);
      const desktopNip46Input = (document.getElementById('desktop-nip46-input') as PageElements['desktop-nip46-input']);
      const desktopNip46Connect = (document.getElementById('desktop-nip46-connect') as PageElements['desktop-nip46-connect']);
      const desktopNip46QrStart = (document.getElementById('desktop-nip46-qr-start') as PageElements['desktop-nip46-qr-start']);
      const desktopNip46Qr = (document.getElementById('desktop-nip46-qr') as PageElements['desktop-nip46-qr']);
      const desktopNip46QrImage = (document.getElementById('desktop-nip46-qr-image') as PageElements['desktop-nip46-qr-image']);
      const desktopNip46QrCopy = (document.getElementById('desktop-nip46-qr-copy') as PageElements['desktop-nip46-qr-copy']);
      const desktopNip46QrCancel = (document.getElementById('desktop-nip46-qr-cancel') as PageElements['desktop-nip46-qr-cancel']);
      const desktopNsecInput = (document.getElementById('desktop-nsec-input') as PageElements['desktop-nsec-input']);
      const desktopNsecConnect = (document.getElementById('desktop-nsec-connect') as PageElements['desktop-nsec-connect']);
      const desktopSignerDisconnect = (document.getElementById('desktop-signer-disconnect') as PageElements['desktop-signer-disconnect']);
      const desktopSignerStatus = (document.getElementById('desktop-signer-status') as PageElements['desktop-signer-status']);
      const desktopSignerMethod = (document.getElementById('desktop-signer-method') as PageElements['desktop-signer-method']);
      const desktopSignerNpub = (document.getElementById('desktop-signer-npub') as PageElements['desktop-signer-npub']);
      const desktopSignerStorage = (document.getElementById('desktop-signer-storage') as PageElements['desktop-signer-storage']);
      const themeModeInput = (document.getElementById('theme-mode') as PageElements['theme-mode']);
      const readerFontInput = (document.getElementById('reader-font') as PageElements['reader-font']);
      const readerAlignmentInput = (document.getElementById('reader-alignment') as PageElements['reader-alignment']);
      const readerFontSizeInput = (document.getElementById('reader-font-size') as PageElements['reader-font-size']);
      const readerFontSizeValue = (document.getElementById('reader-font-size-value') as PageElements['reader-font-size-value']);
      const readerPaddingInput = (document.getElementById('reader-padding') as PageElements['reader-padding']);
      const readerPaddingValue = (document.getElementById('reader-padding-value') as PageElements['reader-padding-value']);
      const speechLanguageInput = (document.getElementById('speech-language') as PageElements['speech-language']);
      const speechVoiceInput = (document.getElementById('speech-voice') as PageElements['speech-voice']);
      const speechRateInput = (document.getElementById('speech-rate') as PageElements['speech-rate']);
      const speechRateValue = (document.getElementById('speech-rate-value') as PageElements['speech-rate-value']);
      const torrentDownloadLimitInput = (document.getElementById('torrent-download-limit') as PageElements['torrent-download-limit']);
      const torrentUploadLimitInput = (document.getElementById('torrent-upload-limit') as PageElements['torrent-upload-limit']);
      const speechModelButtons = [...document.querySelectorAll<HTMLButtonElement>('[id^="speech-model-"]:not(#speech-model-status)')];
      const speechModelStatus = (document.getElementById('speech-model-status') as PageElements['speech-model-status']);
      const npubButton = (document.getElementById('npub-button') as PageElements['npub-button']);
      const npubDisplay = (document.getElementById('npub-display') as PageElements['npub-display']);
      const nip7Status = (document.getElementById('nip7-status') as PageElements['nip7-status']);
      const dictionarySource = (document.getElementById('dictionary-source') as PageElements['dictionary-source']);
      const dictionaryTarget = (document.getElementById('dictionary-target') as PageElements['dictionary-target']);
      const dictionaryInstall = (document.getElementById('dictionary-install') as PageElements['dictionary-install']);
      const dictionaryStatus = (document.getElementById('dictionary-status') as PageElements['dictionary-status']);
      const dictionaryPacks = (document.getElementById('dictionary-packs') as PageElements['dictionary-packs']);

      function createSerializedPreferenceWriter<T extends Record<string, unknown>>(write: (preferences: T) => Promise<unknown> | unknown): (preferences: T) => Promise<unknown> {
        let queued: Promise<unknown> = Promise.resolve();
        return (preferences: T) => {
          const snapshot = { ...preferences };
          const nextWrite = queued.catch(() => {}).then(() => write(snapshot));
          queued = nextWrite;
          return nextWrite;
        };
      }

      const desktopTransferPreferenceWriter = createSerializedPreferenceWriter(
        preferences => desktopBridge?.transfers?.setPreferences?.(preferences),
      );

      function syncDesktopTransferPreferences(preferences: Readonly<Record<string, unknown>>) {
        void desktopTransferPreferenceWriter(preferences).catch(error => {
          console.warn('Could not save desktop transfer preferences:', error);
        });
      }

      const state = {
        favorites: [] as PageBook[],
        reading: [] as PageBook[],
        words: [] as VocabularyEntry[],
        following: [] as FollowEntry[],
        followedProfiles: [] as { pubkey: string; [key: string]: unknown }[],
        publicBookLists: [] as Record<string, unknown>[],
        followingLoaded: false,
        settings: {
          autoReading: true,
          autoDownloadTorrents: true,
          autoSeedTorrents: true,
          torrentDownloadLimit: 10000000,
          torrentUploadLimit: 1000000,
          useNip7: true,
          theme: 'white',
          readerFont: 'arial',
          readerAlignment: 'justified',
          readerFontPercent: 100,
          readerPadding: 24,
          speechVoiceEnglish: '',
          speechVoicePortuguese: '',
          speechVoices: {} as Record<string, string>,
          speechLanguage: 'en',
          speechRate: 1,
          opdsFeeds: [] as PublicOPDSFeed[]
        },
        nip7: {
          pubkey: '',
          npub: ''
        }
      };

      let searchResultBooks: PageBook[] = [];
      let contentSearchBooks: PageBook[] = [];
      const searchResultSort = { key: '', direction: 'asc' };
      const searchResultFilter = { language: '', format: '' };
      let searchResultPage = 1;
      let activeSearchGeneration = 0;
      let libcatPage: { query: string; type: string; offset: number; generation: number } | null = null;

      let dictionaryDbPromise: Promise<IDBDatabase> | undefined;
      let sqlRuntimePromise: Promise<DictionarySqlRuntime> | undefined;
      let opdsSourcesModule: Promise<typeof import('./opds-sources.js')> | undefined;
      let desktopNip46QrUri = '';
      let desktopNip46QrTimer: ReturnType<typeof setInterval> | null = null;

      if (isDesktopMode) {
        desktopSignerPanel.classList.remove('hidden');
        nip7Status.classList.add('hidden');
      }

      function dictionaryDb(): Promise<IDBDatabase> {
        if (dictionaryDbPromise) return dictionaryDbPromise;
        dictionaryDbPromise = new Promise((resolve, reject) => {
          const request = indexedDB.open(DICTIONARY_DB_NAME, 1);
          request.onerror = () => reject(request.error);
          request.onupgradeneeded = () => {
            request.result.createObjectStore('packs', { keyPath: 'id' });
          };
          request.onsuccess = () => resolve(request.result);
        });
        return dictionaryDbPromise;
      }

      async function dictionaryRecords(): Promise<DictionaryPack[]> {
        const db = await dictionaryDb();
        return new Promise((resolve, reject) => {
          const request = db.transaction('packs').objectStore('packs').getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve((request.result || []) as DictionaryPack[]);
        });
      }

      async function dictionaryPut(record: DictionaryPack): Promise<void> {
        const db = await dictionaryDb();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction('packs', 'readwrite');
          transaction.objectStore('packs').put(record);
          transaction.onerror = () => reject(transaction.error);
          transaction.oncomplete = () => resolve();
        });
      }

      async function dictionaryDelete(id: string): Promise<void> {
        const db = await dictionaryDb();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction('packs', 'readwrite');
          transaction.objectStore('packs').delete(id);
          transaction.onerror = () => reject(transaction.error);
          transaction.oncomplete = () => resolve();
        });
      }

      function sqlRuntime(): Promise<DictionarySqlRuntime> {
        if (!sqlRuntimePromise) {
          sqlRuntimePromise = initSqlJs({ locateFile: file => `vendor/${file}` });
        }
        return sqlRuntimePromise!;
      }

      function formatPackSize(bytes: number) {
        return `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)} MB`;
      }

      async function renderDictionaryPacks() {
        const packs = await dictionaryRecords();
        dictionaryPacks.innerHTML = '';
        if (!packs.length) {
          dictionaryPacks.textContent = 'No offline dictionaries installed.';
          return;
        }
        for (const pack of packs.sort((a, b) => a.label.localeCompare(b.label))) {
          const row = document.createElement('div');
          row.className = 'dictionary-pack';
          const label = document.createElement('span');
          label.textContent = `${pack.label} · ${formatPackSize(pack.size)}`;
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.textContent = 'Remove';
          remove.addEventListener('click', async () => {
            await dictionaryDelete(pack.id);
            dictionaryStatus.textContent = `Removed ${pack.label}.`;
            await renderDictionaryPacks();
            await refreshDictionaryTargetOptions();
          });
          row.append(label, remove);
          dictionaryPacks.appendChild(row);
        }
      }

      async function installDictionaryPack() {
        const source = dictionarySource.value;
        const target = dictionaryTarget.value;
        if (!source || !target || source === target) {
          dictionaryStatus.textContent = 'Choose two different languages.';
          return;
        }
        const id = `${source}-${target}`;
        const label = `${DICTIONARY_LANGUAGES[source]} → ${DICTIONARY_LANGUAGES[target]}`;
        dictionaryInstall.disabled = true;
        dictionaryStatus.textContent = `Downloading ${label}…`;
        try {
          const dictionaryUrl = isDesktopMode
            ? `/api/dictionaries/${id}.sqlite3`
            : `${WIKDICT_BASE}/${id}.sqlite3`;
          const response = await fetch(dictionaryUrl);
          if (!response.ok) throw new Error(`download failed (${response.status})`);
          const bytes = await response.arrayBuffer();
          if (bytes.byteLength < 1024) throw new Error('download was incomplete');
          const SQL = await sqlRuntime();
          const check = new SQL.Database(new Uint8Array(bytes));
          check.exec('SELECT written_rep FROM simple_translation LIMIT 1');
          check.close();
          const existing = (await dictionaryRecords()).filter(pack => pack.id !== id).sort((a, b) => a.lastUsed - b.lastUsed);
          let total = existing.reduce((sum, pack) => sum + Number(pack.size || 0), 0) + bytes.byteLength;
          while (total > DICTIONARY_STORAGE_LIMIT && existing.length) {
            const oldest = existing.shift()!;
            await dictionaryDelete(oldest.id);
            total -= Number(oldest.size || 0);
          }
          if (total > DICTIONARY_STORAGE_LIMIT) throw new Error('dictionary exceeds the 250 MB storage limit');
          await dictionaryPut({ id, source, target, label, bytes, size: bytes.byteLength, lastUsed: Date.now() });
          dictionaryStatus.textContent = `Installed ${label}.`;
          await renderDictionaryPacks();
          await refreshDictionaryTargetOptions();
        } catch (error) {
          dictionaryStatus.textContent = `Could not install dictionary: ${(error as Error)?.message || error}`;
        } finally {
          dictionaryInstall.disabled = false;
        }
      }

      function populateDictionaryTargetOptions(preferredTarget = '', installed: Set<string> = new Set()) {
        const source = dictionarySource.value;
        const available = Object.entries(DICTIONARY_LANGUAGES)
          .filter(([code]) => code !== source && !installed.has(`${source}-${code}`))
          .sort(([, left], [, right]) => left.localeCompare(right));
        const previous = preferredTarget || dictionaryTarget.value;
        dictionaryTarget.replaceChildren(...available.map(([code, label]) => new Option(label, code)));
        if (available.some(([code]) => code === previous)) dictionaryTarget.value = previous;
        dictionaryTarget.disabled = !available.length;
        dictionaryInstall.disabled = !available.length;
      }

      async function refreshDictionaryTargetOptions(preferredTarget = ''): Promise<void> {
        let installed = new Set<string>();
        try {
          installed = new Set((await dictionaryRecords()).map(pack => pack.id));
        } catch {}
        populateDictionaryTargetOptions(preferredTarget, installed);
      }

      async function lookupOfflineWord(word: string, language: string): Promise<{ label: string; definitions: string[] } | null> {
        const normalized = String(language || '').split('-')[0]!.toLowerCase();
        const packs = (await dictionaryRecords()).filter(pack => pack.source === normalized);
        const SQL = await sqlRuntime();
        for (const pack of packs) {
          const database = new SQL.Database(new Uint8Array(pack.bytes));
          const statement = database.prepare(
            'SELECT trans_list, sense_list FROM translation_grouped WHERE written_rep = ? COLLATE NOCASE ORDER BY score DESC, importance DESC LIMIT 6'
          );
          statement.bind([word]);
          const definitions: string[] = [];
          while (statement.step()) {
            const row = statement.get();
            const translations = String(row[0] || '').replaceAll(' | ', ', ').trim();
            const sense = String(row[1] || '').trim();
            const definition = sense ? `${translations} — ${sense}` : translations;
            if (definition && !definitions.includes(definition)) definitions.push(definition);
          }
          statement.free();
          database.close();
          if (definitions.length) {
            await dictionaryPut({ ...pack, lastUsed: Date.now() });
            return { label: `WikDict · ${pack.label}`, definitions: definitions.slice(0, 4) };
          }
        }
        return null;
      }

      function makeSubId(prefix = 'bookstr'): string {
        const random = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID().replace(/-/g, '')
          : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
        return `${prefix}-${random.slice(0, 14)}`;
      }

      type NostrBookRecord = Record<string, unknown> & {
        md5?: string; key?: string; updatedAt?: number; deleted?: boolean; favoriteAddedAt?: number;
        url?: string; readUrl?: string; title?: string; author?: string; authors?: string | string[];
        format?: string; language?: string; source?: string; year?: string | number;
        isbn?: string; blossomSha256?: string; blossomUrl?: string;
        extension?: string; metadataProvenance?: Record<string, unknown>;
        locator?: { locations?: { cfi?: string }; href?: string };
      };
      type NostrProfileRecord = { pubkey: string; nip05?: string; name?: string; picture?: string; verifiedNip05?: string; [key: string]: unknown };
      type NostrDeviceRecord = { name?: string; platform?: string; capabilities?: string[]; pubkey?: string };
      type NostrProgressBook = NostrBookRecord & { md5: string; updatedAt: number; deleted?: boolean; progression?: number; furthestProgression?: number; cfi?: string };
      type NostrWireVocabulary = VocabularyEntry & { key: string; updatedAt: number };
      type NostrCacheSnapshot = { favorites: NostrBookRecord[] | null; reading: NostrBookRecord[]; words: VocabularyEntry[]; opdsFeeds?: unknown; ts?: number; version?: number; pubkey?: string };

      function parseNostrTagsValue(value: unknown): string {
        return String(value || '').trim();
      }

      function normalizeIsbnFromTag(value: unknown): string {
        const normalized = parseNostrTagsValue(value)
          .match(/[0-9Xx][0-9Xx\s-]{8,20}[0-9Xx]/g)
          ?.join('')
          ?.replace(/[^0-9Xx]/g, '')
          ?.toUpperCase() ?? '';
        if (normalized.length === 10 || normalized.length === 13) {
          return normalized;
        }
        return '';
      }

      function pseudoIdForSeed(seed: unknown): string {
        const text = parseNostrTagsValue(seed);
        let hash = 0;
        for (let i = 0; i < text.length; i += 1) {
          hash = ((hash << 5) - hash) + text.charCodeAt(i);
          hash |= 0;
        }
        return `x${Math.abs(hash).toString(16).padStart(8, '0')}`;
      }

      function readRelayEvents(relayUrl: string, filters: Record<string, unknown>, { authenticate = false }: { authenticate?: boolean } = {}): Promise<MigratedNostrEvent[]> {
        return new Promise((resolve) => {
          const events: MigratedNostrEvent[] = [];
          let socket: WebSocket | undefined;
          let settled = false;
          let authEventId = '';
          let authInFlight = false;
          let authenticatedRequestSent = false;
          const subscription = makeSubId('bookstr-sync');
          const sendRequest = () => {
            if (socket?.readyState !== WebSocket.OPEN) return;
            socket.send(JSON.stringify(['REQ', subscription, filters]));
          };
          const done = (next: MigratedNostrEvent[]) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
              if (socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify(['CLOSE', subscription]));
              }
            } catch {
              /* ignore */
            }
            try {
              socket?.close();
            } catch {
              /* ignore */
            }
            resolve(next);
          };

          const timer = setTimeout(
            () => done(events),
            authenticate ? NOSTR_AUTH_QUERY_TIMEOUT_MS : NOSTR_QUERY_TIMEOUT_MS
          );
          const onMessage = async (event: MessageEvent<string>) => {
            try {
              const packet = JSON.parse(event.data);
              if (!Array.isArray(packet) || packet.length < 2) {
                return;
              }
              const type = packet[0];
              const id = packet[1];
              if (type === 'AUTH' && authenticate && !authInFlight) {
                if (!nostrSigner?.signEvent || !String(id || '')) {
                  done(events);
                  return;
                }
                authInFlight = true;
                try {
                  const signer = nostrSigner;
                  if (!signer?.signEvent) { done(events); return; }
                  const signed = await signer.signEvent(
                    NostrSocial.nip42AuthTemplate(relayUrl, id as string) as MigratedNostrEvent
                  ) as MigratedNostrEvent;
                  authEventId = String(signed?.id || '');
                  if (!authEventId || socket?.readyState !== WebSocket.OPEN) {
                    done(events);
                    return;
                  }
                  socket.send(JSON.stringify(['AUTH', signed]));
                  authenticatedRequestSent = true;
                  sendRequest();
                } catch {
                  done(events);
                }
                return;
              }
              if (type === 'OK' && authenticate && id === authEventId) {
                if (packet[2] !== true) {
                  done(events);
                }
                return;
              }
              if (type === 'EVENT' && id === subscription && packet[2]?.pubkey) {
                const payload = packet[2];
                events.push(payload);
                return;
              }
              if (type === 'EOSE' && id === subscription) {
                if (authenticate && !authenticatedRequestSent) return;
                clearTimeout(timer);
                done(events);
              }
            } catch {
              /* ignore */
            }
          };

          try {
            socket = new WebSocket(relayUrl);
            socket.addEventListener('open', () => {
              sendRequest();
            });
            socket.addEventListener('message', onMessage);
            socket.addEventListener('error', () => {
              done(events);
            });
            socket.addEventListener('close', () => {
              done(events);
            });
          } catch {
            done([]);
          }
        });
      }

      async function queryNostrEvents(pubkey: string, filters: Record<string, unknown> | Record<string, unknown>[]): Promise<MigratedNostrEvent[]> {
        if (!Array.isArray(NOSTR_RELAYS) || !NOSTR_RELAYS.length || !pubkey) {
          return [];
        }
        const queryFilter = {
          ...((Array.isArray(filters) ? filters[0] : filters) || {}),
          authors: [pubkey],
          limit: ((Array.isArray(filters) ? filters[0] : filters)?.limit) || 200,
        };
        const events = await Promise.all(NOSTR_RELAYS.map((relay) => readRelayEvents(relay, queryFilter)));
        return events.flat().filter(Boolean).sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
      }

      let nostrToolsModule: Promise<typeof import('./vendor/nostr-tools.js')> | undefined;
      async function verifiedNostrEvents(events: MigratedNostrEvent[]): Promise<MigratedNostrEvent[]> {
        nostrToolsModule ||= import('./vendor/nostr-tools.js');
        const tools = await nostrToolsModule;
        return (Array.isArray(events) ? events : []).filter(event => {
          try {
            return tools.verifyEvent(event as Parameters<typeof tools.verifyEvent>[0]);
          } catch {
            return false;
          }
        });
      }

      async function pullNostrFollows(pubkey: string) {
        const events = await queryNostrEvents(pubkey, { kinds: [NOSTR_FOLLOW_KIND], limit: 10 });
        const verified = await verifiedNostrEvents(events);
        return NostrSocial.followsFromEvent(NostrSocial.latestFollowEvent(verified, pubkey));
      }

      async function pullFollowedPublicBookLists(follows: { pubkey: string; relay?: string }[]) {
        const pubkeys = (Array.isArray(follows) ? follows : []).map(follow => follow.pubkey).filter(Boolean);
        if (!pubkeys.length) return [];
        const batches = [];
        for (let index = 0; index < pubkeys.length; index += 50) {
          batches.push(pubkeys.slice(index, index + 50));
        }
        const socialRelays = Array.from(new Set([...NOSTR_RELAYS, ...NOSTR_SOCIAL_RELAYS]));
        const requests = batches.flatMap(authors => socialRelays.map(relay => readRelayEvents(relay, {
          kinds: [NOSTR_FAVORITES_KIND],
          authors,
          limit: 500,
        })));
        const hintedAuthorsByRelay = new Map();
        for (const follow of follows) {
          if (!follow.relay || socialRelays.includes(follow.relay)) continue;
          const authors = hintedAuthorsByRelay.get(follow.relay) || new Set();
          authors.add(follow.pubkey);
          hintedAuthorsByRelay.set(follow.relay, authors);
        }
        for (const [relay, authorSet] of hintedAuthorsByRelay) {
          const authors = Array.from(authorSet);
          requests.push(readRelayEvents(relay, { kinds: [NOSTR_FAVORITES_KIND], authors, limit: 500 }));
        }
        const responses = await Promise.all(requests);
        const verified = await verifiedNostrEvents(responses.flat());
        return NostrSocial.publicBookLists(verified, pubkeys);
      }

      async function verifyProfileNip05(profile: { nip05?: string; pubkey: string; [key: string]: unknown }) {
        const parts = NostrSocial.nip05Parts(profile?.nip05);
        if (!parts) return { ...profile, verifiedNip05: '' };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), NOSTR_QUERY_TIMEOUT_MS);
        try {
          const response = await fetch(parts.url, {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          });
          if (!response.ok) return { ...profile, verifiedNip05: '' };
          const document = await response.json();
          return {
            ...profile,
            verifiedNip05: NostrSocial.nip05Matches(document, parts.name, profile.pubkey)
              ? parts.address
              : '',
          };
        } catch {
          return { ...profile, verifiedNip05: '' };
        } finally {
          clearTimeout(timer);
        }
      }

      async function pullFollowedProfiles(follows: { pubkey: string; relay?: string }[]) {
        const pubkeys = (Array.isArray(follows) ? follows : []).map(follow => follow.pubkey).filter(Boolean);
        if (!pubkeys.length) return [];
        const batches = [];
        for (let index = 0; index < pubkeys.length; index += 50) {
          batches.push(pubkeys.slice(index, index + 50));
        }
        const socialRelays = Array.from(new Set([...NOSTR_RELAYS, ...NOSTR_SOCIAL_RELAYS]));
        const requests = batches.flatMap(authors => socialRelays.map(relay => readRelayEvents(relay, {
          kinds: [0],
          authors,
          limit: authors.length * 2,
        })));
        for (const authors of batches) {
          requests.push(readRelayEvents(NOSTR_TRUSTROOTS_PROFILE_RELAY, {
            kinds: [0],
            authors,
            limit: authors.length * 2,
          }, { authenticate: true }));
        }
        const hintedAuthorsByRelay = new Map();
        for (const follow of follows) {
          if (!follow.relay || socialRelays.includes(follow.relay)) continue;
          const authors = hintedAuthorsByRelay.get(follow.relay) || new Set();
          authors.add(follow.pubkey);
          hintedAuthorsByRelay.set(follow.relay, authors);
        }
        for (const [relay, authorSet] of hintedAuthorsByRelay) {
          const authors = Array.from(authorSet);
          requests.push(readRelayEvents(relay, { kinds: [0], authors, limit: authors.length * 2 }));
        }
        const responses = await Promise.all(requests);
        const verified = await verifiedNostrEvents(responses.flat());
        const profiles = NostrSocial.latestProfiles(verified, pubkeys) as NostrProfileRecord[];
        return Promise.all(profiles.map(verifyProfileNip05));
      }

      function renderPeople() {
        if (!state.nip7.pubkey) {
          peopleList.innerHTML = `<p class="note">${nostrSignerName} not connected.</p>`;
          return;
        }
        if (!state.followingLoaded) {
          peopleList.innerHTML = '<p class="note">Loading…</p>';
          return;
        }
        if (!state.following.length) {
          peopleList.innerHTML = '<p class="note">No follows found.</p>';
          return;
        }
        const listsByAuthor = new Map<string, Array<{ title: string; createdAt: number }>>();
        for (const rawList of state.publicBookLists) {
          const list = rawList as { pubkey: string; title: string; createdAt: number };
          const lists = listsByAuthor.get(list.pubkey) || [];
          lists.push(list);
          listsByAuthor.set(list.pubkey, lists);
        }
        const profilesByAuthor = new Map<string, NostrProfileRecord>(state.followedProfiles.map(profile => [profile.pubkey, profile as NostrProfileRecord]));
        const sorted = [...state.following].sort((left, right) => {
          const leftLatest = listsByAuthor.get(left.pubkey)?.[0]?.createdAt || 0;
          const rightLatest = listsByAuthor.get(right.pubkey)?.[0]?.createdAt || 0;
          return Number(Boolean(rightLatest)) - Number(Boolean(leftLatest))
            || Number(rightLatest) - Number(leftLatest)
            || Number(Boolean(profilesByAuthor.get(right.pubkey))) - Number(Boolean(profilesByAuthor.get(left.pubkey)))
              || String(profilesByAuthor.get(left.pubkey)?.name || (left as FollowEntry & { petname?: string }).petname || '').localeCompare(
              String(profilesByAuthor.get(right.pubkey)?.name || (right as FollowEntry & { petname?: string }).petname || '')
            );
        });
        peopleList.innerHTML = sorted.map(follow => {
          const npub = publicKeyToNpub(follow.pubkey) || follow.pubkey;
          const profile = profilesByAuthor.get(follow.pubkey);
          const name = profile?.name || (follow as FollowEntry & { petname?: string }).petname;
          const avatar = profile?.picture
            ? `<img class="person-avatar" src="${escapeHtml(profile.picture)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
            : '<span class="person-avatar" aria-hidden="true"></span>';
          const identity = `${name ? `<strong class="person-name">${escapeHtml(name)}</strong>` : ''}`
            + `${profile?.verifiedNip05 ? `<span class="person-nip05">${escapeHtml(profile.verifiedNip05)}</span>` : ''}`
            + `<code>${escapeHtml(npub)}</code>`;
          const titles = (listsByAuthor.get(follow.pubkey) || [])
            .map(list => `<li>${escapeHtml(list.title)}</li>`).join('');
          return `<article class="person-row">${avatar}<div>${identity}${titles ? `<ul class="person-lists">${titles}</ul>` : ''}</div></article>`;
        }).join('');
      }

      function shortDeviceKey(value: unknown): string {
        const key = String(value || '');
        return key.length >= 20 ? `${key.slice(0, 12)}…${key.slice(-8)}` : 'pending';
      }

      function deviceTransferError(error: unknown): string {
        console.warn('Bookstr transfer action failed.', error);
        return 'Check the book and paired-device details, then try again.';
      }

      async function refreshDeviceTransferPanel() {
        if (!isDesktopMode || !desktopBridge?.devices?.status || !desktopBridge?.devices?.registry) return;
        deviceTransferPanel.classList.remove('hidden');
        deviceTransferSummary.textContent = 'Checking this device…';
        try {
          const [device, registry, transfers] = await Promise.all([
            desktopBridge.devices.status(),
            desktopBridge.devices.registry(),
            desktopBridge.transfers?.status?.() || [],
          ]);
          const deviceStatus = device as { accountPubkey?: string; persistent?: boolean; name?: string } | null;
          const registryStatus = registry as { devices?: NostrDeviceRecord[] } | null;
          const devices = Array.isArray(registryStatus?.devices) ? registryStatus.devices : [];
          const account = String(deviceStatus?.accountPubkey || '');
          const storage = deviceStatus?.persistent ? 'protected device key' : 'session-only device key';
          const transferCount = Array.isArray(transfers) ? transfers.length : 0;
          deviceTransferSummary.textContent = account
            ? `${deviceStatus?.name || 'Bookstr desktop'} · ${storage} · ${devices.length} authorized device${devices.length === 1 ? '' : 's'} · ${transferCount} active transfer${transferCount === 1 ? '' : 's'}`
            : `${deviceStatus?.name || 'Bookstr desktop'} · ${storage}. Connect your Bookstr account to authorize other devices.`;
          if (!devices.length) {
            deviceTransferDevices.innerHTML = '<p class="device-transfer-note">No authorized devices are available yet. Pair another signed Bookstr client to make it discoverable here.</p>';
            return;
          }
          deviceTransferDevices.innerHTML = devices.map(entry => `<div class="device-transfer-device">
            <span><strong>${escapeHtml(entry.name || 'Bookstr device')}</strong><br><small>${escapeHtml(entry.platform || 'web')} · ${escapeHtml((entry.capabilities || []).join(', ') || 'library')}</small></span>
            <code title="${escapeHtml(entry.pubkey || '')}">${escapeHtml(shortDeviceKey(entry.pubkey))}</code>
          </div>`).join('');
        } catch (error) {
          deviceTransferSummary.textContent = `Device status unavailable: ${deviceTransferError(error)}`;
          deviceTransferDevices.replaceChildren();
        }
      }

      let nostrPeopleSyncTask: Promise<boolean> | null = null;
      async function syncNostrPeopleFromNip7() {
        if (isDesktopMode) return false;
        const pubkey = state.nip7.pubkey;
        if (!state.settings.useNip7 || !pubkey) return false;
        if (nostrPeopleSyncTask) return nostrPeopleSyncTask;
        state.followingLoaded = false;
        renderPeople();
        const task = (async () => {
          const following = await pullNostrFollows(pubkey);
          state.following = following;
          state.followedProfiles = [];
          state.publicBookLists = [];
          state.followingLoaded = true;
          renderPeople();
          const [publicBookLists, followedProfiles] = await Promise.all([
            pullFollowedPublicBookLists(following),
            pullFollowedProfiles(following),
          ]);
          state.publicBookLists = publicBookLists;
          state.followedProfiles = followedProfiles;
          renderPeople();
          return true;
        })().catch(() => {
          state.followingLoaded = true;
          renderPeople();
          return false;
        });
        nostrPeopleSyncTask = task.finally(() => { nostrPeopleSyncTask = null; });
        return nostrPeopleSyncTask;
      }

      function publishRelayEvent(relayUrl: string, event: MigratedNostrEvent): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
          let settled = false;
          let socket: WebSocket | undefined;
          const done = (accepted: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { socket?.close(); } catch { /* ignore */ }
            resolve(accepted);
          };
          const timer = setTimeout(() => done(false), NOSTR_QUERY_TIMEOUT_MS);
          try {
            socket = new WebSocket(relayUrl);
            socket.addEventListener('open', () => socket?.send(JSON.stringify(['EVENT', event])));
            socket.addEventListener('message', (message) => {
              try {
                const packet = JSON.parse(message.data);
                if (packet?.[0] === 'OK' && packet[1] === event.id) done(packet[2] === true);
              } catch { /* ignore */ }
            });
            socket.addEventListener('error', () => done(false));
            socket.addEventListener('close', () => done(false));
          } catch {
            done(false);
          }
        });
      }

      function favoriteNostrItemTags(now = Math.floor(Date.now() / 1000)): string[][] {
        const tags: string[][] = [];
        for (const favorite of state.favorites) {
          const id = String(favorite.md5 || '');
          const readUrl = favorite.readUrl || favorite.url || '';
          const addedAt = String(BookMetadata.normalizeFavoriteAddedAt(favorite.favoriteAddedAt) || now);
          const tagId = id || pseudoIdForSeed(`${favorite.title || ''}${readUrl}`);
		  const rights = BookMetadata.normalizeRights(favorite);
          if (isMd5(id)) {
            tags.push(['book', 'libvault', id.toLowerCase(), addedAt]);
            tags.push([
              'libvault-book', id.toLowerCase(), favorite.title || '', (favorite.authors || favorite.author || '') as string,
              (favorite.format || '') as string, String(Number(favorite.filesizeBytes || favorite.filesize_bytes) || 0),
              (favorite.year || '') as string, favorite.language || '', (favorite.source || '') as string,
              (favorite.coverUrl || '') as string, (favorite.coverSha256 || '') as string,
			  rights.rights_status as string, rights.license as string, rights.license_url as string, rights.rights_source as string,
            ]);
			tags.push(['bookstr', tagId, favorite.title || '', (favorite.authors || favorite.author || '') as string, readUrl, (favorite.format || '') as string, (favorite.year || '') as string, favorite.language || '', (favorite.source || '') as string, (favorite.coverUrl || '') as string, (favorite.coverSha256 || '') as string, rights.rights_status as string, rights.license as string, rights.license_url as string, rights.rights_source as string]);
          } else {
            tags.push(['book', 'bookstr', tagId, addedAt, readUrl].filter((value): value is string => Boolean(value)));
			tags.push(['bookstr', tagId, favorite.title || '', (favorite.authors || favorite.author || '') as string, readUrl, (favorite.format || '') as string, (favorite.year || '') as string, favorite.language || '', (favorite.source || '') as string, (favorite.coverUrl || '') as string, (favorite.coverSha256 || '') as string, rights.rights_status as string, rights.license as string, rights.license_url as string, rights.rights_source as string]);
          }
        }
        return tags;
      }

      function splitFavoriteTags(tags: string[][]): string[][][] {
        const chunks: string[][][] = [];
        let current: string[][] = [];
        for (const tag of tags) {
          const candidate = [...current, tag];
          if (current.length && JSON.stringify(candidate).length > FAVORITES_CHUNK_LIMIT) {
            chunks.push(current);
            current = [tag];
          } else {
            current = candidate;
          }
        }
        if (current.length) chunks.push(current);
        return chunks.length ? chunks : [[]];
      }

      function randomCollectionChunkPrefix() {
        const random = crypto.randomUUID?.().replaceAll('-', '')
          || `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
        return `bookstr-chunk-${random.slice(0, 32)}`;
      }

      function nextFavoritesCreatedAt() {
        const wallClock = Math.floor(Date.now() / 1000);
        const previous = Number(localStorage.getItem(NOSTR_FAVORITES_PUBLISH_TIME_KEY) || 0);
        const next = Math.max(wallClock, Number.isFinite(previous) ? previous + 1 : wallClock);
        localStorage.setItem(NOSTR_FAVORITES_PUBLISH_TIME_KEY, String(next));
        return next;
      }

      async function syncFavoritesToNostr() {
        if (isDesktopMode) return [];
        if (!nostrSigner?.signEvent || !nostrSigner?.nip44?.encrypt) {
          throw new Error(`${nostrSignerName} with NIP-44 support is required to sync favorites.`);
        }
        const signer = nostrSigner;
        if (!signer?.signEvent || !signer.nip44?.encrypt) {
          throw new Error(`${nostrSignerName} with NIP-44 support is required to sync favorites.`);
        }
        const pubkey = state.nip7.pubkey || await signer.getPublicKey() as string;
        const now = nextFavoritesCreatedAt();
		const header = [
          ['bookstr-collection', '2'],
          ['bookstr-publications', '2'],
          ['bookstr-opds-feeds', '1'],
          ...publicOPDSFeedNostrTags(),
          ['title', 'Favorites'],
          ['updated', String(now)],
        ];
        const itemTags = favoriteNostrItemTags(now);
        const publishedEvents: MigratedNostrEvent[] = [];
        const publishEncrypted = async (dTag: string, tags: string[][]): Promise<MigratedNostrEvent> => {
          const plaintext = JSON.stringify(tags);
          if (plaintext.length > FAVORITES_CHUNK_LIMIT) throw new Error('One favorite reference is too large to encrypt safely.');
          const content = await signer.nip44.encrypt(pubkey, plaintext) as string;
          const event = await signer.signEvent({
            kind: NOSTR_FAVORITES_KIND,
            created_at: now,
            tags: [['d', dTag]],
            content,
          }) as MigratedNostrEvent;
          const accepted = await Promise.all(NOSTR_RELAYS.map(relay => publishRelayEvent(relay, event)));
          if (!accepted.some(Boolean)) throw new Error('No Nostr relay accepted the favorites update.');
          publishedEvents.push(event);
          return event;
        };
        const directTags = [...header, ...itemTags];
        if (JSON.stringify(directTags).length <= FAVORITES_CHUNK_LIMIT) {
          await publishEncrypted(FAVORITES_D_TAG, directTags);
        } else {
          const chunks = splitFavoriteTags(itemTags);
          const prefix = randomCollectionChunkPrefix();
          for (let index = 0; index < chunks.length; index += 1) {
            await publishEncrypted(`${prefix}-${index}`, chunks[index]!);
          }
          await publishEncrypted(FAVORITES_D_TAG, [
            ...header,
            ['bookstr-chunks', String(chunks.length), prefix],
          ]);
        }
        saveNostrSyncCache(pubkey, {
          favorites: state.favorites,
          reading: state.reading,
          words: state.words,
        });
        status.textContent = 'Favorites synced to Nostr.';
        return publishedEvents;
      }

      async function previousFavoriteSnapshotEvents(pubkey: string): Promise<MigratedNostrEvent[]> {
        const roots = await verifiedNostrEvents(await queryNostrEvents(pubkey, {
          kinds: [NOSTR_FAVORITES_KIND],
          limit: 10,
          '#d': [FAVORITES_D_TAG],
        }));
        const events = [...roots];
        for (const rootEvent of roots) {
          try {
            const tags = await decryptFavoritePayload(pubkey, rootEvent.content);
            const manifest = tags.find(tag => Array.isArray(tag)
              && (tag[0] === 'bookstr-chunks' || tag[0] === 'libvault-chunks'));
            const count = Number(manifest?.[1] || 0);
            const prefix = String(manifest?.[2] || '');
            if (!Number.isInteger(count) || count < 1 || count > 10000 || !prefix) continue;
            for (let index = 0; index < count; index += 1) {
              const chunks = await verifiedNostrEvents(await queryNostrEvents(pubkey, {
                kinds: [NOSTR_FAVORITES_KIND],
                limit: 10,
                '#d': [`${prefix}-${index}`],
              }));
              events.push(...chunks);
            }
          } catch {
            // The root event can still be deleted if an old chunk is unreadable.
          }
        }
        return [...new Map(events.filter(event => event?.id).map(event => [event.id, event])).values()];
      }

      async function syncFavoriteDeletionToNostr(): Promise<void> {
        if (isDesktopMode) return;
        const pubkey = (state.nip7.pubkey || await nostrSigner?.getPublicKey?.()) as string;
        if (!pubkey || !nostrSigner?.signEvent || !nostrSigner?.nip44?.encrypt) {
          throw new Error(`Connect your ${nostrSignerName} to delete this book from Nostr favorites.`);
        }
        const previousEvents = await previousFavoriteSnapshotEvents(pubkey);
        const publishedEvents = await syncFavoritesToNostr();
        const publishedIds = new Set(publishedEvents.map(event => event.id));
        const deletedIds = previousEvents.map(event => event.id).filter(id => !publishedIds.has(id));
        if (!deletedIds.length) return;
        const deletion = await nostrSigner.signEvent({
          kind: 5,
          created_at: Math.floor(Date.now() / 1000),
          tags: deletedIds.map(id => ['e', id] as string[]),
          content: '',
        }) as MigratedNostrEvent;
        if (!await publishNostrDeletion(deletion)) {
          throw new Error('Nostr relays did not accept the favorites deletion.');
        }
      }

      let favoriteSyncTimer: ReturnType<typeof setTimeout> | undefined;
      function queueFavoriteSync() {
        if (isDesktopMode) return;
        clearTimeout(favoriteSyncTimer);
        favoriteSyncTimer = setTimeout(() => {
          syncFavoritesToNostr().catch((error) => {
            status.textContent = `Favorite saved locally; Nostr sync failed: ${(error as { message?: unknown } | null | undefined)?.message || error}`;
          });
        }, 250);
      }

      let nip17FetchModule: Promise<typeof import('./nip17-fetch.js')> | undefined;
      let browserWebTorrentRuntimePromise: Promise<{ client: Parameters<typeof import('./webtorrent-transfer.js').seedPublicTorrent>[0]; transferModule: typeof import('./webtorrent-transfer.js') }> | undefined;

      function sortByUpdatedAt<T extends { updatedAt?: unknown }>(items: T[]): T[] {
        return [...items].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
      }

      async function decryptFavoritePayload(pubkey: string, payload: unknown): Promise<unknown[][]> {
        if (!payload || typeof payload !== 'string') {
          return [];
        }
        if (nostrSigner?.nip44?.decrypt) {
          const plaintext = await nostrSigner.nip44.decrypt(pubkey, payload);
          const tags = safeJSONRead(plaintext, []);
          return Array.isArray(tags) ? tags as unknown[][] : [];
        }
        throw new Error('NIP-44 decrypt unavailable. Connect a signer with NIP-44 support.');
      }

      function parseSharedFavoriteTags(tags: unknown): NostrBookRecord[] {
        const entries: NostrBookRecord[] = [];
        let contextUrl: string | undefined;
        if (!Array.isArray(tags)) {
          return entries;
        }
        for (const rawTag of tags) {
          if (!Array.isArray(rawTag) || typeof rawTag[0] !== 'string') {
            continue;
          }
          const tag = rawTag.map(parseNostrTagsValue);
          const name = tag[0];
          if (name === 'book' && tag.length > 3) {
            const reference = BookstrFavoriteReferences.parseTag(tag);
            if (reference) {
              BookstrFavoriteReferences.appendWebReference(entries, reference, pseudoIdForSeed);
            }
            continue;
          }
          if (name === 'bookstr' && tag[1]) {
            const id = tag[1];
            const entry = entries.find(item => item.md5 === id) || { md5: id };
            if (!entries.includes(entry)) entries.push(entry);
            entry.title = tag[2] || entry.title || '';
            entry.author = tag[3] || entry.author || '';
            entry.authors = tag[3] || entry.authors || entry.author || '';
            entry.url = tag[4] || entry.url || '';
            entry.readUrl = tag[4] || entry.readUrl || entry.url || '';
            entry.format = tag[5] || entry.format || '';
            entry.year = tag[6] || entry.year || '';
			Object.assign(entry, BookMetadata.normalizeRights({ rights_status: tag[11], license: tag[12], license_url: tag[13], rights_source: tag[14] }));
            continue;
          }
          if (name === 'r') {
            contextUrl = tag[1] || contextUrl;
            try {
              const url = new URL(tag[1]!);
              const md5 = new URLSearchParams(url.hash.split('?')[1] || '').get('md5');
              if (isMd5(md5) && !entries.some(item => item.md5 === md5!.toLowerCase())) {
                entries.push({ md5: md5!.toLowerCase(), url: tag[1], readUrl: tag[1] });
              }
            } catch {
              // Legacy URL tags are optional context and may not be valid URLs.
            }
            continue;
          }
          if (name === 'libvault' && isMd5(tag[1])) {
            const md5 = tag[1]!.toLowerCase();
            const entry = entries.find(item => item.md5 === md5);
            if (entry) {
              entry.url ||= contextUrl || '';
            } else {
              entries.push({ md5, title: '', author: '', url: contextUrl || '' });
            }
            continue;
          }
          if (name === 'libvault-added' && isMd5(tag[1])) {
            const md5 = tag[1]!.toLowerCase();
            const entry = entries.find(item => item.md5 === md5) || { md5 };
            if (!entries.includes(entry)) entries.push(entry);
            entry.favoriteAddedAt = BookMetadata.earliestFavoriteAddedAt(entry.favoriteAddedAt, tag[2]);
            continue;
          }
          if (name === 'libvault-book' && isMd5(tag[1])) {
            const md5 = tag[1]!.toLowerCase();
            const entry = entries.find(item => item.md5 === md5) || { md5 };
            if (!entries.includes(entry)) entries.push(entry);
            entry.title = tag[2] || entry.title || '';
            entry.author = tag[3] || entry.author || '';
            entry.format = tag[4] || entry.format || '';
            entry.year = tag[6] || entry.year || '';
            entry.language = tag[7] || entry.language || '';
            entry.source = tag[8] || entry.source || '';
            entry.coverUrl = tag[9] || entry.coverUrl || '';
            entry.coverSha256 = tag[10] || entry.coverSha256 || '';
			Object.assign(entry, BookMetadata.normalizeRights({ rights_status: tag[11], license: tag[12], license_url: tag[13], rights_source: tag[14] }));
            entry.url ||= contextUrl || '';
            continue;
          }
          if (name === 'bookstr-book' && tag[1]) {
            BookMetadata.mergeFavoriteEntry(entries, {
              md5: tag[1],
              title: tag[2] || '',
              author: tag[3] || '',
              format: tag[4] || '',
              filesize: Number(tag[5] || 0),
              year: tag[6] || '',
              readUrl: tag[7] || '',
              url: tag[7] || '',
              language: tag[8] || '',
              source: tag[9] || '',
			  rights_status: tag[10] || 'unknown',
			  license: tag[11] || '',
			  license_url: tag[12] || '',
			  rights_source: tag[13] || '',
            });
            continue;
          }
          if (name === 'i' && tag[1]?.startsWith('isbn:') && /^(?:13|10)/.test(normalizeIsbnFromTag(tag[1].slice(5) || ''))) {
            const md5 = isMd5(contextUrl)
              ? contextUrl!.toLowerCase()
              : entries.find(item => item.md5)?.md5;
            if (md5) {
              const target = entries.find(item => item.md5 === md5);
              if (target) {
                target.isbn = normalizeIsbnFromTag(tag[1].slice(5) || '');
              }
            }
          }
        }
        return entries;
      }

      function normalizeFavoriteFromRemote(ref: NostrBookRecord, { trustExplicitFormat = true }: { trustExplicitFormat?: boolean } = {}): NostrBookRecord {
        const md5 = String(ref.md5 || '').trim().toLowerCase() || null;
        const explicitFormat = String(ref.format || ref.extension || '')
          .replace(/^\./, '')
          .toLowerCase();
        const formatProvenance = String(ref.metadataProvenance?.extension || '');
        const normalizedFormat = trustExplicitFormat || formatProvenance || isDisabledBookFormat(explicitFormat) ? explicitFormat : '';
        const readUrl = BookMetadata.canonicalReadUrl({
          ...ref,
          readUrl: ref.readUrl || ref.epubUrl || ref.downloadUrl || ref.url || '',
        }, BOOKS_API_BASE);
        const sourceUrl = ref.sourceUrl || ref.url || readUrl;
        const title = BookMetadata.resolveTitle(ref, readUrl, window.location.href);
        const favoriteAddedAt = BookMetadata.normalizeFavoriteAddedAt(ref.favoriteAddedAt);
        const sha256 = normalizeSha256(ref.sha256 || '');
        const libvaultMd5 = isMd5(ref.libvaultMd5) ? String(ref.libvaultMd5).trim().toLowerCase() : '';
        const libgenId = Number(ref.libgenId || ref.libgen_id || 0);
        const stableId = md5 || sha256 || null;
        return {
          md5: stableId || pseudoIdForSeed(`${title}${readUrl}`),
          libvaultMd5,
          libgenId: Number.isSafeInteger(libgenId) && libgenId > 0 ? libgenId : 0,
          title,
          authors: (ref.author || ref.authors || ref.creator || ref.bookAuthor || (ref.metadata as Record<string, unknown> | undefined)?.author || '') as string | string[],
          year: BookMetadata.yearForBook(ref),
          language: BookMetadata.languageForBook(ref),
          extension: normalizedFormat,
          sha256,
          readUrl,
          source: ref.source || 'nostr',
          sourceNativeId: ref.sourceNativeId || ref.source_native_id || '',
          sourceUrl,
          favoriteAddedAt,
          updatedAt: Number(ref.updatedAt || favoriteAddedAt || 0),
          coverId: ref.coverId || ref.cover_id || '',
          coverUrl: ref.coverUrl || ref.cover_url || ref.thumbnail || ref.image || '',
          coverSha256: ref.coverSha256 || ref.cover_sha256 || '',
          publisher: ref.publisher || '',
		  ...BookMetadata.normalizeRights(ref),
          progression: BookMetadata.readingProgressForBook(ref),
          furthestProgression: Number(ref.furthestProgression || 0) || 0,
          cfi: String(ref.cfi || (ref.locator as NostrBookRecord['locator'])?.locations?.cfi || (ref.locator as NostrBookRecord['locator'])?.href || ''),
          metadataLookupComplete: Boolean(ref.metadataLookupComplete),
          metadataProvenance: {
            ...(ref.metadataProvenance && typeof ref.metadataProvenance === 'object' ? ref.metadataProvenance : {}),
            ...(trustExplicitFormat && explicitFormat && !formatProvenance ? { extension: 'nostr' } : {}),
          },
        };
      }

      async function pullNostrFavorites(pubkey: string): Promise<NostrBookRecord[]> {
        if (!pubkey) return [];
        const rawRootEvents = await queryNostrEvents(pubkey, {
          kinds: [NOSTR_FAVORITES_KIND],
          limit: 10,
          '#d': [FAVORITES_D_TAG],
        });
        if (!rawRootEvents.length) throw new Error('The shared relay returned no favorites event for this account.');
        const rootEvents = await verifiedNostrEvents(rawRootEvents);
        if (!rootEvents.length) throw new Error('The shared relay returned a favorites event with an invalid signature.');
        let lastError = null;
        for (const rootEvent of rootEvents) {
          try {
            const rootTags = await decryptFavoritePayload(pubkey, rootEvent.content);
            const manifest = rootTags.find((tag) => Array.isArray(tag) && (tag[0] === 'bookstr-chunks' || tag[0] === 'libvault-chunks'));
            const chunks = Array.isArray(manifest) ? Number(manifest[1] || 0) : 0;
            const chunkPrefix = String(manifest?.[2] || FAVORITES_CHUNK_PREFIX);
            if (manifest && (!Number.isInteger(chunks) || chunks < 1 || chunks > 10000 || !chunkPrefix)) {
              throw new Error('Favorite chunk manifest is invalid.');
            }
            let allTags = [...rootTags];
            for (let index = 0; index < chunks; index += 1) {
              const rawChunkEvents = await queryNostrEvents(pubkey, {
                kinds: [NOSTR_FAVORITES_KIND],
                limit: 10,
                '#d': [`${chunkPrefix}-${index}`],
              });
              const chunkEvents = await verifiedNostrEvents(rawChunkEvents);
              if (rawChunkEvents.length && !chunkEvents.length) {
                throw new Error(`Favorite chunk ${index + 1} has an invalid signature.`);
              }
              const chunkLatest = chunkEvents[0];
              if (!chunkLatest) throw new Error(`Favorite chunk ${index + 1} of ${chunks} is missing.`);
              const chunkTags = await decryptFavoritePayload(pubkey, chunkLatest.content);
              if (!Array.isArray(chunkTags)) throw new Error(`Favorite chunk ${index + 1} is invalid.`);
              allTags = allTags.concat(chunkTags);
            }
            const fallbackAddedAt = BookMetadata.normalizeFavoriteAddedAt(rootEvent.created_at);
            const updatedOPDSFeeds = applySharedOPDSFeedTags(allTags);
            if (updatedOPDSFeeds) renderSearchSources();
            return parseSharedFavoriteTags(allTags).map(ref => normalizeFavoriteFromRemote({
              ...ref,
              favoriteAddedAt: ref.favoriteAddedAt || fallbackAddedAt,
            }));
          } catch (error) {
            lastError = error;
            // A partial new generation must not hide an older complete snapshot.
          }
        }
        throw new Error(`Favorites could not be decrypted or assembled: ${(lastError as { message?: unknown } | null | undefined)?.message || 'unknown payload error'}`);
      }

      function parseReadingProgressEvent(event: MigratedNostrEvent): NostrProgressBook | null {
        const parsed = BookstrNostrProgress.parseProgressEvent(event);
        if (!parsed) return null;
        const { payload, bookId, updatedAt } = parsed;
        if (parsed.deleted) {
          return { md5: bookId.toLowerCase(), updatedAt, deleted: true };
        }
        try {
          return {
            md5: bookId.toLowerCase(),
            title: BookMetadata.resolveTitle(payload),
            authors: String(payload.author || payload.authors || payload.creator || ''),
            language: BookMetadata.languageForBook(payload),
            year: BookMetadata.yearForBook(payload),
            publisher: String(payload.publisher || ''),
            coverUrl: String(payload.coverUrl || payload.cover_url || ''),
            sha256: String(payload.sha256 || ''),
            source: String(payload.source || ''),
            sourceNativeId: String(payload.sourceNativeId || payload.source_native_id || ''),
			...BookMetadata.normalizeRights(payload),
            updatedAt,
            progression: parsed.progression as number,
            furthestProgression: parsed.furthestProgression as number,
            cfi: parsed.cfi as string,
            extension: String(payload.extension || payload.format || '').toLowerCase(),
            readUrl: String(payload.readUrl || ''),
          };
        } catch {
          return null;
        }
      }

      async function pullNostrReading(pubkey: string): Promise<NostrProgressBook[]> {
        if (!pubkey) return [];
        const events = await queryNostrEvents(pubkey, {
          kinds: [NOSTR_PROGRESS_KIND],
          limit: 100,
        });
        const latestByBook = new Map<string, NostrProgressBook>();
        for (const event of events) {
          const parsed = parseReadingProgressEvent(event);
          if (!parsed || !parsed.md5) {
            continue;
          }
          const exists = latestByBook.get(parsed.md5);
          if (!exists || parsed.updatedAt > (exists.updatedAt || 0)) {
            latestByBook.set(parsed.md5, parsed);
          }
        }
        // Keep deletion markers until merge time so stale local state cannot
        // resurrect reading progress removed by another client.
        return sortByUpdatedAt(Array.from(latestByBook.values())).slice();
      }

      function normalizeVocabularyWord(value: unknown): VocabularyEntry | null {
        const source: Record<string, unknown> = value && typeof value === 'object' ? value as Record<string, unknown> : { word: value };
        const word = String(source.word || '').trim().toLowerCase();
        if (!word) return null;
        const language = String(source.sourceLanguage || source.lang || source.language || 'pt').toLowerCase();
        return {
          ...source,
          key: String(source.key || `${language}:${word}`),
          word,
          language,
          bookId: String(source.bookId || ''),
          bookTitle: String(source.bookTitle || ''),
          cfi: String(source.cfi || ''),
          contextSentence: String(source.contextSentence || ''),
          partOfSpeech: String(source.partOfSpeech || ''),
          definitions: Array.isArray(source.definitions) ? source.definitions.filter(Boolean) : [],
          sourceUrl: String(source.sourceUrl || ''),
          lookupCount: Number(source.lookupCount || 1),
          firstSeenAt: Number(source.firstSeenAt || source.updatedAt || 0),
          lastSeenAt: Number(source.lastSeenAt || source.updatedAt || 0),
          updatedAt: Number(source.updatedAt || source.lastSeenAt || 0),
          deleted: Boolean(source.deleted),
        } as NostrWireVocabulary;
      }

      async function decryptVocabularyPayload(pubkey: string, event: MigratedNostrEvent): Promise<NostrWireVocabulary | null> {
        const dTag = Array.isArray(event.tags)
          ? event.tags.find((tag) => Array.isArray(tag) && tag[0] === 'd')?.[1]
          : '';
        if (!dTag || !dTag.startsWith(WORDS_D_PREFIX)) {
          return null;
        }
        if (!nostrSigner?.nip44?.decrypt) {
          return null;
        }
        const plaintext = await nostrSigner.nip44.decrypt(pubkey, event.content);
        const payload = safeJSONRead(plaintext, null);
        if (!payload || typeof payload !== 'object') {
          return null;
        }
        const fallbackUpdatedAt = Number(event.created_at || 0) * 1000;
        return (BookstrVocabularyWire.parsePayload(payload, fallbackUpdatedAt)
          || BookstrVocabularyWire.parseLegacyPayload(payload, fallbackUpdatedAt)) as NostrWireVocabulary | null;
      }

      async function pullNostrWords(pubkey: string): Promise<VocabularyEntry[]> {
        if (!pubkey) return [];
        const events = await queryNostrEvents(pubkey, {
          kinds: [NOSTR_PROGRESS_KIND],
          limit: 120,
        });
        const latestByWord = new Map<string, NostrWireVocabulary>();
        for (const event of events) {
          const payload = await decryptVocabularyPayload(pubkey, event);
          if (!payload) {
            continue;
          }
          const exists = latestByWord.get(payload.key);
          if (!exists || payload.updatedAt > exists.updatedAt) {
            latestByWord.set(payload.key, payload);
          }
        }
        // Keep tombstones in snapshots so an older local or relay cache cannot
        // resurrect a word after another client deletes it.
        return sortByUpdatedAt(Array.from(latestByWord.values()));
      }

      function mergeStateList(primary: NostrBookRecord[], incoming: NostrBookRecord[], { dedupeBy = 'md5' }: { dedupeBy?: string } = {}): NostrBookRecord[] {
        const next = [...primary];
        for (const item of incoming) {
          if (!item || typeof item !== 'object') {
            continue;
          }
          const id = item[dedupeBy];
          if (!id) {
            continue;
          }
          const index = next.findIndex((row) => row && row[dedupeBy] === id);
          if (index >= 0) {
            const favoriteAddedAt = BookMetadata.earliestFavoriteAddedAt(
              next[index]!.favoriteAddedAt,
              item.favoriteAddedAt,
            );
            next[index] = { ...next[index], ...item, dedupSource: 'nostr', updatedAt: Number(item.updatedAt || Date.now()) };
            if (favoriteAddedAt) next[index].favoriteAddedAt = favoriteAddedAt;
          } else {
            next.push(item);
          }
        }
        return next;
      }

      function readNostrSyncCache(pubkey: string): NostrCacheSnapshot | null {
        if (!pubkey) return null;
        const cacheKey = `${NOSTR_SYNC_CACHE_PREFIX}${pubkey}`;
        const payload = safeJSONRead(localStorage.getItem(cacheKey), null);
        if (!payload || typeof payload !== 'object') return null;
        const cachePayload = payload as Record<string, unknown> & { favorites: unknown[]; reading: unknown[]; words: unknown[] };
        const ts = Number(cachePayload.ts || 0);
        if (!Number.isFinite(ts)) return null;
        if (!Array.isArray(cachePayload.favorites) || !Array.isArray(cachePayload.reading) || !Array.isArray(cachePayload.words)) return null;
        return {
          favorites: cachePayload.favorites.filter((item): item is NostrBookRecord => Boolean(item && typeof item === 'object' && typeof (item as Record<string, unknown>).md5 === 'string')),
          reading: cachePayload.reading.filter((item): item is NostrBookRecord => Boolean(item && typeof item === 'object' && typeof (item as Record<string, unknown>).md5 === 'string')),
          words: cachePayload.words.map(normalizeVocabularyWord).filter((item): item is VocabularyEntry => Boolean(item)),
          opdsFeeds: normalizePublicOPDSFeedSettings(cachePayload.opdsFeeds),
          ts,
          version: Number(cachePayload.version || 0) || 0,
          pubkey: String(cachePayload.pubkey || pubkey),
        };
      }

      function saveNostrSyncCache(pubkey: string, payload: { favorites: NostrBookRecord[]; reading: NostrBookRecord[]; words: VocabularyEntry[]; opdsFeeds?: unknown }): void {
        if (!pubkey || !payload || typeof payload !== 'object') return;
        const cacheKey = `${NOSTR_SYNC_CACHE_PREFIX}${pubkey}`;
        const next = {
          favorites: Array.isArray(payload.favorites) ? payload.favorites : [],
          reading: Array.isArray(payload.reading) ? payload.reading : [],
          words: Array.isArray(payload.words) ? payload.words : [],
          opdsFeeds: normalizePublicOPDSFeedSettings(payload.opdsFeeds || state.settings.opdsFeeds),
          ts: Date.now(),
          version: 1,
          pubkey,
        };
        localStorage.setItem(cacheKey, JSON.stringify(next));
      }

      function preserveFavoriteMetadata(remote: NostrBookRecord): NostrBookRecord {
        const cachedMetadata = Object.values(metadataCacheRead() as Record<string, { book?: PageBook }>)
          .map(entry => entry?.book)
          .filter((book): book is PageBook => Boolean(book));
        const known = [...state.favorites, ...state.reading, ...cachedMetadata]
          .find(book => BookMetadata.sameLibraryBook(book, remote));
        if (!known) return remote;
        const remoteHasExplicitFormat = Boolean(remote.extension || remote.format);
        const knownFormatProvenance = String((known.metadataProvenance as Record<string, unknown> | undefined)?.extension || '');
        const enriched = BookMetadata.enrichBookMetadata(remote, known, 'local-cache');
        // Older releases wrote "epub" when Nostr/catalog metadata omitted a
        // format. Do not resurrect that legacy guess while preserving richer
        // metadata. Inspected local bytes and explicit remote formats carry
        // provenance and remain trusted.
        if (!remoteHasExplicitFormat && !knownFormatProvenance) {
          enriched.extension = '';
          delete enriched.format;
          delete (enriched.metadataProvenance as Record<string, unknown>).extension;
        }
        enriched.sha256 ||= known.sha256 || '';
        enriched.coverSha256 ||= known.coverSha256 || '';
        enriched.sourceUrl ||= known.sourceUrl || known.url || '';
        enriched.favoriteAddedAt = BookMetadata.earliestFavoriteAddedAt(
          remote.favoriteAddedAt,
          known.favoriteAddedAt,
        );
        return enriched;
      }

      const nostrAheadReadingByBook = new Map<string, NostrProgressBook>();

      function rememberNostrReadingCandidate(candidate: NostrProgressBook, localReading: PageBook | null | undefined): boolean {
        const id = String(candidate?.md5 || '').trim().toLowerCase();
        if (!id) return false;
        if (!localReading || !BookstrDesktopProgress.isProgressAhead(candidate as unknown as import('./desktop-progress.js').ProgressPayload, localReading as unknown as import('./desktop-progress.js').ProgressPayload)) {
          nostrAheadReadingByBook.delete(id);
          return false;
        }
        nostrAheadReadingByBook.set(id, { ...candidate, md5: id });
        return true;
      }

      function readingSnapshotForNostrCache(): NostrBookRecord[] {
        const merged = new Map<string, NostrBookRecord>();
        state.reading.forEach(item => {
          const id = String(item?.md5 || '').trim().toLowerCase();
          if (id) merged.set(id, item);
        });
        nostrAheadReadingByBook.forEach((item, id) => merged.set(id, item));
        return [...merged.values()];
      }

      function mergeReadingSnapshot(localReading: PageBook[], incomingReading: NostrBookRecord[]): PageBook[] {
        const merged = new Map<string, PageBook>();
        BookMetadata.dedupeLibraryBooks(Array.isArray(localReading) ? localReading : []).forEach(item => {
          const id = String(item?.md5 || '').trim().toLowerCase();
          if (id) merged.set(id, item);
        });
        for (const incoming of Array.isArray(incomingReading) ? incomingReading : []) {
          const id = String(incoming?.md5 || '').trim().toLowerCase();
          if (!id) continue;
          const existing = merged.get(id);
          const incomingProgress = incoming as NostrProgressBook;
          const incomingUpdatedAt = Number(incoming.updatedAt || 0);
          const existingUpdatedAt = Number(existing?.updatedAt || 0);
          if (incomingProgress.deleted) {
            if (!existing || incomingUpdatedAt >= existingUpdatedAt) {
              merged.delete(id);
              nostrAheadReadingByBook.delete(id);
            }
            continue;
          }
          const normalized = { ...normalizeFavoriteFromRemote(incoming), md5: id };
          if (existing && rememberNostrReadingCandidate(normalized as NostrProgressBook, existing)) {
            continue;
          }
          if (existing && BookstrDesktopProgress.isProgressAhead(existing as unknown as import('./desktop-progress.js').ProgressPayload, normalized as unknown as import('./desktop-progress.js').ProgressPayload)) {
            continue;
          }
          if (!existing || incomingUpdatedAt >= existingUpdatedAt) {
            merged.set(id, { ...(existing || {}), ...normalized });
          }
        }
        return BookMetadata.dedupeLibraryBooks([...merged.values()])
          .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
      }

      function applyNostrSnapshot(snapshot: NostrCacheSnapshot, { render = true, authoritativeFavorites = false }: { render?: boolean; authoritativeFavorites?: boolean } = {}): void {
        const next = { ...snapshot };
        if (!isDesktopMode && Array.isArray(next.favorites)) {
          const normalizedFavorites = next.favorites
            .map(ref => normalizeFavoriteFromRemote(ref))
            .map(preserveFavoriteMetadata);
          const replaceFavorites = authoritativeFavorites;
          state.favorites = (replaceFavorites
            ? normalizedFavorites
            : mergeStateList(state.favorites, normalizedFavorites))
            .slice();
        }
        if (Array.isArray(next.reading)) {
          state.reading = mergeReadingSnapshot(state.reading, next.reading).slice();
        }
        state.favorites = BookMetadata.dedupeLibraryBooks(isDesktopMode ? state.favorites : [...state.favorites, ...state.reading]);
        if (Array.isArray(next.words)) {
          const merged = new Map<string, NostrWireVocabulary>();
          [...state.words, ...next.words].map(normalizeVocabularyWord).filter((word): word is VocabularyEntry => Boolean(word)).forEach((word) => {
            const record = word as NostrWireVocabulary;
            const existing = merged.get(record.key);
            if (!existing || record.updatedAt >= existing.updatedAt) merged.set(record.key, record);
          });
          state.words = sortByUpdatedAt(Array.from(merged.values())).slice(0, 120);
        }
        if (Array.isArray(next.opdsFeeds)) {
          (state.settings as Record<string, unknown>).opdsFeeds = normalizePublicOPDSFeedSettings(next.opdsFeeds);
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
        }
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites));
        localStorage.setItem(READING_KEY, JSON.stringify(state.reading));
        localStorage.setItem(WORDS_KEY, JSON.stringify(state.words));
        if (render) {
          renderFavorites();
          renderReading();
          renderWords();
          renderHome();
        }
        if (pendingReadBookId) {
          const pending = pendingReadBookId;
          pendingReadBookId = '';
          void openResolvedReadRoute(pending);
        }
      }

      function isNostrCacheFresh(cached: NostrCacheSnapshot | null): boolean {
        if (!cached || typeof cached !== 'object') return false;
        return Date.now() - Number(cached.ts || 0) < NOSTR_SYNC_CACHE_TTL_MS;
      }

      let nostrSyncTask: Promise<boolean> | null = null;
      let lastNostrSyncAt = 0;
      let nostrFocusSyncTimer: ReturnType<typeof setTimeout> | null = null;

      function setHomeSyncState(kind: 'syncing' | 'ready' | 'failed', message: string): void {
        homeSyncState.textContent = message;
        homeSyncState.dataset.state = kind;
        homeSyncRefresh.disabled = kind === 'syncing';
      }

      function nostrLibraryRelayNames() {
        return NOSTR_RELAYS.map(relay => {
          try {
            return new URL(relay).host;
          } catch {
            return relay;
          }
        }).join(', ');
      }

      function nostrSyncCounts(favorites: NostrBookRecord[] | null, reading: NostrBookRecord[], words: VocabularyEntry[]): string {
        return `${favorites!.length} favorites · ${reading.length} reading · ${words.length} words`;
      }

      async function syncNostrLibraryFromNip7({ useCache = true }: { useCache?: boolean } = {}): Promise<boolean> {
        const pubkey = state.nip7.pubkey;
        if (!state.settings.useNip7 || !pubkey) {
          return false;
        }
        if (nostrSyncTask) {
          return nostrSyncTask;
        }
        const relayNames = nostrLibraryRelayNames();
        setHomeSyncState('syncing', `Syncing with ${relayNames}…`);
        const task = (async () => {
          const cached = readNostrSyncCache(pubkey);
          if (useCache && cached && isNostrCacheFresh(cached)) {
            applyNostrSnapshot(cached);
          }
          try {
            const [favorites, reading, words] = await Promise.all([
              isDesktopMode ? Promise.resolve(null) : pullNostrFavorites(pubkey),
              pullNostrReading(pubkey),
              pullNostrWords(pubkey),
            ]);
            applyNostrSnapshot({
              favorites,
              reading,
              words,
            }, { authoritativeFavorites: Array.isArray(favorites) });
            saveNostrSyncCache(pubkey, {
              favorites: state.favorites,
              reading: readingSnapshotForNostrCache(),
              words: state.words,
            });
            if (document.activeElement !== null) {
              status.textContent = isDesktopMode ? 'Synced reading and words.' : 'Synced latest Nostr library data.';
            }
            lastNostrSyncAt = Date.now();
            setHomeSyncState('ready', isDesktopMode
              ? `Synced · ${reading.length} reading · ${words.length} words`
              : `Synced · ${nostrSyncCounts(favorites, reading, words)}`);
            return true;
          } catch (error) {
            if (cached) {
              applyNostrSnapshot(cached);
              setHomeSyncState('failed', 'Showing cached library · sync failed · retry');
            } else {
              setHomeSyncState('failed', 'Sync failed · retry');
            }
            status.textContent = `${isDesktopMode ? 'Reading and words sync' : 'Nostr library sync'} failed: ${(error as { message?: unknown } | null | undefined)?.message || error}`;
            return false;
          }
        })();
        nostrSyncTask = task.finally(() => {
          nostrSyncTask = null;
        });
        return task;
      }

      function scheduleFocusedNostrSync() {
        if (document.visibilityState === 'hidden') {
          void flushAllReadingProgressPublishes();
          return;
        }
        if (!state.settings.useNip7 || !state.nip7.pubkey) return;
        clearTimeout(nostrFocusSyncTimer!);
        nostrFocusSyncTimer = setTimeout(() => {
          if (Date.now() - lastNostrSyncAt >= 30_000) void syncNostrLibraryFromNip7({ useCache: false });
        }, 250);
      }

      homeSyncRefresh.addEventListener('click', async () => {
        setHomeSyncState('syncing', `Connecting to ${nostrLibraryRelayNames()}…`);
        const connected = await connectNip7({ silent: false, skipSync: true });
        if (connected || state.nip7.pubkey) {
          await syncNostrLibraryFromNip7({ useCache: false });
        } else if (!connected) {
          setHomeSyncState('failed', 'Signer unavailable · retry');
          status.textContent = `Nostr library sync failed: no ${nostrSignerName.toLowerCase()} is available.`;
        }
      });
      window.addEventListener('focus', scheduleFocusedNostrSync);
      document.addEventListener('visibilitychange', scheduleFocusedNostrSync);

      function safeJSONRead<T>(raw: string | null | undefined, fallback: T): T {
        if (!raw) return fallback;
        try {
          return JSON.parse(raw) as T;
        } catch {
          return fallback;
        }
      }

      type SearchRecord = Record<string, unknown>;
      type PublicOPDSFeed = { name: string; url: string };
      function isPublicOPDSSettingsURL(value: unknown): boolean {
        try {
          const url = new URL(String(value));
          const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
          if (url.protocol !== 'https:' || url.username || url.password || !hostname) return false;
          if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return false;
          if (hostname === '::1' || /^(?:fc|fd|fe80):/i.test(hostname)) return false;
          const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
          if (!ipv4) return true;
          const parts = ipv4.slice(1).map(Number);
          const [first, second] = parts as [number, number, number, number];
          return !parts.some(part => part > 255) && !(first === 0 || first === 10 || first === 127
            || (first === 169 && second === 254)
            || (first === 172 && second >= 16 && second <= 31)
            || (first === 192 && second === 168));
        } catch {
          return false;
        }
      }

      function normalizePublicOPDSFeedSettings(value: unknown): PublicOPDSFeed[] {
        if (!Array.isArray(value)) return [];
        const seen = new Set();
        const feeds: PublicOPDSFeed[] = [];
        for (const candidate of value) {
          const feed = candidate as { name?: unknown; url?: unknown } | null | undefined;
          const name = String(feed?.name || '').replace(/\s+/g, ' ').trim();
          const rawURL = String(feed?.url || '').trim();
          if (!name || name.length > 80 || !isPublicOPDSSettingsURL(rawURL)) continue;
          const url = new URL(rawURL).href;
          if (seen.has(url)) continue;
          seen.add(url);
          feeds.push({ name, url });
          if (feeds.length === 12) break;
        }
        return feeds;
      }

      function publicOPDSFeedNostrTags(): string[][] {
        return (state.settings.opdsFeeds as PublicOPDSFeed[]).map(feed => ['bookstr-opds-feed', feed.name, feed.url]);
      }

      function applySharedOPDSFeedTags(tags: unknown): boolean {
        const hasSettings = Array.isArray(tags) && tags.some(tag => Array.isArray(tag) && tag[0] === 'bookstr-opds-feeds');
        if (!hasSettings) return false;
        (state.settings as unknown as Record<string, unknown>).opdsFeeds = normalizePublicOPDSFeedSettings(tags
          .filter(tag => Array.isArray(tag) && tag[0] === 'bookstr-opds-feed')
          .map(tag => {
            const fields = tag as unknown[];
            return { name: fields[1], url: fields[2] };
          }));
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
        return true;
      }

      async function getOPDSSourcesModule() {
        opdsSourcesModule ||= import('./opds-sources.js');
        return opdsSourcesModule;
      }

      function authorSearchName(value: unknown): string {
        return BookMetadata.authorSearchName(value);
      }

      function isMissingAuthor(value: unknown): boolean {
        const author = String(value || '').trim();
        return !author || /^(?:unknown(?: author)?|n\/?a|none|—)$/i.test(author);
      }

      function authorMatchKey(value: unknown): string {
        const author = authorSearchName(value);
        const commaParts = author.split(',').map(part => part.trim()).filter(Boolean);
        const ordered = commaParts.length === 2 ? `${commaParts[1]} ${commaParts[0]}` : author;
        return ordered.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
          .toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      }

      function isDisabledBookFormat(value: unknown): boolean {
        const format = String(value || '').trim().toLowerCase().replace(/^\./, '');
        return Boolean(format) && !['epub', 'pdf', 'cbz', 'cbr', 'application/epub+zip', 'application/pdf', 'application/vnd.comicbook+zip', 'application/vnd.comicbook-rar'].includes(format);
      }

      function normalizeSearchBooks(payload: unknown, source: string): PageBook[] {
        const value = payload as { books?: unknown; results?: unknown } | null | undefined;
        const results = Array.isArray(value?.books)
          ? value.books as SearchRecord[]
          : Array.isArray(value?.results)
            ? value.results as SearchRecord[]
            : [];

        return results.filter(item => !isDisabledBookFormat(item.extension || item.format || item.media_type || item.type)).map(item => {
          const torrent = item.torrent as SearchRecord | null | undefined;
          const duplicatePublisherKey: string = 'publisher';
          const rawId = String(item.md5 || item.id || item.source_native_id || item.sourceNativeId || item.sha256 || item.libvaultMd5 || '').trim().toLowerCase();
          const authors = Array.isArray(item.authors)
            ? item.authors.join(', ')
            : String(item.author || item.authors || 'Unknown author');
          const year = String(item.issued || item.year || '').split('-')[0];
          const provider = String(item.source || source).toLowerCase();
          const isProviderQualified = /^[a-z][a-z0-9+.-]*:/i.test(rawId);
          const md5 = isMd5(rawId) || isProviderQualified ? rawId : `${provider}:${rawId}`;
          const libgenId = isMd5(rawId) ? Number(item.libgen_id || item.libgenId || item.id || 0) : 0;
          const ext = String(item.extension || item.format || item.media_type || item.type || (provider === 'gutenberg' ? 'epub' : '')).replace(/^\./, '').toLowerCase();
          const directReadUrl = provider === 'gutenberg' && item.id
            ? `${BOOKS_API_BASE}/books/${encodeURIComponent(item.id as string)}/download`
            : item.readUrl || item.read_url || item.url || item.link || '';
          const rights = BookMetadata.normalizeRights(item);
          if (!rights.rights_source && (
            rights.rights_status !== 'unknown' || rights.license || rights.license_url
          )) rights.rights_source = provider === 'gutenberg' && typeof item.copyright === 'boolean'
            ? 'gutendex'
            : provider;
          return {
            md5,
            title: item.title || 'Untitled',
            authors,
            year,
            publisher: item.publisher || '',
            isbn: item.isbn || item.isbn13 || item.isbn10 || '',
            extension: ext,
            filesize: Number(item.filesize_bytes || item.filesize || 0),
            language: item.language || item.languages || '',
            [duplicatePublisherKey]: item.publisher || '',
            description: item.description || '',
            subjects: Array.isArray(item.subjects)
              ? item.subjects.join(', ')
              : String(item.subjects || '').trim(),
            rating: Number(item.avg_rating || item.rating || 0),
            editionCount: Number(item.edition_count || 0),
            coverId: item.cover_id || '',
            coverUrl: item.cover_url || item.coverUrl || item.thumbnail || '',
            coverSha256: item.cover_sha256 || item.coverSha256 || '',
            sha256: item.sha256 || '',
            torrentId: item.torrent_id || item.torrentId || item.magnet_uri || item.magnetURI || torrent?.magnetURI || '',
            torrentFile: item.torrent_file || item.torrentFile || torrent?.torrentFile || '',
            torrentAnnounce: item.torrent_announce || item.torrentAnnounce || torrent?.announce || [],
            libgenId,
            collection: String(item.collection || ''),
            source: item.source || source,
            sourceNativeId: item.source_native_id || item.sourceNativeId || '',
            sourceUrl: item.source_url || item.sourceUrl || '',
            license: item.license || item.rights || '',
            ...rights as Record<string, unknown>,
            readUrl: directReadUrl,
            sourceFileUrl: item.read_url || item.readUrl || '',
            fallback: Boolean(directReadUrl)
          } as unknown as PageBook;
        }).sort((a, b) => Number(Boolean(b.readUrl)) - Number(Boolean(a.readUrl)));
      }

      function dedupeBooks(books: PageBook[]): PageBook[] {
        const byId = new Set();
        return books.filter(book => {
          const source = String(book?.source || '').toLowerCase();
          const sourceId = String(book?.sourceNativeId || book?.id || '').trim().toLowerCase();
          const md5 = String(book?.md5 || '').trim().toLowerCase();
          const sha256 = normalizeSha256(book?.sha256 || '');
          const readUrl = String(book?.readUrl || book?.url || '').trim().toLowerCase();
          const key = sha256 ? `sha256:${sha256}`
            : readUrl ? `url:${readUrl}`
              : md5 ? `id:${md5}`
                : source && sourceId ? `${source}:${sourceId}` : '';
          if (!key) return false;
          if (byId.has(key)) return false;
          byId.add(key);
          return true;
        });
      }

      function defaultSearchResultRank(book: PageBook): number {
        if (book.searchSourceId === 'libcat') return -1;
        if (cachedBookKeys.has(bookCacheKey(book, String(book.readUrl || book.url || '')))) return 0;
        if (BookMetadata.canonicalReadUrl(book, BOOKS_API_BASE)) return 1;
        return 2;
      }

      function rankSearchResults(books: PageBook[]): PageBook[] {
        return books.map((book, index) => ({ book, index }))
          .sort((left, right) => defaultSearchResultRank(left.book) - defaultSearchResultRank(right.book)
            || left.index - right.index)
          .map(entry => entry.book);
      }

      let unglueItUnavailable = false;

      async function searchUnglueIt(query: string): Promise<PageBook[]> {
        if (unglueItUnavailable) return [];
        const resp = await fetch(`${BOOKS_API_BASE}/opds?query=${encodeURIComponent(query)}&order_by=newest`);
        const payload = await resp.text();
        if (resp.status === 404) {
          unglueItUnavailable = true;
          return [];
        }
        if (!resp.ok) {
          throw new Error(`Unglue.it search failed (${resp.status})`);
        }
        const opdsMetadata = BookMetadata as typeof BookMetadata & { parseUnglueItOpdsFeed(xml: string): unknown[] };
        const books = opdsMetadata.parseUnglueItOpdsFeed(payload);
        return dedupeBooks(normalizeSearchBooks({ books }, 'unglueit'));
      }

      async function searchProjectGutenberg(query: string): Promise<PageBook[]> {
        const resp = await fetch(`${BOOKS_API_BASE}/gutendex?query=${encodeURIComponent(query)}`);
        const payload = await resp.json().catch(() => ({})) as { results?: unknown };
        if (!resp.ok) throw new Error(`Project Gutenberg search failed (${resp.status})`);
        const books = (Array.isArray(payload.results) ? payload.results as SearchRecord[] : []).map(item => ({
          id: item.id,
          source: 'gutenberg',
          source_native_id: String(item.id || ''),
          title: item.title || '',
          authors: (Array.isArray(item.authors) ? item.authors as (SearchRecord | null | undefined)[] : []).map(author => author?.name).filter(Boolean).join(', '),
          language: Array.isArray(item.languages) ? item.languages[0] || '' : '',
          subjects: item.subjects || [],
          description: Array.isArray(item.summaries) ? item.summaries[0] || '' : '',
          extension: 'epub',
		  cover_url: (item.formats as Record<string, unknown> | null | undefined)?.['image/jpeg'] || '',
		  read_url: (item.formats as Record<string, unknown> | null | undefined)?.['application/epub+zip'] || '',
		  copyright: typeof item.copyright === 'boolean' ? item.copyright : null,
		  rights_source: 'gutendex',
        }));
        return dedupeBooks(normalizeSearchBooks({ books }, 'gutenberg'));
      }

      function oapenMetadataValues(item: SearchRecord, key: string): string[] {
        return (Array.isArray(item?.metadata) ? item.metadata as (SearchRecord | null | undefined)[] : [])
          .filter(entry => entry?.key === key && (entry as SearchRecord).value)
          .map(entry => String((entry as SearchRecord).value).trim())
          .filter(Boolean);
      }

      async function searchOapen(query: string): Promise<PageBook[]> {
        const resp = await fetch(`${BOOKS_API_BASE}/oapen?query=${encodeURIComponent(query)}`);
        const payload: unknown = await resp.json().catch(() => []);
        if (!resp.ok) throw new Error(`OAPEN search failed (${resp.status})`);
        const books = (Array.isArray(payload) ? payload as SearchRecord[] : []).map((item): SearchRecord | null => {
          const title = oapenMetadataValues(item, 'dc.title')[0] || item.name || '';
          const types = oapenMetadataValues(item, 'dc.type').map(value => value.toLowerCase());
          if (!title || (types.length && !types.includes('book'))) return null;
          const originalPdf = (Array.isArray(item.bitstreams) ? item.bitstreams as (SearchRecord | null | undefined)[] : []).find(bitstream =>
            bitstream?.bundleName === 'ORIGINAL'
              && (bitstream?.mimeType === 'application/pdf' || /\.pdf$/i.test(bitstream?.name as string))
              && bitstream?.uuid
          );
          const rights = oapenMetadataValues(item, 'dc.rights.uri')[0]
            || oapenMetadataValues(item, 'dc.rights')[0]
            || originalPdf?.code
            || '';
          const sourceUrl = oapenMetadataValues(item, 'dc.identifier.uri')[0]
            || (item.handle ? `https://library.oapen.org/handle/${item.handle}` : '');
          const languageEntry = (Array.isArray(item.metadata) ? item.metadata as (SearchRecord | null | undefined)[] : [])
            .find(entry => entry?.key === 'dc.language');
          return {
            id: item.uuid || item.handle,
            source: 'oapen',
            source_native_id: String(item.handle || item.uuid || ''),
            source_url: sourceUrl,
            title,
            authors: oapenMetadataValues(item, 'dc.contributor.author').join(', '),
            publisher: oapenMetadataValues(item, 'publisher.name')[0] || '',
            description: oapenMetadataValues(item, 'dc.description.abstract')[0] || '',
            subjects: [
              ...oapenMetadataValues(item, 'dc.subject.other'),
              ...oapenMetadataValues(item, 'dc.subject.classification'),
            ],
            language: languageEntry?.code || languageEntry?.value || '',
            year: oapenMetadataValues(item, 'dc.date.issued')[0] || '',
            license: rights,
            license_url: /^https?:\/\//i.test(rights as string) ? rights : '',
            rights_status: rights ? 'open_license' : 'unknown',
            extension: originalPdf ? 'pdf' : '',
            read_url: originalPdf
              ? `${BOOKS_API_BASE}/oapen-file?id=${encodeURIComponent(originalPdf.uuid as string)}`
              : '',
          };
        }).filter((book): book is SearchRecord => Boolean(book));
        return dedupeBooks(normalizeSearchBooks({ books }, 'oapen'));
      }

      async function searchOpenTextbookLibrary(query: string): Promise<PageBook[]> {
        const resp = await fetch(`${BOOKS_API_BASE}/open-textbooks?query=${encodeURIComponent(query)}`);
        const payload = await resp.json().catch(() => ({})) as { data?: unknown };
        if (!resp.ok) throw new Error(`Open Textbook Library search failed (${resp.status})`);
        const books = (Array.isArray(payload.data) ? payload.data as SearchRecord[] : []).map((item): SearchRecord | null => {
          if (!item?.title || !item.license) return null;
          const formats = Array.isArray(item.formats) ? item.formats as (SearchRecord | null | undefined)[] : [];
          const directEpub = formats.find(format => /epub|ebook/i.test(format?.type as string)
            && /\.epub(?:[?#]|$)/i.test(format?.url as string));
          const directPdf = formats.find(format => /pdf/i.test(format?.type as string)
            && /\.pdf(?:[?#]|$)/i.test(format?.url as string));
          const acquisition = directEpub || directPdf;
          return {
            id: item.id,
            source: 'open-textbook-library',
            source_native_id: String(item.id || ''),
            source_url: item.url || '',
            title: item.title,
            authors: (Array.isArray(item.contributors) ? item.contributors as (SearchRecord | null | undefined)[] : [])
            .map(contributor => contributor?.background_text
              || [contributor?.first_name, contributor?.middle_name, contributor?.last_name].filter(Boolean).join(' '))
              .filter(Boolean)
              .join(', '),
            publisher: (Array.isArray(item.publishers) ? item.publishers as (SearchRecord | null | undefined)[] : [])
              .map(publisher => publisher?.name).filter(Boolean).join(', '),
            description: item.description || '',
            subjects: (Array.isArray(item.subjects) ? item.subjects as (SearchRecord | null | undefined)[] : [])
              .map(subject => subject?.name).filter(Boolean),
            language: item.language || '',
            year: item.copyright_year || '',
            license: item.license,
            rights_status: 'open_license',
            extension: directEpub ? 'epub' : directPdf ? 'pdf' : '',
            read_url: acquisition?.url || '',
          };
        }).filter((book): book is SearchRecord => Boolean(book));
        return dedupeBooks(normalizeSearchBooks({ books }, 'open-textbook-library'));
      }

      async function searchDoab(query: string): Promise<PageBook[]> {
        const resp = await fetch(`${BOOKS_API_BASE}/doab?query=${encodeURIComponent(query)}`);
        const payload: unknown = await resp.json().catch(() => []);
        if (!resp.ok) throw new Error(`DOAB search failed (${resp.status})`);
        const books = (Array.isArray(payload) ? payload as SearchRecord[] : []).map((item): SearchRecord | null => {
          const title = oapenMetadataValues(item, 'dc.title')[0] || item.name || '';
          const types = oapenMetadataValues(item, 'dc.type').map(value => value.toLowerCase());
          if (!title || (types.length && !types.includes('book'))) return null;
          const rights = oapenMetadataValues(item, 'dc.rights.uri')[0]
            || oapenMetadataValues(item, 'dc.rights')[0]
            || '';
          const languageEntry = (Array.isArray(item.metadata) ? item.metadata as (SearchRecord | null | undefined)[] : [])
            .find(entry => entry?.key === 'dc.language');
          return {
            id: item.uuid || item.handle,
            source: 'doab',
            source_native_id: String(item.handle || item.uuid || ''),
            source_url: oapenMetadataValues(item, 'dc.identifier.uri')[0]
              || (item.handle ? `https://directory.doabooks.org/handle/${item.handle}` : ''),
            title,
            authors: oapenMetadataValues(item, 'dc.contributor.author').join(', '),
            publisher: oapenMetadataValues(item, 'publisher.name')[0] || '',
            description: oapenMetadataValues(item, 'dc.description.abstract')[0] || '',
            subjects: [
              ...oapenMetadataValues(item, 'dc.subject.other'),
              ...oapenMetadataValues(item, 'dc.subject.classification'),
            ],
            language: languageEntry?.code || languageEntry?.value || '',
            year: oapenMetadataValues(item, 'dc.date.issued')[0] || '',
            license: rights,
            license_url: /^https?:\/\//i.test(rights) ? rights : '',
            rights_status: rights ? 'open_license' : 'unknown',
          };
        }).filter((book): book is SearchRecord => Boolean(book));
        return dedupeBooks(normalizeSearchBooks({ books }, 'doab'));
      }

      function creativeCommonsUrl(slug: unknown): string {
        const match = String(slug || '').toLowerCase().match(/^cc-(by(?:-nc)?(?:-nd|-sa)?)-(\d)-(\d)$/);
        return match ? `https://creativecommons.org/licenses/${match[1]}/${match[2]}.${match[3]}/` : '';
      }

      async function searchGlobalDigitalLibrary(query: string): Promise<PageBook[]> {
        const resp = await fetch(`${BOOKS_API_BASE}/gdl?query=${encodeURIComponent(query)}`);
        const payload = await resp.json().catch(() => ({})) as { books?: unknown };
        if (!resp.ok) throw new Error(`Global Digital Library search failed (${resp.status})`);
        const books = (Array.isArray(payload.books) ? payload.books as SearchRecord[] : []).map((item): SearchRecord | null => {
          const license = (Array.isArray(item.license) ? item.license[0] : null) as SearchRecord | null;
          if (!item?.title || !license?.name) return null;
          const epubId = String(item.epubUrl || '').match(/\/book\/(\d+)\/?(?:[?#].*)?$/)?.[1] || '';
          const language = (Array.isArray(item.language) ? item.language[0] : null) as SearchRecord | null;
          const topics = [
            ...(Array.isArray(item.topic) ? item.topic as (SearchRecord | null | undefined)[] : []),
            ...(Array.isArray(item.mainCategory) ? item.mainCategory as (SearchRecord | null | undefined)[] : []),
          ];
          return {
            id: item.postId,
            source: 'global-digital-library',
            source_native_id: String(item.postId || ''),
            source_url: item.postLink || '',
            title: item.title,
            authors: '',
            publisher: item.publisher || item.contentsource || '',
            description: item.description || '',
            subjects: topics.map(topic => topic?.name).filter(Boolean),
            language: language?.slug || language?.name || '',
            license: license.name,
            license_url: creativeCommonsUrl(license.slug),
            rights_status: 'open_license',
            extension: epubId ? 'epub' : '',
            read_url: epubId ? `${BOOKS_API_BASE}/gdl-epub?id=${encodeURIComponent(epubId)}` : '',
            cover_url: item.thumbnail || '',
          };
        }).filter((book): book is SearchRecord => Boolean(book));
        return dedupeBooks(normalizeSearchBooks({ books }, 'global-digital-library'));
      }

      function internetArchiveFile(files: unknown, metadata: SearchRecord = {}): SearchRecord | null {
        return BookMetadata.internetArchiveFile(files, metadata);
      }

      async function searchInternetArchive(query: string): Promise<PageBook[]> {
        const response = await fetch(`${BOOKS_API_BASE}/internet-archive/search?query=${encodeURIComponent(query)}`);
        const payload = await response.json().catch(() => ({})) as { response?: { docs?: unknown } };
        if (!response.ok) throw new Error(`Internet Archive search failed (${response.status})`);
        const docs = Array.isArray(payload?.response?.docs) ? payload.response.docs as SearchRecord[] : [];
        const books = await Promise.all(docs.map(async doc => {
          const id = String(doc?.identifier || '').trim();
          if (!id) return null;
          const metadataResponse = await fetch(`${BOOKS_API_BASE}/internet-archive/metadata?id=${encodeURIComponent(id)}`);
          const metadataPayload = await metadataResponse.json().catch(() => ({})) as { metadata?: unknown; files?: unknown };
          if (!metadataResponse.ok) return null;
          const metadata = (metadataPayload.metadata || {}) as SearchRecord;
          const file = internetArchiveFile(metadataPayload.files, metadata);
          if (!file) return null;
          const extension = /\.epub$/i.test(file.name as string) || /epub/i.test(file.format as string) ? 'epub' : 'pdf';
          return {
            id,
            source: 'internet-archive',
            source_native_id: id,
            source_url: `https://archive.org/details/${encodeURIComponent(id)}`,
            title: metadata.title || doc.title || '',
            authors: metadata.creator || doc.creator || '',
            year: metadata.date || metadata.year || doc.date || doc.year || '',
            language: metadata.language || doc.language || '',
            description: metadata.description || '',
            license: metadata.licenseurl || doc.licenseurl || '',
            license_url: metadata.licenseurl || doc.licenseurl || '',
            rights_status: metadata.licenseurl || doc.licenseurl ? 'open_license' : 'unknown',
            extension,
            filesize: Number(file.size || 0),
            read_url: `${BOOKS_API_BASE}/internet-archive/download?id=${encodeURIComponent(id)}&name=${encodeURIComponent(file.name as string)}`,
          };
        }));
        return dedupeBooks(normalizeSearchBooks({ books: books.filter(Boolean) }, 'internet-archive'));
      }

      function formatBuildDate(date: Date): string {
        if (Number.isNaN(date.getTime())) {
          return '';
        }
        const year = String(date.getFullYear());
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}`;
      }

      function escapeHtml(value: unknown): string {
        return String(value ?? '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function bytesLabel(value: unknown): string {
        let n = Number(value) || 0;
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        while (n >= 1024 && i < units.length - 1) {
          n /= 1024;
          i++;
        }
        return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
      }

      function transferRateLabel(value: unknown): string {
        const rate = Math.max(0, Number(value) || 0);
        if (rate < 1000) return `${Math.round(rate)} B/s`;
        if (rate < 1000 * 1000) return `${(rate / 1000).toFixed(rate < 10 * 1000 ? 1 : 0)} kB/s`;
        return `${(rate / (1000 * 1000)).toFixed(rate < 10 * 1000 * 1000 ? 1 : 0)} MB/s`;
      }

	  function rightsMarkerMarkup(book: PageBook): string {
		const rights = BookMetadata.normalizeRights(book);
		const accessible = BookMetadata.rightsAccessibleLabel(book);
		const openClass = ['public_domain', 'open_license'].includes(rights.rights_status) ? ' open' : '';
		return `<span class="rights-marker${openClass}" title="${escapeHtml(accessible)}" aria-label="${escapeHtml(accessible)}">${escapeHtml(BookMetadata.rightsLabel(book))}</span>`;
	  }

      function isMd5(value: unknown): boolean {
        return /^[0-9a-f]{32}$/i.test(String(value || '').trim());
      }

      function normalizeSha256(value: unknown): string {
        const sha = String(value || '').trim().toLowerCase();
        return /^[a-f0-9]{64}$/i.test(sha) ? sha : '';
      }

      function findById<T extends PageBook>(list: T[], id: string | undefined): number {
        return list.findIndex(item => item.md5 === id);
      }

      function upsertById<T extends PageBook>(list: T[], entry: T): void {
        const index = findById(list, entry.md5);
        if (index >= 0) {
          list[index] = { ...list[index], ...entry, updatedAt: Date.now() };
          return;
        }
        list.unshift({ ...entry, updatedAt: Date.now() });
      }

      function normalizeDesktopProgress(value: unknown): PageBook | null {
        const normalized = BookstrDesktopProgress.normalizeProgressPayload(value as Parameters<typeof BookstrDesktopProgress.normalizeProgressPayload>[0], 'web');
        if (!normalized) return null;
        return {
          ...normalized,
          ...BookMetadata.normalizeRights(value),
          publisher: String((value as PageBook).publisher || ''),
          updatedAt: Number((value as PageBook).updatedAt || Date.now()),
        };
      }

      function applyDesktopReadingProgress(payload: unknown): PageBook | null {
        const update = normalizeDesktopProgress(payload);
        if (!update) return null;
        const existingIndex = state.reading.findIndex(item => item && item.md5 === update.md5);
        const existing = existingIndex >= 0 ? state.reading[existingIndex] : null;
        const merged: PageBook = {
          ...(existing || {}),
          md5: update.md5,
          title: String(existing?.title || update.title || 'Book'),
          authors: String(existing?.authors || update.authors || ''),
          year: String(existing?.year || update.year || ''),
          language: String(existing?.language || update.language || ''),
          publisher: String(existing?.publisher || update.publisher || ''),
          readUrl: update.readUrl || existing?.readUrl || '',
          source: String(existing?.source || update.source || ''),
          sourceNativeId: String(existing?.sourceNativeId || update.sourceNativeId || ''),
          extension: String(existing?.extension || update.extension || 'epub').toLowerCase(),
          sourceUrl: update.sourceUrl || existing?.sourceUrl || '',
          sha256: String(existing?.sha256 || update.sha256 || ''),
		  ...BookMetadata.normalizeRights(update),
          progression: update.progression,
          furthestProgression: Math.max(
            Number(existing?.furthestProgression || 0),
            Number(update.furthestProgression || 0)
          ),
          cfi: update.cfi,
          updatedAt: Date.now(),
        };
        upsertById(state.reading, merged);
        state.reading = BookMetadata.dedupeLibraryBooks(state.reading)
          .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
        localStorage.setItem(READING_KEY, JSON.stringify(state.reading));
        if (activeReadingBook && String(activeReadingBook.md5 || '').toLowerCase() === update.md5) {
          activeReadingBook = state.reading.find(item => String(item.md5 || '') === update.md5) || activeReadingBook;
        }
        renderReading();
        renderHome();
        return merged;
      }

      function applyReaderProgress(payload: unknown): PageBook | null {
        const message = payload as Record<string, unknown> | null;
        if (!message || message.type !== 'bookstr-reader-progress') return null;
        const bookId = String(message.bookId || message.md5 || '').trim().toLowerCase();
        if (!bookId) return null;
        const active = activeReadingBook && String(activeReadingBook.md5 || '').trim().toLowerCase() === bookId
          ? activeReadingBook
          : state.reading.find(item => String(item?.md5 || '').trim().toLowerCase() === bookId);
        const merged = applyDesktopReadingProgress({ ...(active || {}), ...message, md5: bookId });
        if (merged) queueReadingProgressPublish(merged);
        return merged;
      }

	  function applyReaderRightsMetadata(payload: Record<string, unknown>): void {
		if (!payload || payload.type !== 'bookstr-reader-metadata') return;
		const rights = BookMetadata.normalizeRights({
		  ...payload,
		  license: payload.license || payload.rights,
		  rights_source: payload.rights_source || (payload.rights ? 'epub_opf' : ''),
		});
		const id = String(payload.md5 || payload.bookId || activeReadingBook?.md5 || '').toLowerCase();
		if (!id || (!rights.license && rights.rights_status === 'unknown')) return;
		const update = (item: PageBook) => String(item?.md5 || '').toLowerCase() === id
		  ? { ...item, ...BookMetadata.preferredRights(item, rights), updatedAt: Date.now() }
		  : item;
		state.reading = state.reading.map(update);
		state.favorites = state.favorites.map(update);
		if (activeReadingBook && String(activeReadingBook.md5 || '').toLowerCase() === id) {
		  activeReadingBook = { ...activeReadingBook, ...BookMetadata.preferredRights(activeReadingBook, rights) };
		}
		localStorage.setItem(READING_KEY, JSON.stringify(state.reading));
		localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites));
		renderReading();
		renderFavorites();
		renderHome();
		if (state.nip7.pubkey) {
		  if (state.favorites.some(item => String(item?.md5 || '').toLowerCase() === id)) queueFavoriteSync();
		  if (state.reading.some(item => String(item?.md5 || '').toLowerCase() === id)) void publishReadingMetadata(activeReadingBook || state.reading.find(item => String(item?.md5 || '').toLowerCase() === id)).catch(() => {});
		}
	  }

	  window.addEventListener('message', event => {
		if (event.source !== readerFrame.contentWindow) return;
		if (event.origin !== window.location.origin) return;
		if (event.data?.type === 'bookstr-reader-progress') {
		  applyReaderProgress(event.data);
		  return;
		}
		if (event.data?.type === 'bookstr-comic-progress') {
		  const id = String(event.data.bookId || activeReadingBook?.md5 || '').trim().toLowerCase();
		  const pageIndex = Math.max(0, Number(event.data.pageIndex) || 0);
		  const pageCount = Math.max(0, Number(event.data.pageCount) || 0);
		  if (id) {
		    state.reading = state.reading.map(item => String(item?.md5 || '').trim().toLowerCase() === id
		      ? { ...item, pageIndex, pageCount, cfi: `comic:${pageIndex}:${pageCount}`, progression: pageCount > 1 ? pageIndex / (pageCount - 1) : 0, updatedAt: Date.now() }
		      : item);
		    localStorage.setItem(READING_KEY, JSON.stringify(state.reading));
		    renderReading();
		    renderHome();
		  }
		  return;
		}
		applyReaderRightsMetadata(event.data);
	  });

      function syncSharedStorage(event: StorageEvent): void {
        if (!isDesktopMode || !event || !desktopSyncKeys.has(event.key)) return;
        if (event.key !== READING_KEY) return;
        const reading = safeJSONRead<unknown[]>(event.newValue, []);
        if (Array.isArray(reading)) {
          state.reading = BookMetadata.dedupeLibraryBooks(reading
            .filter((item): item is PageBook => Boolean((item as PageBook | null)?.md5))
            .map(item => normalizeFavoriteFromRemote(item, { trustExplicitFormat: false }))
          ).sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
          renderReading();
          if (activeReadingBook) {
            const match = state.reading.find(item => BookMetadata.sameLibraryBook(item, activeReadingBook as PageBook));
            if (match) {
              activeReadingBook = match;
            }
          }
        }
      }

      if (isDesktopMode) {
        if (desktopBridge?.onProgress) {
          desktopBridge.onProgress(payload => {
            const merged = applyDesktopReadingProgress(payload);
            if (merged) queueReadingProgressPublish(merged);
          });
        }
        window.addEventListener('storage', syncSharedStorage);
      }

      function removeById<T extends PageBook>(list: T[], id: string): void {
        const index = findById(list, id);
        if (index >= 0) {
          list.splice(index, 1);
        }
      }

      function highlightedWordSnippet(context: unknown, word: unknown): string {
        const text = String(context || '').trim();
        const needle = String(word || '').trim();
        if (!needle) return escapeHtml(text);
        const index = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
        if (index < 0) return `<mark>${escapeHtml(needle)}</mark>`;
        return `${escapeHtml(text.slice(0, index))}<mark>${escapeHtml(text.slice(index, index + needle.length))}</mark>${escapeHtml(text.slice(index + needle.length))}`;
      }

      function dictionaryTextValues(value: unknown): string[] {
        if (!value) return [];
        try {
          const parsed = typeof value === 'string' ? JSON.parse(value) : value;
          const values = Array.isArray(parsed) ? parsed : [parsed];
          return values.flatMap(item => {
            if (typeof item === 'string') return [item];
            if (!item || typeof item !== 'object') return [];
            const record = item as Record<string, unknown>;
            const text = record.written_rep || record.translation || record.text || record.word || record.definition;
            return text ? [String(text)] : Object.values(item).filter((part): part is string => typeof part === 'string');
          }).filter(Boolean);
        } catch {
          return [String(value)].filter(Boolean);
        }
      }

      function formatMediaWikiText(value: unknown): string {
        let text = escapeHtml(String(value || '').trim());
        text = text
          .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1')
          .replace(/\[\[([^\]]+)\]\]/g, '$1')
          .replace(/'''([^']+?)'''/g, '<strong>$1</strong>')
          .replace(/''([^']+?)''/g, '<em>$1</em>')
          .replace(/(={2,6})\s*([^=]+?)\s*\1/g, (_, marks, title) => {
            const level = Math.min(6, marks.length + 1);
            return `\n<h${level}>${title.trim()}</h${level}>\n`;
          });
        const blocks = text.split(/\n+/).map(block => block.trim()).filter(Boolean);
        let listType = '';
        let html = '';
        const closeList = () => {
          if (listType) html += `</${listType}>`;
          listType = '';
        };
        for (const block of blocks) {
          if (/^<h[3-6]>/.test(block)) {
            closeList();
            html += block;
            continue;
          }
          const list = block.match(/^([*#])\s*(.+)$/);
          if (list) {
            const nextType = list[1] === '*' ? 'ul' : 'ol';
            if (listType !== nextType) {
              closeList();
              listType = nextType;
              html += `<${listType}>`;
            }
            html += `<li>${list[2]}</li>`;
            continue;
          }
          closeList();
          html += `<p>${block}</p>`;
        }
        closeList();
        return html;
      }

      async function lookupAllOfflineWords(word: string, language: string): Promise<{ label: string; definitions: string[] } | null> {
        const normalized = String(language || '').split('-')[0]!.toLowerCase();
        const packs = (await dictionaryRecords()).filter(pack => pack.source === normalized);
        if (!packs.length) return null;
        const SQL = await sqlRuntime();
        const groups = [];
        for (const pack of packs.sort((a, b) => a.label.localeCompare(b.label))) {
          const database = new SQL.Database(new Uint8Array(pack.bytes));
          try {
            const statement = database.prepare(
              'SELECT trans_list, sense_list FROM translation_grouped WHERE written_rep = ? COLLATE NOCASE ORDER BY score DESC, importance DESC LIMIT 6'
            );
            statement.bind([word]);
            const definitions: string[] = [];
            while (statement.step()) {
              const row = statement.getAsObject();
              definitions.push(...dictionaryTextValues(row.trans_list), ...dictionaryTextValues(row.sense_list));
            }
            statement.free();
            const unique = [...new Set(definitions.map(value => value.trim()).filter(Boolean))].slice(0, 8);
            if (unique.length) groups.push(`${DICTIONARY_LANGUAGES[pack.target] || pack.target}: ${unique.join('; ')}`);
            pack.lastUsed = Date.now();
            await dictionaryPut(pack);
          } finally {
            database.close();
          }
        }
        return groups.length ? { label: 'Offline dictionaries', definitions: groups } : null;
      }

      function publishNostrDeletion(event: MigratedNostrEvent): Promise<boolean> {
        return Promise.all(NOSTR_RELAYS.map(relay => new Promise<boolean>(resolve => {
          const socket = new WebSocket(relay);
          const timer = setTimeout(() => {
            socket.close();
            resolve(false);
          }, 5000);
          const finish = (success: boolean) => {
            clearTimeout(timer);
            socket.close();
            resolve(success);
          };
          socket.addEventListener('open', () => socket.send(JSON.stringify(['EVENT', event])));
          socket.addEventListener('message', message => {
            try {
              const payload = JSON.parse(message.data);
              if (payload[0] === 'OK' && payload[1] === event.id) finish(Boolean(payload[2]));
            } catch {}
          });
          socket.addEventListener('error', () => finish(false));
        }))).then(results => results.some(Boolean));
      }

      async function publishReadingDeletion(book: PageBook | null | undefined): Promise<void> {
        const bookId = String(book?.md5 || '').toLowerCase();
        if (!bookId) return;
        const pubkey = (state.nip7.pubkey || await nostrSigner?.getPublicKey?.()) as string;
        if (!pubkey || !nostrSigner?.signEvent) {
          throw new Error(`Connect your ${nostrSignerName} to delete reading progress across apps.`);
        }
        const dTag = `${READING_D_PREFIX}${bookId}`;
        const priorEvents = await queryNostrEvents(pubkey, {
          kinds: [NOSTR_PROGRESS_KIND], '#d': [dTag], limit: 50,
        });
        const now = Math.max(
          Math.floor(Date.now() / 1000),
          ...priorEvents.map(event => Number(event.created_at || 0) + 1)
        );
        const tombstone = await nostrSigner.signEvent({
          kind: NOSTR_PROGRESS_KIND,
          created_at: now,
          tags: [['d', dTag]],
          content: JSON.stringify({ bookId, deleted: true, updatedAt: now * 1000 }),
        });
        const accepted = await Promise.all(NOSTR_RELAYS.map(relay => publishRelayEvent(relay, tombstone as MigratedNostrEvent)));
        if (!accepted.some(Boolean)) throw new Error('Nostr relays did not accept the reading deletion.');
        if (priorEvents.length) {
          const deletion = await nostrSigner.signEvent({
            kind: 5,
            created_at: now,
            tags: priorEvents.map(event => ['e', event.id!]),
            content: '',
          });
          await publishNostrDeletion(deletion as MigratedNostrEvent);
        }
      }

      async function publishReadingMetadata(book: PageBook | null | undefined): Promise<unknown> {
        const bookId = String(book?.md5 || '').toLowerCase();
        if (!bookId) return;
        const currentBook = book!;
        const pubkey = (state.nip7.pubkey || await nostrSigner?.getPublicKey?.()) as string;
        if (!pubkey || !nostrSigner?.signEvent) {
          throw new Error(`Connect your ${nostrSignerName} to sync refreshed reading metadata.`);
        }
        const rawPriorEvents = await queryNostrEvents(pubkey, {
          kinds: [NOSTR_PROGRESS_KIND], '#d': [`${READING_D_PREFIX}${bookId}`], limit: 20,
        });
        const priorEvents = await verifiedNostrEvents(rawPriorEvents);
        const remote = priorEvents
          .map(event => {
            const parsed = parseReadingProgressEvent(event);
            return parsed && !parsed.deleted
              ? { ...parsed, relayCreatedAt: Number(event.created_at || 0) }
              : null;
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))[0] || null;
        const localProgression = Math.max(0, Math.min(1, Number(BookMetadata.readingProgressForBook(currentBook) || 0)));
        const localFurthest = Math.max(localProgression, Number(currentBook.furthestProgression || 0) || 0);
        const remoteProgression = Math.max(0, Math.min(1, Number(remote?.progression || 0)));
        const remoteFurthest = Math.max(remoteProgression, Number((remote as unknown as Parameters<typeof BookstrDesktopProgress.isProgressAhead>[0] | null)?.furthestProgression || 0) || 0);
        const remoteIsAhead = remote && BookstrDesktopProgress.isProgressAhead(remote as unknown as Parameters<typeof BookstrDesktopProgress.isProgressAhead>[0], {
          progression: localProgression,
          furthestProgression: localFurthest,
        } as Parameters<typeof BookstrDesktopProgress.isProgressAhead>[1]);
        if (remoteIsAhead) {
          rememberNostrReadingCandidate(remote, currentBook);
          saveNostrSyncCache(pubkey, {
            favorites: state.favorites,
            reading: readingSnapshotForNostrCache(),
            words: state.words,
          });
          return { published: false, reason: 'remote-ahead', progress: remote };
        }
        const now = Math.max(
          Math.floor(Date.now() / 1000),
          ...priorEvents.map(event => Number(event.created_at || 0) + 1),
        );
        const event = await nostrSigner.signEvent({
          kind: NOSTR_PROGRESS_KIND,
          created_at: now,
          tags: [['d', `${READING_D_PREFIX}${bookId}`]],
          content: JSON.stringify({
            v: 2,
            bookId,
            title: currentBook.title || '',
            author: currentBook.authors || currentBook.author || '',
            year: currentBook.year || '',
            language: currentBook.language || '',
            publisher: currentBook.publisher || '',
            coverUrl: currentBook.coverUrl || '',
            sha256: currentBook.sha256 || '',
            extension: currentBook.extension || currentBook.format || '',
            source: currentBook.source || '',
            sourceNativeId: currentBook.sourceNativeId || '',
			...BookMetadata.normalizeRights(currentBook),
            locator: {
              progression: localProgression,
              furthestProgression: Math.max(
                localFurthest,
                remoteFurthest,
              ),
              cfi: currentBook.cfi || '',
            },
            readUrl: currentBook.readUrl || currentBook.url || '',
            updatedAt: now * 1000,
          }),
        });
        const accepted = await Promise.all(NOSTR_RELAYS.map(relay => publishRelayEvent(relay, event as MigratedNostrEvent)));
        if (!accepted.some(Boolean)) throw new Error('Nostr relays did not accept refreshed reading metadata.');
        nostrAheadReadingByBook.delete(bookId);
        return { published: true, event };
      }

      const readingProgressPublishTimers = new Map<string, ReturnType<typeof setTimeout>>();
      const pendingReadingProgressPublishes = new Map<string, PageBook>();

      function queueReadingProgressPublish(book: PageBook): void {
        const bookId = String(book?.md5 || '').trim().toLowerCase();
        if (!bookId || !state.settings.useNip7 || !state.nip7.pubkey || !nostrSigner?.signEvent) return;
        pendingReadingProgressPublishes.set(bookId, { ...book, md5: bookId });
        clearTimeout(readingProgressPublishTimers.get(bookId));
        readingProgressPublishTimers.set(bookId, setTimeout(() => {
          readingProgressPublishTimers.delete(bookId);
          void flushReadingProgressPublish(bookId);
        }, 2000));
      }

      async function flushReadingProgressPublish(bookId: string): Promise<boolean> {
        const id = String(bookId || '').trim().toLowerCase();
        clearTimeout(readingProgressPublishTimers.get(id));
        readingProgressPublishTimers.delete(id);
        const pending = pendingReadingProgressPublishes.get(id);
        if (!pending) return false;
        pendingReadingProgressPublishes.delete(id);
        try {
          await publishReadingMetadata(pending);
          return true;
        } catch (error) {
          console.warn('Reading progress stayed local because Nostr sync failed:', error);
          return false;
        }
      }

      async function flushAllReadingProgressPublishes(): Promise<boolean[]> {
        return Promise.all([...pendingReadingProgressPublishes.keys()].map(flushReadingProgressPublish));
      }

      async function deleteLibraryBook(book: PageBook): Promise<void> {
        const title = book?.title || 'this book';
        if (!window.confirm(isDesktopMode ? `Remove ${title} from your library?` : `Delete ${title} from your library across apps?`)) return;
        const wasFavorite = state.favorites.some(item => BookMetadata.sameLibraryBook(item, book));
        const wasReading = state.reading.some(item => BookMetadata.sameLibraryBook(item, book));
        state.favorites = state.favorites.filter(item => !BookMetadata.sameLibraryBook(item, book));
        state.reading = state.reading.filter(item => !BookMetadata.sameLibraryBook(item, book));
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites));
        localStorage.setItem(READING_KEY, JSON.stringify(state.reading));
        if (state.nip7.pubkey) {
          saveNostrSyncCache(state.nip7.pubkey, {
            favorites: state.favorites, reading: state.reading, words: state.words,
          });
        }
        renderFavorites();
        renderReading();
        renderHome();
        status.textContent = isDesktopMode ? `Removed ${title} from your library.` : `Removed ${title} locally; syncing deletion…`;
        try {
          const tasks = [];
          if (wasFavorite && !isDesktopMode) tasks.push(syncFavoriteDeletionToNostr());
          if (wasReading) tasks.push(publishReadingDeletion(book));
          if (tasks.length) await Promise.all(tasks);
          if (!isDesktopMode) status.textContent = `Deleted ${title} from your library across apps.`;
        } catch (error) {
          const message = (error as Error)?.message || error;
          status.textContent = isDesktopMode
            ? `Removed ${title} locally; reading sync failed: ${message}`
            : `Deleted ${title} locally; cross-app sync failed: ${message}`;
        }
      }

      async function deleteVocabularyWord(entry: VocabularyEntry): Promise<void> {
        const pubkey = (state.nip7.pubkey || await nostrSigner?.getPublicKey?.()) as string;
        if (!pubkey || !nostrSigner?.signEvent || !nostrSigner?.nip44?.encrypt) {
          throw new Error(`Connect your ${nostrSignerName} to delete this word from Nostr.`);
        }
        const events = await queryNostrEvents(pubkey, { kinds: [NOSTR_PROGRESS_KIND], limit: 500 });
        const matchingEvents: MigratedNostrEvent[] = [];
        for (const event of events) {
          try {
            const saved = await decryptVocabularyPayload(pubkey, event);
            if (!saved) continue;
            const sameKey = entry.key && saved.key === entry.key;
            const sameWord = saved.word === entry.word && (saved.bookId || saved.bookTitle) === (entry.bookId || entry.bookTitle);
            if (sameKey || sameWord) matchingEvents.push(event);
          } catch {}
        }

        const now = Date.now();
        const tombstone = normalizeVocabularyWord({
          ...entry,
          syncId: entry.syncId || crypto.randomUUID?.() || `${now}-${Math.random().toString(16).slice(2)}`,
          lastSeenAt: now,
          updatedAt: now,
          deleted: true,
        });
        const dTags = new Set(matchingEvents.map(event =>
          event.tags?.find(tag => tag?.[0] === 'd')?.[1]
        ).filter((tag): tag is string => Boolean(tag)));
        if (!dTags.size) dTags.add(`${WORDS_D_PREFIX}${tombstone!.syncId}`);
        for (const dTag of dTags) {
          const syncId = dTag.startsWith(WORDS_D_PREFIX)
            ? dTag.slice(WORDS_D_PREFIX.length)
            : tombstone!.syncId!;
          const content = await nostrSigner.nip44.encrypt(pubkey, JSON.stringify({ ...tombstone!, syncId }));
          const event = await nostrSigner.signEvent({
            kind: NOSTR_PROGRESS_KIND,
            created_at: Math.floor(now / 1000),
            tags: [['d', dTag]],
            content: content as string,
          });
          const accepted = await Promise.all(NOSTR_RELAYS.map(relay => publishRelayEvent(relay, event as MigratedNostrEvent)));
          if (!accepted.some(Boolean)) throw new Error('Nostr relays did not accept the deletion tombstone.');
        }
        if (matchingEvents.length) {
          const tags = matchingEvents.map(event => ['e', event.id!]);
          const deletion = await nostrSigner.signEvent({
            kind: 5,
            created_at: Math.floor(Date.now() / 1000),
            tags,
            content: ''
          });
          // NIP-09 cleanup is best-effort. The encrypted replaceable tombstone
          // above is the durable, cross-client deletion record.
          await publishNostrDeletion(deletion as MigratedNostrEvent);
        }
        state.words = state.words.filter(value => {
          const saved = normalizeVocabularyWord(value);
          return saved && saved.key !== entry.key && !(saved.word === entry.word && (saved.bookId || saved.bookTitle) === (entry.bookId || entry.bookTitle));
        });
        state.words.push(tombstone!);
        if (wordsFilter.value.trim().toLowerCase() === entry.word.trim().toLowerCase()) {
          wordsFilter.value = '';
        }
        localStorage.setItem(WORDS_KEY, JSON.stringify(state.words));
        saveNostrSyncCache(pubkey, {
          favorites: state.favorites,
          reading: state.reading,
          words: state.words,
        });
        renderWords();
        renderHome();
      }

      function hasActiveWords(): boolean {
        return state.words.map(normalizeVocabularyWord).some(entry => entry && !entry.deleted);
      }

      function renderWords() {
        wordsList.innerHTML = '';
        const activeWords = state.words.map(normalizeVocabularyWord).filter((entry): entry is VocabularyEntry => Boolean(entry && !entry.deleted));
        wordsTabBtn.classList.toggle('hidden', activeWords.length === 0);
        if (!activeWords.length) {
          wordsList.textContent = 'Select a word while reading. It will be saved here even when no definition is found.';
          return;
        }
        const needle = wordsFilter.value.trim().toLowerCase();
        const uniqueWords = new Map<string, VocabularyEntry>();
        for (const entry of activeWords) {
          const identity = `${entry.word}\u0000${entry.bookId || entry.bookTitle}`;
          const existing = uniqueWords.get(identity);
          if (!existing || entry.language === 'pt' || entry.lastSeenAt > existing.lastSeenAt) uniqueWords.set(identity, entry);
        }
        const words = [...uniqueWords.values()].filter((entry) => {
          if (!needle) return true;
          return [entry.word, entry.bookTitle, entry.contextSentence, ...entry.definitions]
            .some(value => String(value).toLowerCase().includes(needle));
        });
        const sort = wordsSort.value;
        words.sort((a, b) => {
          if (sort === 'alphabetical') return a.word.localeCompare(b.word);
          if (sort === 'first') return a.firstSeenAt - b.firstSeenAt;
          if (sort === 'added') return b.firstSeenAt - a.firstSeenAt;
          if (sort === 'book') return a.bookTitle!.localeCompare(b.bookTitle!) || a.word.localeCompare(b.word);
          if (sort === 'seen') return b.lookupCount - a.lookupCount;
          return b.lastSeenAt - a.lastSeenAt;
        });
        if (!words.length) {
          wordsList.textContent = `No words match “${wordsFilter.value.trim()}”.`;
          return;
        }
        for (const entry of words) {
          const row = document.createElement('article');
          row.className = 'word-row';
          const sourceBook = [...state.reading, ...state.favorites].find(book =>
            (entry.bookId && book.md5 === entry.bookId) ||
            (entry.bookTitle && book.title === entry.bookTitle)
          );
          const sourceHref = sourceBook?.readUrl || sourceBook?.url
            ? `#read=${encodeURIComponent((sourceBook.readUrl || sourceBook.url)!)}`
            : '#reading';
          row.innerHTML = `
            <div class="word-heading">
              <a href="${escapeHtml(sourceHref)}">${escapeHtml(entry.word)}</a>
              <span class="word-language" title="${escapeHtml(DICTIONARY_LANGUAGES[entry.language.split('-')[0]!] || entry.language)}">${escapeHtml(entry.language.split('-')[0])}</span>
              ${entry.partOfSpeech ? `<span class="word-kind">${escapeHtml(entry.partOfSpeech)}</span>` : ''}
              <button class="word-delete" type="button" aria-label="Delete ${escapeHtml(entry.word)}" title="Delete word"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm3 2v7h2v-7H9Zm4 0v7h2v-7h-2Z"/></svg></button>
            </div>
            <p class="word-definition" role="button" tabindex="0" aria-label="Show definitions" title="Show definitions">${entry.definitions[0] ? escapeHtml(entry.definitions[0]) : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.5A3.5 3.5 0 0 1 7.5 1H11v17H7.5A3.5 3.5 0 0 0 4 21.5v-17ZM13 1h3.5A3.5 3.5 0 0 1 20 4.5v17a3.5 3.5 0 0 0-3.5-3.5H13V1Z"/></svg>'}</p>
            <p class="word-context">${highlightedWordSnippet(entry.contextSentence, entry.word)}</p>
            ${entry.bookTitle ? `<div class="word-source">${escapeHtml(entry.bookTitle)}${entry.lookupCount > 1 ? ` · seen ${entry.lookupCount} times` : ''}</div>` : ''}
            <div class="word-lookup" aria-live="polite" data-loaded="${entry.definitions.length ? 'true' : 'false'}">${entry.definitions.length
              ? `<strong>${escapeHtml(entry.partOfSpeech || 'Saved definition')}</strong>${entry.definitions.map(definition => `<div class="wiki-definition">${formatMediaWikiText(definition)}</div>`).join('')}`
              : 'Looking up…'}</div>
          `;
          row.querySelector<HTMLButtonElement>('.word-delete')!.addEventListener('click', async () => {
            const button = row.querySelector<HTMLButtonElement>('.word-delete')!;
            button.disabled = true;
            status.textContent = `Deleting ${entry.word}…`;
            try {
              await deleteVocabularyWord(entry);
              status.textContent = `Deleted ${entry.word}.`;
            } catch (error) {
              button.disabled = false;
              status.textContent = `Could not delete ${entry.word}: ${(error as Error)?.message || error}`;
            }
          });
          row.querySelector<HTMLAnchorElement>('.word-heading a')!.addEventListener('click', (event) => {
            event.preventDefault();
            if (sourceBook) void openBook({ ...sourceBook, cfi: entry.cfi });
            else activateTab('reading', { updateHash: true });
          });
          row.querySelector<HTMLParagraphElement>('.word-definition')!.addEventListener('click', async (event) => {
            event.preventDefault();
            const panel = row.querySelector<HTMLDivElement>('.word-lookup')!;
            if (!panel.classList.contains('hidden')) {
              panel.classList.add('hidden');
              return;
            }
            panel.classList.remove('hidden');
            if (panel.dataset.loaded === 'true') return;
            panel.textContent = 'Looking up…';
            try {
              let label = entry.partOfSpeech || 'Saved definition';
              let definitions = [...entry.definitions];
              const offline = await lookupAllOfflineWords(entry.word, entry.language);
              if (offline) {
                label = offline.label;
                definitions = [...offline.definitions, ...definitions];
              }
              if (!definitions.length) {
                const host = entry.language.startsWith('pt') ? 'pt.wiktionary.org' : 'en.wiktionary.org';
                const api = `https://${host}/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(entry.word)}&format=json&formatversion=2&origin=*`;
                const response = await fetch(api);
                const payload = await response.json();
                const extract = String(payload?.query?.pages?.[0]?.extract || '').trim();
                definitions = extract ? [extract.slice(0, 900)] : [];
                label = 'Wiktionary';
              }
              panel.innerHTML = definitions.length
                ? `<strong>${escapeHtml(label)}</strong>${definitions.map(definition => `<div class="wiki-definition">${formatMediaWikiText(definition)}</div>`).join('')}`
                : 'No definition found.';
              panel.dataset.loaded = 'true';
            } catch (error) {
              panel.textContent = `Definition unavailable: ${(error as Error)?.message || error}`;
            }
          });
          wordsList.appendChild(row);
          if (!entry.definitions.length) {
            const panel = row.querySelector<HTMLDivElement>('.word-lookup')!;
            panel.classList.add('hidden');
            row.querySelector<HTMLParagraphElement>('.word-definition')!.click();
          }
        }
      }

      function matchesLibraryFilter(entry: PageBook): boolean {
        const terms = queryInput.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (!terms.length) return true;
        const searchable = `${entry.title || ''} ${entry.authors || ''}`.toLowerCase();
        return terms.every(term => searchable.includes(term));
      }

      function compactAuthorLabel(value: unknown, limit = 120): string {
        const authors = String(value || '').trim();
        return authors.length > limit ? `${authors.slice(0, limit - 1).trimEnd()}…` : authors;
      }

      function renderFavorites() {
        refreshSpeechVoiceMenus();
        favoritesList.innerHTML = '';
        if (!state.favorites.length) {
          const p = document.createElement('li');
          p.textContent = isDesktopMode ? 'No favorites yet.' : 'No Nostr favorites yet.';
          favoritesList.appendChild(p);
          return;
        }
        const matches = state.favorites.filter(matchesLibraryFilter);
        if (!matches.length) {
          const p = document.createElement('li');
          p.textContent = 'No matching favorites.';
          favoritesList.appendChild(p);
          return;
        }
        for (const entry of matches) {
          const item = document.createElement('li');
          item.textContent = `${entry.title} · ${compactAuthorLabel(entry.authors)}`;
          item.title = `${entry.title}${entry.authors ? ` — ${entry.authors}` : ''}`;
          item.style.cursor = 'pointer';
          item.addEventListener('click', () => openBook(entry));
          favoritesList.appendChild(item);
        }
      }

      function renderReading() {
        refreshSpeechVoiceMenus();
        readingList.innerHTML = '';
        if (!state.reading.length) {
          const item = document.createElement('li');
          item.textContent = 'Open a result and it will appear here.';
          readingList.appendChild(item);
          return;
        }
        const matches = state.reading.filter(matchesLibraryFilter);
        if (!matches.length) {
          const item = document.createElement('li');
          item.textContent = 'No matching reading books.';
          readingList.appendChild(item);
          return;
        }
        for (const entry of matches) {
          const item = document.createElement('li');
          item.textContent = `${entry.title} · ${compactAuthorLabel(entry.authors)}`;
          item.title = `${entry.title}${entry.authors ? ` — ${entry.authors}` : ''}`;
          item.style.cursor = 'pointer';
          item.addEventListener('click', () => openBook(entry));
          readingList.appendChild(item);
        }
      }

      function bookCoverUrls(book: PageBook): string[] {
        const download = desktopDownloadForBook(book);
        const md5 = String(download?.md5 || download?.bookId || desktopTorrentBookId(book)).trim().toLowerCase();
        const localCoverUrl = isDesktopMode && isMd5(md5) && String(download?.status || '').toLowerCase() === 'ready'
          ? `app://bookstr/api/library-cover/${md5}`
          : '';
        return CoverAssets.bookCoverCandidates(book, {
          desktop: isDesktopMode,
          key: md5 || BookMetadata.bookIdentity(book),
          localCoverUrl,
        });
      }

      function realCoverUrlsForBook(book: PageBook): string[] {
        return bookCoverUrls(book).filter(url => url && !url.startsWith('data:image/'));
      }

      function tryRealCoverCandidates(book: PageBook, slot: HTMLElement | null): Promise<boolean> {
        const candidates = realCoverUrlsForBook(book);
        if (!slot || !candidates.length) return Promise.resolve(false);
        slot.querySelector('.result-cover')?.remove();
        const image = document.createElement('img');
        image.className = 'result-cover';
        image.alt = '';
        image.loading = 'lazy';
        slot.append(image);
        image.src = candidates[0]!;
        return new Promise<boolean>(resolve => {
          let settled = false;
          const finish = (value: boolean) => {
            if (settled) return;
            settled = true;
            resolve(value);
          };
          CoverAssets.attachImageFallback(image, candidates, {
            key: String(book?.md5 || BookMetadata.bookIdentity(book) || '').trim().toLowerCase(),
            onLoaded: (_url, result) => finish(Boolean(result?.isRealCover)),
            onExhausted: () => finish(false),
          });
          window.setTimeout(() => finish(slot.classList.contains('has-real-cover')), 5000);
        });
      }

      async function lookupCoverOnHover(book: PageBook, slot: HTMLElement | null): Promise<void> {
        if (!slot || slot.classList.contains('has-real-cover')) return;
        const key = String(book?.md5 || BookMetadata.bookIdentity(book) || '').trim().toLowerCase();
        const previous = coverHoverLookups.get(key);
        if (previous?.promise || Date.now() - Number(previous?.attemptedAt || 0) < 60_000) return;
        const promise = (async () => {
          slot.classList.add('cover-lookup-pending');
          CoverAssets.retryBookCover(key);
          if (await tryRealCoverCandidates(book, slot)) return;
          const metadata = await remoteMetadataForBook(book).catch(() => null);
          if (!metadata) return;
          const update = (item: PageBook): PageBook => {
            if (!BookMetadata.sameLibraryBook(item, book)) return item;
            const next = BookMetadata.enrichBookMetadata(item, metadata, 'cover-hover');
            for (const field of ['coverId', 'coverUrl', 'isbn', 'sourceNativeId', 'sourceUrl']) {
              if (metadata[field] !== '' && metadata[field] != null) next[field] = metadata[field];
            }
            return next;
          };
          state.reading = state.reading.map(update);
          state.favorites = state.favorites.map(update);
          localStorage.setItem(READING_KEY, JSON.stringify(state.reading));
          localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites));
          const cache = metadataCacheRead();
          cache[BookMetadata.bookIdentity(book)] = { book: metadata, provenance: 'cover-hover', ts: Date.now() };
          metadataCacheWrite(cache);
          const refreshed = (BookMetadata.mergeLibraryState(state.reading, state.favorites) as PageBook[])
            .find((item: PageBook) => BookMetadata.sameLibraryBook(item, book)) || { ...book, ...metadata };
          CoverAssets.retryBookCover(key);
          await tryRealCoverCandidates(refreshed, slot);
        })().finally(() => {
          slot.classList.remove('cover-lookup-pending');
          coverHoverLookups.set(key, { attemptedAt: Date.now() });
        });
        coverHoverLookups.set(key, { promise, attemptedAt: 0 });
        await promise;
      }

      function searchForAuthor(book: PageBook): void {
        const authorQuery = authorSearchName(book.authors || book.author);
        if (!authorQuery) return;
        queryInput.value = authorQuery;
        searchType.value = 'author';
        activateTab('search');
        void startSearch();
      }

      function desktopBookIds(book: PageBook | null | undefined) {
        const libgenMd5 = BookMetadata.libgenTorrentMetadataForBook(book as PageBook)?.md5 || '';
        return [...new Set([libgenMd5, book?.libvaultMd5, book?.md5, book?.id, book?.sha256]
          .map(value => String(value || '').trim().toLowerCase())
          .filter(Boolean))];
      }

      function desktopTorrentBookId(book: PageBook | null | undefined) {
        return desktopBookIds(book).find(isMd5) || '';
      }

      function desktopDownloadForBook(book: PageBook | null | undefined) {
        let exact = null;
        for (const bookId of desktopBookIds(book)) {
          const download = desktopDownloadByBook.get(bookId);
          if (download) {
            exact = download;
            if (!['failed', 'unavailable'].includes(String(download.status || '').toLowerCase())) return download;
          }
        }
        return BookMetadata.matchingTorrentCatalogRecord(book as PageBook, desktopReadyEditions) || exact;
      }

      function desktopDownloadIds(download: BrowserBook | null | undefined) {
        return [...new Set([download?.bookId, download?.md5, download?.sha256]
          .map(value => String(value || '').trim().toLowerCase())
          .filter(Boolean))];
      }

      function bookFromDesktopDownload(download: BrowserBook | null | undefined) {
        const md5 = String(download?.md5 || download?.bookId || '').trim().toLowerCase();
        const title = String(download?.title || '').trim();
        if (!md5 || !title) return null;
        return {
          md5,
          title,
          authors: String(download?.authors || ''),
          language: String(download?.language || ''),
          year: String(download?.year || ''),
          extension: String(download?.extension || ''),
          isbn: String(download?.isbn || ''),
          source: String(download?.source || 'torrent'),
          sourceNativeId: String(download?.sourceNativeId || ''),
          sha256: String(download?.sha256 || ''),
        };
      }

      function desktopDownloadingBookCount() {
        const activeStatuses = new Set(['queued', 'finding-peers', 'downloading', 'retrying']);
        return new Set([...desktopDownloadByBook.values()]
          .filter(download => activeStatuses.has(String(download?.status || '').toLowerCase()))
          .map(download => String(download?.bookId || '').trim().toLowerCase())
          .filter(Boolean)).size;
      }

      function isBookReadableNow(book: PageBook) {
        if (isDisabledBookFormat(book.extension || book.format)) return false;
        const cached = cachedBookKeys.has(bookCacheKey(book, (book.readUrl || book.url) as string | undefined));
        const download = desktopDownloadForBook(book);
        if (isDesktopMode) return download?.readable === true;
        return cached
          || isBookSeeded(book)
          || Boolean(BookMetadata.canonicalReadUrl(book, BOOKS_API_BASE));
      }

      function isBookSeeded(book: PageBook) {
        const identities = desktopBookIds(book);
        const download = desktopDownloadForBook(book);
        return String(download?.status || '').toLowerCase() === 'seeding'
          || identities.some(identity => desktopSeededBookIds.has(identity));
      }

      function torrentStatusForBook(book: PageBook | null | undefined) {
        const md5 = desktopTorrentBookId(book);
        if (isDesktopMode && isMd5(md5) && !desktopDownloadStatesReady) return 'Looking for torrents';
        const download = desktopDownloadForBook(book);
        if (isBookSeeded(book as PageBook)) return 'Seeding';
        if (!download) {
          const hasTorrent = BookMetadata.torrentMetadataForBook(book as PageBook)
            || BookMetadata.libgenTorrentMetadataForBook(book as PageBook);
          return isDesktopMode && hasTorrent ? 'Available' : '';
        }
        const status = String(download.status || '').toLowerCase();
        if (status === 'ready') return 'Ready';
        if (status === 'downloading') {
          const total = Math.max(0, Number(download.totalBytes || 0));
          const bytes = Math.max(0, Number(download.bytes || 0));
          const percent = total > 0 ? Math.max(0, Math.min(100, Math.round(bytes / total * 100))) : 0;
          const peers = Number(download.peers || 0);
          return `Downloading · ${percent}%${peers ? ` · ${peers} peer${peers === 1 ? '' : 's'}` : ''}`;
        }
        if (status === 'finding-peers' || status === 'queued') return 'Finding peers';
        if (status === 'failed') return 'Unavailable';
        return 'Available';
      }

      function torrentStatusClass(label: unknown) {
        const status = String(label || '').toLowerCase();
        if (status.startsWith('looking') || status.startsWith('finding') || status === 'queued') return 'status-dot-waiting';
        if (status.startsWith('downloading')) return 'status-dot-downloading';
        if (status === 'unavailable' || status === 'failed') return 'status-dot-error';
        if (['available', 'ready', 'seeding', 'cached', 'torrent', 'gutenberg'].includes(status)) return 'status-dot-success';
        return '';
      }

      function updateReadTorrentStatus(book = activeReadingBook) {
        const torrent = (document.getElementById('read-metadata-fallback-torrent') as PageElements['read-metadata-fallback-torrent']);
        if (!torrent) return;
        const statusLabel = torrentStatusForBook(book)
          || (isDesktopMode && desktopTorrentBookId(book) ? 'Looking for torrents' : '');
        torrent.hidden = !statusLabel;
        torrent.className = ['read-torrent-status', 'status-with-dot', torrentStatusClass(statusLabel)].filter(Boolean).join(' ');
        torrent.textContent = statusLabel;
        const note = (document.getElementById('read-metadata-fallback-status') as PageElements['read-metadata-fallback-status']);
        if (note && book) {
          updateReadMetadataFallbackDiagnostics(book, {
            cacheStatus: note.dataset.cacheStatus || '',
            error: note.dataset.error || '',
            attempts: safeJSONRead(note.dataset.attempts, []),
          });
        }
      }

      function activeDesktopDownloads() {
        return [...desktopDownloadByBook.entries()].filter(([, download]) => (
          ['downloading', 'finding-peers', 'queued'].includes(String(download?.status || '').toLowerCase())
        ));
      }

      function desktopDownloadTitle(bookId: string) {
        const library = BookMetadata.mergeLibraryState(state.reading, state.favorites) as PageBook[];
        return library.find(book => desktopBookIds(book).includes(bookId))?.title || 'book';
      }

      function desktopDownloadSummary() {
        const active = activeDesktopDownloads();
        if (!active.length) return '';
        const downloading = active.filter(([, download]) => String(download.status || '').toLowerCase() === 'downloading');
        const waiting = active.length - downloading.length;
        const peers = active.reduce((sum, [, download]) => sum + Math.max(0, Number(download.peers || 0)), 0);
        const bytes = downloading.reduce((sum, [, download]) => sum + Math.max(0, Number(download.bytes || 0)), 0);
        const totalBytes = downloading.reduce((sum, [, download]) => sum + Math.max(0, Number(download.totalBytes || 0)), 0);
        const percent = totalBytes > 0 ? Math.max(0, Math.min(100, Math.round(bytes / totalBytes * 100))) : 0;
        if (active.length === 1) {
          const [bookId] = active[0]!;
          const label = downloading.length ? `Downloading ${desktopDownloadTitle(bookId)} · ${percent}%` : `Finding peers for ${desktopDownloadTitle(bookId)}`;
          return `${label}${peers ? ` · ${peers} peer${peers === 1 ? '' : 's'}` : ''}`;
        }
        const details = [];
        if (downloading.length && totalBytes > 0) details.push(`${percent}% overall`);
        if (waiting) details.push(`${waiting} waiting`);
        if (peers) details.push(`${peers} peers`);
        return `${active.length} torrent downloads${details.length ? ` · ${details.join(' · ')}` : ''}`;
      }

      function updateDesktopDownloadSummary() {
        const summary = desktopDownloadSummary();
        if (isDesktopMode) {
          desktopDownloadsSummary.textContent = `${desktopDownloadingBookCount()} downloading · ${desktopSeededBookIds.size} seeding · ↓ ${transferRateLabel(desktopTransferRates.download)} · ↑ ${transferRateLabel(desktopTransferRates.upload)}`;
          return;
        }
        if (summary && status.textContent !== summary) status.textContent = summary;
      }

      function updateHomeDownloadRows() {
        if (isDesktopMode) return;
        for (const row of homeReadingList.querySelectorAll<HTMLElement>('.book-table-row[data-download-book-id]')) {
          if (!desktopDownloadByBook.has(row.dataset.downloadBookId!)) continue;
          const label = torrentStatusForBook({ md5: row.dataset.downloadBookId! });
          const cell = row.querySelector('.availability-primary');
          if (!cell || !label) continue;
          cell.textContent = label;
          cell.className = `availability-primary${torrentStatusClass(label) ? ` status-with-dot ${torrentStatusClass(label)}` : ''}`;
        }
      }

      async function refreshDesktopDownloadStates() {
        if (!isDesktopMode || !desktopBridge?.library?.downloads) return;
        const [downloads, transfers] = await Promise.all([
          desktopBridge!.library.downloads().catch(() => []),
          desktopBridge?.transfers?.status?.().catch(() => []) || [],
        ]);
        const wasReady = desktopDownloadStatesReady;
        desktopDownloadStatesReady = true;
        desktopDownloadByBook.clear();
        for (const download of downloads || []) {
          for (const identity of desktopDownloadIds(download)) {
            desktopDownloadByBook.set(identity, download);
          }
        }
        desktopReadyEditions = (downloads || []).filter(download => (
          ['ready', 'seeding'].includes(String(download?.status || '').toLowerCase())
          && isMd5(download?.md5 || download?.bookId)
          && Number(download?.sourceNativeId || 0) > 0
        ));
        desktopSeededBookIds.clear();
        desktopTransferRates.download = 0;
        desktopTransferRates.upload = 0;
        for (const transfer of transfers || []) {
          desktopTransferRates.download += Math.max(0, Number(transfer?.downloadSpeed || 0));
          desktopTransferRates.upload += Math.max(0, Number(transfer?.uploadSpeed || 0));
          if (transfer?.seeding !== true) continue;
          const bookIds = Array.isArray(transfer?.bookIds) ? transfer.bookIds : [transfer?.bookId];
          for (const value of bookIds) {
            const bookId = String(value || '').trim().toLowerCase();
            if (!bookId) continue;
            desktopSeededBookIds.add(bookId);
            const download = desktopDownloadByBook.get(bookId);
            for (const identity of desktopDownloadIds(download)) desktopSeededBookIds.add(identity);
          }
        }
        updateDesktopDownloadSummary();
        updateReadTorrentStatus();
        const signature = JSON.stringify([
          (downloads || []).map(download => [download.bookId, download.status, download.title, download.error, download.readable, download.completedAt]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
          [...desktopSeededBookIds].sort(),
        ]);
        const structureChanged = !wasReady || signature !== desktopDownloadStateSignature;
        desktopDownloadStateSignature = signature;
        if (activeTab === 'home') {
          if (structureChanged) renderHome();
          else updateHomeDownloadRows();
        }
      }

      function renderBookTable(target: HTMLElement, books: PageBook[], options: {sort?:{key:string;direction:string};library?:boolean;emptyText?:string;label?:string;onSort?:(key:string,direction:string)=>void;routeOnly?:boolean;canOpen?:(book:PageBook)=>boolean;onOpen?:(book:PageBook)=>void} = {}) {
        const sort = options.sort || { key: '', direction: 'asc' };
        const isCached = (book: PageBook) => cachedBookKeys.has(bookCacheKey(book, (book.readUrl || book.url) as string | undefined));
        const availabilityLabel = (book: PageBook) => {
          if (isCached(book)) return 'Cached';
          if (isDesktopMode && options.library) return 'Available';
          const torrentStatus = options.library ? torrentStatusForBook(book) : '';
          if (torrentStatus) return torrentStatus;
          const sources = BookMetadata.availabilitySourcesForBook(book, false);
          if (sources.includes('Torrent')) return 'Torrent';
          if (sources.includes('Gutenberg')) return 'Gutenberg';
          return sources.find(item => item !== 'Metadata only') || '—';
        };
        const visible = sort.key
          ? BookMetadata.sortBooks(books, sort.key, sort.direction, isCached, availabilityLabel)
          : books.slice();
        target.innerHTML = '';
        if (!books.length) {
          target.innerHTML = `<p class="note">${escapeHtml(options.emptyText || 'No matches. Try a shorter query.')}</p>`;
          return;
        }
        const table = document.createElement('div');
        table.className = 'book-table';
        table.setAttribute('role', 'table');
        table.setAttribute('aria-label', options.label || 'Books');
        const head = document.createElement('div');
        head.className = 'book-table-head';
        head.setAttribute('role', 'row');
        const columns = [
          ['', ''], ['Title', 'title'], ['Author', 'author'], ['Rights', 'rights'], ['Year', 'year'],
          ['Available', 'availability'], ['Format', 'format'], ['Language', 'language'], ['', ''],
        ];
        for (const [label, key] of columns) {
          const cell = document.createElement('span');
          cell.setAttribute('role', 'columnheader');
          if (key) {
            const button = document.createElement('button');
            button.type = 'button';
            const selected = sort.key === key;
            button.textContent = `${label}${selected ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}`;
            button.addEventListener('click', () => {
              options.onSort?.(key, selected && sort.direction === 'asc' ? 'desc' : 'asc');
            });
            cell.setAttribute('aria-sort', selected ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
            cell.appendChild(button);
          }
          head.appendChild(cell);
        }
        table.appendChild(head);
        for (const book of visible as Array<PageBook & BrowserBook & {rating?:number;editionCount?:number}>) {
          const canOpen = !isDisabledBookFormat(book.extension || book.format)
            && (options.routeOnly || (options.canOpen ? options.canOpen(book) : Boolean(options.onOpen)));
          const readUrl = book.readUrl || book.url || '';
          const authorQuery = authorSearchName(book.authors);
          const availability = availabilityLabel(book);
          const availabilityClass = torrentStatusClass(availability);
          const downloadPercent = availability.match(/^Downloading · (\d+)%/)?.[1] || '';
          const availabilityMarkup = downloadPercent
            ? `Downloading <strong class="availability-progress">${escapeHtml(downloadPercent)}%</strong>`
            : escapeHtml(availability);
          const readableNow = isBookReadableNow(book);
          const titleAvailabilityClass = readableNow ? 'readable' : 'unavailable';
          const rawLanguage = BookMetadata.languageForBook(book);
          const languageCode = Object.entries(DICTIONARY_LANGUAGES)
            .find(([, name]) => name.toLowerCase() === rawLanguage)?.[0]
            || ({ eng: 'en', por: 'pt' })[rawLanguage]
            || rawLanguage.split('-', 1)[0];
          const catalogUrl = BookMetadata.canonicalCatalogUrl(book);
          const sourceMarkup = catalogUrl
            ? `<a class="result-source" href="${escapeHtml(catalogUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(book.source)}</a>`
            : '';
          const titleDetails = [
            book.publisher ? escapeHtml(book.publisher) : '',
            sourceMarkup,
            book.rating! > 0 ? `★ ${book.rating!.toFixed(1)}` : '',
            book.editionCount! > 0 ? `${book.editionCount} editions` : '',
          ].filter(Boolean).join(' · ');
          const coverUrls = bookCoverUrls(book);
          const coverPlaceholder = CoverAssets.placeholderCoverUrl(book);
          const realCoverUrls = coverUrls.filter(url => url && !url.startsWith('data:image/'));
          const coverUrl = realCoverUrls[0] || '';
          const coverKey = String(book?.md5 || BookMetadata.bookIdentity(book) || '').trim().toLowerCase();
          const fullAuthors = String(book.authors || book.author || '').trim();
          const inLibrary = isLibraryBook(book);
          const canQueueFromTitle = isDesktopMode && options.routeOnly && !canOpen && isMd5(book.md5);
          const statusMarkup = options.library
            ? `<button type="button" class="library-delete" data-action="delete-library" aria-label="Delete ${escapeHtml(book.title || 'book')} from library" title="Delete from library"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button>`
            : isDesktopMode && options.routeOnly
              ? `<button type="button" class="chip-btn" data-action="queue-download" aria-label="Add ${escapeHtml(book.title || 'book')} to downloads" title="Download">+</button><button type="button" class="chip-btn" data-action="add-library" data-md5="${escapeHtml(book.md5)}" aria-label="${inLibrary ? 'Already in favorites' : 'Add to favorites'}" title="${inLibrary ? 'Already in favorites' : 'Add to favorites'}"${inLibrary ? ' disabled' : ''}>${inLibrary ? '♥' : '♡'}</button>`
            : `<button type="button" class="chip-btn" data-action="add-library" data-md5="${escapeHtml(book.md5)}" aria-label="${inLibrary ? 'Already in library' : 'Add to library'}" title="${inLibrary ? 'Already in library' : 'Add to library'}"${inLibrary ? ' disabled' : ''}>${inLibrary ? '✓' : '+'}</button>`;
          const row = document.createElement('article');
          row.className = 'book-table-row';
          row.setAttribute('role', 'row');
          if (options.library && book.md5) row.dataset.downloadBookId = String(book.md5).toLowerCase();
          row.innerHTML = `
            <span class="result-cover-slot" role="cell"><img class="result-cover-placeholder" src="${escapeHtml(coverPlaceholder)}" alt="">${coverUrl ? `<img class="result-cover" src="${escapeHtml(coverUrl)}" alt="" loading="lazy">` : ''}</span>
            <span class="result-cell" role="cell">${canOpen ? `<a class="result-title ${titleAvailabilityClass}" data-action="open" href="#read=${encodeURIComponent(readRouteValue(book, readUrl))}">${escapeHtml(book.title)}</a>` : canQueueFromTitle ? `<button type="button" class="result-title ${titleAvailabilityClass}" data-action="queue-download-title" aria-label="Download ${escapeHtml(book.title || 'book')}">${escapeHtml(book.title)}</button>` : `<span class="result-title ${titleAvailabilityClass}">${escapeHtml(book.title)}</span>`}${titleDetails ? `<small>${titleDetails}</small>` : ''}</span>
            <span class="result-cell" role="cell">${authorQuery ? `<a class="result-author" data-action="author-search" href="#search=${encodeURIComponent(authorQuery)}" title="${escapeHtml(fullAuthors)}" aria-label="${escapeHtml(fullAuthors)}">${escapeHtml(fullAuthors)}</a>` : `<span class="result-author" title="${escapeHtml(fullAuthors)}" aria-label="${escapeHtml(fullAuthors)}">${escapeHtml(fullAuthors)}</span>`}</span>
			<span class="result-cell result-rights" role="cell">${rightsMarkerMarkup(book)}</span>
			<span class="result-cell result-year" role="cell">${escapeHtml(book.year || '—')}</span>
            <span class="result-cell result-availability" role="cell"><span class="availability-primary${availabilityClass ? ` status-with-dot ${availabilityClass}` : ''}">${availabilityMarkup}</span></span>
            <span class="result-cell" role="cell">${escapeHtml(String(book.extension || book.format || '—').toLowerCase())}${Number(book.filesize) > 0 ? `<small>${escapeHtml(bytesLabel(book.filesize))}</small>` : ''}</span>
            <span class="result-cell" role="cell">${escapeHtml(languageCode ? languageCode.toUpperCase() : '—')}</span>
            <span class="row-actions home-book-status" role="cell">${statusMarkup}</span>
          `;
          row.querySelector('[data-action="open"]')?.addEventListener('click', (event) => {
            if (isDesktopMode && !options.library && options.routeOnly) {
              event.preventDefault();
              void queueSearchDownload(book);
              return;
            }
            if (options.routeOnly) return;
            event.preventDefault();
            options.onOpen?.(book);
          });
          CoverAssets.attachImageFallback(row.querySelector<HTMLImageElement>('.result-cover'), realCoverUrls, { key: coverKey });
          const coverSlot = row.querySelector<HTMLElement>('.result-cover-slot');
          coverSlot?.addEventListener('mouseenter', () => void lookupCoverOnHover(book, coverSlot));
          row.querySelector('[data-action="author-search"]')?.addEventListener('click', (event) => {
            event.preventDefault();
            searchForAuthor(book);
          });
          row.querySelector('[data-action="add-library"]')?.addEventListener('click', (event) => {
            addBookToLibrary(book, event.currentTarget as HTMLButtonElement);
          });
          row.querySelector('[data-action="queue-download"]')?.addEventListener('click', () => {
            void queueSearchDownload(book);
          });
          row.querySelector('[data-action="queue-download-title"]')?.addEventListener('click', () => {
            void queueSearchDownload(book);
          });
          if (isDesktopMode && options.library && isBookReadableNow(book)) {
            const job = desktopDownloadForBook(book);
            if (job && BookstrDesktopKindle.transferableDownloads([job]).length) {
              const send = document.createElement('button');
              send.type = 'button';
              send.className = 'chip-btn';
              send.dataset.kindleBookId = job.bookId;
              updateKindleLibraryButton(send);
              send.dataset.action = 'send-kindle';
              send.setAttribute('aria-label', `Send ${book.title || 'book'} to Kindle`);
              send.addEventListener('click', () => void sendLibraryBookToKindle(book, send));
              row.querySelector('.row-actions')!.append(send);
            }
          }
          row.querySelector('[data-action="delete-library"]')?.addEventListener('click', () => {
            void deleteLibraryBook(book);
          });
          table.appendChild(row);
        }
        target.appendChild(table);
      }

      function resultLanguage(book: PageBook) {
        return String(BookMetadata.languageForBook(book) || '').toLowerCase();
      }

      function resultFormat(book: PageBook) {
        return String(book.extension || book.format || '').replace(/^\./, '').toLowerCase();
      }

      function exactSearchTokens(value: unknown) {
        return String(value || '').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
      }

      function matchesExactSearchTokens(book: PageBook, query: unknown, type = 'all') {
        const fields: Record<string, unknown> = {
          title: book.title,
          author: book.authors || book.author,
          publisher: book.publisher,
          isbn: book.isbn,
        };
        const selected = type === 'all' ? Object.values(fields) : [fields[type]];
        const available = new Set(exactSearchTokens(selected.filter(Boolean).join(' ')));
        return exactSearchTokens(query).every(term => available.has(term));
      }

      function configureSearchResultFilter(select: HTMLSelectElement, wrap: HTMLElement, values: string[], allLabel: string, selected: string, labelForValue = (value: string) => value.toUpperCase()) {
        const visible = values.length > 1;
        wrap.classList.toggle('hidden', !visible);
        if (!visible) return '';
        select.replaceChildren();
        for (const [value, label] of [['', allLabel], ...values.map(value => [value, labelForValue(value)])] as Array<[string,string]>) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          select.appendChild(option);
        }
        select.value = values.includes(selected) ? selected : '';
        return select.value;
      }

      function filteredSearchResultBooks() {
        return searchResultBooks.filter(book => (
          (!searchResultFilter.language || resultLanguage(book) === searchResultFilter.language)
          && (!searchResultFilter.format || resultFormat(book) === searchResultFilter.format)
        ));
      }

      function renderResults(books: PageBook[], { preserveResults = false, routeState = null }: {preserveResults?:boolean;routeState?:{language?:string;format?:string;page?:number} | null} = {}) {
        if (!preserveResults) {
          contentSearchBooks = [];
          searchResultBooks = books.slice();
          searchResultFilter.language = routeState?.language || '';
          searchResultFilter.format = routeState?.format || '';
          searchResultPage = Math.max(1, Number(routeState?.page) || 1);
        }
        const languages = [...new Set(searchResultBooks.map(resultLanguage).filter(Boolean))].sort();
        const formats = [...new Set(searchResultBooks.map(resultFormat).filter(Boolean))].sort();
        searchResultFilter.language = configureSearchResultFilter(
          searchLanguageFilter, searchLanguageFilterWrap, languages, 'All languages', searchResultFilter.language,
          value => isDesktopMode ? BookMetadata.languageLabel(value)! : value.toUpperCase()
        );
        searchResultFilter.format = configureSearchResultFilter(
          searchFormatFilter, searchFormatFilterWrap, formats, 'All formats', searchResultFilter.format
        );
        searchResultFilters.classList.toggle('hidden', languages.length <= 1 && formats.length <= 1);
        const filteredBooks = filteredSearchResultBooks();
        const sortedBooks = searchResultSort.key
          ? BookMetadata.sortBooks(
            filteredBooks, searchResultSort.key, searchResultSort.direction,
            book => cachedBookKeys.has(bookCacheKey(book, (book.readUrl || book.url) as string | undefined))
          )
          : rankSearchResults(filteredBooks);
        const totalPages = Math.max(1, Math.ceil(sortedBooks.length / SEARCH_RESULT_PAGE_SIZE));
        searchResultPage = Math.min(Math.max(1, searchResultPage), totalPages);
        const start = (searchResultPage - 1) * SEARCH_RESULT_PAGE_SIZE;
        const pageBooks = sortedBooks.slice(start, start + SEARCH_RESULT_PAGE_SIZE);
        searchPagination.classList.toggle('hidden', totalPages <= 1);
        searchPagePrev.disabled = searchResultPage <= 1;
        searchPageNext.disabled = searchResultPage >= totalPages;
        searchPagePrev.dataset.page = String(Math.max(1, searchResultPage - 1));
        searchPageNext.dataset.page = String(Math.min(totalPages, searchResultPage + 1));
        searchPageLabel.textContent = `Page ${searchResultPage} of ${totalPages} · ${sortedBooks.length} results`;
        searchResultCount.textContent = sortedBooks.length === searchResultBooks.length
          ? `${sortedBooks.length} result${sortedBooks.length === 1 ? '' : 's'}`
          : `${sortedBooks.length} of ${searchResultBooks.length} results`;
        renderBookTable(resultsEl, pageBooks, {
          sort: searchResultSort,
          label: 'Book search results',
          routeOnly: true,
          onSort: (key: string, direction: string) => {
            searchResultSort.key = key;
            searchResultSort.direction = direction;
            searchResultPage = 1;
            renderResults(searchResultBooks, { preserveResults: true });
          },
        });
        return { shown: pageBooks.length, total: sortedBooks.length, page: searchResultPage, totalPages };
      }

      function renderPassageResults(payload: Parameters<typeof PassageResults.normalizePassageHits>[0]) {
        const entries = PassageResults.normalizePassageHits(payload).map(entry => {
          const normalized = entry.book
            ? normalizeSearchBooks({ books: [entry.book] }, 'private-search')[0]
            : null;
          const book = normalized ? enrichedHomeBooks([normalized])[0] : null;
          return { ...entry, book, canOpen: Boolean(book && isBookReadableNow(book)) };
        });
        contentSearchBooks = entries.map(entry => entry.book).filter(Boolean) as PageBook[];
        searchResultBooks = [];
        searchResultFilter.language = '';
        searchResultFilter.format = '';
        searchResultFilters.classList.add('hidden');
        searchPagination.classList.add('hidden');
        searchResultCount.textContent = `${entries.length} passage${entries.length === 1 ? '' : 's'}`;
        resultsEl.innerHTML = PassageResults.passageResultsMarkup(entries);
        resultsEl.querySelectorAll<HTMLButtonElement>('[data-passage-open]').forEach(button => {
          button.addEventListener('click', () => {
            const entry = entries[Number(button.dataset.passageOpen)];
            if (entry?.book) void openBook(entry.book);
          });
        });
        return entries;
      }

      function isLibraryBook(book: PageBook) {
        return state.favorites.some(item => BookMetadata.sameLibraryBook(item, book))
          || state.reading.some(item => BookMetadata.sameLibraryBook(item, book));
      }

      function addBookToLibrary(book: PageBook, button: HTMLButtonElement | null | undefined, { sync = true, render = true } = {}) {
        if (!book.md5) {
          status.textContent = 'This result cannot be added to the library (missing identifier).';
          return false;
        }
        const exists = state.favorites.some(item => BookMetadata.sameLibraryBook(item, book));
        if (exists) {
          if (button) {
            button.textContent = isDesktopMode && button.closest('#results') ? '♥' : '✓';
            button.disabled = true;
            button.setAttribute('aria-label', isDesktopMode && button.closest('#results') ? 'Already in favorites' : 'Already in library');
            button.title = button.getAttribute('aria-label')!;
          }
          return false;
        }
        upsertById(state.favorites, {
          md5: book.md5,
          title: book.title,
          authors: book.authors,
          year: book.year || '',
          language: book.language || '',
          source: book.source || '',
          extension: book.extension || 'epub',
          sha256: book.sha256 || '',
          readUrl: book.readUrl || book.url || '',
		  ...BookMetadata.normalizeRights(book),
          favoriteAddedAt: Math.floor(Date.now() / 1000)
        });
        state.favorites = sortByUpdatedAt(BookMetadata.dedupeLibraryBooks(state.favorites));
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites));
        if (button) {
          button.textContent = isDesktopMode && button.closest('#results') ? '♥' : '✓';
          button.disabled = true;
          button.setAttribute('aria-label', isDesktopMode && button.closest('#results') ? 'Already in favorites' : 'Already in library');
          button.title = button.getAttribute('aria-label')!;
        }
        if (render) {
          renderFavorites();
          renderButtonsState();
          renderHome();
        }
        if (sync && state.settings.useNip7 && nostrSigner?.signEvent) queueFavoriteSync();
        return true;
      }

      function renderButtonsState() {
        const rows = Array.from(resultsEl.querySelectorAll<HTMLButtonElement>('[data-action="add-library"]'));
        for (const btn of rows) {
          const md5 = btn.getAttribute('data-md5') || '';
          const inLibrary = state.favorites.some(item => String(item?.md5 || '') === md5)
            || state.reading.some(item => String(item?.md5 || '') === md5);
          btn.textContent = isDesktopMode ? (inLibrary ? '♥' : '♡') : (inLibrary ? '✓' : '+');
          btn.disabled = inLibrary;
          btn.setAttribute('aria-label', isDesktopMode ? (inLibrary ? 'Already in favorites' : 'Add to favorites') : (inLibrary ? 'Already in library' : 'Add to library'));
          btn.title = btn.getAttribute('aria-label')!;
        }
      }

      function updateKindleLibraryButton(button: HTMLButtonElement) {
        const bookId = button.dataset.kindleBookId!;
        button.hidden = !currentKindleId;
        const sending = kindleTransferRunning && kindleLibraryBookId === bookId;
        button.textContent = sending ? 'Sending…' : kindleLibraryPresence.has(currentKindleId, bookId) ? 'On Kindle' : kindleLibraryPresence.failed(currentKindleId, bookId) ? 'Retry' : 'Send to Kindle';
        button.disabled = sending;
        if (sending) {
          button.setAttribute('aria-busy', 'true');
          kindleLibraryButton = button;
        } else button.removeAttribute('aria-busy');
      }

      function refreshKindleLibraryButtons() {
        for (const button of homeReadingList.querySelectorAll<HTMLButtonElement>('[data-action="send-kindle"]')) updateKindleLibraryButton(button);
      }

      async function refreshKindlePresence() {
        const id = currentKindleId;
        if (!id || !desktopBridge?.kindle?.presence || kindlePresenceRequest?.id === id) return;
        const request = kindleLibraryPresence.begin(id);
        kindlePresenceRequest = request;
        try {
          const result = await desktopBridge!.kindle.presence(id);
          if (kindleLibraryPresence.apply(request, result.bookIds) && id === currentKindleId) refreshKindleLibraryButtons();
        } catch { /* Presence is a hint; a transfer still verifies device contents. */ }
        finally { if (kindlePresenceRequest === request) kindlePresenceRequest = null; }
      }

      function renderKindleTransferOverview() {
        const overview = kindleTransferOverview.snapshot()!;
        kindleTransferPanel.classList.remove('hidden');
        kindleTransferPanel.setAttribute('aria-busy', String(overview.running));
        kindleTransferStatus.textContent = overview.message;
        kindleTransferCount.textContent = overview.running ? `${overview.completed} / ${overview.total} copied` : '';
        kindleTransferProgress.max = overview.max;
        if (overview.determinate) kindleTransferProgress.value = overview.value;
        else kindleTransferProgress.removeAttribute('value');
        kindleTransferProgress.hidden = !overview.running;
        kindleTransferDismiss.disabled = overview.running;
        kindleTransferItems.replaceChildren(...overview.items.map(item => {
          const row = document.createElement('li');
          row.dataset.kindleTransferBookId = item.bookId;
          const title = document.createElement('strong');
          title.textContent = item.title;
          const status = document.createElement('small');
          status.textContent = item.status;
          row.append(title, status);
          return row;
        }));
      }

      async function sendLibraryBookToKindle(book: PageBook, button: HTMLButtonElement) {
        if (kindleTransferRunning) return;
        kindleTransferRunning = true;
        kindleLibraryButton = button;
        kindleLibraryBookId = button.dataset.kindleBookId || '';
        kindleTransferOverview.start([{ bookId: kindleLibraryBookId, title: book.title || 'Book' }]);
        renderKindleTransferOverview();
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.textContent = 'Sending…';
        desktopKindleOffer.classList.remove('hidden');
        desktopKindleSummary.textContent = `Sending ${book.title || 'book'}…`;
        let deviceId = currentKindleId;
        try {
          const job = desktopDownloadForBook(book);
          if (!job || !BookstrDesktopKindle.transferableDownloads([job]).length) {
            throw new Error('This book cannot be sent to Kindle.');
          }
          const devices = await desktopBridge!.kindle.devices();
          if (!devices.length) throw new Error('No Kindle connected.');
          deviceId = devices.some(device => device.id === currentKindleId) ? currentKindleId : devices[0]!.id;
          currentKindleId = deviceId;
          kindleLibraryBookId = job.bookId;
          const result = await desktopBridge!.kindle.transfer(deviceId, job.bookId);
          kindleTransferOverview.finish(result);
          renderKindleTransferOverview();
          if (result.transferred.length || result.alreadyPresent) kindleLibraryPresence.mark(deviceId, [job.bookId]);
          else kindleLibraryPresence.fail(deviceId, job.bookId);
          const message = result.transferred.length ? 'Copied to Kindle' :
            result.alreadyPresent ? 'Already on Kindle' :
            result.errors[0]?.error || 'Could not copy to Kindle';
          desktopKindleSummary.textContent = message;
          button.textContent = result.transferred.length || result.alreadyPresent ? 'On Kindle' : 'Retry';
          button.title = message;
          button.setAttribute('aria-description', message);
        } catch (error) {
          kindleLibraryPresence.fail(deviceId, kindleLibraryBookId);
          kindleTransferOverview.fail(error as {message?:string}|string);
          renderKindleTransferOverview();
          const message = (error as {message?:string}|null)?.message || String(error);
          desktopKindleSummary.textContent = message;
          button.textContent = 'Retry';
          button.title = message;
          button.setAttribute('aria-description', message);
        } finally {
          kindleTransferRunning = false;
          kindleLibraryButton = null;
          kindleLibraryBookId = '';
          refreshKindleLibraryButtons();
          button.disabled = false;
          button.removeAttribute('aria-busy');
        }
      }

      async function renderDesktopDownloads() {
        if (!isDesktopMode || !desktopBridge?.library?.downloads) return;
        const generation = ++desktopDownloadsRenderGeneration;
        const allJobs = await desktopBridge!.library.downloads();
        if (generation !== desktopDownloadsRenderGeneration) return;
        if (desktopDownloadEntryNeedsSnapshot) {
          desktopHiddenCompletedIds = new Set(allJobs.filter(job => ['ready', 'seeding'].includes(String(job.status).toLowerCase())).map(job => job.bookId));
          desktopDownloadEntryNeedsSnapshot = false;
        }
        const jobs = allJobs.filter(job =>
          !['ready', 'seeding'].includes(String(job.status).toLowerCase()) || !desktopHiddenCompletedIds.has(job.bookId));
        desktopDownloadsList.replaceChildren();
        if (!jobs.length && !desktopDownloadsNotice.textContent) {
          const empty = document.createElement('p');
          empty.textContent = 'No downloads yet.';
          desktopDownloadsList.append(empty);
        }
        for (const job of jobs) {
          const row = document.createElement('div');
          row.className = 'desktop-download-job';
          row.setAttribute('data-download-id', job.bookId);
          const title = document.createElement('strong');
          title.textContent = job.title || job.bookId;
          const state = document.createElement('small');
          const jobStatus = String(job.status || '').toLowerCase();
          const total = Math.max(0, Number(job.totalBytes) || 0);
          const received = Math.max(0, Number(job.bytes) || 0);
          state.textContent = jobStatus === 'failed' ? (job.error || 'Download failed')
            : jobStatus === 'queued' ? 'Queued'
              : jobStatus === 'finding-peers' ? 'Finding peers'
                : jobStatus === 'retrying' ? 'Retrying'
                  : jobStatus === 'downloading' ? (total > 0
                    ? `${bytesLabel(received)} of ${bytesLabel(total)} · ${Math.min(100, Math.round(received / total * 100))}%`
                    : `${bytesLabel(received)} downloaded`)
                    : ['ready', 'seeding'].includes(jobStatus) ? 'Ready to read' : job.status;
          row.append(title, state);
          if (total > 0 && ['queued', 'finding-peers', 'downloading', 'retrying'].includes(jobStatus)) {
            const progress = document.createElement('progress');
            progress.max = total;
            progress.value = Math.min(total, received);
            progress.setAttribute('aria-label', `Download progress for ${job.title || 'book'}`);
            row.append(progress);
          }
          const actions = document.createElement('div');
          actions.className = 'desktop-download-job-actions';
          if (['failed', 'stopped'].includes(jobStatus)) {
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.textContent = 'Retry';
            retry.setAttribute('aria-label', `Retry ${job.title || 'book'}`);
            retry.addEventListener('click', async () => {
              retry.disabled = true;
              try {
                if (job.source === 'catalog') await queueSearchDownload(bookFromDesktopDownload(job)!);
                else await desktopBridge!.library.retryDownload(job.bookId);
              }
              catch (error) { state.textContent = (error as {message?:string}|null)?.message || String(error); }
              await renderDesktopDownloads();
            });
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'icon-btn';
            remove.setAttribute('aria-label', `Delete ${job.title || 'book'} from Downloads`);
            remove.title = 'Delete download';
            remove.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';
            remove.addEventListener('click', async () => {
              remove.disabled = true;
              retry.disabled = true;
              try {
                await desktopBridge!.library.removeDownload(job.bookId);
                await refreshDesktopDownloadStates();
                await renderDesktopDownloads();
              } catch (error) {
                state.textContent = (error as {message?:string}|null)?.message || String(error);
                remove.disabled = false;
                retry.disabled = false;
              }
            });
            actions.append(retry, remove);
          }
          if (['ready', 'seeding'].includes(jobStatus)) {
            const read = document.createElement('button');
            read.type = 'button';
            read.textContent = 'Read';
            read.setAttribute('aria-label', `Read ${job.title || 'book'}`);
            read.addEventListener('click', async () => {
              await refreshDesktopDownloadStates();
              await openBook(bookFromDesktopDownload(job)!);
            });
            actions.append(read);
          }
          if (actions.childElementCount) row.append(actions);
          desktopDownloadsList.append(row);
        }
      }

      async function openDesktopDownloads() {
        if (!isDesktopMode) return;
        await refreshDesktopDownloadStates();
        activateTab('downloads', { updateHash: true });
        await renderDesktopDownloads();
      }

      async function queueSearchDownload(book: PageBook) {
        desktopDownloadsNotice.textContent = `Adding ${book.title || 'book'} to Downloads…`;
        let resolvingCatalog = false;
        try {
          await openDesktopDownloads();
          let resolved: PageBook | null = book;
          let edition = BookMetadata.libgenTorrentMetadataForBook(resolved);
          if (!edition && isMd5(book.md5)) {
            resolvingCatalog = true;
            resolved = await resolvePrivateTorrentBook(book);
            if (!resolved) throw new Error('No downloadable edition matched this book.');
            edition = BookMetadata.libgenTorrentMetadataForBook(resolved);
          }
          let queuedDownload;
          if (edition) {
            queuedDownload = await desktopBridge!.library.enqueue({ kind: 'libgen', record: {
              ...resolved, md5: edition.md5, libgenId: edition.libgenId,
            } });
          } else {
            const provider = String(book.source || '').toLowerCase();
            const recordId = String(book.sourceNativeId || book.md5 || '').replace(/^[^:]+:/, '');
            queuedDownload = await desktopBridge!.library.enqueue({ kind: 'provider', record: {
              provider, recordId, title: book.title, authors: book.authors,
              languages: [book.language].flat().filter(Boolean), year: book.year, isbn: book.isbn,
              ...BookMetadata.normalizeRights(book),
              acquisitions: [{ format: book.extension, url: book.sourceFileUrl || book.readUrl, sha256: book.sha256,
                size: book.filesize, availability: 'open' }],
            } });
          }
          if (queuedDownload?.bookId) desktopHiddenCompletedIds.delete(queuedDownload.bookId);
          desktopDownloadsNotice.textContent = '';
          await refreshDesktopDownloadStates();
          await renderDesktopDownloads();
        } catch (error) {
          if (resolvingCatalog) {
            try {
              await desktopBridge!.library.enqueue({ kind: 'catalog', record: {
                ...book, resolutionError: (error as {message?:string}|null)?.message || String(error),
              } });
              await refreshDesktopDownloadStates();
              await renderDesktopDownloads();
            } catch { /* Keep the original lookup error visible if admission also fails. */ }
          }
          desktopDownloadsNotice.textContent = (error as {message?:string}|null)?.message || String(error);
          status.textContent = desktopDownloadsNotice.textContent;
        }
      }

      desktopDownloadsButton.addEventListener('click', () => void openDesktopDownloads());
      desktopBridge?.library?.onDownloadsChanged?.(() => {
        void refreshDesktopDownloadStates();
        if (activeTab === 'downloads') void renderDesktopDownloads();
      });

      async function refreshKindleOffer() {
        if (!isDesktopMode || kindleTransferRunning || !desktopBridge?.kindle) return;
        if (kindleOfferRefreshing) { kindleOfferQueued = true; return; }
        kindleOfferRefreshing = true;
        try {
          const devices = await desktopBridge!.kindle.devices();
          kindleLibraryPresence.retain(devices.map(device => device.id));
          deviceKindleList.replaceChildren();
          if (!devices.length) {
            deviceKindleList.textContent = 'No Kindle connected.';
          }
          for (const device of devices) {
            const row = document.createElement('div');
            row.className = 'device-transfer-device';
            const name = document.createElement('strong');
            name.textContent = device.name;
            const select = document.createElement('button');
            select.type = 'button';
            select.textContent = 'Select';
            select.setAttribute('aria-label', `Select ${device.name}`);
            select.addEventListener('click', () => {
              currentKindleId = device.id;
              void refreshKindleOffer();
            });
            row.append(name, select);
            deviceKindleList.append(row);
          }
          desktopKindleOffer.classList.toggle('hidden', devices.length === 0);
          if (!devices.length) { currentKindleId = ''; refreshKindleLibraryButtons(); return; }
          if (!devices.some(device => device.id === currentKindleId)) currentKindleId = devices[0]!.id;
          desktopKindleDevice.replaceChildren(...devices.map(device => new Option(device.name, device.id)));
          desktopKindleDevice.value = currentKindleId;
          refreshKindleLibraryButtons();
          void refreshKindlePresence();
          desktopKindleDevice.classList.toggle('hidden', devices.length < 2);
          const jobs = BookstrDesktopKindle.transferableDownloads(await desktopBridge!.library.downloads());
          desktopKindleSummary.textContent = `${devices.find(device => device.id === currentKindleId)!.name} · ${jobs.length} downloaded books`;
          desktopKindleTransfer.disabled = jobs.length === 0;
        } catch (error) {
          desktopKindleSummary.textContent = (error as {message?:string}|null)?.message || String(error);
          desktopKindleTransfer.disabled = true;
        } finally {
          kindleOfferRefreshing = false;
          if (kindleOfferQueued) {
            kindleOfferQueued = false;
            void refreshKindleOffer();
          }
        }
      }

      desktopKindleDevice.addEventListener('change', () => {
        currentKindleId = desktopKindleDevice.value;
        void refreshKindleOffer();
      });
      function renderKindleSelection() {
        const query = kindleSelectionFilter.value.trim().toLowerCase();
        const visible = kindleSelectionJobs.filter(job => `${job.title || ''} ${job.authors || ''}`.toLowerCase().includes(query));
        kindleSelectionList.replaceChildren();
        for (const job of visible) {
          const label = document.createElement('label');
          label.style.display = 'block';
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.dataset.bookId = job.bookId;
          input.setAttribute('aria-label', `Transfer ${job.title || job.bookId}`);
          input.checked = kindleSelectedBooks.has(job.bookId);
          input.addEventListener('change', () => {
            if (input.checked) kindleSelectedBooks.add(job.bookId);
            else kindleSelectedBooks.delete(job.bookId);
            renderKindleSelection();
          });
          label.append(input, document.createTextNode(` ${job.title || job.bookId}`));
          kindleSelectionList.append(label);
        }
        kindleSelectVisible.checked = visible.length > 0 && visible.every(job => kindleSelectedBooks.has(job.bookId));
        kindleSelectionSend.disabled = kindleSelectedBooks.size === 0;
        kindleSelectionSend.textContent = `Transfer selected books (${kindleSelectedBooks.size})`;
      }
      kindleSelectionFilter.addEventListener('input', renderKindleSelection);
      kindleSelectVisible.addEventListener('change', () => {
        const query = kindleSelectionFilter.value.trim().toLowerCase();
        for (const job of kindleSelectionJobs.filter(job => `${job.title || ''} ${job.authors || ''}`.toLowerCase().includes(query))) {
          if (kindleSelectVisible.checked) kindleSelectedBooks.add(job.bookId);
          else kindleSelectedBooks.delete(job.bookId);
        }
        renderKindleSelection();
      });
      (document.getElementById('desktop-kindle-selection-close') as PageElements['desktop-kindle-selection-close']).addEventListener('click', () => kindleSelectionDialog.close());
      desktopKindleTransfer.addEventListener('click', async () => {
        if (!currentKindleId || kindleTransferRunning) return;
        kindleSelectionJobs = BookstrDesktopKindle.transferableDownloads(await desktopBridge!.library.downloads());
        kindleSelectedBooks.clear();
        kindleSelectionFilter.value = '';
        renderKindleSelection();
        kindleSelectionDialog.showModal();
      });
      kindleSelectionSend.addEventListener('click', async () => {
        if (!currentKindleId || kindleTransferRunning) return;
        const bookIds = [...kindleSelectedBooks];
        if (!bookIds.length) return;
        kindleSelectionDialog.close();
        kindleTransferRunning = true;
        desktopKindleTransfer.disabled = true;
        kindleTransferOverview.start(kindleSelectionJobs.filter(job => kindleSelectedBooks.has(job.bookId)));
        renderKindleTransferOverview();
        try {
          const deviceId = currentKindleId;
          const result = await desktopBridge!.kindle.transfer(deviceId, bookIds);
          kindleTransferOverview.finish(result);
          renderKindleTransferOverview();
          kindleLibraryPresence.mark(deviceId, result.transferred);
          refreshKindleLibraryButtons();
          void refreshKindlePresence();
          desktopKindleSummary.textContent = `${result.transferred.length} copied · ${result.alreadyPresent} already there · ${result.skipped.length} skipped · ${result.errors.length} failed`;
        } catch (error) {
          kindleTransferOverview.fail(error as {message?:string}|string);
          renderKindleTransferOverview();
          desktopKindleSummary.textContent = (error as {message?:string}|null)?.message || String(error);
        } finally {
          kindleTransferRunning = false;
          // Leave the result visible; the next passive poll updates devices.
        }
      });
      function renderKindleProgress(progress: import('./desktop-kindle.js').KindleTransferProgress) {
        if (progress.done || !kindleTransferRunning) return;
        kindleTransferOverview.update(progress);
        renderKindleTransferOverview();
        const message = BookstrDesktopKindle.progressText(progress);
        desktopKindleSummary.textContent = message;
        if (kindleLibraryButton) kindleLibraryButton.title = message;
      }
      export type DesktopPageApi = {renderPassageResults: typeof renderPassageResults};
      desktopBridge?.kindle?.onProgress?.(renderKindleProgress);
      if (isDesktopMode) {
        void refreshKindleOffer();
        window.setInterval(() => void refreshKindleOffer(), 10000);
      }

      function setHashRoute(route: string | null | undefined): void {
        const nextHash = route ? `#${route}` : '';
        if (window.location.hash === nextHash) return;
        history.pushState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`);
      }

      function homeHashRoute(): string {
        const params = new URLSearchParams();
        if (homeLibraryFilter.language) params.set('language', homeLibraryFilter.language);
        if (homeLibraryFilter.format) params.set('format', homeLibraryFilter.format);
        const query = params.toString();
        return query ? `home?${query}` : 'home';
      }

      function replaceHomeHash(): void {
        if (activeTab !== 'home') return;
        history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${homeHashRoute()}`);
      }

      function searchHashRoute({
        query = queryInput.value.trim(),
        type = searchType.value || 'all',
        language = searchResultFilter.language,
        format = searchResultFilter.format,
        page = searchResultPage,
      }: { query?: string; type?: string; language?: string; format?: string; page?: number } = {}): string {
        const params = new URLSearchParams();
        params.set('search', query);
        if (type !== 'all') params.set('type', type);
        if (language) params.set('language', language);
        if (format) params.set('format', format);
        if (page > 1) params.set('page', String(page));
        return params.toString();
      }

      function replaceSearchHash(): void {
        const nextHash = `#${searchHashRoute()}`;
        history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`);
      }

      function readRouteValue(book: PageBook, readUrl = ''): string {
        const md5 = String(book?.md5 || '').toLowerCase();
        if (isMd5(md5)) return md5;
        const direct = readUrl || BookMetadata.canonicalReadUrl(book, BOOKS_API_BASE);
        return direct || `book:${BookMetadata.bookIdentity(book)}`;
      }

      async function resolveReadRouteBook(readUrl: string): Promise<PageBook> {
        const routeReference = String(readUrl || '');
        const bookId = routeReference.toLowerCase();
        if (bookId.startsWith('book:')) {
          const identity = routeReference.slice(5);
          const savedBooks = BookMetadata.mergeLibraryState(state.reading, state.favorites);
          const metadataBooks = Object.values(metadataCacheRead()).map(entry => entry?.book).filter((book): book is PageBook => Boolean(book));
          const known = [...searchResultBooks, ...savedBooks, ...metadataBooks]
            .find(book => BookMetadata.bookIdentity(book) === identity);
          if (known) return known;
          try {
            const cached = (await bookCacheRecords()).find(book => BookMetadata.bookIdentity(book) === identity);
            if (cached) return cached;
          } catch {}
          return { title: 'Book metadata unavailable', routeIdentity: identity };
        }
        if (isMd5(bookId)) {
          const searchBook = searchResultBooks.find(book => String(book?.md5 || '').toLowerCase() === bookId);
          if (searchBook) return searchBook;
          const contentBook = contentSearchBooks.find(book => String(book?.md5 || '').toLowerCase() === bookId);
          if (contentBook) return contentBook;
          const saved = BookMetadata.mergeLibraryState(state.reading, state.favorites)
            .find(book => String(book?.md5 || '').toLowerCase() === bookId);
          if (saved) return saved;
          try {
            const cached = (await bookCacheRecords()).find(book =>
              String(book?.md5 || '').toLowerCase() === bookId
              || String(book?.key || '').toLowerCase() === bookId
              || String(book?.key || '').toLowerCase().includes(bookId)
              || String(book?.readUrl || '').toLowerCase().includes(bookId)
            );
            if (cached) return { ...cached, md5: bookId, extension: cached.extension || 'epub' };
          } catch {}
          const cachedMetadata = Object.values(metadataCacheRead())
            .map(entry => entry?.book)
            .find(book => String(book?.md5 || '').toLowerCase() === bookId);
          if (cachedMetadata) return { ...cachedMetadata, md5: bookId };
          return { md5: bookId, title: 'Untitled book', extension: 'epub' };
        }
        const searchBook = BookMetadata.findBookByReadUrl(readUrl, searchResultBooks);
        if (searchBook) return searchBook;
        const saved = BookMetadata.findBookByReadUrl(readUrl, state.reading, state.favorites);
        if (saved) return saved;
        try {
          const cached = BookMetadata.findBookByReadUrl(readUrl, await bookCacheRecords());
          if (cached?.title && !BookMetadata.isPlaceholderTitle(cached.title)) {
            return { ...cached, md5: String(cached.key || ''), extension: 'epub', readUrl };
          }
        } catch {}
        const metadataUrl = BookMetadata.metadataEndpointForReadUrl(readUrl);
        if (metadataUrl) {
          try {
            const response = await fetch(metadataUrl);
            if (response.ok) {
              const payload = await response.json();
              const metadata = payload?.book || payload?.data || payload;
              const id = readUrl.match(/\/api\/books\/(\d+)\/download/)?.[1] || readUrl;
              return {
                md5: `gutenberg:${id}`,
                title: BookMetadata.resolveTitle(metadata, readUrl, window.location.href),
                authors: Array.isArray(metadata?.authors)
                  ? metadata.authors.join(', ')
                  : String(metadata?.author || metadata?.authors || ''),
                year: BookMetadata.yearForBook(metadata),
                language: BookMetadata.languageForBook(metadata),
                extension: 'epub',
				...BookMetadata.normalizeRights(metadata),
                readUrl,
              };
            }
          } catch {}
        }
        return { title: 'Untitled book', readUrl, extension: 'epub' };
      }

      function showReadMetadataFallback(book: PageBook): void {
        if (isDesktopMode && !isBookReadableNow(book)) {
          void openDesktopDownloads();
          return;
        }
        const frame = (document.getElementById('reader-frame') as PageElements['reader-frame']);
        if (!frame?.parentElement) return;
        frame.parentElement.classList.add('metadata-fallback-visible');
        let panel = (document.getElementById('read-metadata-fallback') as PageElements['read-metadata-fallback']);
        if (!panel) {
          panel = document.createElement('article');
          panel.id = 'read-metadata-fallback';
          frame.parentElement.insertBefore(panel, frame);
        }
        panel.replaceChildren();
        if (isDesktopMode) {
          const label = document.createElement('p');
          label.textContent = ['cbz', 'cbr'].includes(resultFormat(book)) ? 'Opening comic…' : 'Opening book…';
          const progress = document.createElement('progress');
          progress.id = 'read-comic-opening-progress';
          progress.setAttribute('aria-label', label.textContent);
          panel.append(label, progress);
          panel.hidden = false;
          panel.style.display = 'grid';
          frame.hidden = false;
          frame.classList.add('reader-pending');
          return;
        }
        const coverCandidates = bookCoverUrls(book).filter(url => url && !url.startsWith('data:image/'));
        const coverUrl = coverCandidates[0] || '';
        panel.style.gridTemplateColumns = coverUrl ? 'minmax(0,9rem) minmax(0,1fr)' : 'minmax(0,1fr)';
        if (coverUrl) {
          const cover = document.createElement('img');
          cover.src = coverUrl;
          cover.alt = '';
          cover.className = 'read-metadata-cover';
          panel.append(cover);
          CoverAssets.attachImageFallback(cover, coverCandidates, {
            key: String(book?.md5 || BookMetadata.bookIdentity(book) || '').trim().toLowerCase(),
          });
        }
        const details = document.createElement('div');
        details.className = 'read-metadata-details';
        const title = document.createElement('h1');
        title.className = 'read-metadata-title';
        title.textContent = book.title || 'Book';
        details.append(title);
        const metadata = document.createElement('dl');
        metadata.className = 'read-metadata-grid';
        const digest = String(book.md5 || book.sha256 || '').trim();
        const catalogUrl = BookMetadata.canonicalCatalogUrl(book);
        const digestLabel = /^[a-f0-9]{64}$/i.test(digest)
          ? 'SHA-256'
          : /^[a-f0-9]{32}$/i.test(digest)
            ? 'MD5'
            : /^openlibrary:/i.test(digest)
              ? 'Open Library'
              : 'Catalog ID';
        const metadataRows: [string, unknown][] = [
          ['Author', book.author || book.authors],
          ['Published', book.year],
          ['Language', book.language],
          ['Format', book.extension || book.format],
          ['Publisher', book.publisher],
          [digestLabel, digest],
        ];
        for (const [label, value] of metadataRows) {
          if (!value || value === '--') continue;
          const term = document.createElement('dt');
          term.textContent = label;
          const description = document.createElement('dd');
          if (label === 'Author' && authorSearchName(value)) {
            const link = document.createElement('a');
            link.href = `#search=${encodeURIComponent(authorSearchName(value))}`;
            link.textContent = String(value);
            link.addEventListener('click', event => {
              event.preventDefault();
              searchForAuthor(book);
            });
            description.append(link);
          } else if (label === 'Open Library' && catalogUrl) {
            const link = document.createElement('a');
            link.href = catalogUrl;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = String(value).replace(/^openlibrary:/i, '');
            description.append(link);
          } else {
            description.textContent = String(value);
          }
          if (['MD5', 'SHA-256', 'Open Library', 'Catalog ID'].includes(String(label))) description.className = 'metadata-digest';
          if (label === 'Author') {
            description.classList.add('metadata-authors');
            description.title = String(value);
          }
          metadata.append(term, description);
        }
		const rights = BookMetadata.normalizeRights(book);
		const rightsTerm = document.createElement('dt');
		rightsTerm.textContent = 'Rights';
		const rightsRow = document.createElement('dd');
		const rightsText = BookMetadata.rightsAccessibleLabel(book);
		if (rights.license_url) {
		  const link = document.createElement('a');
		  link.href = rights.license_url;
		  link.target = '_blank';
		  link.rel = 'noopener noreferrer';
		  link.textContent = rightsText;
		  rightsRow.append(link);
		} else {
		  rightsRow.append(document.createTextNode(rightsText));
		}
		if (rights.rights_source) {
          const source = document.createElement('span');
          source.className = 'read-metadata-source';
          const sourceLabels: Record<string, string> = { epub_opf: 'EPUB metadata', epub_content: 'EPUB content', metadata: 'Embedded metadata' };
          source.textContent = ` · ${sourceLabels[rights.rights_source] || String(rights.rights_source).replaceAll('_', ' ')}`;
          rightsRow.append(source);
        }
		metadata.append(rightsTerm, rightsRow);
        details.append(metadata);
        const torrent = document.createElement('p');
        torrent.id = 'read-metadata-fallback-torrent';
        details.append(torrent);
        const note = document.createElement('div');
        note.id = 'read-metadata-fallback-status';
        note.setAttribute('role', 'status');
        details.append(note);
        if (['cbz', 'cbr'].includes(String(book.extension || book.format || '').toLowerCase())) {
          const progress = document.createElement('progress');
          progress.id = 'read-comic-opening-progress';
          progress.setAttribute('aria-label', 'Opening comic');
          details.append(progress);
        }
        panel.append(details);
        panel.hidden = false;
        panel.style.display = 'grid';
        updateReadTorrentStatus(book);
        updateReadMetadataFallbackDiagnostics(book, {
          readPath: BookMetadata.canonicalReadUrl(book, BOOKS_API_BASE),
          cacheStatus: 'Checking local cache…',
        });
        // Keep the previous reader out of view while the requested book is
        // being resolved. Only the successful display path may reveal it.
        frame.hidden = false;
        frame.classList.add('reader-pending');
      }

      function revealReadableBook(book: PageBook, openGeneration: number): boolean {
        if (openGeneration !== readerOpenGeneration || !BookMetadata.sameLibraryBook(activeReadingBook as PageBook, book)) return false;
        const panel = (document.getElementById('read-metadata-fallback') as PageElements['read-metadata-fallback']);
        if (panel) {
          panel.hidden = true;
          panel.style.display = 'none';
        }
        readerFrame.hidden = false;
        readerFrame.classList.remove('reader-pending');
        readerFrame.parentElement?.classList.remove('metadata-fallback-visible');
        return true;
      }

      function friendlyBookLoadError(error: unknown): string {
        const message = String((error as Error)?.message || error || '').trim();
        if (!message) return '';
        if (/duplicate torrent|already active/i.test(message)) return 'The torrent is already active. Bookstr will keep checking its progress.';
        if (/absent from the repository/i.test(message)) return 'This edition was not found in the catalog torrent.';
        if (/connect your nostr signer/i.test(message)) return 'Connect your Nostr signer in Settings so Bookstr can look up this torrent.';
        if (/public torrent catalog could not be reached/i.test(message)) return 'The public torrent catalogue could not be reached.';
        if (/no compatible public torrent edition/i.test(message)) return 'No compatible public torrent edition was found.';
        if (/no readable download or torrent/i.test(message)) return 'No downloadable or torrent copy is currently available.';
        return 'Bookstr could not prepare a readable copy yet.';
      }

      function updateReadMetadataFallbackDiagnostics(book: PageBook, { cacheStatus = '', error = '', attempts = [] }: ReaderDiagnostics = {}): void {
        const note = (document.getElementById('read-metadata-fallback-status') as PageElements['read-metadata-fallback-status']);
        if (!note) return;
        const torrent = torrentStatusForBook(book);
        let title = 'This book is not stored locally';
        let copy = friendlyBookLoadError(error) || 'Bookstr is checking for a readable copy.';
        if (/^Downloading\b/i.test(torrent)) {
          title = 'Downloading this book';
          copy = 'It will open automatically when the file is ready.';
        } else if (/^Finding peers\b/i.test(torrent)) {
          title = 'Finding torrent peers';
          copy = 'Bookstr will start downloading as soon as a peer responds.';
        } else if (/^Available\b/i.test(torrent)) {
          title = 'Available from the torrent library';
          copy = isDesktopMode ? 'Add this book to Downloads to start it.' : 'Open the book to start downloading it.';
        }
        note.dataset.cacheStatus = cacheStatus;
        note.dataset.error = String((error as Error)?.message || error || '');
        note.dataset.attempts = JSON.stringify(Array.isArray(attempts) ? attempts : []);
        note.replaceChildren();
        const heading = document.createElement('strong');
        heading.className = 'read-file-state-title';
        heading.textContent = title;
        const description = document.createElement('span');
        description.className = 'read-file-state-copy';
        description.textContent = copy;
        note.append(heading, description);
        if (isDesktopMode && /^Available\b/i.test(torrent)) {
          const addDownload = document.createElement('button');
          addDownload.type = 'button';
          addDownload.textContent = 'Add to Downloads';
          addDownload.setAttribute('aria-label', `Add ${book.title || 'book'} to downloads`);
          addDownload.addEventListener('click', () => void queueSearchDownload(book));
          note.append(addDownload);
        }
        if (attempts.length) {
          const attemptsTitle = document.createElement('small');
          attemptsTitle.className = 'read-file-attempts-title';
          attemptsTitle.textContent = 'What Libstr tried';
          const list = document.createElement('ul');
          list.className = 'read-file-attempts';
          list.setAttribute('aria-label', 'What Libstr tried');
          for (const attempt of attempts) {
            const item = document.createElement('li');
            item.dataset.state = String(attempt?.state || 'skipped');
            const text = document.createElement('span');
            const label = document.createElement('strong');
            label.textContent = `${String(attempt?.label || 'Check')}: `;
            text.append(label, document.createTextNode(String(attempt?.detail || 'No result.')));
            item.append(text);
            list.append(item);
          }
          note.append(attemptsTitle, list);
        }
      }

      let readRouteGeneration = 0;

      async function openResolvedReadRoute(bookRef: string): Promise<void> {
        const routeGeneration = ++readRouteGeneration;
        let book = await resolveReadRouteBook(bookRef);
        if (routeGeneration !== readRouteGeneration) return;
        // Invalidate any pending reveal from the previously selected book,
        // including routes that finish as metadata-only and never call openBook.
        readerOpenGeneration += 1;
        activeReadingBook = book;
        activateTab('reading');
        showReadMetadataFallback(book);
        const readPath = BookMetadata.canonicalReadUrl(book, BOOKS_API_BASE);
        let cacheError: unknown = null;
        const attempts: ReadAttempt[] = [];
        const setAttempt = (attempt: ReadAttempt) => {
          const index = attempts.findIndex(item => item.label === attempt.label);
          if (index >= 0) attempts[index] = attempt;
          else attempts.push(attempt);
          const fallbackNote = (document.getElementById('read-metadata-fallback-status') as PageElements['read-metadata-fallback-status']);
          updateReadMetadataFallbackDiagnostics(book, {
            cacheStatus: fallbackNote?.dataset.cacheStatus || '',
            error: cacheError,
            attempts,
          });
        };
        const cached = await cachedBookBlob(book, readPath).catch(error => {
          cacheError = error;
          return null;
        });
        updateReadMetadataFallbackDiagnostics(book, {
          readPath,
          cacheStatus: cached ? 'Found a local cached copy' : 'No local cached copy found',
          error: cacheError,
          attempts,
        });
        setAttempt({ label: 'Local library', state: cached ? 'found' : 'failed', detail: cached ? 'A downloaded copy was found.' : 'No downloaded copy was found.' });
        setAttempt({ label: 'Direct download', state: readPath ? 'found' : 'skipped', detail: readPath ? 'A source URL is available.' : 'This record does not provide a direct file URL.' });
        if (routeGeneration !== readRouteGeneration) return;
        const cachedFormat = await bookFormatForBlob(cached);
        if (routeGeneration !== readRouteGeneration) return;
        if (cachedFormat) {
          book = { ...book, extension: cachedFormat, format: cachedFormat };
          rememberDetectedBookFormat(book, cachedFormat);
        }
        let torrentAvailable = Boolean(
          BookMetadata.torrentMetadataForBook(book)
          || BookMetadata.libgenTorrentMetadataForBook(book)
          || (isDesktopMode && isMd5(book?.md5)),
        );
        if (!readPath && !cached && !torrentAvailable) {
          status.textContent = `Looking for a torrent for ${book.title || 'book'}…`;
          const resolvedTorrentBook = await resolvePrivateTorrentBook(book, { onAttempt: setAttempt }).catch(error => {
            cacheError = error;
            const fallbackNote = (document.getElementById('read-metadata-fallback-status') as PageElements['read-metadata-fallback-status']);
            updateReadMetadataFallbackDiagnostics(book, {
              cacheStatus: fallbackNote?.dataset.cacheStatus || 'No local cached copy found',
              error: cacheError,
              attempts,
            });
            return null;
          });
          if (routeGeneration !== readRouteGeneration) return;
          if (resolvedTorrentBook) {
            rememberResolvedTorrentMetadata(book, resolvedTorrentBook);
            book = resolvedTorrentBook;
            activeReadingBook = book;
            torrentAvailable = true;
            updateReadTorrentStatus(book);
          }
        }
        if (!readPath && !cached && !torrentAvailable) {
          updateReadMetadataFallbackDiagnostics(book, {
            readPath,
            cacheStatus: 'No local cached copy found',
            error: cacheError || 'No readable download or torrent is available for this record.',
            attempts,
          });
          if (isMd5(bookRef) && state.settings.useNip7 && nostrSigner) {
            pendingReadBookId = String(bookRef).toLowerCase();
            status.textContent = 'Looking for this book in your Nostr library…';
          } else {
            status.textContent = 'No cached or torrent copy was found for this book.';
          }
          return;
        }
        pendingReadBookId = '';
        await openBook(book, { updateHash: false, addToReading: true });
      }

      function enrichedHomeBooks(books: PageBook[]): PageBook[] {
        const library = BookMetadata.dedupeLibraryBooks([...state.reading, ...state.favorites]) as PageBook[];
        return books.map(book => {
          const peer = library.find((item: PageBook) =>
            (book.md5 && item.md5 === book.md5) ||
            ((book.readUrl || book.url) && BookMetadata.findBookByReadUrl(book.readUrl || book.url, [item]))
          );
          if (!peer) return book;
          const merged = { ...peer, ...book };
          if (BookMetadata.isPlaceholderTitle(merged.title)) merged.title = BookMetadata.resolveTitle(peer);
          merged.readUrl ||= peer.readUrl || peer.url || '';
          merged.authors ||= peer.authors || peer.author || '';
          merged.year ||= peer.year || '';
          merged.language ||= peer.language || '';
          return merged;
        });
      }

      function metadataCacheRead(): MetadataCache {
        const cached = safeJSONRead(localStorage.getItem(BOOK_METADATA_CACHE_KEY), {});
        return cached && typeof cached === 'object' ? cached as MetadataCache : {};
      }

      function metadataCacheWrite(cache: MetadataCache): void {
        localStorage.setItem(BOOK_METADATA_CACHE_KEY, JSON.stringify(cache));
      }

      function applyLibraryEnrichment(book: PageBook, metadata: PageBook, provenance: string): void {
        const update = (item: PageBook): PageBook => {
          if (!BookMetadata.sameLibraryBook(item, book)) return item;
          const enriched = BookMetadata.enrichBookMetadata(item, metadata, provenance) as PageBook;
          if (provenance === 'local-file' && metadata?.extension) {
            enriched.extension = String(metadata.extension).replace(/^\./, '').toLowerCase();
            enriched.metadataProvenance!.extension = provenance;
          }
          return enriched;
        };
        state.reading = state.reading.map(update);
        state.favorites = state.favorites.map(update);
      }

      function openLibraryRecordId(book: PageBook): string {
        const direct = String(book?.sourceNativeId || book?.source_native_id || '').trim();
        if (/^OL\d+[WM]$/i.test(direct)) return direct.toUpperCase();
        return BookMetadata.canonicalCatalogUrl(book).match(/\/(?:works|books)\/(OL\d+[WM])(?:[/?#]|$)/i)?.[1]?.toUpperCase() || '';
      }

      async function openLibrarySearchMetadataForBook(book: PageBook): Promise<PageBook | null> {
        const isbn = BookMetadata.isbnForBook(book);
        const title = BookMetadata.resolveTitle(book);
        const authors = String(book?.authors || book?.author || '').trim();
        if (!isbn && (BookMetadata.isPlaceholderTitle(title) || !title)) return null;
        const params = new URLSearchParams({
          fields: 'key,title,author_name,cover_i,isbn,first_publish_year,publisher,language,edition_count',
          limit: '8',
        });
        if (isbn) params.set('q', `isbn:${isbn}`);
        else {
          params.set('title', title);
          if (!isMissingAuthor(authors)) params.set('author', authors);
        }
        const response = await fetch(`https://openlibrary.org/search.json?${params}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Open Library cover lookup failed (${response.status})`);
        const payload = await response.json();
        const documents: OpenLibraryDocument[] = Array.isArray(payload?.docs) ? payload.docs : [];
        const wantedTitle = String(title || '').trim().toLocaleLowerCase();
        const wantedAuthor = authorMatchKey(authors);
        const document = documents.find(item => {
          const sameTitle = String(item?.title || '').trim().toLocaleLowerCase() === wantedTitle;
          const itemAuthors = Array.isArray(item?.author_name) ? item.author_name.join(', ') : item?.author_name || '';
          return sameTitle && (!wantedAuthor || authorMatchKey(itemAuthors) === wantedAuthor);
        }) || (isbn ? documents[0] : null);
        if (!document) return null;
        const coverId = Number(document.cover_i || 0) || '';
        const recordId = String(document.key || '').match(/OL\d+W/i)?.[0]?.toUpperCase() || '';
        return {
          title: document.title || '',
          authors: Array.isArray(document.author_name) ? document.author_name.join(', ') : document.author_name || '',
          year: document.first_publish_year || '',
          language: document.language?.[0] || '',
          publisher: document.publisher?.[0] || '',
          isbn: isbn || document.isbn?.[0] || '',
          coverId,
          coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : '',
          editionCount: Number(document.edition_count || 0),
          source: 'openlibrary',
          sourceNativeId: recordId,
          sourceUrl: recordId ? `https://openlibrary.org/works/${recordId}` : '',
        };
      }

      async function openLibraryMetadataForBook(book: PageBook): Promise<PageBook | null> {
        const recordId = openLibraryRecordId(book);
        if (!recordId) return openLibrarySearchMetadataForBook(book);
        const getJSON = async (url: string) => {
          const response = await fetch(url, { cache: 'no-store' });
          if (!response.ok) throw new Error(`Open Library metadata lookup failed (${response.status})`);
          return response.json();
        };
        const edition = recordId.endsWith('M')
          ? await getJSON(`https://openlibrary.org/books/${recordId}.json`)
          : null;
        const workId = recordId.endsWith('W')
          ? recordId
          : String(edition?.works?.[0]?.key || '').match(/OL\d+W/i)?.[0]?.toUpperCase() || '';
        const work = workId ? await getJSON(`https://openlibrary.org/works/${workId}.json`) : null;
        const source = { ...(work || {}), ...(edition || {}) };
        const authorRefs = [...(edition?.authors || []), ...(work?.authors || [])]
          .map(item => item?.author?.key || item?.key || '')
          .filter(Boolean);
        const authors = (await Promise.all([...new Set(authorRefs)].slice(0, 8).map(async key => {
          try { return String((await getJSON(`https://openlibrary.org${key}.json`))?.name || ''); } catch { return ''; }
        }))).filter(Boolean).join(', ');
        let editionCount = Number(book.editionCount || 0);
        if (workId) {
          try {
            editionCount = Number((await getJSON(`https://openlibrary.org/works/${workId}/editions.json?limit=1`))?.size || editionCount);
          } catch {}
        }
        const language = String(source.languages?.[0]?.key || '').split('/').pop();
        const coverId = Number(source.covers?.[0] || 0) || '';
        return {
          title: source.title || '',
          authors,
          year: BookMetadata.yearForBook({
            year: edition?.publish_date
              || work?.first_publish_date
              || source.first_publish_date
              || source.first_publish_year
              || source.publish_date
              || '',
          }),
          language,
          publisher: Array.isArray(source.publishers) ? source.publishers.join(', ') : source.publishers || '',
          isbn: source.isbn_13?.[0] || source.isbn_10?.[0] || '',
          coverId,
          coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : '',
          editionCount,
          source: 'openlibrary',
          sourceNativeId: workId || recordId,
          sourceUrl: `https://openlibrary.org/${workId ? 'works' : 'books'}/${workId || recordId}`,
        };
      }

      async function remoteMetadataForBook(book: PageBook): Promise<PageBook | null> {
        let combined: PageBook | null = null;
        const merge = (metadata: PageBook | null | undefined, provenance: string): void => {
          if (!metadata) return;
          const normalized = BookMetadata.enrichBookMetadata({}, metadata, provenance) as PageBook;
          const current: PageBook = combined ||= {
            md5: book.md5,
            readUrl: book.readUrl || book.url || '',
            source: book.source || '',
            sourceNativeId: (book.sourceNativeId || book.source_native_id || '') as string,
          };
          for (const field of ['title', 'authors', 'year', 'language', 'publisher', 'isbn', 'coverId', 'coverUrl', 'extension', 'readUrl', 'source']) {
            if (normalized[field] !== '' && normalized[field] != null) current[field] = normalized[field];
          }
          current.metadataLookupComplete = true;
          current.metadataProvenance = { ...((current.metadataProvenance || {}) as Record<string,unknown>), ...((normalized.metadataProvenance || {}) as Record<string,unknown>) };
          for (const field of ['editionCount', 'sourceNativeId', 'sourceUrl', 'filesizeBytes', 'pages', 'series', 'topic']) {
            if (metadata[field] !== '' && metadata[field] != null) current[field] = metadata[field];
          }
        };
        let openLibraryMetadata: PageBook | null = null;
        try { openLibraryMetadata = await openLibraryMetadataForBook(book); } catch {}
        const mergeOpenLibraryMetadata = () => merge(openLibraryMetadata, 'openlibrary');
        const readUrl = BookMetadata.canonicalReadUrl(book, BOOKS_API_BASE);
        const metadataUrl = BookMetadata.metadataEndpointForReadUrl(readUrl);
        if (metadataUrl) {
          const response = await fetch(metadataUrl);
          if (!response.ok) throw new Error(`metadata lookup failed (${response.status})`);
          const payload = await response.json();
          const metadata = payload?.book || payload?.data || payload;
          merge({
            ...metadata,
            title: BookMetadata.resolveTitle(metadata, readUrl, window.location.href),
            authors: Array.isArray(metadata?.authors) ? metadata.authors.join(', ') : metadata?.authors || metadata?.author || '',
            year: BookMetadata.yearForBook(metadata),
            language: BookMetadata.languageForBook(metadata),
            extension: metadata?.extension || metadata?.format || 'epub',
            source: metadata?.source || 'gutenberg',
            readUrl,
          }, 'gutenberg');
          mergeOpenLibraryMetadata();
          return combined;
        }
        const knownAuthor = (combined as PageBook | null)?.authors || (combined as PageBook | null)?.author || book.authors || book.author || '';
        const knownReadUrl = BookMetadata.canonicalReadUrl(combined || book, BOOKS_API_BASE);
        if (openLibraryMetadata && (
          Number(openLibraryMetadata.coverId || 0) > 0
          || (knownReadUrl && (!isMissingAuthor(knownAuthor) || !isMissingAuthor(openLibraryMetadata.authors)))
        )) {
          mergeOpenLibraryMetadata();
          return combined;
        }
        const isbn = BookMetadata.isbnForBook(book);
        const title = BookMetadata.resolveTitle(book);
        const query = isbn || (!BookMetadata.isPlaceholderTitle(title) ? title : '');
        if (!query) {
          mergeOpenLibraryMetadata();
          return combined;
        }
        let results: PageBook[];
        try {
          results = await searchAllBooksPartySource(query);
        } catch (error) {
          if (!openLibraryMetadata && !combined) throw error;
          mergeOpenLibraryMetadata();
          return combined;
        }
        const exact = results.find((result: PageBook) => BookMetadata.sameLibraryBook(book, result));
        if (exact) {
          merge(exact, exact.source || 'remote');
          mergeOpenLibraryMetadata();
          return combined;
        }
        const wantedTitle = title.toLocaleLowerCase();
        const wantedAuthor = authorMatchKey(book.authors || book.author);
        const matched = results.find((result: PageBook) => {
          const sameTitle = String(result.title || '').toLocaleLowerCase() === wantedTitle;
          const resultAuthor = authorMatchKey(result.authors || result.author);
          return sameTitle && wantedAuthor && resultAuthor === wantedAuthor;
        }) || null;
        merge(matched, matched?.source || 'remote');
        mergeOpenLibraryMetadata();
        return combined;
      }

      async function refreshLibraryBookMetadata(book: PageBook): Promise<void> {
        const title = book?.title || 'book';
        status.textContent = `Refreshing metadata for ${title} from Open Library and all.books…`;
        try {
          const metadata = await remoteMetadataForBook(book);
          if (!metadata) throw new Error('No newer metadata was found.');
          const update = (item: PageBook): PageBook => {
            if (!BookMetadata.sameLibraryBook(item, book)) return item;
            const next = { ...item };
            for (const [field, value] of Object.entries(metadata)) {
              if (value === '' || value == null) continue;
              next[field] = value;
            }
            next.md5 = item.md5;
            next.updatedAt = Date.now();
            return next;
          };
          state.reading = state.reading.map(update);
          state.favorites = state.favorites.map(update);
          const refreshed = (BookMetadata.mergeLibraryState(state.reading, state.favorites) as PageBook[])
            .find((item: PageBook) => BookMetadata.sameLibraryBook(item, book)) || { ...book, ...metadata };
          const cache = metadataCacheRead();
          cache[BookMetadata.bookIdentity(book)] = { book: metadata, provenance: 'manual-refresh', ts: Date.now() };
          metadataCacheWrite(cache);
          localStorage.setItem(READING_KEY, JSON.stringify(state.reading));
          localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites));
          renderFavorites();
          renderReading();
          renderHome();
          const syncTasks = [];
          if (refreshed.isFavorite && !isDesktopMode) syncTasks.push(syncFavoritesToNostr());
          if (refreshed.isReading) syncTasks.push(publishReadingMetadata(refreshed));
          if (syncTasks.length) await Promise.all(syncTasks);
          status.textContent = `Updated ${refreshed.title || title} from Open Library and all.books${isDesktopMode ? '.' : ' across apps.'}`;
        } catch (error) {
          status.textContent = `Could not refresh ${title}: ${(error as Error)?.message || error}`;
        }
      }

      async function enrichLibraryMetadata(): Promise<void> {
        const cache = metadataCacheRead();
        let library = BookMetadata.mergeLibraryState(state.reading, state.favorites) as PageBook[];
        if (isDesktopMode && desktopBridge?.library?.metadata) {
          await Promise.all(library.filter((book: PageBook) => isMd5(book?.md5)).map(async (book: PageBook) => {
            const metadata = await desktopBridge.library.metadata(book.md5!).catch(() => null);
            if (metadata) applyLibraryEnrichment(book, metadata as PageBook, 'local-file');
          }));
          library = BookMetadata.mergeLibraryState(state.reading, state.favorites);
          localStorage.setItem(READING_KEY, JSON.stringify(state.reading));
          localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites));
          renderHome();
        }
        const pending = [];
        for (const book of library) {
          const key = BookMetadata.bookIdentity(book);
          const cached = cache[key];
          if (cached && Date.now() - Number(cached.ts || 0) < BOOK_METADATA_CACHE_TTL_MS) {
            applyLibraryEnrichment(book, cached.book as PageBook, String(cached.provenance || 'cache'));
          }
          const current = BookMetadata.mergeLibraryState(state.reading, state.favorites)
            .find(item => BookMetadata.sameLibraryBook(item, book)) || book;
          const metadataOnly = BookMetadata.availabilitySourcesForBook(current).includes('Metadata only');
          const coverUrl = String(current.coverUrl || current.cover_url || current.thumbnail || current.image || '');
          const hasIndependentCover = Boolean(
            current.coverId || current.cover_id || BookMetadata.isbnForBook(current)
            || (coverUrl && !/^https:\/\/lib\.b\.bfr\.ee\/api\/(?:covers|placeholder)\//i.test(coverUrl))
          );
          if (!current.year || !current.language || BookMetadata.isPlaceholderTitle(current.title) || metadataOnly || !hasIndependentCover) pending.push(current);
        }
        renderHome();
        for (let index = 0; index < pending.length; index += 4) {
          await Promise.all(pending.slice(index, index + 4).map(async book => {
            const key = BookMetadata.bookIdentity(book);
            try {
              const metadata = await remoteMetadataForBook(book);
              const complete = metadata || { metadataLookupComplete: true };
              const provenance = metadata?.source || 'remote';
              applyLibraryEnrichment(book, complete, provenance);
              cache[key] = { book: complete, provenance, ts: Date.now() };
            } catch {
              applyLibraryEnrichment(book, { metadataLookupComplete: true }, 'unresolved');
              cache[key] = { book: { metadataLookupComplete: true }, provenance: 'unresolved', ts: Date.now() };
            }
          }));
          metadataCacheWrite(cache);
          localStorage.setItem(READING_KEY, JSON.stringify(state.reading));
          localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites));
          renderHome();
        }
      }

      async function openLibraryBook(book: PageBook): Promise<void> {
        const directUrl = BookMetadata.canonicalReadUrl(book, BOOKS_API_BASE);
        if (directUrl) {
          await openBook({ ...book, readUrl: directUrl });
          return;
        }
        const gutenbergId = String(book.md5 || '').match(/^gutenberg:(\d+)$/i)?.[1];
        if (gutenbergId) {
          await openBook({ ...book, extension: 'epub', readUrl: `${BOOKS_API_BASE}/books/${gutenbergId}/download` });
          return;
        }
        status.textContent = `Finding a readable copy of ${book.title || 'this book'}…`;
        try {
          const query = BookMetadata.isPlaceholderTitle(book.title) ? book.md5 : book.title;
          const results = await searchAllBooksPartySource(String(query || book.authors || '')) as PageBook[];
          const normalizedTitle = String(book.title || '').toLocaleLowerCase();
          const match = results.find(item => item.md5 === book.md5 && (item.readUrl || item.url))
            || results.find(item => String(item.title || '').toLocaleLowerCase() === normalizedTitle && (item.readUrl || item.url))
            || results.find(item => item.readUrl || item.url);
          if (!match) throw new Error('No readable copy was found.');
          await openBook({ ...book, ...match, title: BookMetadata.resolveTitle({ ...book, ...match }) });
        } catch (error) {
          status.textContent = `Could not open ${book.title || 'book'}: ${(error as Error)?.message || error}`;
        }
      }

      function renderHomeBookList(target: HTMLElement, books: PageBook[], emptyText: string): void {
        const sort = homeBookSorts[target.id] || { key: '', direction: 'asc' };
        renderBookTable(target, books, {
          sort,
          label: 'Library',
          library: true,
          routeOnly: true,
          emptyText,
          onSort: (key, direction) => {
            homeBookSorts[target.id] = { key, direction };
            renderHome();
          },
        });
      }

      function configureHomeLibraryFilter(select: HTMLSelectElement, wrap: HTMLElement, values: string[], allLabel: string, selected: string, labelForValue: (value: string) => string): string {
        const visible = values.length > 1;
        wrap.classList.toggle('hidden', !visible);
        if (!visible) return '';
        select.replaceChildren();
        for (const [value, label] of [['', allLabel], ...values.map(value => [value, labelForValue(value)])]) {
          select.add(new Option(label, value));
        }
        select.value = values.includes(selected) ? selected : '';
        return select.value;
      }

      function desktopReadableLibrary(savedBooks: PageBook[]): PageBook[] {
        const downloadedBooks = [...new Map<string, BrowserDownloadRow>([...desktopDownloadByBook.values()].map(job => [job.bookId, job])).values()]
          .filter(job => job.readable === true).map(bookFromDesktopDownload).filter(Boolean) as PageBook[];
        const byFile = new Map<string, PageBook>();
        for (const book of BookMetadata.dedupeLibraryBooks([...savedBooks, ...downloadedBooks]) as PageBook[]) {
          const job = desktopDownloadForBook(book);
          if (job?.readable === true && !byFile.has(job.bookId)) byFile.set(job.bookId, book);
        }
        return [...byFile.values()].sort((left, right) =>
          Number(desktopDownloadForBook(right)?.completedAt || 0) - Number(desktopDownloadForBook(left)?.completedAt || 0));
      }

      function renderHome(): void {
        const needle = homeQueryInput.value.trim().toLocaleLowerCase();
        const library = BookMetadata.mergeLibraryState(state.reading, state.favorites);
        const enrichedLibrary = isDesktopMode ? desktopReadableLibrary(library) : library;
        const languages = [...new Set(enrichedLibrary.map(resultLanguage).filter((value): value is string => Boolean(value)))].sort();
        const formats = [...new Set(enrichedLibrary.map(resultFormat).filter((value): value is string => Boolean(value)))].sort();
        homeLibraryFilter.language = configureHomeLibraryFilter(
          homeLanguageFilter, homeLanguageFilterWrap, languages, 'All languages',
          homeLibraryFilter.language, value => isDesktopMode ? BookMetadata.languageLabel(value)! : value.toUpperCase()
        );
        homeLibraryFilter.format = configureHomeLibraryFilter(
          homeFormatFilter, homeFormatFilterWrap, formats, 'All formats',
          homeLibraryFilter.format, value => value.toLowerCase()
        );
        homeResultFilters.classList.toggle('hidden', languages.length <= 1 && formats.length <= 1);
        const matchesQuery = BookMetadata.createBookFilterMatcher(
          needle,
          item => cachedBookKeys.has(bookCacheKey(item, String(item.readUrl || item.url || '')))
        );
        const matchingBooks = enrichedLibrary.filter(book => (
          (!homeLibraryFilter.language || resultLanguage(book) === homeLibraryFilter.language)
          && (!homeLibraryFilter.format || resultFormat(book) === homeLibraryFilter.format)
          && matchesQuery(book)
        ));
        const visibleCount = matchingBooks.length === enrichedLibrary.length
          ? `${enrichedLibrary.length} ${enrichedLibrary.length === 1 ? 'book' : 'books'}`
          : `${matchingBooks.length} of ${enrichedLibrary.length} books`;
        const readableCount = matchingBooks.filter(isBookReadableNow).length;
        const downloadingCount = desktopDownloadingBookCount();
        const seedingCount = enrichedLibrary.filter(isBookSeeded).length;
        const transferRates = isDesktopMode
          ? ` · ↓ ${transferRateLabel(desktopTransferRates.download)} · ↑ ${transferRateLabel(desktopTransferRates.upload)}`
          : '';
        homeLibraryCount.textContent = isDesktopMode ? visibleCount
          : `${visibleCount} · ${readableCount} readable now · ${downloadingCount} downloading · ${seedingCount} seeding${transferRates}`;
        renderHomeBookList(homeReadingList, matchingBooks, 'No books match these filters.');
      }

      function activateTab(tab: string, { updateHash = false }: { updateHash?: boolean } = {}): void {
        if (tab === 'words' && !hasActiveWords()) tab = 'home';
        if (tab === 'downloads' && isDesktopMode && activeTab !== 'downloads') {
          desktopDownloadEntryNeedsSnapshot = !desktopDownloadStatesReady;
          desktopHiddenCompletedIds = new Set([...desktopDownloadByBook.values()]
            .filter(job => ['ready', 'seeding'].includes(String(job.status).toLowerCase())).map(job => job.bookId));
        }
        activeTab = ['home', 'search', 'reading', 'words', 'people', 'settings', ...(isDesktopMode ? ['downloads'] : [])].includes(tab) ? tab : 'home';
        desktopDownloadsPane.classList.toggle('hidden', activeTab !== 'downloads');
        desktopDownloadsButton.setAttribute('aria-selected', String(activeTab === 'downloads'));
        if (activeTab === 'downloads') void renderDesktopDownloads();
        homeTab.classList.toggle('hidden', activeTab !== 'home');
        searchTab.classList.toggle('hidden', activeTab !== 'search');
        readingLibraryTab.classList.toggle('hidden', activeTab !== 'reading');
        wordsTab.classList.toggle('hidden', activeTab !== 'words');
        peopleTab.classList.toggle('hidden', activeTab !== 'people');
        settingsModal.classList.toggle('hidden', activeTab !== 'settings');
        settingsModal.setAttribute('aria-hidden', String(activeTab !== 'settings'));
        readerSection.classList.toggle('hidden', activeTab !== 'reading' || !activeReadingBook);
        document.body.classList.toggle('book-open', activeTab === 'reading' && Boolean(activeReadingBook));
        homeTabBtn.setAttribute('aria-selected', String(activeTab === 'home'));
        searchTabBtn.setAttribute('aria-selected', String(activeTab === 'search'));
        readingTabBtn.setAttribute('aria-selected', String(activeTab === 'reading'));
        wordsTabBtn.setAttribute('aria-selected', String(activeTab === 'words'));
        peopleTabBtn.setAttribute('aria-selected', String(activeTab === 'people'));
        settingsBtn.setAttribute('aria-selected', String(activeTab === 'settings'));
        const currentBook = activeReadingBook;
        const showBookTitle = activeTab === 'reading' && currentBook?.title;
        headerBookTitle.classList.toggle('hidden', !showBookTitle);
        headerBookTitle.textContent = showBookTitle ? currentBook!.title! : '';
        headerBookTitle.title = showBookTitle ? currentBook!.title! : '';
        const bookMeta = showBookTitle
          ? [currentBook!.authors || currentBook!.author, currentBook!.year].filter(Boolean).join(' · ')
          : '';
        headerBookMeta.classList.toggle('hidden', !bookMeta);
        headerBookMeta.textContent = bookMeta;
        headerBookMeta.title = bookMeta;
        if (activeTab === 'home') renderHome();
        if (activeTab === 'search' && !queryInput.value.trim()) renderSearchSources();
        if (activeTab === 'words') requestAnimationFrame(() => wordsFilter.focus());
        if (activeTab === 'people') {
          if (isDesktopMode) void refreshDeviceTransferPanel();
          else {
            renderPeople();
            if (!state.followingLoaded) void syncNostrPeopleFromNip7();
          }
        }
        if (!updateHash) return;
        if (activeTab === 'home') {
          setHashRoute(homeHashRoute());
          homeQueryInput.focus();
        } else if (activeTab === 'search') {
          const query = queryInput.value.trim();
          setHashRoute(query.length >= 2 ? searchHashRoute({ query }) : 'search');
          queryInput.focus();
        } else if (activeTab === 'reading') {
          const readUrl = activeReadingBook?.readUrl || activeReadingBook?.url || '';
          const routeValue = activeReadingBook ? readRouteValue(activeReadingBook, readUrl) : '';
          setHashRoute(routeValue ? `read=${encodeURIComponent(routeValue)}` : 'reading');
        } else if (activeTab === 'downloads') {
          setHashRoute('downloads');
        } else if (activeTab === 'words') {
          setHashRoute('words');
        } else if (activeTab === 'people') {
          setHashRoute(isDesktopMode ? 'devices' : 'people');
        } else {
          setHashRoute('settings');
        }
      }

      function bytesToHex(bytes: Uint8Array): string {
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      }

      async function blobSha256Hex(blob: Blob): Promise<string> {
        if (!globalThis.crypto?.subtle || !(blob instanceof Blob)) return '';
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return bytesToHex(new Uint8Array(digest));
      }

      async function enforceBlobSha256(book: PageBook, blob: Blob): Promise<void> {
        const expected = normalizeSha256(book?.sha256);
        const computed = await blobSha256Hex(blob);
        if (!computed) return;
        if (expected && computed !== expected) {
          throw new Error('Downloaded book SHA-256 does not match the expected value.');
        }
        if (!expected) {
          book.sha256 = computed;
        }
      }

      function matchingTorrentCatalogRecord(book: PageBook, candidates: PageBook[]): PageBook | null {
        return BookMetadata.matchingTorrentCatalogRecord(book, candidates);
      }

      function resolvedTorrentBook(book: PageBook, matched: PageBook, provenance: string): PageBook {
        return {
          ...BookMetadata.enrichBookMetadata(book, matched, provenance),
          md5: String(matched.md5 || matched.libvaultMd5 || '').toLowerCase(),
          libgenId: Number(matched.libgenId || matched.libgen_id || matched.sourceNativeId || 0),
        };
      }

      function rememberResolvedTorrentMetadata(original: PageBook, resolved: PageBook): void {
        const libvaultMd5 = String(resolved?.md5 || resolved?.libvaultMd5 || '').trim().toLowerCase();
        const libgenId = Number(resolved?.libgenId || resolved?.libgen_id || 0);
        if (!isMd5(libvaultMd5) || !Number.isSafeInteger(libgenId) || libgenId <= 0) return;
        const update = (item: PageBook): PageBook => BookMetadata.sameLibraryBook(item, original)
          ? { ...item, libvaultMd5, libgenId, filesize: Number(resolved.filesize || item.filesize || 0) }
          : item;
        state.reading = state.reading.map(update);
        state.favorites = state.favorites.map(update);
        localStorage.setItem(READING_KEY, JSON.stringify(state.reading));
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites));
      }

      async function resolvePrivateTorrentBook(book: PageBook, { onAttempt }: { onAttempt?: (attempt: ReadAttempt) => void } = {}): Promise<PageBook | null> {
        const signerCapabilities = nostrSigner as { signEvent?: unknown; nip44?: { encrypt?: unknown; decrypt?: unknown } } | undefined;
        let signerConfigured = Boolean(signerCapabilities?.signEvent && signerCapabilities?.nip44?.encrypt && signerCapabilities?.nip44?.decrypt);
        const signerStatus = (nostrSigner as MigratedNostrSigner & { status?: () => Promise<{ configured?: boolean }> } | undefined)?.status;
        if (signerConfigured && typeof signerStatus === 'function') {
          try {
            signerConfigured = Boolean((await signerStatus())?.configured);
          } catch {
            signerConfigured = false;
          }
        }
        if (!signerConfigured) {
          onAttempt?.({ label: 'Private Nostr lookup', state: 'skipped', detail: 'Not tried because no Nostr signer is connected.' });
          throw new Error('Connect your Nostr signer to ask the LibVault NIP-17 service for torrent metadata.');
        }
        const isbn = BookMetadata.isbnForBook(book);
        const title = BookMetadata.resolveTitle(book);
        const query = isbn || (!BookMetadata.isPlaceholderTitle(title) ? title : '');
        const md5 = String(book?.md5 || book?.libvaultMd5 || '').trim().toLowerCase();
        if (!isMd5(md5) && !query) return null;
        onAttempt?.({ label: 'Private Nostr lookup', state: 'checking', detail: 'Asking Libcat over an encrypted NIP-17 request.' });
        nip17FetchModule ||= import('./nip17-fetch.js');
        let matched;
        try {
          matched = await nip17FetchModule.then(async module => {
            const options = {
              signer: nostrSigner,
              publish: publishRelayEvent,
              onTrace: showNip17Trace,
            };
            if (query) {
              const response = await module.searchLibcat(query, isbn ? 'isbn' : 'title', { ...options, limit: 50 });
              return matchingTorrentCatalogRecord(book, normalizeSearchBooks(response, 'libvault'));
            }
            const resolved = await module.resolveLibcatBook({ ...book, md5 }, options);
            return normalizeSearchBooks({ books: [resolved] }, 'libvault')[0] || null;
          });
        } catch (error) {
          if (/signer|public key|nip-44/i.test(String((error as Error)?.message || error))) {
            onAttempt?.({ label: 'Private Nostr lookup', state: 'failed', detail: 'The connected signer could not complete the encrypted request.' });
            throw new Error('Connect your Nostr signer to search Libcat for this torrent.');
          }
          onAttempt?.({ label: 'Private Nostr lookup', state: 'failed', detail: 'The encrypted catalogue request failed.' });
          throw error;
        }
        if (!matched) {
          onAttempt?.({ label: 'Private Nostr lookup', state: 'failed', detail: 'No compatible edition matched this metadata.' });
          return null;
        }
        onAttempt?.({
          label: 'Private Nostr lookup',
          state: 'found',
          detail: `Matched a ${String(matched.extension || matched.format || 'readable').toUpperCase()} edition.`,
        });
        return resolvedTorrentBook(book, matched, 'libvault-nip17');
      }

      async function fetchDesktopTorrentCopy(book: PageBook): Promise<Blob | null> {
        if (!isDesktopMode) return null;
        const localDownload = desktopDownloadForBook(book);
        const localStatus = String(localDownload?.status || '').toLowerCase();
        const localBookId = String(localDownload?.bookId || '').trim().toLowerCase();
        const localTorrentBook: PageBook | null = ['ready', 'seeding'].includes(localStatus) && localBookId
          ? {
              ...book,
              ...localDownload!,
              md5: book.md5 || localBookId,
              libgenId: Number(localDownload!.sourceNativeId || 0),
              extension: String(localDownload!.extension || book.extension || book.format || ''),
            }
          : null;
        if (localTorrentBook && desktopBridge?.library?.openReader) {
          const reader = await desktopBridge.library.openReader(localBookId) as { token?: string };
          if (reader?.token) {
            const response = await fetch(`app://bookstr/api/library-file/${reader.token}`);
            if (!response.ok) throw new Error(`Local library file read failed (${response.status}).`);
            const blob = await response.blob();
            await enforceBlobSha256(localTorrentBook, blob);
            Object.assign(book, localTorrentBook);
            return blob;
          }
        }
        if (!state.settings.autoDownloadTorrents) {
          throw new Error('Automatic torrent downloads are disabled in Settings.');
        }
        let torrentBook = localTorrentBook || book;
        Object.assign(book, torrentBook);
        let libgenTorrent = BookMetadata.libgenTorrentMetadataForBook(torrentBook);
        if (!libgenTorrent && isMd5(torrentBook?.md5)) {
          if (!nostrSigner?.signEvent || !nostrSigner?.nip44?.encrypt || !nostrSigner?.nip44?.decrypt) {
            throw new Error('Connect your Nostr signer to resolve this torrent from Libcat.');
          }
          status.textContent = `Resolving torrent metadata for ${torrentBook.title || 'book'}…`;
          nip17FetchModule ||= import('./nip17-fetch.js');
          const resolved = await nip17FetchModule.then(module => module.resolveLibcatBook(torrentBook, {
            signer: nostrSigner,
            publish: publishRelayEvent,
            onTrace: showNip17Trace,
          }));
          const normalized = normalizeSearchBooks({ books: [resolved] }, 'libvault')[0];
          if (!normalized) throw new Error('Libcat returned invalid torrent metadata.');
          torrentBook = {
            ...BookMetadata.enrichBookMetadata(torrentBook, normalized, 'libvault'),
            libgenId: Number(normalized.libgenId || normalized.libgen_id || 0),
          };
          Object.assign(book, torrentBook);
          libgenTorrent = BookMetadata.libgenTorrentMetadataForBook(torrentBook);
        }
        if (libgenTorrent && desktopBridge?.library?.acquireLibgen) {
          torrentBook = { ...torrentBook, md5: libgenTorrent.md5, libgenId: libgenTorrent.libgenId };
          addBookToLibrary(torrentBook, undefined);
          desktopDownloadByBook.set(libgenTorrent.md5, {
            ...desktopDownloadByBook.get(libgenTorrent.md5),
            bookId: libgenTorrent.md5,
            status: 'finding-peers',
          });
          updateDesktopDownloadSummary();
          let result: { url?: string; sha256?: string };
          try {
            result = await desktopBridge.library.acquireLibgen(torrentBook, {
              autoSeed: state.settings.autoSeedTorrents,
            }) as { url?: string; sha256?: string };
          } finally {
            await refreshDesktopDownloadStates();
          }
          if (!result?.url) throw new Error('The torrent download did not produce a readable file.');
          const response = await fetch(result.url);
          if (!response.ok) throw new Error(`Torrent file read failed (${response.status}).`);
          const blob = await response.blob();
          if (result.sha256) book.sha256 = result.sha256;
          await enforceBlobSha256(book, blob);
          return blob;
        }
        if (!desktopBridge?.transfers?.downloadPublic) return null;
        const torrent = BookMetadata.torrentMetadataForBook(book);
        const sha256 = normalizeSha256(book?.sha256);
        if (!torrent || !sha256 || !book?.md5) return null;
        const torrentId = torrent.torrentId || torrent.torrentFile;
        if (!torrentId) return null;
        addBookToLibrary(book, undefined);
        status.textContent = `Finding peers for ${book.title || 'book'}…`;
        const result = await desktopBridge.transfers.downloadPublic({
          bookId: book.md5,
          sha256,
          torrentId,
          book,
          autoSeed: state.settings.autoSeedTorrents,
        }) as { url?: string };
        if (!result?.url) throw new Error('The torrent download did not produce a readable file.');
        const response = await fetch(result.url);
        if (!response.ok) throw new Error(`Torrent file read failed (${response.status}).`);
        const blob = await response.blob();
        await enforceBlobSha256(book, blob);
        return blob;
      }

      async function browserWebTorrentRuntime(): Promise<{ client: Parameters<typeof import('./webtorrent-transfer.js').seedPublicTorrent>[0]; transferModule: typeof import('./webtorrent-transfer.js') } | null> {
        if (isDesktopMode) return null;
        browserWebTorrentRuntimePromise ||= Promise.all([
          import(BROWSER_WEBTORRENT_MODULE),
          import('./webtorrent-transfer.js'),
        ]).then(([clientModule, transferModule]) => ({
          client: new clientModule.default({
            dht: false,
            tracker: {
              rtcConfig: { iceServers: transferModule.PUBLIC_ICE_SERVERS },
            },
          }) as Parameters<typeof import('./webtorrent-transfer.js').seedPublicTorrent>[0],
          transferModule,
        }));
        return browserWebTorrentRuntimePromise;
      }

      function showBrowserWebTorrentStatus(label: string): void {
        status.textContent = `WebTorrent · ${label}`;
        const torrentStatus = (document.getElementById('read-metadata-fallback-torrent') as PageElements['read-metadata-fallback-torrent']);
        if (!torrentStatus) return;
        const classLabel = label.startsWith('Seeding') ? 'Seeding'
          : label.startsWith('Loading') ? 'Finding peers'
            : label;
        torrentStatus.hidden = false;
        torrentStatus.className = ['read-torrent-status', 'status-with-dot', torrentStatusClass(classLabel)].filter(Boolean).join(' ');
        torrentStatus.textContent = `WebTorrent: ${label}`;
      }

      async function fetchBrowserTorrentCopy(book: PageBook): Promise<Blob | null> {
        if (isDesktopMode) return null;
        let torrentBook = book;
        Object.assign(book, torrentBook);
        const libgenTorrent = BookMetadata.libgenTorrentMetadataForBook(torrentBook);
        const publicTorrent = BookMetadata.torrentMetadataForBook(torrentBook);
        if (!libgenTorrent && !publicTorrent) return null;
        let torrentId: string | Uint8Array = publicTorrent?.torrentId || publicTorrent?.torrentFile || '';
        let fileName = String(torrentBook.md5 || '').trim().toLowerCase();
        if (libgenTorrent) {
          if (libgenTorrent.libgenId >= LIBGEN_RS_REPOSITORY_ID_LIMIT) {
            throw new Error('The private catalogue returned a general record ID instead of LibGen repository metadata.');
          }
          if (['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) {
            addBookToLibrary(torrentBook, undefined);
            showBrowserWebTorrentStatus(`Downloading ${torrentBook.title || 'book'} with the local torrent bridge…`);
            const nativeResponse = await fetch(`/api/libgen-file?libgen_id=${encodeURIComponent(libgenTorrent.libgenId)}&md5=${encodeURIComponent(libgenTorrent.md5)}`);
            if (!nativeResponse.ok) throw new Error(`Local torrent download failed (${nativeResponse.status}).`);
            const blob = await nativeResponse.blob();
            await enforceBlobSha256(torrentBook, blob);
            showBrowserWebTorrentStatus(`Ready · local torrent bridge is seeding ${torrentBook.title || 'book'}`);
            return blob;
          }
          showBrowserWebTorrentStatus(`Loading torrent metadata for ${torrentBook.title || 'book'}…`);
          const metadataResponse = await fetch(`/api/libgen-torrent?libgen_id=${encodeURIComponent(libgenTorrent.libgenId)}&md5=${encodeURIComponent(libgenTorrent.md5)}`);
          if (!metadataResponse.ok) throw new Error(`Torrent metadata download failed (${metadataResponse.status}).`);
          torrentId = new Uint8Array(await metadataResponse.arrayBuffer());
          fileName = libgenTorrent.md5;
        }
        if (!torrentId || !fileName) return null;
        const { client, transferModule } = (await browserWebTorrentRuntime())!;
        addBookToLibrary(torrentBook, undefined);
        showBrowserWebTorrentStatus(`Finding peers for ${torrentBook.title || 'book'}…`);
        const result = await transferModule.downloadPublicTorrentFile(client, torrentId as string, {
          fileName,
          maxBytes: MAX_BROWSER_TORRENT_BOOK_BYTES,
          onProgress: progress => {
            const total = Math.max(0, Number(progress.total || 0));
            const downloaded = Math.max(0, Number(progress.downloaded || 0));
            const percent = total > 0 ? Math.max(0, Math.min(100, Math.round(downloaded / total * 100))) : 0;
            const peers = Math.max(0, Number(progress.peers || 0));
            showBrowserWebTorrentStatus(`Downloading · ${percent}%${peers ? ` · ${peers} peer${peers === 1 ? '' : 's'}` : ' · finding peers'}`);
          },
        });
        showBrowserWebTorrentStatus(`Seeding ${torrentBook.title || 'book'} while this page stays open`);
        await enforceBlobSha256(torrentBook, result.blob);
        return result.blob;
      }

      function blobToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error || new Error('Could not read EPUB.'));
          reader.onload = () => resolve(String(reader.result || '').split(',', 2)[1] || '');
          reader.readAsDataURL(blob);
        });
      }

      async function bookFormatForBlob(blob: Blob | null): Promise<string> {
        if (!(blob instanceof Blob)) return '';
        const type = String(blob.type || '').toLowerCase();
        if (type.includes('pdf')) return 'pdf';
        if (type.includes('zip') || type.includes('epub')) {
          try {
            const zip = await JSZip.loadAsync(blob, { checkCRC32: true, createFolders: false });
            const names = Object.keys(zip.files).map(name => name.replaceAll('\\', '/'));
            if (names.some(name => /(^|\/)META-INF\/container\.xml$/i.test(name))) return 'epub';
            if (names.some(name => isComicImageName(name))) return 'cbz';
          } catch {}
          return 'epub';
        }
        try {
          const bytes = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
          if (String.fromCharCode(...bytes) === '%PDF-') return 'pdf';
          if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
            try {
              const zip = await JSZip.loadAsync(blob, { checkCRC32: true, createFolders: false });
              const names = Object.keys(zip.files).map(name => name.replaceAll('\\', '/'));
              if (names.some(name => /(^|\/)META-INF\/container\.xml$/i.test(name))) return 'epub';
              return names.some(name => isComicImageName(name)) ? 'cbz' : 'epub';
            } catch {}
            return 'epub';
          }
          if (bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21) return 'cbr';
        } catch {}
        return '';
      }

      function rememberDetectedBookFormat(book: PageBook, format: string): void {
        const detected = String(format || '').replace(/^\./, '').toLowerCase();
        if (!['epub', 'pdf', 'cbz', 'cbr'].includes(detected)) return;
        const update = (item: PageBook): PageBook => BookMetadata.sameLibraryBook(item, book)
          ? {
              ...item,
              extension: detected,
              format: detected,
              metadataProvenance: { ...(item.metadataProvenance || {}), extension: 'detected-local' },
            }
          : item;
        const previousReading = state.reading;
        const previousFavorites = state.favorites;
        state.reading = state.reading.map(update);
        state.favorites = state.favorites.map(update);
        if (activeReadingBook && BookMetadata.sameLibraryBook(activeReadingBook, book)) {
          activeReadingBook = {
            ...activeReadingBook,
            extension: detected,
            format: detected,
            metadataProvenance: { ...(activeReadingBook.metadataProvenance || {}), extension: 'detected-local' },
          };
        }
        if (state.reading.some((item, index) => item !== previousReading[index])) {
          localStorage.setItem(READING_KEY, JSON.stringify(state.reading));
        }
        if (state.favorites.some((item, index) => item !== previousFavorites[index])) {
          localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites));
        }
      }

      function isComicImageName(name: string): boolean {
        const clean = String(name || '').replaceAll('\\', '/');
        if (!clean || clean.endsWith('/') || clean.split('/').includes('..')) return false;
        if (/(^|\/)__MACOSX(\/|$)/i.test(clean) || /(^|\/)(thumbs?|thumbnails?)(\/|$)/i.test(clean)) return false;
        return /\.(?:jpe?g|png|gif|webp)$/i.test(clean);
      }

      let bookCacheDatabase: Promise<IDBDatabase> | null = null;
      const cachedBookKeys = new Set<string>();

      function openBookCache(): Promise<IDBDatabase> {
        if (bookCacheDatabase) return bookCacheDatabase;
        bookCacheDatabase = new Promise((resolve, reject) => {
          const request = indexedDB.open(BOOK_CACHE_DB_NAME, 1);
          request.onupgradeneeded = () => request.result.createObjectStore('books', { keyPath: 'key' });
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error('Could not open the book cache.'));
        });
        return bookCacheDatabase;
      }

      async function bookCacheRecords(): Promise<CachedBookRecord[]> {
        const database = await openBookCache();
        return new Promise((resolve, reject) => {
          const request = database.transaction('books').objectStore('books').getAll();
          request.onsuccess = () => resolve((request.result || []) as CachedBookRecord[]);
          request.onerror = () => reject(request.error);
        });
      }

      async function bookCachePut(record: PageBook & { key: string; blob: Blob; lastUsed: number }): Promise<void> {
        const database = await openBookCache();
        return new Promise((resolve, reject) => {
          const request = database.transaction('books', 'readwrite').objectStore('books').put(record);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      }

      async function bookCacheDelete(key: string): Promise<void> {
        const database = await openBookCache();
        return new Promise((resolve, reject) => {
          const request = database.transaction('books', 'readwrite').objectStore('books').delete(key);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      }

      async function purgeLegacyBookCache() {
        cachedBookKeys.clear();
        if (bookCacheDatabase) {
          const database = await bookCacheDatabase.catch(() => null);
          database?.close();
          bookCacheDatabase = null;
        }
        return new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(BOOK_CACHE_DB_NAME);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error || new Error('Could not remove the legacy book cache.'));
          request.onblocked = () => reject(new Error('Could not remove the legacy book cache because it is still in use.'));
        });
      }

      function bookCacheKey(book: PageBook, readUrl = ''): string {
        const md5 = String(book?.md5 || '').trim().toLowerCase();
        return isMd5(md5) ? md5 : String(readUrl || book?.readUrl || book?.url || '').trim();
      }

      function cacheIdentity(value: unknown): string {
        const identity = String(value || '').trim();
        if (!identity) return '';
        if (isMd5(identity)) return identity.toLowerCase();
        try {
          const url = new URL(identity, window.location.href);
          url.hash = '';
          return url.href;
        } catch {
          return identity;
        }
      }

      function cacheIdentities(book: PageBook, readUrl?: string): Set<string> {
        return new Set<string>([
          bookCacheKey(book, readUrl),
          book?.md5,
          readUrl,
          book?.readUrl,
          book?.url,
        ].map(cacheIdentity).filter(Boolean));
      }

      function cacheRecordMatches(record: CachedBookRecord, book: PageBook, readUrl: string): boolean {
        const wanted = cacheIdentities(book, readUrl);
        const stored = cacheIdentities(record, record?.readUrl);
        if ([...wanted].some(identity => stored.has(identity))) return true;
        const md5 = String(book?.md5 || '').toLowerCase();
        return isMd5(md5) && [record?.key, record?.readUrl]
          .some(value => String(value || '').toLowerCase().includes(md5));
      }

      function rememberCachedRecord(record: CachedBookRecord): void {
        for (const identity of cacheIdentities(record, record?.readUrl)) cachedBookKeys.add(identity);
      }

      async function cachedBookBlob(book: PageBook, readUrl: string): Promise<Blob | null> {
        if (isDesktopMode) return null;
        const key = bookCacheKey(book, readUrl);
        if (!key) return null;
        const record = (await bookCacheRecords()).find(item => cacheRecordMatches(item, book, readUrl));
        if (!(record?.blob instanceof Blob)) return null;
        const migrated = {
          ...record,
          key,
          md5: book?.md5 || record.md5 || '',
          readUrl: readUrl || record.readUrl || '',
          lastUsed: Date.now(),
        };
        await bookCachePut(migrated);
        if (record.key !== key) await bookCacheDelete(record.key);
        cachedBookKeys.delete(cacheIdentity(record.key));
        rememberCachedRecord(migrated);
        return migrated.blob;
      }

      async function cacheBookBlob(book: PageBook, readUrl: string, blob: Blob): Promise<void> {
        if (isDesktopMode) return;
        if (!(blob instanceof Blob) || !blob.size) return;
        const key = bookCacheKey(book, readUrl);
        if (!key || blob.size > BOOK_CACHE_STORAGE_LIMIT) return;
        const allRecords = await bookCacheRecords();
        const replaced = allRecords.filter(item => cacheRecordMatches(item, book, readUrl));
        const records = allRecords.filter(item => !replaced.includes(item)).sort((a, b) => a.lastUsed - b.lastUsed);
        let total = records.reduce((sum, item) => sum + Number(item.size || item.blob?.size || 0), 0) + blob.size;
        while (total > BOOK_CACHE_STORAGE_LIMIT && records.length) {
          const oldest = records.shift()!;
          await bookCacheDelete(oldest.key);
          cachedBookKeys.delete(oldest.key);
          total -= Number(oldest.size || oldest.blob?.size || 0);
        }
        const record: CachedBookRecord = {
          key,
          blob,
          size: blob.size,
          title: book?.title || '',
          md5: book?.md5 || '',
          authors: book?.authors || '',
          year: book?.year || '',
          language: book?.language || '',
          source: book?.source || '',
          extension: String(book?.extension || book?.format || ''),
          sha256: book?.sha256 || '',
          readUrl,
          lastUsed: Date.now()
        };
        await bookCachePut(record);
        for (const old of replaced) {
          if (old.key !== key) await bookCacheDelete(old.key);
          cachedBookKeys.delete(cacheIdentity(old.key));
        }
        rememberCachedRecord(record);
      }

      let epubTypographyObserver: MutationObserver | undefined;

      function improveEpubTypography() {
        const shell = readerFrame.contentDocument;
        if (!shell) return;
        const applyToFrame = (frame: HTMLIFrameElement) => {
          const apply = () => {
            try {
              const document = frame.contentDocument;
              if (!document?.head || (document.getElementById('bookstr-epub-type') as PageElements['bookstr-epub-type'])) return;
              const style = document.createElement('style');
              style.id = 'bookstr-epub-type';
              style.textContent = `
                html, body {
                  font-family: Georgia, "Times New Roman", serif !important;
                  font-size: 1.04em;
                  line-height: 1.62 !important;
                  text-rendering: optimizeLegibility;
                  font-kerning: normal;
                }
                p { margin-block: 0.72em; orphans: 3; widows: 3; }
                h1, h2, h3, h4, h5, h6 {
                  font-family: "Avenir Next", Avenir, "Gill Sans", sans-serif !important;
                  line-height: 1.18 !important;
                  text-wrap: balance;
                }
                a, a:visited { color: #d7352a !important; }
                blockquote { margin-inline: 1.2em; }
                body.cover,
                body[epub\\:type~="cover"],
                body:has(img.cover),
                body:has(img[id*="cover" i]),
                body:has(img[src*="cover" i]),
                body:has(img[alt*="cover" i]),
                section.cover,
                section[epub\\:type~="cover"] {
                  width: 100% !important;
                  height: 100vh !important;
                  margin: 0 !important;
                  padding: 0 !important;
                  overflow: hidden !important;
                }
                body:has(img.cover) > *,
                body:has(img[id*="cover" i]) > *,
                body:has(img[src*="cover" i]) > *,
                body:has(img[alt*="cover" i]) > * {
                  width: 100% !important;
                  max-width: none !important;
                  height: 100% !important;
                  margin: 0 !important;
                  padding: 0 !important;
                }
                body.cover img,
                body[epub\\:type~="cover"] img,
                section.cover img,
                section[epub\\:type~="cover"] img,
                img.cover,
                img[id*="cover" i],
                img[src*="cover" i],
                img[alt*="cover" i],
                body.cover svg,
                body[epub\\:type~="cover"] svg,
                section.cover svg,
                section[epub\\:type~="cover"] svg {
                  display: block !important;
                  width: 100% !important;
                  height: 100% !important;
                  max-width: none !important;
                  max-height: none !important;
                  margin: 0 !important;
                  object-fit: contain !important;
                }
              `;
              document.head.appendChild(style);
            } catch {}
          };
          frame.addEventListener('load', apply, { once: true });
          apply();
        };
        const applyAll = () => shell.querySelectorAll('iframe').forEach(applyToFrame);
        epubTypographyObserver?.disconnect();
        epubTypographyObserver = new MutationObserver(applyAll);
        epubTypographyObserver.observe(shell.documentElement, { childList: true, subtree: true });
        applyAll();
      }

      let readerOpenGeneration = 0;
      let readerFrameKind = '';
      let readerFrameBookId = '';
      let readerFrameNavigation: ReaderFrameNavigation | null = null;
      let readerFrameNavigationId = 0;

      async function readerFrameLoader(kind: string, openGeneration: number, bookId: string): Promise<ReaderLoader | null> {
        const loaderName = kind === 'pdf' ? 'loadPdf' : kind === 'comic' ? 'loadComic' : 'loadBook';
        const readerPath = kind === 'pdf' ? 'pdf-reader.html' : kind === 'comic' ? 'comic-reader.html' : 'reader.html';
        const requestedBookId = String(bookId || '').trim().toLowerCase();
        const existingLoader = (readerFrame.contentWindow as (Window & Record<string, unknown>) | null)?.[loaderName];
        if (!readerFrameNavigation && readerFrameKind === kind && readerFrameBookId === requestedBookId && typeof existingLoader === 'function') {
          return existingLoader as ReaderLoader;
        }

        if (!readerFrameNavigation || readerFrameNavigation.kind !== kind || readerFrameNavigation.bookId !== requestedBookId) {
          readerFrameNavigation?.cancel();
          const navigationId = ++readerFrameNavigationId;
          let cancelNavigation: (() => void) | undefined;
          const navigation = {
            kind,
            bookId: requestedBookId,
            cancel: () => cancelNavigation?.(),
          } as ReaderFrameNavigation;
          navigation.promise = new Promise<boolean>((resolve, reject) => {
            let settled = false;
            let readinessTimer: ReturnType<typeof setInterval> | undefined;
            const settle = <T>(callback: (value: T) => void) => (value: T) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              clearInterval(readinessTimer);
              callback(value);
            };
            const resolveOnce = settle(resolve);
            const rejectOnce = settle(reject);
            cancelNavigation = () => resolveOnce(false);
            const timeout = setTimeout(() => {
              rejectOnce(new Error(`${kind === 'pdf' ? 'PDF' : kind === 'comic' ? 'comic' : 'EPUB'} reader timed out while loading.`));
            }, 45_000);
            const resolveWhenReady = () => {
              if (readerFrameNavigation !== navigation) return;
              const loader = (readerFrame.contentWindow as (Window & Record<string, unknown>) | null)?.[loaderName];
              // A newly inserted iframe can still emit its initial about:blank
              // load after navigation starts. Ignore it and wait for the
              // document that exposes the requested reader API.
              if (typeof loader !== 'function') return;
              readerFrameKind = kind;
              readerFrameBookId = requestedBookId;
              resolveOnce(true);
            };
            readerFrame.onload = resolveWhenReady;
            // Some Electron/Chromium combinations can deliver the iframe load
            // event before its final script globals are observable here. Poll
            // the concrete loader too, so a missed readiness edge cannot leave
            // the book stuck on its metadata fallback.
            readinessTimer = setInterval(resolveWhenReady, 50);
            readerFrame.src = `${readerPath}?load=${navigationId}`;
          }).finally(() => {
            if (readerFrameNavigation === navigation) readerFrameNavigation = null;
          });
          readerFrameNavigation = navigation;
        }

        const ready = await readerFrameNavigation.promise;
        if (!ready || openGeneration !== readerOpenGeneration || readerFrameKind !== kind) return null;
        const loader = (readerFrame.contentWindow as (Window & Record<string, unknown>) | null)?.[loaderName];
        return typeof loader === 'function' ? loader as ReaderLoader : null;
      }

      async function displayEpub(blob: Blob, book: PageBook, readPath: string, openGeneration: number): Promise<void> {
        const theme = state.settings.theme === 'dark' ? 'night' : state.settings.theme;
        const base64 = await blobToBase64(blob);
        if (openGeneration !== readerOpenGeneration) return;
        const readerLoad = await readerFrameLoader('epub', openGeneration, book.md5 || BookMetadata.bookIdentity(book));
        if (!readerLoad) return;
        await readerLoad(
          base64,
          book.cfi || '',
          theme,
          book.md5 || BookMetadata.bookIdentity(book),
          { ...book, readUrl: readPath || book.readUrl || book.url || '' },
        );
        applyOpenReaderTypography();
        if (revealReadableBook(book, openGeneration)) status.textContent = `Opened ${book.title || 'book'}.`;
      }

      async function displayComic(blob: Blob, book: PageBook, readPath: string, openGeneration: number, format: string): Promise<void> {
        const readerLoad = await readerFrameLoader('comic', openGeneration, book.md5 || BookMetadata.bookIdentity(book));
        if (!readerLoad) return;
        if (openGeneration !== readerOpenGeneration || !revealReadableBook(book, openGeneration)) return;
        status.textContent = `Opening ${book.title || 'comic'}…`;
        const opened = await readerLoad({
          archiveBlob: blob,
          format,
          bookTitle: BookMetadata.resolveTitle(book),
          initialPage: Number(book.pageIndex || book.page || 0) || 0,
          bookId: book.md5 || BookMetadata.bookIdentity(book),
          readUrl: readPath || book.readUrl || book.url || '',
        });
        if (opened && openGeneration === readerOpenGeneration) status.textContent = `Opened ${book.title || 'comic'}.`;
      }

      function pdfDownloadFilename(book: PageBook): string {
        const resolvedTitle = BookMetadata.resolveTitle(book);
        const identity = String(book?.sourceNativeId || book?.source_native_id || book?.md5 || 'book').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 32);
        const usefulTitle = BookMetadata.isPlaceholderTitle(resolvedTitle) ? `Bookstr book ${identity || 'book'}` : resolvedTitle;
        const safeTitle = usefulTitle.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
        return `${safeTitle || 'Bookstr book'}.pdf`;
      }

      async function displayPdf(blob: Blob, book: PageBook, readPath: string, openGeneration: number): Promise<void> {
        const pdfBlob = blob.type === 'application/pdf'
          ? blob
          : new Blob([blob], { type: 'application/pdf' });
        const base64 = await blobToBase64(pdfBlob);
        if (openGeneration !== readerOpenGeneration) return;
        const options = {
          base64,
          bookTitle: BookMetadata.resolveTitle(book),
          filename: pdfDownloadFilename(book),
          theme: state.settings.theme === 'dark' ? 'night' : state.settings.theme,
          initialCfi: book.cfi || '',
          readUrl: readPath || book.readUrl || book.url || '',
          book,
        };
        const readerLoad = await readerFrameLoader('pdf', openGeneration, book.md5 || BookMetadata.bookIdentity(book));
        if (!readerLoad) return;
        await readerLoad(options);
        if (revealReadableBook(book, openGeneration)) status.textContent = `Opened ${book.title || 'PDF'}.`;
      }

      document.addEventListener('keydown', event => {
        if (!document.body.classList.contains('book-open') || event.defaultPrevented) return;
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const command = event.key === 'ArrowLeft' ? 'prevPage' : 'nextPage';
        (readerFrame.contentWindow as (Window & Record<string, (() => void) | undefined>) | null)?.[command]?.();
      });

      function bookWithSavedReadingState(book: PageBook | null | undefined): PageBook | null | undefined {
        if (!book) return book;
        const saved = state.reading.find(item => BookMetadata.sameLibraryBook(item, book));
        if (!saved) return book;
        return {
          ...book,
          progression: BookMetadata.readingProgressForBook(saved),
          furthestProgression: Math.max(
            Number(saved.furthestProgression || 0) || 0,
            Number(BookMetadata.readingProgressForBook(saved) || 0),
          ),
          cfi: saved.cfi || book.cfi || '',
          readUrl: book.readUrl || book.url || saved.readUrl || saved.url || '',
          updatedAt: Math.max(Number(book.updatedAt || 0), Number(saved.updatedAt || 0)),
        };
      }

      function bookWithChosenNostrReadingState(book: PageBook): PageBook {
        const bookId = String(book?.md5 || '').trim().toLowerCase();
        const remote = nostrAheadReadingByBook.get(bookId);
        if (!remote) return book;
        const local = state.reading.find(item => String(item?.md5 || '').trim().toLowerCase() === bookId);
        if (!local || !BookstrDesktopProgress.isProgressAhead(remote as unknown as Parameters<typeof BookstrDesktopProgress.isProgressAhead>[0], local as unknown as Parameters<typeof BookstrDesktopProgress.isProgressAhead>[1])) {
          nostrAheadReadingByBook.delete(bookId);
          return book;
        }
        const localPercent = Math.round((BookMetadata.readingProgressForBook(local as PageBook) as number) * 100);
        const remotePercent = Math.round((BookMetadata.readingProgressForBook(remote as PageBook) as number) * 100);
        const title = BookMetadata.resolveTitle(book) || 'this book';
        const useRemote = window.confirm(
          `Nostr has a further position for ${title} (${remotePercent}%, local ${localPercent}%). Continue from the Nostr position?`,
        );
        if (!useRemote) return book;
        nostrAheadReadingByBook.delete(bookId);
        const adopted = applyDesktopReadingProgress({ ...local, ...remote, md5: bookId, updatedAt: Date.now() });
        return adopted ? { ...book, ...adopted } : book;
      }

      async function openBook(book: PageBook | null | undefined, { updateHash = true, addToReading = true }: { updateHash?: boolean; addToReading?: boolean } = {}): Promise<void> {
        if (!book) {
          status.textContent = `${(book as PageBook | null | undefined)?.title || 'This book'} has metadata only; no readable copy is available.`;
          return;
        }
        if (isDisabledBookFormat(book.extension || book.format)) {
          status.textContent = `Could not open ${book.title || 'book'}: The downloaded book format is not supported.`;
          return;
        }

        const previousBookId = String(activeReadingBook?.md5 || '').trim().toLowerCase();
        const nextBookId = String(book.md5 || '').trim().toLowerCase();
        if (previousBookId && previousBookId !== nextBookId) void flushReadingProgressPublish(previousBookId);
        book = bookWithSavedReadingState(book)!;
        book = bookWithChosenNostrReadingState(book);

        const openGeneration = ++readerOpenGeneration;
        const readPath = BookMetadata.canonicalReadUrl(book, BOOKS_API_BASE);
        if (!book.md5) {
          const gutenbergId = readPath.match(/\/api\/books\/(\d+)\/download(?:\?|$)/)?.[1];
          if (gutenbergId) book = { ...book, md5: `gutenberg:${gutenbergId}` };
        }
        activeReadingBook = book;
        activateTab('reading');
        requestAnimationFrame(() => readerSection.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        if (updateHash) {
          setHashRoute(`read=${encodeURIComponent(readRouteValue(book, readPath))}`);
        }

        try {
          let torrentBlob = null;
          let torrentError = null;
          try {
            torrentBlob = isDesktopMode
              ? await fetchDesktopTorrentCopy(book)
              : await fetchBrowserTorrentCopy(book);
          } catch (error) {
            torrentError = error;
            console.warn('Public torrent unavailable; using network fallback.', error);
          }
          if (torrentBlob) {
            const torrentFormat = await bookFormatForBlob(torrentBlob) || String(book.extension || '').toLowerCase();
            rememberDetectedBookFormat(book, torrentFormat);
            if (torrentFormat === 'pdf') await displayPdf(torrentBlob, book, readPath, openGeneration);
            else if (torrentFormat === 'cbz' || torrentFormat === 'cbr') await displayComic(torrentBlob, book, readPath, openGeneration, torrentFormat);
            else await displayEpub(torrentBlob, book, readPath, openGeneration);
          } else {
            if (torrentError && !readPath) throw torrentError;
            if (String(book.extension || '').toLowerCase() === 'pdf' || /\.pdf(?:\?|$)/i.test(readPath)) {
            let blob = await cachedBookBlob(book, readPath).catch(() => null);
            if (openGeneration !== readerOpenGeneration) return;
            if (!blob) {
              status.textContent = `Loading ${book.title || 'PDF'}…`;
              const response = await fetch(readPath);
              if (!response.ok) throw new Error(`PDF download failed (${response.status}).`);
              blob = await response.blob();
              await enforceBlobSha256(book, blob);
              if (openGeneration !== readerOpenGeneration) return;
              void cacheBookBlob(book, readPath, blob).catch(() => {});
            }
            await displayPdf(blob, book, readPath, openGeneration);
            } else if (['cbz', 'cbr'].includes(String(book.extension || '').toLowerCase()) || /\.(?:cbz|cbr)(?:\?|$)/i.test(readPath)) {
            let blob = await cachedBookBlob(book, readPath).catch(() => null);
            if (!blob) {
              if (!readPath) throw new Error('No cached comic archive was found.');
              const response = await fetch(readPath);
              if (!response.ok) throw new Error(`Comic download failed (${response.status}).`);
              blob = await response.blob();
              await enforceBlobSha256(book, blob);
              void cacheBookBlob(book, readPath, blob).catch(() => {});
            }
            const format = await bookFormatForBlob(blob) || String(book.extension || '').toLowerCase();
            await displayComic(blob, book, readPath, openGeneration, format);
            } else if (String(book.extension || '').toLowerCase() === 'epub' || /\.epub(?:\?|$)/i.test(readPath) || /\/download(?:\?|$)/i.test(readPath) || (!readPath && isMd5(book.md5))) {
            let blob = await cachedBookBlob(book, readPath).catch(() => null);
            if (openGeneration !== readerOpenGeneration) return;
            if (blob) {
              status.textContent = `Opening cached ${book.title || 'book'}…`;
            } else {
              if (!readPath) throw new Error('No cached or downloadable copy was found.');
              status.textContent = `Loading ${book.title || 'book'}…`;
              const response = await fetch(readPath);
              if (!response.ok) throw new Error(`EPUB download failed (${response.status}).`);
              blob = await response.blob();
              await enforceBlobSha256(book, blob);
              if (openGeneration !== readerOpenGeneration) return;
              void cacheBookBlob(book, readPath, blob).catch(() => {});
            }
            const format = await bookFormatForBlob(blob);
            if (format === 'pdf') await displayPdf(blob, book, readPath, openGeneration);
            else await displayEpub(blob, book, readPath, openGeneration);
            } else if (/\/api\/files\/[a-f0-9]{32}(?:\?|$)/i.test(readPath)) {
            status.textContent = `Loading ${book.title || 'book'}…`;
            const response = await fetch(readPath);
            if (!response.ok) throw new Error(`Book download failed (${response.status}).`);
            const blob = await response.blob();
            await enforceBlobSha256(book, blob);
            if (openGeneration !== readerOpenGeneration) return;
            const format = await bookFormatForBlob(blob);
            if (format === 'pdf') await displayPdf(blob, book, readPath, openGeneration);
            else if (format === 'epub') await displayEpub(blob, book, readPath, openGeneration);
            else if (format === 'cbz' || format === 'cbr') await displayComic(blob, book, readPath, openGeneration, format);
            else throw new Error('The downloaded book format is not supported.');
            void cacheBookBlob(book, readPath, blob).catch(() => {});
          } else {
            throw new Error('Only EPUB, PDF, CBZ, and CBR book files can be opened.');
            }
          }
        } catch (error) {
          status.textContent = `Could not open ${book.title || 'book'}: ${(error as Error)?.message || error}`;
          updateReadMetadataFallbackDiagnostics(book, {
            readPath,
            cacheStatus: cachedBookKeys.has(bookCacheKey(book, readPath)) ? 'A local cache entry exists' : 'No usable local cached copy',
            error,
          });
          return;
        }
        if (openGeneration !== readerOpenGeneration) return;
        if (addToReading && state.settings.autoReading && book.md5) {
		  const currentRights = activeReadingBook && BookMetadata.sameLibraryBook(activeReadingBook, book)
			? BookMetadata.preferredRights(book, activeReadingBook)
			: BookMetadata.normalizeRights(book);
          upsertById(state.reading, {
            md5: book.md5,
            title: book.title,
            authors: book.authors,
            year: book.year || '',
            language: book.language || '',
            source: book.source || '',
            extension: book.extension || 'epub',
            sha256: book.sha256 || '',
			...currentRights,
			readUrl: readPath
          });
          state.reading = state.reading.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)).slice();
          localStorage.setItem(READING_KEY, JSON.stringify(state.reading));
          renderReading();
        }
      }

      async function searchAllBooksPartySource(query: string): Promise<PageBook[]> {
        const res = await fetch(`${BOOKS_API_BASE}/search?q=${encodeURIComponent(query)}&limit=${SEARCH_RESULT_LIMIT}`);
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error || `search failed (${res.status})`);
        return normalizeSearchBooks(payload, 'all.books.party');
      }

      function resetNip17Exchange() {
        nip17Exchange.classList.remove('hidden');
        nip17Exchange.open = false;
        nip17Sent.textContent = 'Preparing encrypted request…';
        nip17Received.textContent = 'Waiting for a response…';
      }

      function showNip17Trace(trace: { direction?: string; recipient?: string; recipientNip05?: string; relays?: string[]; payload?: unknown; event?: unknown; relay?: string; error?: string } | null | undefined): void {
        nip17Exchange.classList.remove('hidden');
        if (trace?.direction === 'sent') {
          nip17Sent.textContent = JSON.stringify({
            recipient: trace.recipient,
            recipient_nip05: trace.recipientNip05,
            relays: trace.relays,
            decrypted_payload: trace.payload,
            gift_wrap_event: trace.event,
          }, null, 2);
        } else if (trace?.direction === 'received') {
          nip17Received.textContent = JSON.stringify({
            relay: trace.relay || '',
            decrypted_payload: trace.payload,
            gift_wrap_event: trace.event || null,
          }, null, 2);
        } else if (trace?.direction === 'error') {
          const reason = trace.error || 'Unknown Nostr error';
          if (nip17Received.textContent === 'Waiting for a response…') {
            nip17Received.textContent = `No private response received.\n\n${reason}`;
          } else {
            nip17Received.textContent += `\n\nFallback reason: ${reason}`;
          }
        }
      }

      async function searchCustomOPDSFeed(feed: { name: string; url: string }, query: string): Promise<PageBook[]> {
        const adapter = await getOPDSSourcesModule();
        const records = await adapter.searchOPDSFeed(feed, query);
        const books = records.map(record => adapter.providerRecordToBook(record, feed.url)).filter(Boolean);
        return dedupeBooks(normalizeSearchBooks({ books }, adapter.providerForOPDSFeed(feed)));
      }

      async function searchLibcatSource(query: string): Promise<PageBook[]> {
        const generation = activeSearchGeneration;
        const type = searchType.value || 'all';
        nip17FetchModule ||= import('./nip17-fetch.js');
        const module = await nip17FetchModule!;
        const response = await module.searchLibcat(query, type, {
          signer: nostrSigner, publish: publishRelayEvent, limit: 50,
        }) as Record<string, unknown> & { next_offset?: number };
        const nextOffset = response.next_offset as number;
        if (generation === activeSearchGeneration) {
          libcatPage = Number.isSafeInteger(nextOffset) && nextOffset > 0
            ? { query, type, offset: nextOffset, generation } : null;
        }
        return normalizeSearchBooks(response, 'libvault').map(book => ({ ...book, searchSourceId: 'libcat' }));
      }

      async function loadMoreLibcat(): Promise<void> {
        if (!libcatPage || searchLoadMore.disabled) return;
        const page = libcatPage;
        searchLoadMore.disabled = true;
        try {
          const module = await nip17FetchModule!;
          const response = await module.searchLibcat(page.query, page.type, {
            signer: nostrSigner, publish: publishRelayEvent, limit: 50, offset: page.offset,
          }) as Record<string, unknown> & { next_offset?: number };
          if (page.generation !== activeSearchGeneration) return;
          const books = dedupeBooks([...searchResultBooks, ...normalizeSearchBooks(response, 'libvault').map(book => ({ ...book, searchSourceId: 'libcat' }))]);
          const nextOffset = response.next_offset as number;
          libcatPage = Number.isSafeInteger(nextOffset) && nextOffset > page.offset
            ? { ...page, offset: nextOffset } : null;
          renderResults(books, { routeState: { ...searchResultFilter, page: searchResultPage } });
          searchLoadMore.classList.toggle('hidden', !libcatPage);
          replaceSearchHash();
        } catch (error) {
          if (page.generation === activeSearchGeneration) status.textContent = (error as Error).message || 'Could not load more results';
        } finally {
          if (page.generation === activeSearchGeneration) searchLoadMore.disabled = false;
        }
      }

      function searchSourceRegistry(): SearchSource[] {
        if (isDesktopMode) {
          return [{
            id: 'libcat', name: 'Libcat', coverage: 'Your private book catalogs',
            deliveries: ['Metadata', 'Torrent identifiers'], access: 'Private', search: searchLibcatSource,
          }];
        }
        const sources: SearchSource[] = [
          {
            id: 'all-books-party', name: 'all.books.party',
            coverage: 'Broad catalog metadata, including Open Library and Project Gutenberg',
            deliveries: ['Metadata', 'Source links', 'Some EPUBs'], access: 'Public', search: searchAllBooksPartySource,
          },
          {
            id: 'unglueit', name: 'Unglue.it', coverage: 'Free and open-access books',
            deliveries: ['Metadata', 'EPUB', 'PDF', 'Licenses'], access: 'Public', search: searchUnglueIt,
          },
          {
            id: 'gutenberg', name: 'Project Gutenberg', coverage: 'Public-domain ebooks',
            deliveries: ['Metadata', 'EPUB', 'Covers'], access: 'Public', search: searchProjectGutenberg,
          },
          {
            id: 'oapen', name: 'OAPEN', coverage: 'Peer-reviewed open-access academic books',
            deliveries: ['Metadata', 'PDF', 'Licenses'], access: 'Public', search: searchOapen,
          },
          {
            id: 'open-textbook-library', name: 'Open Textbook Library', coverage: 'Reviewed open textbooks',
            deliveries: ['Metadata', 'Source links', 'Licenses'], access: 'Public', search: searchOpenTextbookLibrary,
          },
          {
            id: 'doab', name: 'DOAB', coverage: 'Peer-reviewed open-access academic books',
            deliveries: ['Metadata', 'Source links', 'Licenses'], access: 'Public', search: searchDoab,
          },
          {
            id: 'global-digital-library', name: 'Global Digital Library', coverage: 'Multilingual children’s and learning books',
            deliveries: ['Metadata', 'EPUB', 'Licenses', 'Covers'], access: 'Public', search: searchGlobalDigitalLibrary,
          },
          {
            id: 'internet-archive', name: 'Internet Archive', coverage: 'Publicly downloadable digitized and born-digital books',
            deliveries: ['Metadata', 'EPUB', 'PDF'], access: 'Public', search: searchInternetArchive,
          },
        ];
        if (state.nip7?.pubkey && nostrSigner?.nip44?.decrypt) sources.unshift({
          id: 'libcat', name: 'Libcat', coverage: 'Your private book catalogs',
          deliveries: ['Metadata', 'Torrent identifiers'], access: 'Private', search: searchLibcatSource,
        });
        for (const feed of normalizePublicOPDSFeedSettings(state.settings.opdsFeeds)) {
          sources.push({
            id: `opds-${feed.url}`,
            name: feed.name,
            coverage: 'Your public OPDS catalogue',
            deliveries: ['Metadata'],
            access: 'Public',
            search: query => searchCustomOPDSFeed(feed, query),
          });
        }
        return sources;
      }

      function disabledSearchSourceIds(): Set<string> {
        const stored = safeJSONRead(localStorage.getItem(SEARCH_SOURCE_SETTINGS_KEY), []);
        return new Set(Array.isArray(stored) ? stored.map(value => String(value || '')).filter(Boolean) : []);
      }

      function isSearchSourceEnabled(sourceId: string): boolean {
        return !disabledSearchSourceIds().has(String(sourceId || ''));
      }

      function setSearchSourceEnabled(sourceId: string, enabled: boolean): void {
        const disabled = disabledSearchSourceIds();
        if (enabled) disabled.delete(sourceId);
        else disabled.add(sourceId);
        localStorage.setItem(SEARCH_SOURCE_SETTINGS_KEY, JSON.stringify([...disabled].sort()));
      }

      function renderSearchSources(): void {
        renderSearchSourceProgress([]);
        const sources = searchSourceRegistry();
        const rows = sources.map(source => {
          const enabled = isSearchSourceEnabled(source.id);
          return `
          <tr data-source="${escapeHtml(source.id)}" class="${enabled ? '' : 'source-disabled'}">
            <td data-label="Source"><strong>${escapeHtml(source.name)}</strong></td>
            <td data-label="Coverage">${escapeHtml(source.coverage)}</td>
            <td data-label="Delivers"><span class="source-deliveries">${source.deliveries.map(item => `<span class="source-delivery">${escapeHtml(item)}</span>`).join('')}</span></td>
            <td data-label="Use"><label class="search-source-toggle"><input type="checkbox" data-action="toggle-search-source" data-source-id="${escapeHtml(source.id)}" ${enabled ? 'checked' : ''}><span>${enabled ? 'On' : 'Off'}</span></label></td>
          </tr>`;
        }).join('');
        resultsEl.innerHTML = `<section class="search-sources" aria-labelledby="search-sources-title">
          <h3 id="search-sources-title">Sources</h3>
          ${rows ? `<table id="search-sources-table" class="search-sources-table">
            <thead><tr><th>Source</th><th>Coverage</th><th>Delivers</th><th>Use</th></tr></thead>
            <tbody>${rows}</tbody></table>` : '<p class="note">No book catalogs are configured.</p>'}
        </section>`;
        resultsEl.querySelectorAll('[data-action="toggle-search-source"]').forEach(input => {
          input.addEventListener('change', event => {
            const target = event.currentTarget as HTMLInputElement;
            setSearchSourceEnabled(target.dataset.sourceId || '', target.checked);
            renderSearchSources();
          });
        });
      }

      function renderSearchSourceProgress(entries: SearchSourceProgress[]): void {
        const target = (document.getElementById('search-source-progress') as PageElements['search-source-progress']);
        if (!target) return;
        if (!entries.length) {
          target.replaceChildren();
          target.classList.add('hidden');
          return;
        }
        target.classList.remove('hidden');
        target.innerHTML = searchSourceRegistry().map(source => {
          const entry = entries.find(entry => entry.source.id === source.id) || { source, state: 'cached' };
          const enabled = isSearchSourceEnabled(source.id);
          const state = entry.state || (entry.error ? 'failed' : 'done');
          const stateText = !enabled ? 'Off' : state === 'cached' ? '' : state === 'pending'
            ? 'Searching'
            : state === 'failed'
              ? 'Failed'
              : `Done · ${Number(entry.count || 0)} result${Number(entry.count || 0) === 1 ? '' : 's'}`;
          return `<li data-source="${escapeHtml(entry.source.id)}" data-state="${escapeHtml(state)}">
            <label class="search-source-toggle"><input type="checkbox" data-action="toggle-search-source" data-source-id="${escapeHtml(source.id)}" ${enabled ? 'checked' : ''}><span>${escapeHtml(source.name)}</span></label><span class="search-source-state">${escapeHtml(stateText)}</span>
          </li>`;
        }).join('');
        target.querySelectorAll('[data-action="toggle-search-source"]').forEach(input => {
          input.addEventListener('change', event => {
            const target = event.currentTarget as HTMLInputElement;
            setSearchSourceEnabled(target.dataset.sourceId || '', target.checked);
            void startSearch({ updateHash: false, bypassCache: true });
          });
        });
      }

      async function searchAvailableBookSources(query: string, onUpdate: (progress: SearchSourceProgress[], books: PageBook[]) => void = () => {}): Promise<{ books: PageBook[]; outcomes: SearchOutcome[] }> {
        const sources = searchSourceRegistry().filter(source => isSearchSourceEnabled(source.id));
        if (!sources.length) {
          onUpdate(searchSourceRegistry().map(source => ({ source, state: 'cached' })), []);
          return { books: [], outcomes: [] };
        }
        const arrivedBooks: PageBook[] = [];
        const catalogBooks: PageBook[] = [];
        const mergedBooks = (): PageBook[] => dedupeBooks([...catalogBooks, ...dedupeBooks(arrivedBooks).slice(0, SEARCH_RESULT_LIMIT)]);
        const progress: SearchSourceProgress[] = sources.map(source => ({ source, state: 'pending', count: 0, error: null }));
        onUpdate(progress, []);
        const outcomes: SearchOutcome[] = await Promise.all(sources.map(async (source, index): Promise<SearchOutcome> => {
          let outcome;
          try {
            const books = await source.search(query);
            outcome = { source, books, error: null };
            (source.id === 'libcat' ? catalogBooks : arrivedBooks).push(...books);
            progress[index] = { source, state: 'done', count: books.length, error: null };
          } catch (error) {
            outcome = { source, books: [], error };
            progress[index] = { source, state: 'failed', count: 0, error };
          }
          onUpdate(
            progress.slice(),
            mergedBooks(),
          );
          return outcome;
        }));
        if (outcomes.every(outcome => outcome.error)) {
          throw new Error(outcomes.map(outcome => `${outcome.source.name}: ${(outcome.error as Error)?.message || outcome.error}`).join('; '));
        }
        return { books: mergedBooks(), outcomes };
      }

      function searchOutcomeSummary(outcomes: SearchOutcome[]): string {
        return outcomes.map(outcome => outcome.error
          ? `${outcome.source.name}: failed`
          : `${outcome.source.name}: ${outcome.books.length}`).join(' · ');
      }

      function searchCacheIdentity(query: string): string {
        return JSON.stringify({
          query: String(query || '').trim().toLocaleLowerCase(),
          type: searchType.value || 'all',
          opdsFeeds: normalizePublicOPDSFeedSettings(state.settings.opdsFeeds),
          sources: searchSourceRegistry().filter(source => isSearchSourceEnabled(source.id)).map(source => source.id).sort(),
        });
      }

      function freshSearchCacheEntries(): SearchCacheEntry[] {
        const entries = safeJSONRead(localStorage.getItem(SEARCH_CACHE_KEY), []) as SearchCacheEntry[];
        return (Array.isArray(entries) ? entries : [])
          .filter(entry => entry?.key && Array.isArray(entry.books)
            && Date.now() - Number(entry.ts || 0) < SEARCH_CACHE_TTL_MS)
          .sort((left, right) => Number(right.ts || 0) - Number(left.ts || 0))
          .slice(0, SEARCH_CACHE_MAX_ENTRIES);
      }

      function cachedSearchBooks(query: string): PageBook[] | null {
        const entries = freshSearchCacheEntries();
        try { localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify(entries)); } catch {}
        return entries.find(entry => entry.key === searchCacheIdentity(query))?.books || null;
      }

      function cacheSearchBooks(query: string, books: PageBook[]): void {
        const key = searchCacheIdentity(query);
        const entries = [
          { key, ts: Date.now(), books: books.slice(0, SEARCH_RESULT_LIMIT) },
          ...freshSearchCacheEntries().filter(entry => entry.key !== key),
        ].slice(0, SEARCH_CACHE_MAX_ENTRIES);
        try { localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify(entries)); } catch {
          try { localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify(entries.slice(0, 1))); } catch {}
        }
      }

      async function startSearch({ updateHash = true, routeState = null, bypassCache = false }: { updateHash?: boolean; routeState?: SearchRouteState | null; bypassCache?: boolean } = {}): Promise<void> {
        const searchGeneration = ++activeSearchGeneration;
        libcatPage = null;
        searchLoadMore.classList.add('hidden');
        searchLoadMore.disabled = false;
        // Source adapters may report partial results before their final result.
        // Once the user has seen a result set, retain any filter/page choice
        // while a later adapter update re-renders it.
        let renderedSearchResults = false;
        const renderSearchResults = (books: PageBook[]) => {
          const currentRouteState = renderedSearchResults
            ? {
              language: searchResultFilter.language,
              format: searchResultFilter.format,
              page: searchResultPage,
            }
            : routeState;
          renderResults(books, { routeState: currentRouteState });
          renderedSearchResults = true;
        };
        const query = queryInput.value.trim();
        if (!query) {
          renderSearchSources();
          searchResultFilters.classList.add('hidden');
          searchResultCount.textContent = '';
          searchPagination.classList.add('hidden');
          status.textContent = '';
          return;
        }
        if (query.length < 2) {
          status.textContent = 'Type at least 2 characters to search.';
          queryInput.focus();
          return;
        }
        if (updateHash) {
          setHashRoute(searchHashRoute({ query, language: '', format: '', page: 1 }));
        }
        resultsEl.innerHTML = '';
        searchResultFilters.classList.add('hidden');
        searchResultCount.textContent = '0 results';
        searchPagination.classList.add('hidden');
        resetNip17Exchange();
        const cachedBooks = bypassCache || state.nip7?.pubkey && isSearchSourceEnabled('libcat') ? null : cachedSearchBooks(query);
        if (cachedBooks) {
          renderSearchSourceProgress(searchSourceRegistry().map(source => ({ source, state: 'cached' })));
          const books = cachedBooks.filter(book => matchesExactSearchTokens(
            book,
            query,
            searchType.value || 'all',
          ));
          renderSearchResults(books);
          status.textContent = `Showing ${books.length} cached result${books.length === 1 ? '' : 's'} · refreshes after 10 minutes.`;
          replaceSearchHash();
          renderButtonsState();
          return;
        }
        status.textContent = 'Searching book catalogs…';
        try {
          const searchResponse = await searchAvailableBookSources(query, (progress: SearchSourceProgress[], arrivedBooks: PageBook[]) => {
            if (searchGeneration !== activeSearchGeneration) return;
            renderSearchSourceProgress(progress);
            if (!arrivedBooks.length) return;
            const matchingBooks = arrivedBooks.filter(book => matchesExactSearchTokens(
              book,
              query,
              searchType.value || 'all',
            ));
            renderSearchResults(matchingBooks);
            renderButtonsState();
          });
          if (searchGeneration !== activeSearchGeneration) return;
          let books = searchResponse.books;
          books = books.filter(book => matchesExactSearchTokens(book, query, searchType.value || 'all'));
          if (!state.nip7?.pubkey || !isSearchSourceEnabled('libcat')) cacheSearchBooks(query, books);
          searchLoadMore.classList.toggle('hidden', !libcatPage);
          status.textContent = `${searchOutcomeSummary(searchResponse.outcomes)} · ${books.length} result(s).`;
          renderSearchResults(books);
          replaceSearchHash();
          renderButtonsState();
          if (!books.length) {
            status.textContent += ' No matches found.';
          }
        } catch (error) {
          if (searchGeneration !== activeSearchGeneration) return;
          const message = (error as Error).message || String(error);
          status.textContent = `Search failed: ${message}`;
          resultsEl.innerHTML = `<p class="note">${escapeHtml((error as Error).message || 'Search failed. Check your network connection and try again.')}</p>`;
          searchResultCount.textContent = '0 results';
          searchPagination.classList.add('hidden');
        }
      }

      homeSearchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const query = homeQueryInput.value.trim();
        if (!query) return;
        queryInput.value = query;
        activateTab('search');
        void startSearch();
      });
      searchType.addEventListener('change', () => {
        if (!queryInput.value.trim()) renderSearchSources();
      });
      renderSearchSources();
      homeQueryInput.addEventListener('input', () => {
        clearTimeout(homeLibraryFilterTimer as ReturnType<typeof setTimeout>);
        homeLibraryFilterTimer = setTimeout(renderHome, 80);
      });
      homeLanguageFilter.addEventListener('change', () => {
        homeLibraryFilter.language = homeLanguageFilter.value;
        renderHome();
        replaceHomeHash();
      });
      homeFormatFilter.addEventListener('change', () => {
        homeLibraryFilter.format = homeFormatFilter.value;
        renderHome();
        replaceHomeHash();
      });

      async function refreshDesktopSignerStatus(message = '') {
        const desktopSigner = nostrSigner as unknown as NonNullable<MigratedDesktopBridge['signer']> | undefined;
        if (!isDesktopMode || !desktopSigner?.status) return null;
        try {
          const signerState = await desktopSigner.status() as { mode?: string; configured?: boolean; pubkey?: string; persistent?: boolean };
          const modeLabel = signerState.mode === 'nip46'
            ? 'Connected with NIP-46 remote signer'
            : signerState.mode === 'nsec'
              ? 'Connected with local nsec'
              : 'No signer connected';
          const connected = Boolean(signerState.configured);
          const npub = signerState.pubkey ? publicKeyToNpub(signerState.pubkey) || shortPubkey(signerState.pubkey) : '';
          desktopSignerMethod.textContent = message || modeLabel;
          desktopSignerNpub.textContent = npub;
          desktopSignerNpub.title = npub;
          desktopSignerNpub.classList.toggle('hidden', !connected || !npub);
          desktopSignerStorage.textContent = connected && !signerState.persistent ? 'Available for this session only' : '';
          desktopSignerStorage.classList.toggle('hidden', !connected || signerState.persistent);
          desktopSignerPanel.classList.toggle('signer-connected', connected);
          desktopSignerStatus.classList.toggle('signer-connected', connected);
          desktopSignerDisconnect.classList.toggle('hidden', !connected);
          desktopNip46QrStart.classList.toggle('hidden', connected);
          if (connected) {
            desktopNip46QrImage.hidden = true;
            desktopNip46Qr.classList.add('hidden');
          }
          return signerState;
        } catch (error) {
          desktopSignerPanel.classList.remove('signer-connected');
          desktopSignerStatus.classList.remove('signer-connected');
          desktopSignerMethod.textContent = `Signer status unavailable: ${(error as Error)?.message || error}`;
          desktopSignerNpub.classList.add('hidden');
          desktopSignerStorage.classList.add('hidden');
          return null;
        }
      }

      function setDesktopSignerMessage(message: string): void {
        desktopSignerMethod.textContent = message;
      }

      function stopDesktopNip46QrPolling(): void {
        if (desktopNip46QrTimer) clearInterval(desktopNip46QrTimer);
        desktopNip46QrTimer = null;
      }

      function desktopSignerApi(): NonNullable<MigratedDesktopBridge['signer']> {
        return nostrSigner as unknown as NonNullable<MigratedDesktopBridge['signer']>;
      }

      async function pollDesktopNip46Qr(): Promise<void> {
        let qrState: { status?: string; uri?: string; qrDataUrl?: string; error?: string };
        try {
          qrState = await desktopSignerApi().nip46QrStatus() as typeof qrState;
        } catch (error) {
          setDesktopSignerMessage(`Could not check NIP-46 connection: ${(error as Error)?.message || error}`);
          return;
        }
        if (qrState.status === 'waiting') return;
        if (qrState.status === 'authorizing') {
          setDesktopSignerMessage('Signer approved. Finishing the secure connection…');
          return;
        }
        stopDesktopNip46QrPolling();
        if (qrState.status === 'connected') {
          desktopNip46QrImage.hidden = true;
          desktopNip46Qr.classList.add('hidden');
          enableDesktopNostrSigner();
          await connectNip7({ silent: true });
          await refreshDesktopSignerStatus();
        } else if (qrState.status === 'failed') {
          setDesktopSignerMessage(`NIP-46 connection failed: ${qrState.error || 'Signer did not connect.'}`);
        }
      }

      function enableDesktopNostrSigner(): void {
        state.settings.useNip7 = true;
        nip7EnabledInput.checked = true;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
      }

      async function startDesktopNip46Qr(): Promise<void> {
        desktopNip46QrStart.disabled = true;
        setDesktopSignerMessage('Preparing a secure NIP-46 invitation…');
        try {
          const qrSession = await desktopSignerApi().startNip46Qr() as { uri: string; qrDataUrl: string };
          desktopNip46QrUri = qrSession.uri;
          desktopNip46QrImage.src = qrSession.qrDataUrl;
          desktopNip46QrImage.hidden = false;
          desktopNip46Qr.classList.remove('hidden');
          desktopNip46QrStart.classList.add('hidden');
          setDesktopSignerMessage('Waiting for your remote signer…');
          stopDesktopNip46QrPolling();
          desktopNip46QrTimer = setInterval(() => void pollDesktopNip46Qr(), 1000);
        } catch (error) {
          setDesktopSignerMessage(`Could not start NIP-46: ${(error as Error)?.message || error}`);
        } finally {
          desktopNip46QrStart.disabled = false;
        }
      }

      async function cancelDesktopNip46Qr(): Promise<void> {
        stopDesktopNip46QrPolling();
        await desktopSignerApi().cancelNip46Qr();
        desktopNip46QrUri = '';
        desktopNip46QrImage.removeAttribute('src');
        desktopNip46QrImage.hidden = true;
        desktopNip46Qr.classList.add('hidden');
        desktopNip46QrStart.classList.remove('hidden');
        await refreshDesktopSignerStatus();
      }

      async function connectDesktopNip46(): Promise<void> {
        const input = desktopNip46Input.value.trim();
        if (!input) {
          setDesktopSignerMessage('Paste a bunker:// connection or NIP-05 signer address.');
          desktopNip46Input.focus();
          return;
        }
        desktopNip46Connect.disabled = true;
        setDesktopSignerMessage('Waiting for NIP-46 signer approval…');
        try {
          await desktopSignerApi().connectNip46(input);
          desktopNip46Input.value = '';
          enableDesktopNostrSigner();
          await connectNip7({ silent: true });
          await refreshDesktopSignerStatus();
        } catch (error) {
          setDesktopSignerMessage(`NIP-46 connection failed: ${(error as Error)?.message || error}`);
        } finally {
          desktopNip46Connect.disabled = false;
        }
      }

      async function connectDesktopNsec(): Promise<void> {
        const secret = desktopNsecInput.value.trim();
        if (!secret) {
          setDesktopSignerMessage('Paste an nsec1… key.');
          desktopNsecInput.focus();
          return;
        }
        desktopNsecConnect.disabled = true;
        try {
          await desktopSignerApi().setNsec(secret);
          desktopNsecInput.value = '';
          enableDesktopNostrSigner();
          await connectNip7({ silent: true });
          await refreshDesktopSignerStatus();
        } catch (error) {
          setDesktopSignerMessage(`nsec connection failed: ${(error as Error)?.message || error}`);
        } finally {
          desktopNsecConnect.disabled = false;
        }
      }

      async function disconnectDesktopNostrSigner(): Promise<void> {
        await desktopSignerApi().disconnect();
        state.nip7.pubkey = '';
        state.nip7.npub = '';
        localStorage.removeItem(NIP7_STATUS_KEY);
        updateNip7Status();
        await refreshDesktopSignerStatus();
      }

      function speechVoices(): SpeechSynthesisVoice[] {
        if (!isDesktopMode || typeof window.speechSynthesis?.getVoices !== 'function') return [];
        return window.speechSynthesis.getVoices().filter(voice => voice && (voice.name || voice.voiceURI));
      }

      function preferredSpeechPattern(language: string): RegExp {
        if (language === 'en') return /kokoro/i;
        if (language === 'pt') return /tug[aã]o/i;
        return /$a/;
      }

      function populateSpeechVoiceMenu(select: HTMLSelectElement | null, language: string, savedIdentifier: string | null | undefined): void {
        if (!select) return;
        const voices = BookstrSpeechSettings.voicesForLanguage(speechVoices(), language, preferredSpeechPattern(language));
        const selected = String(savedIdentifier || '');
        select.replaceChildren(new Option('Best installed voice', ''));
        voices.forEach(voice => {
          const identifier = String(voice.voiceURI || voice.name);
          const localLabel = voice.localService === false ? 'online' : 'installed';
          select.append(new Option(`${voice.name} · ${voice.lang || language} · ${localLabel}`, identifier));
        });
        if (selected && !voices.some(voice => String(voice.voiceURI || voice.name) === selected)) {
          const option = new Option('Previously selected voice · unavailable', selected);
          option.disabled = true;
          option.selected = true;
          select.append(option);
        } else {
          select.value = selected;
        }
      }

      function refreshSpeechVoiceMenus() {
        const displayNames = typeof Intl.DisplayNames === 'function'
          ? new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' })
          : null;
        const bookLanguages = BookMetadata.mergeLibraryState(state.reading, state.favorites)
          .map(book => BookMetadata.languageForBook(book))
          .filter((value): value is string => Boolean(value));
        const languages = BookstrSpeechSettings.languagesForCodes([...bookLanguages, 'en', 'pt'], displayNames);
        const requestedLanguage = BookstrSpeechSettings.languageCode(state.settings.speechLanguage || '');
        speechLanguageInput.replaceChildren();
        if (!languages.length) {
          const empty = new Option('No book languages', '');
          empty.disabled = true;
          empty.selected = true;
          speechLanguageInput.append(empty);
          speechLanguageInput.disabled = true;
          speechVoiceInput.replaceChildren(new Option('No language-specific voice', ''));
          speechVoiceInput.disabled = true;
          updateSpeechModelVisibility();
          return;
        }
        speechLanguageInput.disabled = false;
        speechVoiceInput.disabled = false;
        languages.forEach(language => speechLanguageInput.append(new Option(language.label, language.code)));
        const selectedLanguage = languages.some(language => language.code === requestedLanguage)
          ? requestedLanguage
          : languages[0]!.code;
        speechLanguageInput.value = selectedLanguage;
        populateSpeechVoiceMenu(speechVoiceInput, selectedLanguage, BookstrSpeechSettings.savedVoice(state.settings, selectedLanguage));
        updateSpeechModelVisibility();
      }

      function speechModelSize(bytes: unknown): string {
        return `${Math.round(Number(bytes || 0) / 1_000_000)} MB`;
      }

      function updateSpeechModelVisibility(clearStatus = true): void {
        const selectedLanguage = BookstrSpeechSettings.languageCode(speechLanguageInput.value);
        speechModelButtons.forEach(button => {
          button.hidden = button.dataset.language !== selectedLanguage;
        });
        if (clearStatus) speechModelStatus.textContent = '';
      }

      async function refreshSpeechModels(models?: SpeechModel[]): Promise<void> {
        const next = Array.isArray(models)
          ? models
          : await window.bookstrDesktop?.speechModels?.status?.().catch(() => []) as SpeechModel[];
        for (const model of next || []) {
          const button = (document.getElementById(`speech-model-${model.id}`) as HTMLElement) as HTMLButtonElement;
          if (!button) continue;
          button.disabled = Boolean(model.installing);
          button.dataset.installed = String(Boolean(model.installed));
          button.classList.toggle('speech-model-delete', Boolean(model.installed));
          button.textContent = model.installed
            ? `Delete ${model.label} · ${speechModelSize(model.approximateBytes)}`
            : model.installing
              ? `Downloading ${model.label}… ${model.completedFiles}/${model.fileCount}`
              : `Download ${model.label} · ${speechModelSize(model.approximateBytes)}`;
        }
        updateSpeechModelVisibility(false);
        const visibleError = (next || []).find(model => model.language === speechLanguageInput.value && model.error);
        speechModelStatus.textContent = visibleError ? `${visibleError.label}: ${visibleError.error}` : '';
      }

      async function toggleSpeechModel(event: Event): Promise<void> {
        const button = event.currentTarget as HTMLButtonElement;
        const id = button.id.replace('speech-model-', '');
        button.disabled = true;
        speechModelStatus.textContent = '';
        try {
          const speechModels = window.bookstrDesktop!.speechModels;
          const models = button.dataset.installed === 'true'
            ? await speechModels.remove(id)
            : await speechModels.install(id);
          await refreshSpeechModels(models as SpeechModel[]);
          refreshSpeechVoiceMenus();
        } catch (error) {
          speechModelStatus.textContent = `Voice download failed: ${(error as Error)?.message || error}`;
          await refreshSpeechModels();
        }
      }

      function updateReaderSettingLabels() {
        readerFontSizeValue.value = `${readerFontSizeInput.value}%`;
        readerFontSizeValue.textContent = readerFontSizeValue.value;
        readerPaddingValue.value = `${readerPaddingInput.value} px`;
        readerPaddingValue.textContent = readerPaddingValue.value;
        speechRateValue.value = `${Number(speechRateInput.value).toFixed(2)}×`;
        speechRateValue.textContent = speechRateValue.value;
      }

      function notifyOpenReaderSettings() {
        const apply = readerFrame.contentWindow?.applyReaderSettings;
        if (typeof apply === 'function') apply({ ...state.settings });
      }

      function loadState(): void {
        const favorites = safeJSONRead(localStorage.getItem(FAVORITES_KEY), []) as PageBook[];
        const reading = safeJSONRead(localStorage.getItem(READING_KEY), []) as PageBook[];
        const words = safeJSONRead(localStorage.getItem(WORDS_KEY), []) as unknown[];
        const settings = safeJSONRead(localStorage.getItem(SETTINGS_KEY), { autoReading: true, useNip7: true, theme: 'white', readerFont: 'arial', readerAlignment: 'justified', opdsFeeds: [] }) as Record<string, unknown>;
        const nip7 = safeJSONRead(localStorage.getItem(NIP7_STATUS_KEY), { pubkey: '', npub: '', ts: 0 }) as Record<string, unknown>;
        const hasFreshNip7Status = Date.now() - Number(nip7.ts || 0) < NIP7_CACHE_TTL_MS;

        if (Array.isArray(favorites)) {
          state.favorites = BookMetadata.dedupeLibraryBooks(favorites
            .filter(item => item && typeof item.md5 === 'string')
            .filter(item => item.md5)
            .map(item => normalizeFavoriteFromRemote(item, { trustExplicitFormat: false }))
          ).slice();
        }
        if (Array.isArray(reading)) {
          state.reading = BookMetadata.dedupeLibraryBooks(reading
            .filter(item => item && typeof item.md5 === 'string')
            .map(item => normalizeFavoriteFromRemote(item, { trustExplicitFormat: false }))
          )
            .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
            .slice();
        }
        state.favorites = BookMetadata.dedupeLibraryBooks(isDesktopMode ? state.favorites : [...state.favorites, ...state.reading]);
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites));
        if (Array.isArray(words)) {
        state.words = words.map(normalizeVocabularyWord).filter((word): word is VocabularyEntry => word !== null).slice(0, 120);
        }
        const savedWordsSort = localStorage.getItem(WORDS_SORT_KEY);
        if (savedWordsSort && ['recent', 'first', 'alphabetical', 'book', 'seen'].includes(savedWordsSort)) {
          wordsSort.value = savedWordsSort;
        }
        if (settings && typeof settings === 'object') {
          if (typeof settings.autoReading === 'boolean') {
            state.settings.autoReading = settings.autoReading;
          }
          if (typeof settings.autoDownloadTorrents === 'boolean') {
            state.settings.autoDownloadTorrents = settings.autoDownloadTorrents;
          }
          if (typeof settings.autoSeedTorrents === 'boolean') {
            state.settings.autoSeedTorrents = settings.autoSeedTorrents;
          }
          if ([-1, 1000000, 5000000, 10000000, 25000000].includes(Number(settings.torrentDownloadLimit))) {
            state.settings.torrentDownloadLimit = Number(settings.torrentDownloadLimit);
          }
          if ([-1, 128000, 500000, 1000000, 5000000].includes(Number(settings.torrentUploadLimit))) {
            state.settings.torrentUploadLimit = Number(settings.torrentUploadLimit);
          }
          if (typeof settings.useNip7 === 'boolean') {
            state.settings.useNip7 = settings.useNip7;
          }
          if (typeof settings.theme === 'string') {
            state.settings.theme = settings.theme;
          }
          state.settings.readerFont = BookstrTypography.normalizeFont(settings.readerFont || settings.readerFontFamily);
          state.settings.readerAlignment = BookstrTypography.normalizeAlignment(
            settings.readerAlignment || (settings.readerTextAlign === 'justify' ? 'justified' : settings.readerTextAlign),
          );
          const readerFontPercent = Number(settings.readerFontPercent);
          if (Number.isFinite(readerFontPercent)) {
            state.settings.readerFontPercent = Math.max(75, Math.min(180, readerFontPercent));
          }
          state.settings.readerPadding = BookstrTypography.normalizePadding(settings.readerPadding);
          if (typeof settings.speechVoiceEnglish === 'string') {
            state.settings.speechVoiceEnglish = settings.speechVoiceEnglish;
          }
          if (typeof settings.speechVoicePortuguese === 'string') {
            state.settings.speechVoicePortuguese = settings.speechVoicePortuguese;
          }
          if (settings.speechVoices && typeof settings.speechVoices === 'object' && !Array.isArray(settings.speechVoices)) {
            state.settings.speechVoices = { ...settings.speechVoices };
          }
          if (typeof settings.speechLanguage === 'string') {
            state.settings.speechLanguage = BookstrSpeechSettings.languageCode(settings.speechLanguage) || 'en';
          }
          const speechRate = Number(settings.speechRate);
          if (Number.isFinite(speechRate)) {
            state.settings.speechRate = Math.max(0.73, Math.min(1.25, speechRate));
          }
          state.settings.opdsFeeds = normalizePublicOPDSFeedSettings(settings.opdsFeeds);
        }
        state.settings.theme = localAppearance() || state.settings.theme;
        if (nip7 && typeof nip7.pubkey === 'string') {
          state.nip7.pubkey = nip7.pubkey;
        }
        if (nip7 && typeof nip7.npub === 'string' && nip7.npub) {
          state.nip7.npub = nip7.npub;
        }

        for (const input of autoReadingInputs) input.checked = Boolean(state.settings.autoReading);
        torrentAutoDownloadInput.checked = Boolean(state.settings.autoDownloadTorrents);
        torrentAutoSeedInput.checked = Boolean(state.settings.autoSeedTorrents);
        torrentDownloadLimitInput.value = String(state.settings.torrentDownloadLimit);
        torrentUploadLimitInput.value = String(state.settings.torrentUploadLimit);
        nip7EnabledInput.checked = Boolean(state.settings.useNip7);
        themeModeInput.value = ['white', 'paper', 'dark'].includes(state.settings.theme) ? state.settings.theme : 'white';
        readerFontInput.value = state.settings.readerFont;
        readerAlignmentInput.value = state.settings.readerAlignment;
        readerFontSizeInput.value = String(state.settings.readerFontPercent);
        readerPaddingInput.value = String(state.settings.readerPadding);
        speechRateInput.value = String(state.settings.speechRate);
        refreshSpeechVoiceMenus();
        updateReaderSettingLabels();
        applyTheme(themeModeInput.value);
        saveLocalAppearance(state.settings.theme);
        renderFavorites();
        renderReading();
        renderWords();
        updateNip7Status();
        if (isDesktopMode) {
          syncDesktopTransferPreferences({
            autoDownload: state.settings.autoDownloadTorrents,
            autoSeed: state.settings.autoSeedTorrents,
            downloadLimit: state.settings.torrentDownloadLimit,
            uploadLimit: state.settings.torrentUploadLimit,
          });
          state.settings.useNip7 = true;
          nip7EnabledInput.checked = true;
          void refreshDesktopSignerStatus().then(signerState => {
            if (signerState?.configured) {
              void connectNip7({ silent: true, quick: hasFreshNip7Status });
            }
          });
        } else if (state.settings.useNip7) {
          const cached = readNostrSyncCache(state.nip7.pubkey || '');
          if (cached) {
            applyNostrSnapshot(cached);
          }
          if (state.nip7.pubkey) {
            void connectNip7({ silent: true, quick: hasFreshNip7Status });
          }
        }
      }

      function shortPubkey(pubkey: string): string {
        const npub = publicKeyToNpub(pubkey);
        if (npub) {
          return npub;
        }
        if (!pubkey || pubkey.length <= 12) return pubkey;
        return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
      }

      function publicKeyToNpub(pubkey: string): string {
        const hex = String(pubkey || '').trim().toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(hex)) {
          return '';
        }
        const bytes: number[] = [];
        for (let i = 0; i < 32; i++) {
          const idx = i * 2;
          const byte = parseInt(hex.slice(idx, idx + 2), 16);
          if (Number.isNaN(byte)) {
            return '';
          }
          bytes.push(byte);
        }
        const data = convertBits(bytes, 8, 5, true);
        if (!data) {
          return '';
        }
        const values = [0].concat(data);
        const encoded = bech32Encode('npub', values);
        return encoded;
      }

      function convertBits(data: number[], fromWidth: number, toWidth: number, pad = false): number[] | null {
        let acc = 0;
        let bits = 0;
        const maxv = (1 << toWidth) - 1;
        const out = [];
        for (const value of data) {
          if (value < 0 || value >> fromWidth) {
            return null;
          }
          acc = (acc << fromWidth) | value;
          bits += fromWidth;
          while (bits >= toWidth) {
            bits -= toWidth;
            out.push((acc >> bits) & maxv);
          }
        }
        if (pad) {
          if (bits > 0) {
            out.push((acc << (toWidth - bits)) & maxv);
          }
        } else if (bits >= fromWidth || ((acc << (toWidth - bits)) & maxv)) {
          return null;
        }
        return out;
      }

      function bech32Polymod(values: number[]): number {
        let chk = 1;
        const gen = [
          0x3b6a57b2,
          0x26508e6d,
          0x1ea119fa,
          0x3d4233dd,
          0x2a1462b3
        ];
        for (const value of values) {
          const top = chk >> 25;
          chk = ((chk & 0x1ffffff) << 5) ^ value;
          if (top & 1) chk ^= gen[0]!;
          if (top & 2) chk ^= gen[1]!;
          if (top & 4) chk ^= gen[2]!;
          if (top & 8) chk ^= gen[3]!;
          if (top & 16) chk ^= gen[4]!;
        }
        return chk ^ 1;
      }

      function bech32CreateChecksum(hrp: string, data: number[]): number[] {
        const values = hrpExpand(hrp).concat(data, [0, 0, 0, 0, 0, 0]);
        const mod = bech32Polymod(values);
        const out = [];
        for (let i = 0; i < 6; i++) {
          out.push((mod >> (5 * (5 - i))) & 31);
        }
        return out;
      }

      function hrpExpand(hrp: string): number[] {
        const ret = [];
        for (let i = 0; i < hrp.length; i++) {
          ret.push(hrp.charCodeAt(i) >> 5);
        }
        ret.push(0);
        for (let i = 0; i < hrp.length; i++) {
          ret.push(hrp.charCodeAt(i) & 31);
        }
        return ret;
      }

      function bech32Encode(hrp: string, data: number[]): string {
        const charSet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
        const checksum = bech32CreateChecksum(hrp, data);
        let out = '';
        for (const v of data.concat(checksum)) {
          out += charSet[v];
        }
        return `${hrp}1${out}`;
      }

      function updateNip7Status() {
        nip7ConnectButton.disabled = !state.settings.useNip7;
        if (!state.settings.useNip7) {
          const msg = `Automatic ${nostrSignerName} connection is disabled.`;
          nip7Status.textContent = msg;
          if (npubDisplay) {
            npubDisplay.textContent = 'disabled';
          }
          npubButton.classList.add('hidden');
          settingsBtn.classList.remove('hidden');
          nip7ConnectButton.textContent = 'Connect NIP-07';
          return;
        }
        if (!state.nip7.pubkey) {
          const msg = `${nostrSignerName} not connected yet.`;
          nip7Status.textContent = msg;
          if (npubDisplay) {
            npubDisplay.textContent = 'not connected';
          }
          npubButton.classList.add('hidden');
          settingsBtn.classList.remove('hidden');
          nip7ConnectButton.textContent = 'Connect NIP-07';
          return;
        }
        const npub = state.nip7.npub || publicKeyToNpub(state.nip7.pubkey) || '';
        if (npub) {
          state.nip7.npub = npub;
        }
        const shown = npub || shortPubkey(state.nip7.pubkey);
        nip7Status.textContent = `${nostrSignerName} connected ${shown}.`;
        if (npubDisplay) {
          npubDisplay.textContent = shown.length > 22
            ? `${shown.slice(0, 12)}…${shown.slice(-6)}`
            : shown;
          npubDisplay.title = shown;
        }
        npubButton.classList.remove('hidden');
        settingsBtn.classList.remove('hidden');
        nip7ConnectButton.textContent = 'Reconnect NIP-07';
      }

      function applyTheme(theme: string): void {
        const normalized = ['white', 'paper', 'dark'].includes(theme) ? theme : 'white';
        state.settings.theme = normalized;
        document.body.classList.remove('theme-white', 'theme-paper', 'theme-dark');
        document.body.classList.add(`theme-${normalized}`);
      }

      function localAppearance(): string {
        const saved = localStorage.getItem(LOCAL_APPEARANCE_KEY);
        return saved && ['white', 'paper', 'dark'].includes(saved) ? saved : '';
      }

      function saveLocalAppearance(theme: string): void {
        const normalized = ['white', 'paper', 'dark'].includes(theme) ? theme : 'white';
        localStorage.setItem(LOCAL_APPEARANCE_KEY, normalized);
      }

      function applyOpenReaderTypography() {
        const win = readerFrame?.contentWindow;
        if (typeof win?.setReaderTypography !== 'function') return;
        win.setReaderTypography(
          BookstrTypography.normalizeFont(state.settings.readerFont),
          BookstrTypography.normalizeAlignment(state.settings.readerAlignment),
          BookstrTypography.normalizePadding(state.settings.readerPadding),
        );
      }

      async function connectNip7(opts: { silent?: boolean; quick?: boolean; skipSync?: boolean } = {}): Promise<boolean> {
        const previous = safeJSONRead(localStorage.getItem(NIP7_STATUS_KEY), null) as Record<string, unknown> | null;
        const signer = currentNostrSigner();
        if (!state.settings.useNip7) {
          state.nip7.pubkey = '';
          localStorage.removeItem(NIP7_STATUS_KEY);
          updateNip7Status();
          return false;
        }

        if (!opts.silent) {
          nip7ConnectButton.disabled = true;
          nip7ConnectButton.textContent = 'Connecting…';
          nip7Status.textContent = 'Waiting for your NIP-07 extension…';
        }

        if (!signer || typeof signer.getPublicKey !== 'function') {
          if (opts.silent && previous && typeof previous.pubkey === 'string' && previous.pubkey) {
            state.nip7.pubkey = previous.pubkey;
            state.nip7.npub = typeof previous.npub === 'string' ? previous.npub : '';
            updateNip7Status();
            if (opts.quick) setTimeout(() => void connectNip7({ silent: true, quick: false }), 1500);
            return false;
          }
          state.nip7.pubkey = '';
          localStorage.removeItem(NIP7_STATUS_KEY);
          updateNip7Status();
          if (!opts.silent) {
            nip7Status.textContent = 'NIP-07 extension not found. Enable it for this site, then try again.';
            status.textContent = isDesktopMode
              ? 'Nostr signer not connected. Open Settings to connect one.'
              : 'NIP-07 not found. Install or enable a browser extension.';
          }
          return false;
        }

        try {
          if (typeof signer.enable === 'function') {
            try {
              await Promise.resolve(signer.enable());
            } catch {
              // ignore; getPublicKey may still work when permissions are already granted
            }
          }

          const getPublicKeyPromise = Promise.resolve(signer.getPublicKey());
          const timeoutMs = opts.silent ? (opts.quick ? 1200 : 9000) : 15000;
          const pubkey = await Promise.race([
            getPublicKeyPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(`${nostrSignerName} timeout`)), timeoutMs))
          ]);
          state.nip7.pubkey = String(pubkey || '');
          state.nip7.npub = publicKeyToNpub(state.nip7.pubkey) || '';
          localStorage.setItem(NIP7_STATUS_KEY, JSON.stringify({
            pubkey: state.nip7.pubkey,
            npub: state.nip7.npub,
            ts: Date.now()
          }));
          updateNip7Status();
          if (!opts.silent) {
            nip7Status.textContent = `Connected as ${state.nip7.npub || shortPubkey(state.nip7.pubkey)}.`;
            status.textContent = `Connected to ${nostrSignerName}.`;
          }
          if (!opts.skipSync) void syncNostrLibraryFromNip7();
          if (!isDesktopMode) void syncNostrPeopleFromNip7();
          return true;
        } catch (error) {
          if (opts.silent && previous && typeof previous.pubkey === 'string' && previous.pubkey) {
            state.nip7.pubkey = previous.pubkey;
            state.nip7.npub = typeof previous.npub === 'string' ? previous.npub : '';
            localStorage.setItem(NIP7_STATUS_KEY, JSON.stringify({
              pubkey: state.nip7.pubkey,
              npub: state.nip7.npub,
              ts: Date.now()
            }));
            updateNip7Status();
            if (opts.quick) setTimeout(() => void connectNip7({ silent: true, quick: false }), 1500);
            return false;
          }
          state.nip7.pubkey = '';
          localStorage.removeItem(NIP7_STATUS_KEY);
          updateNip7Status();
          if (!opts.silent) {
            const message = (error as Error)?.message || error;
            nip7Status.textContent = `Could not connect: ${message}`;
            status.textContent = `${nostrSignerName} connection failed: ${message}`;
          }
          return false;
        }
      }

      function applySettingsFromUI() {
        state.settings.autoReading = autoReadingInputs[0]?.checked ?? true;
        state.settings.autoDownloadTorrents = torrentAutoDownloadInput.checked;
        state.settings.autoSeedTorrents = torrentAutoSeedInput.checked;
        state.settings.torrentDownloadLimit = Number(torrentDownloadLimitInput.value);
        state.settings.torrentUploadLimit = Number(torrentUploadLimitInput.value);
        state.settings.useNip7 = nip7EnabledInput.checked;
        state.settings.theme = themeModeInput.value;
        state.settings.readerFont = BookstrTypography.normalizeFont(readerFontInput.value);
        state.settings.readerAlignment = BookstrTypography.normalizeAlignment(readerAlignmentInput.value);
        state.settings.readerFontPercent = Number(readerFontSizeInput.value);
        state.settings.readerPadding = BookstrTypography.normalizePadding(readerPaddingInput.value);
        state.settings.speechLanguage = BookstrSpeechSettings.languageCode(speechLanguageInput.value) || 'en';
        state.settings.speechVoices[state.settings.speechLanguage] = speechVoiceInput.value;
        state.settings.speechRate = Number(speechRateInput.value);
        updateReaderSettingLabels();
        saveLocalAppearance(state.settings.theme);
        applyTheme(state.settings.theme);
        applyOpenReaderTypography();
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
        localStorage.setItem('bookstr-reader-font-percent', String(state.settings.readerFontPercent));
        notifyOpenReaderSettings();
        if (!state.settings.useNip7) {
          state.nip7.pubkey = '';
          localStorage.removeItem(NIP7_STATUS_KEY);
        }
        updateNip7Status();
      }

      let settingsReturnFocus: HTMLElement | null = null;

      function openSettings({ updateHash = true } = {}) {
        activateTab('settings', { updateHash });
        settingsBtn.setAttribute('aria-pressed', 'true');
        npubButton.setAttribute('aria-pressed', 'true');
        settingsReturnFocus = document.activeElement as HTMLElement | null;
        const firstInput = settingsPanel.querySelector<HTMLElement>('input, button, select, textarea, [tabindex]:not([tabindex="-1"])');
        firstInput?.focus();
        if (isDesktopMode) void refreshSpeechModels();
      }

      function closeSettings({ updateHash = true } = {}) {
        settingsBtn.setAttribute('aria-pressed', 'false');
        npubButton.setAttribute('aria-pressed', 'false');
        if (settingsReturnFocus && typeof settingsReturnFocus.focus === 'function') {
          settingsReturnFocus.focus();
        } else {
          settingsBtn.focus();
        }
        if (activeTab === 'settings') activateTab('home', { updateHash });
      }

      function applyHashRoute() {
        const route = window.location.hash.slice(1);
        if (route === 'home' || route.startsWith('home?')) {
          const params = new URLSearchParams(route.startsWith('home?') ? route.slice(5) : '');
          homeLibraryFilter.language = params.get('language') || '';
          homeLibraryFilter.format = params.get('format') || '';
          activateTab('home');
          renderHome();
          replaceHomeHash();
          requestAnimationFrame(() => homeQueryInput.focus());
          return;
        }
        if (route === 'downloads' && isDesktopMode) {
          activateTab('downloads');
          return;
        }
        if (route === 'settings') {
          activateTab('settings');
          return;
        }
        if (route === 'people' || (route === 'devices' && isDesktopMode)) {
          activateTab('people');
          return;
        }
        if (route === 'search') {
          activateTab('search');
          requestAnimationFrame(() => queryInput.focus());
          return;
        }
        if (route.startsWith('search=')) {
          activateTab('search');
          const params = new URLSearchParams(route);
          const query = params.get('search') || '';
          if (query.length >= 2) {
            queryInput.value = query;
            const requestedType = params.get('type') || 'all';
            searchType.value = [...searchType.options].some(option => option.value === requestedType) ? requestedType : 'all';
            void startSearch({
              updateHash: false,
              routeState: {
                language: params.get('language') || '',
                format: params.get('format') || '',
                page: Math.max(1, Number(params.get('page')) || 1),
              },
            });
          }
          return;
        }
        if (route.startsWith('words=')) {
          if (!hasActiveWords()) {
            activateTab('home');
            history.replaceState(null, '', `${window.location.pathname}${window.location.search}#home`);
            return;
          }
          wordsFilter.value = decodeURIComponent(route.slice('words='.length));
          activateTab('words');
          renderWords();
          return;
        }
        if (route === 'words') {
          if (!hasActiveWords()) {
            activateTab('home');
            history.replaceState(null, '', `${window.location.pathname}${window.location.search}#home`);
            return;
          }
          activateTab('words');
          return;
        }
        if (route === 'reading') {
          activateTab('reading');
          return;
        }
        if (route.startsWith('read=')) {
          const routeValue = decodeURIComponent(route.slice('read='.length));
          const legacyMd5 = routeValue.match(/\/api\/read\/([a-f0-9]{32})(?:[/?#]|$)/i)?.[1]?.toLowerCase() || '';
          const bookRef = legacyMd5 || routeValue;
          if (legacyMd5) {
            history.replaceState(null, '', `${window.location.pathname}${window.location.search}#read=${legacyMd5}`);
          }
          const isDesktopGutenbergDownload = /^app:\/\/bookstr\/api\/books\/\d+\/download(?:[?#]|$)/i.test(bookRef);
          if (isMd5(bookRef) || /^(?:book:|https?:|blob:)/i.test(bookRef) || isDesktopGutenbergDownload) {
            void openResolvedReadRoute(bookRef);
          }
          return;
        }
        activateTab('home');
        requestAnimationFrame(() => homeQueryInput.focus());
        if (route !== 'home') {
          history.replaceState(null, '', `${window.location.pathname}${window.location.search}#home`);
        }
      }

      homeTabBtn.addEventListener('click', () => activateTab('home', { updateHash: true }));
      searchTabBtn.addEventListener('click', () => activateTab('search', { updateHash: true }));
      peopleTabBtn.addEventListener('click', () => activateTab('people', { updateHash: true }));
      deviceTransferRefresh.addEventListener('click', () => {
        deviceTransferResult.textContent = '';
        void refreshDeviceTransferPanel();
      });
      deviceTransferAnnounce.addEventListener('click', async () => {
        if (!desktopBridge?.devices?.announce) return;
        deviceTransferAnnounce.disabled = true;
        try {
          const message = await desktopBridge.devices.announce() as { expires_at: number };
          deviceTransferResult.textContent = `Private presence prepared until ${new Date(Number(message.expires_at) * 1000).toLocaleTimeString()}. Share it securely with your paired Bookstr device.`;
        } catch (error) {
          deviceTransferResult.textContent = `Could not prepare private presence: ${deviceTransferError(error)}`;
        } finally {
          deviceTransferAnnounce.disabled = false;
        }
      });
      devicePrivateTransferForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (!desktopBridge?.transfers?.addPrivate) return;
          deviceTransferResult.textContent = 'Preparing your private book transfer…';
        try {
          await desktopBridge.transfers.addPrivate({
            torrentId: devicePrivateTorrent.value.trim(),
            peer: devicePrivatePeer.value.trim(),
          });
          deviceTransferResult.textContent = 'Private book transfer started.';
          devicePrivateTransferForm.reset();
          await refreshDeviceTransferPanel();
        } catch (error) {
          deviceTransferResult.textContent = `Private book transfer could not start. ${deviceTransferError(error)}`;
        }
      });
      devicePublicTransferForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (!desktopBridge?.transfers?.addPublic) return;
          deviceTransferResult.textContent = 'Adding your book…';
        try {
          await desktopBridge.transfers.addPublic({ torrentId: devicePublicTorrent.value.trim() });
          deviceTransferResult.textContent = 'Book added.';
          devicePublicTransferForm.reset();
          await refreshDeviceTransferPanel();
        } catch (error) {
          deviceTransferResult.textContent = `Book could not be added. ${deviceTransferError(error)}`;
        }
      });
      readingTabBtn.addEventListener('click', () => activateTab('reading', { updateHash: true }));
      wordsTabBtn.addEventListener('click', () => activateTab('words', { updateHash: true }));

      settingsBtn.addEventListener('click', () => {
        openSettings();
      });

      window.bookstrDesktop?.onOpenSettings?.(() => openSettings());
      window.bookstrDesktop?.onOpenPane?.((pane) => activateTab(pane, { updateHash: true }));

      npubButton.addEventListener('click', () => {
        openSettings();
      });

      settingsCloseBtn.addEventListener('click', () => {
        closeSettings();
      });

      settingsBackdrop.addEventListener('click', () => {
        closeSettings();
      });

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !settingsModal.classList.contains('hidden')) {
          event.preventDefault();
          closeSettings();
        }
      });

      for (const input of autoReadingInputs) {
        input.addEventListener('change', () => {
          for (const peer of autoReadingInputs) peer.checked = input.checked;
          applySettingsFromUI();
        });
      }
      nip7EnabledInput.addEventListener('change', () => {
        applySettingsFromUI();
        if (state.settings.useNip7) void connectNip7();
      });
      nip7ConnectButton.addEventListener('click', () => void connectNip7());
      desktopNip46QrStart.addEventListener('click', () => void startDesktopNip46Qr());
      desktopNip46QrCopy.addEventListener('click', async () => {
        if (!desktopNip46QrUri) return;
        await navigator.clipboard.writeText(desktopNip46QrUri);
        setDesktopSignerMessage('NIP-46 connection link copied.');
      });
      desktopNip46QrCancel.addEventListener('click', () => void cancelDesktopNip46Qr());
      desktopNip46Connect.addEventListener('click', connectDesktopNip46);
      desktopNip46Input.addEventListener('keydown', event => {
        if (event.key === 'Enter') void connectDesktopNip46();
      });
      desktopNsecConnect.addEventListener('click', connectDesktopNsec);
      desktopNsecInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') void connectDesktopNsec();
      });
      desktopSignerDisconnect.addEventListener('click', () => void disconnectDesktopNostrSigner());
      themeModeInput.addEventListener('change', applySettingsFromUI);
      readerFontInput.addEventListener('change', applySettingsFromUI);
      readerAlignmentInput.addEventListener('change', applySettingsFromUI);
      readerFontSizeInput.addEventListener('input', applySettingsFromUI);
      readerPaddingInput.addEventListener('input', applySettingsFromUI);
      torrentAutoDownloadInput.addEventListener('change', () => {
        applySettingsFromUI();
        syncDesktopTransferPreferences({
          autoDownload: state.settings.autoDownloadTorrents,
          autoSeed: state.settings.autoSeedTorrents,
          downloadLimit: state.settings.torrentDownloadLimit,
          uploadLimit: state.settings.torrentUploadLimit,
        });
      });
      torrentAutoSeedInput.addEventListener('change', () => {
        applySettingsFromUI();
        syncDesktopTransferPreferences({
          autoDownload: state.settings.autoDownloadTorrents,
          autoSeed: state.settings.autoSeedTorrents,
          downloadLimit: state.settings.torrentDownloadLimit,
          uploadLimit: state.settings.torrentUploadLimit,
        });
      });
      torrentDownloadLimitInput.addEventListener('change', () => {
        applySettingsFromUI();
        syncDesktopTransferPreferences({
          downloadLimit: state.settings.torrentDownloadLimit,
          uploadLimit: state.settings.torrentUploadLimit,
        });
      });
      torrentUploadLimitInput.addEventListener('change', () => {
        applySettingsFromUI();
        syncDesktopTransferPreferences({
          downloadLimit: state.settings.torrentDownloadLimit,
          uploadLimit: state.settings.torrentUploadLimit,
        });
      });
      speechLanguageInput.addEventListener('change', () => {
        state.settings.speechLanguage = speechLanguageInput.value;
        refreshSpeechVoiceMenus();
        updateSpeechModelVisibility();
        applySettingsFromUI();
      });
      speechVoiceInput.addEventListener('change', applySettingsFromUI);
      speechRateInput.addEventListener('input', applySettingsFromUI);
      speechModelButtons.forEach(button => button.addEventListener('click', toggleSpeechModel));
      window.bookstrDesktop?.speechModels?.onProgress?.(payload => {
        const progress = payload as { id: string; completedFiles: number; fileCount: number; file: string; receivedBytes: number; totalBytes: number };
        const button = (document.getElementById(`speech-model-${progress.id}`) as HTMLElement);
        if (button) button.textContent = `Downloading… ${progress.completedFiles}/${progress.fileCount}`;
        if (button && !button.hidden) {
          speechModelStatus.textContent = `${progress.file} · ${speechModelSize(progress.receivedBytes)} / ${speechModelSize(progress.totalBytes)}`;
        }
      });
      if (window.speechSynthesis) {
        window.speechSynthesis.addEventListener?.('voiceschanged', refreshSpeechVoiceMenus);
      }
      searchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        startSearch();
      });

      searchLanguageFilter.addEventListener('change', () => {
        searchResultFilter.language = searchLanguageFilter.value;
        searchResultPage = 1;
        const view = renderResults(searchResultBooks, { preserveResults: true });
        replaceSearchHash();
        status.textContent = `Showing ${view.total} of ${searchResultBooks.length} result(s).`;
      });

      searchFormatFilter.addEventListener('change', () => {
        searchResultFilter.format = searchFormatFilter.value;
        searchResultPage = 1;
        const view = renderResults(searchResultBooks, { preserveResults: true });
        replaceSearchHash();
        status.textContent = `Showing ${view.total} of ${searchResultBooks.length} result(s).`;
      });

      function openSearchResultPage(event: Event): void {
        event.preventDefault();
        const requestedPage = Number((event.currentTarget as HTMLElement).dataset.page);
        if (!Number.isInteger(requestedPage) || requestedPage === searchResultPage) return;
        searchResultPage = requestedPage;
        const view = renderResults(searchResultBooks, { preserveResults: true });
        replaceSearchHash();
        status.textContent = `Page ${view.page} of ${view.totalPages} · ${view.total} result(s).`;
        resultsEl.scrollIntoView({ block: 'start', behavior: 'auto' });
      }

      searchLoadMore.addEventListener('click', loadMoreLibcat);
      searchPagePrev.addEventListener('click', openSearchResultPage);
      searchPageNext.addEventListener('click', openSearchResultPage);

      queryInput.addEventListener('input', () => {
        if (!queryInput.value.trim()) {
          resultsEl.innerHTML = '';
          searchResultFilters.classList.add('hidden');
          searchResultCount.textContent = '0 results';
          searchPagination.classList.add('hidden');
          nip17Exchange.classList.add('hidden');
          status.textContent = '';
        }
        renderFavorites();
        renderReading();
      });

      wordsFilter.addEventListener('input', renderWords);
      wordsSort.addEventListener('change', () => {
        localStorage.setItem(WORDS_SORT_KEY, wordsSort.value);
        renderWords();
      });

      for (const [code, label] of Object.entries(DICTIONARY_LANGUAGES).sort(([, left], [, right]) => left.localeCompare(right))) {
        dictionarySource.add(new Option(label, code));
      }
      dictionarySource.value = 'pt';
      dictionarySource.addEventListener('change', () => {
        populateDictionaryTargetOptions();
        void refreshDictionaryTargetOptions();
      });
      dictionaryInstall.addEventListener('click', installDictionaryPack);
      populateDictionaryTargetOptions('en');
      void refreshDictionaryTargetOptions('en');
      void renderDictionaryPacks();
      if (isDesktopMode) {
        void purgeLegacyBookCache().then(() => {
          if (activeTab === 'home') renderHome();
        if (activeTab === 'search' && !queryInput.value.trim()) renderSearchSources();
        }).catch(() => {});
      } else {
        void bookCacheRecords().then(records => {
          cachedBookKeys.clear();
          records.forEach(rememberCachedRecord);
          if (activeTab === 'home') renderHome();
        if (activeTab === 'search' && !queryInput.value.trim()) renderSearchSources();
        }).catch(() => {});
      }
      void refreshDesktopDownloadStates();
      window.setInterval(() => void refreshDesktopDownloadStates(), 5000);
      desktopBridge?.library?.onAcquisitionProgress?.(payload => {
        const progress = payload as Record<string, unknown>;
        const md5 = String(progress?.bookId || '').trim().toLowerCase();
        if (!isMd5(md5)) return;
        desktopDownloadByBook.set(md5, { ...desktopDownloadByBook.get(md5), ...progress, status: 'downloading' } as BrowserDownloadRow);
        if (activeReadingBook && desktopBookIds(activeReadingBook).includes(md5)) {
          updateReadTorrentStatus(activeReadingBook);
        }
        clearTimeout(desktopDownloadStatusTimer);
        desktopDownloadStatusTimer = setTimeout(updateDesktopDownloadSummary, 180);
        clearTimeout(desktopDownloadRenderTimer);
        desktopDownloadRenderTimer = setTimeout(() => {
          if (activeTab === 'downloads') void renderDesktopDownloads();
          if (activeTab === 'home') updateHomeDownloadRows();
          if (activeTab === 'search' && !queryInput.value.trim()) renderSearchSources();
        }, 200);
      });

      window.addEventListener('popstate', applyHashRoute);
      window.addEventListener('hashchange', applyHashRoute);

      const fileTime = new Date(document.lastModified);
      buildTime.textContent = Number.isNaN(fileTime.getTime())
        ? 'Unavailable'
        : formatBuildDate(fileTime);

      loadState();
      void enrichLibraryMetadata();
      applyHashRoute();
      if (activeTab === 'home') {
        homeQueryInput.focus();
      } else if (activeTab === 'search') {
        queryInput.focus();
        queryInput.setSelectionRange(queryInput.value.length, queryInput.value.length);
      }
