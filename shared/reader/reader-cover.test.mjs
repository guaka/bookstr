import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const path = fileURLToPath(new URL('./reader.html', import.meta.url));
const html = readFileSync(path, 'utf8');
const start = html.indexOf('    function includeOpeningSpineItems(');
const end = html.indexOf('    function installKnownWordNavigation', start);
const context = vm.createContext({});
vm.runInContext(html.slice(start, end), context, {
  filename: path, lineOffset: html.slice(0, start).split('\n').length - 1,
});

test('opening covers stay in reading order without changing saved spine indexes', () => {
  const items = [{ index: 0, linear: false }, { index: 1, linear: false }, { index: 2, linear: true }, { index: 3, linear: false }];
  context.includeOpeningSpineItems(items);
  assert.deepEqual(items.map(item => item.linear), [true, true, true, false]);
  assert.equal(items[0].prev(), undefined);
  assert.equal(items[0].next(), items[1]);
  assert.equal(items[1].prev(), items[0]);
  assert.equal(items[1].next(), items[2]);
  assert.deepEqual(items.map(item => item.index), [0, 1, 2, 3]);
  context.includeOpeningSpineItems(items);
  context.includeOpeningSpineItems([]);
  const only = [{ linear: false }];
  context.includeOpeningSpineItems(only);
  assert.equal(only[0].next(), undefined);
  assert.equal(only[0].prev(), undefined);
});

test('cover layout never clips mixed images and index or sizes media against its own iframe', () => {
  assert.doesNotMatch(html, /bookstr-cover-layout|textLength < 80|88vh/);
  assert.match(html, /"max-height": Math.round\(window.innerHeight \* 0.88\) \+ "px !important"/);
  assert.match(html, /includeOpeningSpineItems\(book.spine.spineItems\)/);
});

test('theme image bounds use the outer viewport height for every theme', () => {
  const start = html.indexOf('    function registerThemes()');
  const end = html.indexOf('    function openBook(', start);
  const registered = [];
  const context = vm.createContext({
    window: { innerHeight: 844 },
    rendition: { themes: { register: (name, rules) => registered.push({ name, rules }) } },
  });
  vm.runInContext(html.slice(start, end), context, {
    filename: path, lineOffset: html.slice(0, start).split('\n').length - 1,
  });
  context.registerThemes();
  assert.equal(registered.length, 3);
  for (const theme of registered) {
    assert.equal(theme.rules['img, svg, video']['max-height'], '743px !important');
    assert.equal(theme.rules['img, svg, video'].height, 'auto !important');
  }
});

test('opening a book includes non-linear front matter before the first display', async () => {
  const opening = { linear: false };
  const calls = [];
  const stages = [];
  const rendition = {
    hooks: { content: { register() {} } }, on() {},
    themes: { fontSize() {} },
    display(target) { calls.push({ target, included: opening.linear }); return Promise.resolve(); },
    currentLocation() { return {}; },
  };
  const book = {
    ready: Promise.resolve(), spine: { spineItems: [opening, { linear: true }] },
    renderTo() { return rendition; }, locations: { generate: () => Promise.resolve() },
  };
  const noop = () => {};
  const context = vm.createContext({
    window: {}, ePub: () => book, readerFontPercent: 100,
    waitForReaderViewport: () => Promise.resolve(), applyTheme: noop,
    reportBookMetadata: noop, reportBookSections: noop, installContinuousShellWatch: noop,
    registerThemes: noop, restoredHighlights: () => ({ words: [], marks: [] }),
    rememberReaderHighlights: noop, activeReaderHighlights: { words: [], marks: [] },
    reportLocation: noop, reportReaderStartupStage: stage => stages.push(stage),
  });
  // Use the real front-matter function in this reader context too.
  vm.runInContext(html.slice(start, end), context, { filename: path, lineOffset: html.slice(0, start).split('\n').length - 1 });
  const openStart = html.indexOf('    function openBook(');
  const openEnd = html.indexOf('    function cfiProgression(', openStart);
  vm.runInContext(html.slice(openStart, openEnd), context, { filename: path, lineOffset: html.slice(0, openStart).split('\n').length - 1 });
  await context.openBook('fixture', '', 'paper', '', 'opening');
  assert.deepEqual(calls, [{ target: undefined, included: true }]);
  assert.deepEqual(stages, ['parsing', 'rendering', 'ready']);
});
