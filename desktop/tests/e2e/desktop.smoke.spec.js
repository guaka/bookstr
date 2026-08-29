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

test('Bookstr desktop app opens with preload bridge', async () => {
  const electronApp = await electron.launch({
    args: electronArgs(),
  });

  try {
    const firstWindow = await electronApp.firstWindow();
    await expect(firstWindow).toHaveTitle(/Bookstr/i);

    const contentSecurityPolicy = await firstWindow.evaluate(async () => (
      await fetch(window.location.href)
    ).headers.get('content-security-policy'));
    expect(contentSecurityPolicy).toContain("connect-src 'self' https: wss:;");

    const bridge = await firstWindow.evaluate(() => ({
      version: window.bookstrDesktop?.version,
      hasOpenReader: typeof window.bookstrDesktop?.openReader === 'function',
      hasDesktopSigner: typeof window.bookstrDesktop?.signer?.status === 'function',
      hasBrowserNip07: !!window.nostr,
    }));

    expect(bridge.version).toBe(1);
    expect(bridge.hasOpenReader).toBe(true);
    expect(bridge.hasDesktopSigner).toBe(true);
    expect(bridge.hasBrowserNip07).toBe(false);
    expect(await firstWindow.locator('a.app-header-left').count()).toBe(0);
    await expect.poll(() => firstWindow.locator('.brand-mark').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(firstWindow.locator('.brand-mark')).toHaveAttribute('src', 'public/apple-touch-icon.png');

    const paneIconOrder = await firstWindow.locator('.app-header-right .header-tab').evaluateAll(buttons => (
      buttons.slice(0, 4).map(button => button.id)
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
      const icon = button.querySelector('svg');
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

    await firstWindow.getByRole('button', { name: 'People' }).click();
    await expect(firstWindow.locator('#people-tab')).toContainText('Nostr signer not connected.');
    await expect(firstWindow.locator('#people-tab')).not.toContainText('NIP-07');
    await firstWindow.getByRole('button', { name: 'Reading' }).click();
    await expect(firstWindow.locator('#reading-library-tab')).toContainText('Favorites sync through your Nostr signer.');
    await expect(firstWindow.locator('#reading-library-tab')).not.toContainText('NIP-07');

    await firstWindow.getByRole('button', { name: 'Search' }).click();
    await expect(firstWindow.locator('#search-tab')).toBeVisible();

    await firstWindow.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
    await expect(firstWindow.locator('#settings-modal')).toBeVisible();
    await expect(firstWindow.locator('#desktop-signer')).toBeVisible();
    await expect(firstWindow.getByText('NIP-46 remote signer')).toBeVisible();
    await expect(firstWindow.locator('#desktop-nip46-qr')).toBeHidden();
    await expect(firstWindow.locator('#desktop-nip46-qr-image')).toBeHidden();

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
    await library.locator('#home-query-input').focus();

    await library.keyboard.press(shortcut(2));
    await expect(library.locator('#reading-library-tab')).toBeVisible();
    await expect.poll(() => library.evaluate(() => location.hash)).toBe('#reading');

    await library.keyboard.press(shortcut(3));
    await expect(library.locator('#search-tab')).toBeVisible();
    await expect(library.locator('#query-input')).toBeFocused();

    await library.keyboard.press(shortcut(4));
    await expect(library.locator('#people-tab')).toBeVisible();

    await library.evaluate(() => { void window.bookstrDesktop.openReader({
      kind: 'pdf',
      base64: btoa('%PDF-1.4\n' + 'reader shortcut fixture'.repeat(8)),
      readUrl: 'https://files.test/shortcut.pdf',
      book: { md5: '11111111111111111111111111111111', title: 'Shortcut fixture' },
    }); });
    await library.waitForURL('app://bookstr/pdf-reader.html');
    expect(await electronApp.windows()).toHaveLength(1);
    await library.keyboard.press(shortcut(1));
    await expect(library.locator('#home-tab')).toBeVisible();
    await expect.poll(() => library.evaluate(() => location.hash.startsWith('#home'))).toBe(true);
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
    await library.locator('#dictionary-source').selectOption('pt');
    await library.locator('#dictionary-target').selectOption('en');
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
      BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Bookstr')?.setSize(950, 620);
    });
    await assertFooterPosition();
  } finally {
    await electronApp.close();
  }
});

test('desktop favorites load public Blossom covers instead of private API images', async () => {
  const electronApp = await electron.launch({ args: electronArgs() });
  const md5 = 'd'.repeat(32);
  const coverSha256 = 'c'.repeat(64);
  const blossomCover = `https://blossom.bfr.ee/${coverSha256}.jpg`;

  try {
    const library = await electronApp.firstWindow();
    await library.route(blossomCover, route => route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="56"><rect width="40" height="56" fill="#2f5d50"/></svg>',
    }));
    await library.evaluate(({ md5: id, coverSha256: coverHash }) => {
      localStorage.setItem('bookstr_nostr_favorites_v1', JSON.stringify([{
        md5: id,
        title: 'Covered Book',
        authors: 'Fixture Author',
        coverUrl: `https://lib.b.bfr.ee/api/covers/${id}`,
        coverSha256: coverHash,
      }]));
    }, { md5, coverSha256 });
    await library.reload();

    const cover = library.locator('.result-cover').first();
    await expect(cover).toHaveAttribute('src', blossomCover);
    await expect.poll(() => cover.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  } finally {
    await electronApp.close();
  }
});
