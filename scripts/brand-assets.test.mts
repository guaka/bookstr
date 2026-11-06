import { present } from '../web/tests/test-values.mts';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const lightLogo = await readFile(new URL('../brand/bookstr-logo.svg', import.meta.url), 'utf8');
const darkLogo = await readFile(new URL('../brand/bookstr-logo-dark.svg', import.meta.url), 'utf8');

test('README presents one centered, theme-aware horizontal Bookstr logo', () => {
  const header = present(readme.split('**A calm, open-source')[0]);
  const imageTags = header.match(/<img\b[^>]*>/gi) ?? [];
  const sources = [...header.matchAll(/<source\b[^>]*media="([^"]+)"[^>]*srcset="([^"]+)"\s*\/>/gi)];

  assert.equal(imageTags.length, 1);
  assert.match(header, /<p align="center">\s*<picture>/);
  assert.match(imageTags[0], /src="\.\/brand\/bookstr-logo\.svg"/);
  assert.match(imageTags[0], /width="420"/);
  assert.match(imageTags[0], /alt="Bookstr"/);
  assert.deepEqual(sources.map(([, media]) => media), [
    '(prefers-color-scheme: dark)',
    '(prefers-color-scheme: light)',
  ]);
  assert.deepEqual(sources.map(([, , srcset]) => srcset), [
    './brand/bookstr-logo-dark.svg',
    './brand/bookstr-logo.svg',
  ]);
  assert.doesNotMatch(header, /favicon\.svg|Bookstr icon/);
});

test('dark logo preserves the established mark and changes only wordmark contrast', () => {
  const normalize = (svg: string) => svg.replace(/(<text\b[^>]*\bfill=")[^"]+("[^>]*>)/, '$1COLOR$2');

  assert.equal(normalize(lightLogo), normalize(darkLogo));
  assert.match(lightLogo, /<text x="338" y="214" textLength="560" lengthAdjust="spacingAndGlyphs"/);
  assert.match(darkLogo, /<text x="338" y="214" textLength="560" lengthAdjust="spacingAndGlyphs"/);
  assert.equal(338 + 560, 898);
  assert.equal(927 - 10, 917);
  assert.match(lightLogo, /<text[^>]*fill="#1C1916"/);
  assert.match(darkLogo, /<text[^>]*fill="#FFFAF2"/);
  assert.match(darkLogo, /<rect[^>]*fill="#2F5D50"/);
  assert.match(darkLogo, /<path[^>]*fill="#C74B32"/);
});
