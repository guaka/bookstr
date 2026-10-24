const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');
const { getPublicKey, verifyEvent } = require('nostr-tools/pure');

const initSqlJs = require('../../../web/vendor/sql-wasm.js');

async function dictionaryFixture() {
  const SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, '../../../web/vendor', file),
  });
  const database = new SQL.Database();
  database.run('CREATE TABLE simple_translation (written_rep TEXT)');
  database.run("INSERT INTO simple_translation VALUES ('livro')");
  const bytes = Buffer.from(database.export());
  database.close();
  return bytes;
}

async function dictionaryServer(bytes) {
  const server = http.createServer((request, response) => {
    if (request.url !== '/pt-en.sqlite3') {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': bytes.length,
    });
    response.end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

function shortcut(number) {
  return `${process.platform === 'darwin' ? 'Meta' : 'Control'}+${number}`;
}

function electronArgs() {
  const output = path.join(__dirname, '../../test-results');
  fs.mkdirSync(output, { recursive: true });
  const userData = fs.mkdtempSync(path.join(output, 'user-data-'));
  return [path.join(__dirname, '../..'), `--user-data-dir=${userData}`];
}

async function setReadableDownloadFixture(electronApp, downloads) {
  await electronApp.evaluate(({ ipcMain }, rows) => {
    globalThis.readableDownloadFixture = rows;
    ipcMain.removeHandler('bookstr-desktop-library-downloads');
    ipcMain.handle('bookstr-desktop-library-downloads', () => globalThis.readableDownloadFixture);
  }, downloads);
}

test('libstr desktop app opens with preload bridge', async () => {
  const electronApp = await electron.launch({
    args: electronArgs(),
  });

  try {
    const firstWindow = await electronApp.firstWindow();
    await expect(firstWindow).toHaveTitle('libstr');
    const appVersion = await electronApp.evaluate(({ app }) => app.getVersion());
    expect(appVersion).toMatch(/^0\.1-\d{8}-\d{4}$/);
    const windowState = await electronApp.evaluate(({ BrowserWindow }) => {
      const [window] = BrowserWindow.getAllWindows();
      return {
        maximized: window?.isMaximized(),
        fullScreen: window?.isFullScreen(),
      };
    });
    expect(windowState.fullScreen).toBe(false);
    if (process.platform !== 'linux') expect(windowState.maximized).toBe(true);

    const contentSecurityPolicy = await firstWindow.evaluate(async () => (
      await fetch(window.location.href)
    ).headers.get('content-security-policy'));
    expect(contentSecurityPolicy).toContain("connect-src 'self' https: wss:;");

    const bridge = await firstWindow.evaluate(() => ({
      version: window.bookstrDesktop?.version,
      hasOpenReader: typeof window.bookstrDesktop?.openReader === 'function',
      hasDesktopSigner: typeof window.bookstrDesktop?.signer?.status === 'function',
      hasSpeechModels: typeof window.bookstrDesktop?.speechModels?.install === 'function',
      hasBrowserNip07: !!window.nostr,
    }));

    expect(bridge.version).toBe(1);
    expect(bridge.hasOpenReader).toBe(true);
    expect(bridge.hasDesktopSigner).toBe(true);
    expect(bridge.hasSpeechModels).toBe(true);
    expect(bridge.hasBrowserNip07).toBe(false);
    expect(await firstWindow.locator('a.app-header-left').count()).toBe(0);
    await expect.poll(() => firstWindow.locator('.brand-mark').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(firstWindow.locator('.brand-mark')).toHaveAttribute('src', 'public/apple-touch-icon.png');

    const paneIconOrder = await firstWindow.locator('.app-header-right .header-tab').evaluateAll(buttons => (
      buttons.filter(button => button.id !== 'desktop-downloads-button').slice(0, 4).map(button => button.id)
    ));
    expect(paneIconOrder).toEqual([
      'home-tab-btn',
      'reading-tab-btn',
      'search-tab-btn',
      'people-tab-btn',
    ]);

    const toolbarGeometry = await firstWindow.evaluate(() => {
      const header = document.querySelector('.app-header');
      const navigation = document.querySelector('.app-header-right');
      const button = document.querySelector('.app-header-right .header-tab');
      const icon = button.querySelector('svg:not(.hidden)');
      const brand = document.querySelector('.brand-mark');
      const headerRect = header.getBoundingClientRect();
      const navigationRect = navigation.getBoundingClientRect();
      return {
        headerHeight: headerRect.height,
        navigationRight: navigationRect.right,
        headerRight: headerRect.right,
        buttonWidth: button.getBoundingClientRect().width,
        iconWidth: icon.getBoundingClientRect().width,
        brandWidth: brand.getBoundingClientRect().width,
        backdropFilter: getComputedStyle(header).backdropFilter,
        navigationRadius: parseFloat(getComputedStyle(navigation).borderRadius),
      };
    });
    expect(toolbarGeometry.headerHeight).toBeGreaterThanOrEqual(52);
    expect(toolbarGeometry.buttonWidth).toBeGreaterThanOrEqual(33);
    expect(toolbarGeometry.iconWidth).toBeGreaterThanOrEqual(20);
    expect(toolbarGeometry.brandWidth).toBeGreaterThanOrEqual(42);
    expect(toolbarGeometry.navigationRight).toBeLessThanOrEqual(toolbarGeometry.headerRight);
    expect(toolbarGeometry.backdropFilter).toContain('blur(18px)');
    expect(toolbarGeometry.navigationRadius).toBeGreaterThanOrEqual(12);

    const devicesButton = firstWindow.getByRole('button', { name: 'Devices, Command 4' });
    await expect(devicesButton.locator('.device-nav-icon')).toBeVisible();
    await expect(devicesButton.locator('.social-nav-icon')).toBeHidden();
    await devicesButton.click();
    await expect(firstWindow.locator('#device-transfer-panel')).toBeVisible();
    await expect(firstWindow.locator('#people-list')).toBeHidden();
    await expect(firstWindow.locator('#people-tab')).not.toContainText('No follows found.');
    await expect.poll(() => firstWindow.evaluate(() => location.hash)).toBe('#devices');
    await firstWindow.getByRole('button', { name: 'Reading' }).click();
    await expect(firstWindow.locator('#favorites-heading')).toHaveText('Favorites');
    await expect(firstWindow.locator('#favorites-sync-note')).toBeHidden();
    await expect(firstWindow.locator('#home-sync-refresh')).toHaveAttribute('aria-label', 'Refresh reading and words');

    await firstWindow.getByRole('button', { name: 'Search' }).click();
    await expect(firstWindow.locator('#search-tab')).toBeVisible();
    await expect(firstWindow.locator('#search-sources-table')).not.toContainText('LibVault');
    await expect(firstWindow.locator('#search-sources-table')).not.toContainText('LitRes');
    await expect(firstWindow.locator('#search-type option[value="content"]')).toHaveCount(0);
    const sourceToggles = firstWindow.locator('[data-action="toggle-search-source"]');
    await expect(sourceToggles).toHaveCount(1);
    await expect(sourceToggles.first()).toBeChecked();
    await sourceToggles.first().uncheck();
    await expect(firstWindow.locator('tr[data-source="libcat"]')).toHaveClass(/source-disabled/);
    await firstWindow.reload();
    await expect(firstWindow.locator('tr[data-source="libcat"] [data-action="toggle-search-source"]')).not.toBeChecked();
    await firstWindow.locator('tr[data-source="libcat"] [data-action="toggle-search-source"]').check();

    await firstWindow.evaluate(() => {
      state.favorites = [{ md5: 'a', title: 'English book', language: 'en' }, { md5: 'b', title: 'Portuguese book', language: 'pt-PT' }];
      state.reading = [{ md5: 'c', title: 'Spanish book', language: 'es' }];
      refreshSpeechVoiceMenus();
    });

    await firstWindow.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
    await expect(firstWindow.locator('#settings-modal')).toBeVisible();
    await expect(firstWindow.locator('#desktop-signer')).toBeVisible();
    await expect(firstWindow.getByText('NIP-46 remote signer')).toBeVisible();
    await expect(firstWindow.locator('#desktop-nip46-qr')).toBeHidden();
    await expect(firstWindow.locator('#desktop-nip46-qr-image')).toBeHidden();
    await expect(firstWindow.locator('#speech-language')).toBeVisible();
    await expect(firstWindow.locator('#speech-voice')).toContainText('Best installed voice');
    await expect(firstWindow.locator('#reader-padding')).toBeVisible();
    const languageNames = await firstWindow.evaluate(() => {
      const names = new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' });
      return { en: names.of('en'), pt: names.of('pt'), es: names.of('es') };
    });
    await expect(firstWindow.locator('#speech-language option[value="en"]')).toHaveText(languageNames.en);
    await expect(firstWindow.locator('#speech-language option[value="pt"]')).toHaveText(languageNames.pt);
    await expect(firstWindow.locator('#speech-language option[value="es"]')).toHaveText(languageNames.es);
    await expect(firstWindow.locator('#speech-language option[value="de"]')).toHaveCount(0);
    expect(await firstWindow.locator('#speech-language option').count()).toBe(3);
    const kokoroModel = firstWindow.locator('#speech-model-kokoro_en');
    const tugaoModel = firstWindow.locator('#speech-model-piper_pt_pt');
    await expect(kokoroModel).toBeVisible();
    await expect(kokoroModel).toContainText('Download Kokoro');
    await expect(tugaoModel).toBeHidden();
    const englishVoiceOptions = await firstWindow.locator('#speech-voice option').count();
    await firstWindow.evaluate(() => refreshSpeechModels([{
      id: 'kokoro_en', label: 'Kokoro · English', language: 'en', approximateBytes: 352_148_969,
      fileCount: 11, installed: true, installing: false, completedFiles: 0, error: '',
    }, {
      id: 'piper_pt_pt', label: 'Tugão · Português (Portugal)', language: 'pt', approximateBytes: 63_939_446,
      fileCount: 9, installed: false, installing: false, completedFiles: 0, error: '',
    }]));
    await expect(kokoroModel).toHaveClass(/speech-model-delete/);
    await expect(kokoroModel).toContainText('Delete Kokoro');
    expect(await firstWindow.locator('#speech-voice option').count()).toBe(englishVoiceOptions);
    await firstWindow.locator('#speech-language').selectOption('pt');
    await expect(kokoroModel).toBeHidden();
    await expect(tugaoModel).toBeVisible();
    await expect(firstWindow.locator('#speech-voice')).toContainText('Best installed voice');
    await firstWindow.locator('#speech-language').selectOption('es');
    await expect(kokoroModel).toBeHidden();
    await expect(tugaoModel).toBeHidden();
    await expect(firstWindow.locator('#speech-voice')).toContainText('Best installed voice');
    await firstWindow.locator('#speech-language').selectOption('en');
    await firstWindow.evaluate(() => refreshSpeechModels());
    await firstWindow.locator('#reader-font').selectOption('arial');
    await firstWindow.locator('#reader-alignment').selectOption('justified');
    await firstWindow.locator('#reader-font-size').evaluate(input => {
      input.value = '125';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await firstWindow.locator('#reader-padding').evaluate(input => {
      input.value = '40';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await firstWindow.locator('#speech-rate').evaluate(input => {
      input.value = '1.10';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(firstWindow.locator('#reader-font-size-value')).toHaveText('125%');
    await expect(firstWindow.locator('#reader-padding-value')).toHaveText('40 px');
    await expect(firstWindow.locator('#speech-rate-value')).toHaveText('1.10×');
    await expect(firstWindow.locator('#torrent-auto-download')).toBeChecked();
    await expect(firstWindow.locator('#torrent-auto-seed')).toBeChecked();
    await expect(firstWindow.locator('#torrent-download-limit')).toHaveValue('10000000');
    await expect(firstWindow.locator('#torrent-upload-limit')).toHaveValue('1000000');
    await firstWindow.locator('#torrent-auto-download').uncheck();
    await firstWindow.locator('#torrent-auto-seed').uncheck();
    await expect.poll(() => firstWindow.evaluate(() => window.bookstrDesktop.transfers.setPreferences())).toEqual({
      autoDownload: false,
      autoSeed: false,
      downloadLimit: 10000000,
      uploadLimit: 1000000,
    });
    await firstWindow.locator('#torrent-auto-download').check();
    await firstWindow.locator('#torrent-auto-seed').check();
    await expect.poll(() => firstWindow.evaluate(() => window.bookstrDesktop.transfers.setPreferences())).toEqual({
      autoDownload: true,
      autoSeed: true,
      downloadLimit: 10000000,
      uploadLimit: 1000000,
    });
    await firstWindow.locator('#torrent-download-limit').selectOption('5000000');
    await firstWindow.locator('#torrent-upload-limit').selectOption('500000');
    await expect.poll(() => firstWindow.evaluate(() => window.bookstrDesktop.transfers.setPreferences())).toMatchObject({
      downloadLimit: 5000000,
      uploadLimit: 500000,
    });
    expect(await firstWindow.evaluate(() => JSON.parse(localStorage.getItem('bookstr_reader_settings_v1')))).toMatchObject({
      autoDownloadTorrents: true,
      autoSeedTorrents: true,
      torrentDownloadLimit: 5000000,
      torrentUploadLimit: 500000,
      readerFont: 'arial',
      readerAlignment: 'justified',
      readerFontPercent: 125,
      readerPadding: 40,
      speechRate: 1.1,
      speechVoiceEnglish: '',
      speechVoicePortuguese: '',
      speechVoices: { en: '' },
      speechLanguage: 'en',
    });

    const settingsAccelerator = await electronApp.evaluate(({ Menu }) => {
      const menus = Menu.getApplicationMenu()?.items || [];
      const settingsItem = menus.flatMap(item => item.submenu?.items || [])
        .find(item => item.label === 'Settings…');
      return settingsItem?.accelerator || '';
    });
    expect(settingsAccelerator).toBe('CommandOrControl+,');

    const editRoles = await electronApp.evaluate(({ Menu }) => {
      const editMenu = Menu.getApplicationMenu()?.items.find(item => item.label === 'Edit');
      return editMenu?.submenu?.items.map(item => item.role).filter(Boolean) || [];
    });
    expect(editRoles).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectall']);

    await firstWindow.getByRole('button', { name: 'Search' }).click();
    await expect(firstWindow.locator('#settings-modal')).toBeHidden();
    await electronApp.evaluate(({ Menu }) => {
      const menus = Menu.getApplicationMenu()?.items || [];
      const settingsItem = menus.flatMap(item => item.submenu?.items || [])
        .find(item => item.label === 'Settings…');
      settingsItem?.click();
    });
    await expect(firstWindow.locator('#settings-modal')).toBeVisible();
    await expect(firstWindow.locator('#opds-feeds')).toHaveCount(0);
    await expect(firstWindow.getByRole('heading', { name: 'Public OPDS feeds' })).toHaveCount(0);

    await firstWindow.getByRole('button', { name: 'Connect with QR code' }).click();
    await expect(firstWindow.getByAltText('NIP-46 connection QR code')).toHaveAttribute('src', /^data:image\/png;base64,/);
    await firstWindow.getByRole('button', { name: 'Cancel' }).click();

    await firstWindow.getByText('Use a local nsec instead').click();
    await electronApp.evaluate(({ clipboard }) => clipboard.writeText('1'.repeat(64)));
    await firstWindow.getByLabel('Nostr secret key').focus();
    await firstWindow.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
    await expect(firstWindow.getByLabel('Nostr secret key')).toHaveValue('1'.repeat(64));
    await firstWindow.getByRole('button', { name: 'Connect nsec' }).click();
    await expect(firstWindow.locator('#desktop-signer-status')).toContainText('Connected with local nsec');
    await expect(firstWindow.locator('#desktop-signer-status')).not.toContainText('[object Promise]');
    await expect(firstWindow.locator('#desktop-signer-status')).toContainText('npub1');
    await expect(firstWindow.locator('#desktop-signer-status')).toHaveClass(/signer-connected/);
    await expect(firstWindow.locator('#desktop-signer-status')).toBeVisible();
    await expect(firstWindow.locator('#desktop-signer-npub')).toHaveText(/^npub1/);
    await expect(firstWindow.getByRole('button', { name: 'Connect with QR code' })).toBeHidden();

    const localSigner = await firstWindow.evaluate(async () => ({
      pubkey: await window.bookstrDesktop.signer.getPublicKey(),
      signed: await window.bookstrDesktop.signer.signEvent({
        kind: 30078,
        created_at: 1_700_000_000,
        tags: [['d', 'local-nsec-test']],
        content: 'signed locally',
      }),
    }));
    const expectedPubkey = getPublicKey(Uint8Array.from(Buffer.from('1'.repeat(64), 'hex')));
    expect(localSigner.pubkey).toBe(expectedPubkey);
    expect(localSigner.signed.pubkey).toBe(expectedPubkey);
    expect(verifyEvent(localSigner.signed)).toBe(true);
  } finally {
    await electronApp.close();
  }
});

test('desktop pane shortcuts work from controls and the single reader window', async () => {
  const electronApp = await electron.launch({
    args: electronArgs(),
  });

  try {
    const library = await electronApp.firstWindow();
    await library.evaluate(() => localStorage.setItem('bookstr_words_v1', JSON.stringify([{
      key: 'en:shortcut', word: 'shortcut', language: 'en', updatedAt: Date.now(),
    }])));
    await library.reload();
    await library.locator('#home-query-input').focus();

    await library.keyboard.press(shortcut(2));
    await expect(library.locator('#reading-library-tab')).toBeVisible();
    await expect.poll(() => library.evaluate(() => location.hash)).toBe('#reading');

    await library.keyboard.press(shortcut(3));
    await expect(library.locator('#search-tab')).toBeVisible();
    await expect(library.locator('#query-input')).toBeFocused();

    await library.keyboard.press(shortcut(4));
    await expect(library.locator('#people-tab')).toBeVisible();
    await expect(library.getByRole('button', { name: 'Devices, Command 4' })).toHaveAttribute('aria-selected', 'true');

    await library.keyboard.press(shortcut(5));
    await expect(library.locator('#words-tab')).toBeVisible();

    await library.evaluate(() => { void window.bookstrDesktop.openReader({
      kind: 'pdf',
      base64: btoa('%PDF-1.4\n' + 'reader shortcut fixture'.repeat(8)),
      readUrl: 'https://files.test/shortcut.pdf',
      book: { md5: '11111111111111111111111111111111', title: 'Shortcut fixture' },
    }); });
    await library.waitForURL('app://bookstr/pdf-reader.html');
    expect(await electronApp.windows()).toHaveLength(1);
    await library.keyboard.press(shortcut(5));
    await expect(library.locator('#words-tab')).toBeVisible();
    await library.keyboard.press(shortcut(1));
    await expect(library.locator('#home-tab')).toBeVisible();
    await expect.poll(() => library.evaluate(() => location.hash.startsWith('#home'))).toBe(true);
  } finally {
    await electronApp.close();
  }
});

test('desktop home filtering keeps the matching in-progress book visible', async () => {
  const electronApp = await electron.launch({ args: electronArgs() });

  try {
    const library = await electronApp.firstWindow();
    await library.evaluate(() => {
      localStorage.setItem('bookstr_reading_library_v1', JSON.stringify([
        { md5: '1'.repeat(32), title: 'Visible Reading Journey', authors: 'Reader', extension: 'epub', progression: 0.6 },
        { md5: '2'.repeat(32), title: 'Another Book', authors: 'Reader', extension: 'epub', progression: 0 },
      ]));
    });
    await setReadableDownloadFixture(electronApp, [{
      bookId: '1'.repeat(32), md5: '1'.repeat(32), title: 'Visible Reading Journey',
      authors: ['Reader'], extension: 'epub', status: 'seeding', readable: true, completedAt: 1,
    }]);
    await library.reload();
    await library.evaluate(async () => {
      await refreshDesktopDownloadStates();
      renderHome();
    });
    await expect(library.locator('#home-reading-list')).toContainText('Visible Reading Journey');
    await library.locator('#home-query-input').fill('journey');
    await expect(library.locator('#home-reading-list')).toContainText('Visible Reading Journey');
    await expect(library.locator('#home-reading-list').getByRole('img', { name: 'Currently reading' })).toHaveCount(0);
    await expect(library.locator('#home-reading-list')).not.toContainText('Another Book');
  } finally {
    await electronApp.close();
  }
});

test('desktop bridge round-trips normalized reading progress to the library', async () => {
  const electronApp = await electron.launch({
    args: electronArgs(),
  });

  try {
    const library = await electronApp.firstWindow();
    const progress = await library.evaluate(() => new Promise((resolve) => {
      const unsubscribe = window.bookstrDesktop.onProgress((payload) => {
        unsubscribe();
        resolve(payload);
      });
      window.bookstrDesktop.reportProgress({
        md5: ' AABB ',
        progression: 2,
        furthestProgression: -1,
        extension: 'PDF',
        language: 'pt-BR',
      });
    }));
    expect(progress).toMatchObject({
      md5: 'aabb',
      progression: 1,
      furthestProgression: 0,
      extension: 'pdf',
      language: '',
    });
  } finally {
    await electronApp.close();
  }
});

test('embedded reader progress is persisted locally across library reloads', async () => {
  const electronApp = await electron.launch({ args: electronArgs() });

  try {
    const library = await electronApp.firstWindow();
    await library.locator('#reader-frame').evaluate(frame => { frame.src = 'reader.html?progress-test=1'; });
    const reader = library.frameLocator('#reader-frame');
    await expect(reader.locator('#viewer')).toBeAttached();
    await reader.locator('body').evaluate(() => {
      parent.postMessage({
        type: 'bookstr-reader-progress',
        bookId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        progression: 0.42,
        furthestProgression: 0.67,
        cfi: 'epubcfi(/6/4!/4/2/1:0)',
        title: 'Persisted progress fixture',
        extension: 'epub',
      }, location.origin);
    });
    await expect.poll(() => library.evaluate(() => {
      const books = JSON.parse(localStorage.getItem('bookstr_reading_library_v1') || '[]');
      return books.find(book => book.md5 === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') || null;
    })).toMatchObject({
      progression: 0.42,
      furthestProgression: 0.67,
      cfi: 'epubcfi(/6/4!/4/2/1:0)',
    });

    await library.reload();
    const restored = await library.evaluate(() => {
      const books = JSON.parse(localStorage.getItem('bookstr_reading_library_v1') || '[]');
      return books.find(book => book.md5 === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') || null;
    });
    expect(restored).toMatchObject({ progression: 0.42, furthestProgression: 0.67 });
  } finally {
    await electronApp.close();
  }
});

test('desktop downloads dictionaries through its same-origin proxy', async () => {
  const fixture = await dictionaryFixture();
  const server = await dictionaryServer(fixture);
  const electronApp = await electron.launch({
    args: electronArgs(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      BOOKSTR_DESKTOP_TEST_DICTIONARY_BASE_URL: server.baseUrl,
    },
  });

  try {
    const library = await electronApp.firstWindow();
    await library.getByRole('button', { name: 'Settings' }).click();
    const source = library.locator('#dictionary-source');
    const target = library.locator('#dictionary-target');
    await expect(source.locator('option')).toHaveCount(26);
    await expect(target.locator('option')).toHaveCount(25);
    await expect(target.locator('option[value="en"]')).toHaveText('English');
    await expect(target.locator('option[value="pt"]')).toHaveCount(0);
    await source.selectOption('en');
    await expect(target.locator('option[value="en"]')).toHaveCount(0);
    await expect(target.locator('option[value="pt"]')).toHaveText('Portuguese');
    await library.locator('#dictionary-source').selectOption('pt');
    await target.selectOption('en');
    await library.locator('#dictionary-install').click();
    await expect(library.locator('#dictionary-status')).toHaveText('Installed Portuguese → English.');
    await expect(library.locator('#dictionary-packs')).toContainText('Portuguese → English');

    const stored = await library.evaluate(async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('bookstr_dictionaries_v1', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      return new Promise((resolve, reject) => {
        const request = database.transaction('packs').objectStore('packs').get('pt-en');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve({ id: request.result?.id, size: request.result?.size });
      });
    });
    expect(stored).toEqual({ id: 'pt-en', size: fixture.length });
  } finally {
    await electronApp.close();
    await server.close();
  }
});

test('desktop keeps dictionary destinations available when dictionary storage cannot open', async () => {
  const electronApp = await electron.launch({ args: electronArgs() });
  try {
    const library = await electronApp.firstWindow();
    await library.addInitScript(() => {
      const nativeOpen = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function open(name, ...args) {
        if (name === 'bookstr_dictionaries_v1') throw new Error('Dictionary storage fixture unavailable');
        return nativeOpen.call(this, name, ...args);
      };
    });
    await library.reload();
    await library.getByRole('button', { name: 'Settings' }).click();
    await expect(library.locator('#dictionary-source')).toHaveValue('pt');
    await expect(library.locator('#dictionary-target option')).toHaveCount(25);
    await expect(library.locator('#dictionary-target option[value="en"]')).toHaveText('English');
    await expect(library.locator('#dictionary-target')).toBeEnabled();
    await expect(library.locator('#dictionary-install')).toBeEnabled();
  } finally {
    await electronApp.close();
  }
});

test('desktop footer stays in the viewport bottom-right without covering content', async () => {
  const electronApp = await electron.launch({
    args: electronArgs(),
  });

  try {
    const library = await electronApp.firstWindow();
    await expect(library.locator('body')).toHaveClass(/desktop-mode/);
    const assertFooterPosition = async () => {
      const geometry = await library.evaluate(() => {
        const footer = document.querySelector('.footer');
        const wrap = document.querySelector('.wrap');
        const rect = footer.getBoundingClientRect();
        return {
          position: getComputedStyle(footer).position,
          right: window.innerWidth - rect.right,
          bottom: window.innerHeight - rect.bottom,
          wrapPaddingBottom: parseFloat(getComputedStyle(wrap).paddingBottom),
        };
      });
      expect(geometry.position).toBe('fixed');
      expect(geometry.right).toBeGreaterThanOrEqual(4);
      expect(geometry.right).toBeLessThan(12);
      expect(geometry.bottom).toBeGreaterThanOrEqual(3);
      expect(geometry.bottom).toBeLessThan(12);
      expect(geometry.wrapPaddingBottom).toBeGreaterThanOrEqual(30);
    };

    await assertFooterPosition();
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find(window => window.getTitle() === 'libstr')?.setSize(950, 620);
    });
    await assertFooterPosition();
  } finally {
    await electronApp.close();
  }
});

test('desktop favorites discover independent Open Library covers without LibVault', async () => {
  const electronApp = await electron.launch({ args: electronArgs() });
  const md5 = 'd'.repeat(32);
  const openLibraryCover = 'https://covers.openlibrary.org/b/id/12345-M.jpg';

  try {
    const library = await electronApp.firstWindow();
    let libVaultMetadataRequests = 0;
    await library.route(`https://lib.b.bfr.ee/api/books/${md5}`, route => {
      libVaultMetadataRequests += 1;
      return route.fulfill({ status: 503 });
    });
    await library.route('https://openlibrary.org/search.json?**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ docs: [{
        key: '/works/OL123W',
        title: 'Covered Book',
        author_name: ['Fixture Author'],
        cover_i: 12345,
        first_publish_year: 2024,
        language: ['eng'],
        edition_count: 1,
      }] }),
    }));
    await library.route(openLibraryCover, route => route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="56"><rect width="40" height="56" fill="#2f5d50"/></svg>',
    }));
    await library.evaluate(id => {
      localStorage.setItem('bookstr_nostr_favorites_v1', JSON.stringify([{
        md5: id,
        title: 'Covered Book',
        authors: 'Fixture Author',
        year: '2024',
        language: 'eng',
        extension: 'epub',
      }]));
    }, md5);
    await setReadableDownloadFixture(electronApp, [{
      bookId: md5, md5, title: 'Covered Book', authors: ['Fixture Author'], year: '2024',
      language: 'eng', extension: 'epub', status: 'seeding', readable: true, completedAt: 1,
    }]);
    await library.reload();
    await library.evaluate(async () => {
      await refreshDesktopDownloadStates();
      renderHome();
    });

    const cover = library.locator('.result-cover').first();
    await expect(cover).toHaveAttribute('src', openLibraryCover, { timeout: 15_000 });
    await expect.poll(() => cover.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    expect(libVaultMetadataRequests).toBe(0);
  } finally {
    await electronApp.close();
  }
});
