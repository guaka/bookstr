const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const desktopRoot = path.join(__dirname, '../..');
const repositoryRoot = path.join(desktopRoot, '..');
const dockerfile = fs.readFileSync(path.join(desktopRoot, 'Dockerfile.test'), 'utf8');
const dockerignore = fs.readFileSync(path.join(repositoryRoot, '.dockerignore'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
const readme = fs.readFileSync(path.join(desktopRoot, 'README.md'), 'utf8');
const playwrightConfig = fs.readFileSync(path.join(desktopRoot, 'playwright.config.js'), 'utf8');

test('Electron Docker tests use the pinned Playwright image and an unprivileged Xvfb runtime', () => {
  assert.match(dockerfile, /^FROM mcr\.microsoft\.com\/playwright:v1\.62\.1-noble$/m);
  assert.match(dockerfile, /^RUN chown -R pwuser:pwuser \/workspace$/m);
  assert.match(dockerfile, /^USER pwuser$/m);
  assert.match(dockerfile, /^RUN npm ci$/m);
  assert.match(dockerfile, /^RUN node node_modules\/electron\/install\.js$/m);
  assert.match(dockerfile, /^ENTRYPOINT \["xvfb-run", "-a"\]$/m);
  assert.match(dockerfile, /^CMD \["npx", "playwright", "test"\]$/m);
});

test('Electron Docker test command builds from the repository root with a disposable container', () => {
  assert.equal(
    packageJson.scripts['test:e2e:docker'],
    'docker build --file Dockerfile.test --tag bookstr-electron-tests .. && docker run --rm --init --ipc=host bookstr-electron-tests',
  );
  assert.match(dockerignore, /^!desktop\/\*\*$/m);
  assert.match(dockerignore, /^!shared\/\*\*$/m);
  assert.match(dockerignore, /^!web\/\*\*$/m);
  assert.match(readme, /npm run test:e2e:docker/);
  assert.match(playwrightConfig, /workers: 1/);
});
