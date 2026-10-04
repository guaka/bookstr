'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('repository guidance bounds Electron, Playwright, and native-test memory use', () => {
  const instructions = fs.readFileSync(path.join(__dirname, '../../../AGENTS.md'), 'utf8');
  const resourceGuidance = instructions.split('## Local resource safety')[1]?.split('\n## ')[0] || '';

  assert.match(resourceGuidance, /one Electron or Playwright instance and one Playwright worker/i);
  assert.match(resourceGuidance, /Do not overlap Electron end-to-end suites, native builds, or native\s+dependency installation/i);
  assert.match(resourceGuidance, /inspect process RSS/i);
  assert.match(resourceGuidance, /70 GB/i);
  assert.match(resourceGuidance, /Cap the Node\.js heap/i);
});
