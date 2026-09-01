import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const BookstrTypography = createRequire(import.meta.url)('../reader-typography.js');

test('reader typography defaults unknown values to Arial and justified', () => {
  assert.equal(BookstrTypography.normalizeFont(undefined), 'arial');
  assert.equal(BookstrTypography.normalizeFont(''), 'arial');
  assert.equal(BookstrTypography.normalizeFont('Comic Sans'), 'arial');
  assert.equal(BookstrTypography.normalizeFont(' Georgia '), 'georgia');
  assert.equal(BookstrTypography.normalizeFont('palatino'), 'palatino');
  assert.equal(BookstrTypography.normalizeFont('system'), 'system');
  assert.equal(BookstrTypography.normalizeAlignment(null), 'justified');
  assert.equal(BookstrTypography.normalizeAlignment('JUSTIFIED'), 'justified');
  assert.equal(BookstrTypography.normalizeAlignment('left'), 'left');
  assert.equal(BookstrTypography.normalizeAlignment(' Left '), 'left');
  assert.equal(BookstrTypography.normalizePadding(undefined), 24);
  assert.equal(BookstrTypography.normalizePadding(4), 8);
  assert.equal(BookstrTypography.normalizePadding('36'), 36);
  assert.equal(BookstrTypography.normalizePadding(100), 64);
});

test('reader typography CSS uses Arial and justify by default', () => {
  const justified = BookstrTypography.css();
  assert.match(justified, /font-family:Arial, Helvetica, sans-serif !important/);
  assert.match(justified, /text-align:justify !important/);
  assert.match(justified, /hyphens:auto !important/);
  assert.match(justified, /padding-left:24px !important;padding-right:24px !important/);
  assert.match(justified, /h1, h2, h3, h4, h5, h6, pre, code\{text-align:start !important;\}/);

  const leftGeorgia = BookstrTypography.css('georgia', 'left', 40);
  assert.match(leftGeorgia, /font-family:Georgia, 'Times New Roman', serif !important/);
  assert.match(leftGeorgia, /text-align:left !important/);
  assert.match(leftGeorgia, /hyphens:manual !important/);
  assert.match(leftGeorgia, /padding-left:40px !important;padding-right:40px !important/);

  assert.equal(
    BookstrTypography.fontStack('palatino'),
    "Palatino, 'Palatino Linotype', 'Iowan Old Style', serif",
  );
  assert.equal(
    BookstrTypography.fontStack('system'),
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  );
});

test('reader typography emits the system font and manual hyphenation for left alignment', () => {
  const css = BookstrTypography.css(' system ', 'LEFT');
  assert.match(css, /font-family:system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important/);
  assert.match(css, /text-align:left !important/);
  assert.match(css, /hyphens:manual !important/);
});

test('reader typography exposes its browser global when CommonJS is unavailable', async () => {
  const source = await readFile(new URL('../reader-typography.js', import.meta.url), 'utf8');
  const context = {};
  vm.runInNewContext(source, context);
  assert.equal(context.BookstrTypography.normalizeFont('georgia'), 'georgia');
  assert.match(context.BookstrTypography.css('georgia', 'left'), /text-align:left !important/);

  const noGlobalThis = { globalThis: undefined };
  vm.runInNewContext(source, noGlobalThis);
  assert.equal(noGlobalThis.BookstrTypography.normalizeAlignment('left'), 'left');

  const noRoot = { globalThis: undefined };
  vm.runInNewContext(`(function() { "use strict"; ${source} }).call(null)`, noRoot);
  new Function('globalThis', `"use strict"; ${source}`)(undefined);
});
