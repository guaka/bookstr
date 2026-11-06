'use strict';

const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const fs = require('node:fs') as typeof import('node:fs');
const path = require('node:path') as typeof import('node:path');
const test = require('node:test') as typeof import('node:test');

test('repository guidance bounds Electron, Playwright, and native-test memory use', () => {
  const instructions = fs.readFileSync(path.join(__dirname, '../../../AGENTS.md'), 'utf8');
  const resourceGuidance = instructions.split('## Local resource safety')[1]?.split('\n## ')[0] || '';

  assert.match(resourceGuidance, /one Electron or Playwright instance and one Playwright worker/i);
  assert.match(resourceGuidance, /Do not overlap Electron end-to-end suites, native builds, or native\s+dependency installation/i);
  assert.match(resourceGuidance, /inspect process RSS/i);
  assert.match(resourceGuidance, /70 GB/i);
  assert.match(resourceGuidance, /Cap the Node\.js heap/i);
  assert.match(resourceGuidance, /Never open Electron or Playwright test windows on the user's desktop/i);
  assert.match(resourceGuidance, /Do not bypass isolation with direct Playwright or Electron commands/i);
  assert.match(resourceGuidance, /must not read whole archives or decompress their contents/i);
  assert.match(resourceGuidance, /bounded header and ZIP-directory reads, bounded\s+concurrency/i);
});

test('Electron unit commands bound concurrent processes and heap size', () => {
  const { scripts } = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')) as import('../types/package-manifest').DesktopPackageManifest;
  for (const command of ['test:unit', 'test:coverage']) {
    assert.match(scripts[command]!, /--test-concurrency=1\b/);
    assert.match(scripts[command]!, /--max-old-space-size=768\b/);
  }
});
