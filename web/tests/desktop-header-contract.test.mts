import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('Electron gets a polished toolbar with larger top controls', () => {
  assert.match(html, /body\.desktop-mode \.app-header\s*\{[\s\S]*?min-height:\s*3\.25rem/);
  assert.match(html, /body\.desktop-mode \.app-header\s*\{[\s\S]*?backdrop-filter:\s*blur\(18px\) saturate\(1\.16\)/);
  assert.match(html, /body\.desktop-mode \.app-header-right\s*\{[\s\S]*?border-radius:\s*0\.78rem/);
  assert.match(html, /body\.desktop-mode \.header-tab\s*\{[\s\S]*?width:\s*2\.1rem;[\s\S]*?height:\s*2\.1rem/);
  assert.match(html, /body\.desktop-mode \.header-tab svg\s*\{[\s\S]*?width:\s*1\.28rem;[\s\S]*?height:\s*1\.28rem/);
  assert.match(html, /body\.desktop-mode \.brand-mark\s*\{[\s\S]*?width:\s*2\.65rem;[\s\S]*?height:\s*2\.65rem/);
  assert.match(html, /if \(isDesktopMode\) \{[\s\S]*?const brandMark = document\.querySelector\('\.brand-mark'\);[\s\S]*?brandMark\.src = 'public\/apple-touch-icon\.png';[\s\S]*?brandMark\.alt = 'libstr'/);
});
