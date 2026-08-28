import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const desktopMain = await readFile(new URL('../../desktop/main.js', import.meta.url), 'utf8');
const desktopPackage = JSON.parse(await readFile(new URL('../../desktop/package.json', import.meta.url), 'utf8'));

test('Electron routes signed Blossom book downloads through its allowlisted proxy', () => {
  assert.match(html, /BookMetadata\.desktopBlossomProxyUrl\(blossomUrl, sha256, window\.location\.href\)/);
  assert.match(html, /fetch\(downloadUrl/);
  assert.match(desktopMain, /const blossomResponse = await proxyBlossomRequest\(request, net\.fetch, BLOSSOM_PROXY_BASE_URL\)/);
  assert.ok(desktopPackage.build.files.includes('blossom-proxy.js'));
});
