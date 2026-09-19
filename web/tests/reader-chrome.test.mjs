import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BookstrReaderChrome = require('../reader-chrome.js');

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
  function el(tag, styleText = '', kids = []) {
    const style = {
      cssText: styleText,
      removeProperty(name) {
        const pattern = new RegExp('(?:^|;)\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:[^;]*', 'ig');
        this.cssText = this.cssText.replace(pattern, '').replace(/^;|;$/g, '');
      },
    };
    const node = {
      tagName: tag.toUpperCase(),
      style,
      childNodes: kids,
      closest(selector) {
        if (selector !== 'svg') return null;
        let current = this;
        while (current) {
          if (current.tagName === 'SVG') return current;
          current = current.parent;
        }
        return null;
      },
      querySelectorAll() {
        const found = [];
        function walk(item) {
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
  const body = {
    childNodes: [wrapper],
    querySelectorAll() {
      const found = [];
      function walk(item) {
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

  assert.equal(BookstrReaderChrome.clearInlineBackgrounds(body), 2);
  assert.equal(wrapper.style.cssText.replace(/\s+/g, ''), '');
  assert.equal(paragraph.style.cssText.replace(/\s+/g, ''), '');
  assert.equal(img.style.cssText.includes('background'), true);
  assert.equal(rect.style.cssText.includes('background'), true);
});

test('prepareContentDocument stamps isolate classes and stylesheet', () => {
  const styles = [];
  const root = {
    classList: {
      values: new Set(),
      add(...names) { for (const name of names) this.values.add(name); },
    },
    appendChild(node) { styles.push(node); },
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
  assert.equal(BookstrReaderChrome.prepareContentDocument(doc, 'night'), true);
  assert.ok(root.classList.values.has('bookstr-reader-root'));
  assert.ok(root.classList.values.has('bookstr-bg-isolate'));
  assert.equal(styles.length, 1);
  assert.equal(styles[0].id, 'bookstr-bg-isolate');
  assert.match(styles[0].textContent, /#121212/);
});

test('paintShell colors continuous epub views before content arrives', () => {
  const iframe = { style: { background: '' } };
  assert.equal(BookstrReaderChrome.paintShell([iframe], 'white'), '#ffffff');
  assert.equal(iframe.style.background, '#ffffff');
});
