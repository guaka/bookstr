import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const desktopMain = await readFile(new URL('../../desktop/main.js', import.meta.url), 'utf8');
const desktopPackage = JSON.parse(await readFile(new URL('../../desktop/package.json', import.meta.url), 'utf8'));

test('Electron treats legacy Blossom references as metadata instead of network sources', () => {
  assert.doesNotMatch(html, /fetchBlossomCopy/);
  assert.doesNotMatch(html, /desktopBlossomProxyUrl/);
  assert.doesNotMatch(desktopMain, /proxyBlossomRequest|BLOSSOM_PROXY_BASE_URL/);
  assert.ok(!desktopPackage.build.files.includes('blossom-proxy.js'));
  assert.doesNotMatch(html, /\['book', 'blossom'/);
  assert.doesNotMatch(html, /tags\.push\(\['blossom'/);
});
