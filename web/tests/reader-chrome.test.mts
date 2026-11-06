import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BookstrReaderChrome = require('../reader-chrome.js') as import('../src/reader-chrome.js').ReaderChromeApi;

interface ChromeContainerFixture { childNodes: ChromeNodeFixture[] }
interface ChromeNodeFixture {
  tagName: string;
  style: { cssText: string; removeProperty(name: string): void };
  childNodes: ChromeNodeFixture[];
  parent?: ChromeNodeFixture | ChromeContainerFixture;
  closest(selector: string): ChromeNodeFixture | null;
  querySelectorAll(): ChromeNodeFixture[];
}
function fixture<T>(value: unknown): T { return value as T; }

test('theme backgrounds match reader paper white and night shells', () => {
  assert.equal(BookstrReaderChrome.themeBackgroundColor('paper'), '#f7f3ea');
  assert.equal(BookstrReaderChrome.themeBackgroundColor('white'), '#ffffff');
  assert.equal(BookstrReaderChrome.themeBackgroundColor('night'), '#121212');
  assert.equal(BookstrReaderChrome.themeBackgroundColor('other'), '#f7f3ea');
});

test('background isolate CSS forces theme shells and transparent wrappers', () => {
  const css = BookstrReaderChrome.backgroundIsolateCss('#f7f3ea');
  assert.match(css, /html,body\{background:#f7f3ea!important/);
  assert.match(css, /bookstr-reader-root\.bookstr-bg-isolate/);
  assert.match(css, /background-color:transparent!important/);
  assert.match(css, /\*:not\(img\):not\(svg\):not\(image\):not\(video\):not\(canvas\)/);
});

test('clearInlineBackgrounds drops wrapper paint but keeps media and svg guts', () => {
  function el(tag: string, styleText = '', kids: ChromeNodeFixture[] = []): ChromeNodeFixture {
    const style = {
      cssText: styleText,
      removeProperty(name: string) {
        const pattern = new RegExp('(?:^|;)\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:[^;]*', 'ig');
        this.cssText = this.cssText.replace(pattern, '').replace(/^;|;$/g, '');
      },
    };
    const node: ChromeNodeFixture = {
      tagName: tag.toUpperCase(),
      style,
      childNodes: kids,
      closest(selector: string) {
        if (selector !== 'svg') return null;
        let current: ChromeNodeFixture | ChromeContainerFixture = this;
        while ('tagName' in current) {
          if (current.tagName === 'SVG') return current;
          if (!current.parent) return null;
          current = current.parent;
        }
        return null;
      },
      querySelectorAll() {
        const found: ChromeNodeFixture[] = [];
        function walk(item: ChromeNodeFixture): void {
          for (const child of item.childNodes || []) {
            found.push(child);
            walk(child);
          }
        }
        walk(this);
        return found;
      },
    };
    for (const kid of kids) kid.parent = node;
    return node;
  }

  const rect = el('rect', 'background:#fff');
  const svg = el('svg', '', [rect]);
  const img = el('img', 'background:#fff');
  const paragraph = el('p', 'background:white');
  const wrapper = el('div', 'background:#ffffff; background-color:#ffffff', [img, svg, paragraph]);
  const body: ChromeContainerFixture & { querySelectorAll(): ChromeNodeFixture[] } = {
    childNodes: [wrapper],
    querySelectorAll() {
      const found: ChromeNodeFixture[] = [];
      function walk(item: ChromeContainerFixture): void {
        for (const child of item.childNodes || []) {
          found.push(child);
          walk(child);
        }
      }
      walk(this);
      return found;
    },
  };
  wrapper.parent = body;

  assert.equal(BookstrReaderChrome.clearInlineBackgrounds(fixture<Element>(body)), 2);
  assert.equal(wrapper.style.cssText.replace(/\s+/g, ''), '');
  assert.equal(paragraph.style.cssText.replace(/\s+/g, ''), '');
  assert.equal(img.style.cssText.includes('background'), true);
  assert.equal(rect.style.cssText.includes('background'), true);
});

test('prepareContentDocument stamps isolate classes and stylesheet', () => {
  const styles: Array<{ id: string; textContent: string }> = [];
  const root = {
    classList: {
      values: new Set<string>(),
      add(...names: string[]) { for (const name of names) this.values.add(name); },
    },
    appendChild(node: { id: string; textContent: string }) { styles.push(node); },
  };
  const body = {
    querySelectorAll() { return []; },
  };
  const doc = {
    documentElement: root,
    body,
    head: root,
    getElementById() { return null; },
    createElement() {
      return { id: '', textContent: '' };
    },
  };
  assert.equal(BookstrReaderChrome.prepareContentDocument(fixture<Document>(doc), 'night'), true);
  assert.ok(root.classList.values.has('bookstr-reader-root'));
  assert.ok(root.classList.values.has('bookstr-bg-isolate'));
  assert.equal(styles.length, 1);
  assert.equal(styles[0]!.id, 'bookstr-bg-isolate');
  assert.match(styles[0]!.textContent, /#121212/);
});

test('paintShell colors continuous epub views before content arrives', () => {
  const iframe = { style: { background: '' } };
  assert.equal(BookstrReaderChrome.paintShell([iframe], 'white'), '#ffffff');
  assert.equal(iframe.style.background, '#ffffff');
});
