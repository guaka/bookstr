import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

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
});

test('reader typography CSS uses Arial and justify by default', () => {
  const justified = BookstrTypography.css();
  assert.match(justified, /font-family:Arial, Helvetica, sans-serif !important/);
  assert.match(justified, /text-align:justify !important/);
  assert.match(justified, /hyphens:auto !important/);
  assert.match(justified, /h1, h2, h3, h4, h5, h6, pre, code\{text-align:start !important;\}/);

  const leftGeorgia = BookstrTypography.css('georgia', 'left');
  assert.match(leftGeorgia, /font-family:Georgia, 'Times New Roman', serif !important/);
  assert.match(leftGeorgia, /text-align:left !important/);
  assert.match(leftGeorgia, /hyphens:manual !important/);

  assert.equal(
    BookstrTypography.fontStack('palatino'),
    "Palatino, 'Palatino Linotype', 'Iowan Old Style', serif",
  );
  assert.equal(
    BookstrTypography.fontStack('system'),
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  );
});
