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
  assert.match(dockerfile, /^COPY --chown=pwuser:pwuser desktop\/package\.json desktop\/pnpm-lock\.yaml desktop\/pnpm-workspace\.yaml \.\/$/m);
  assert.match(dockerfile, /^COPY --chown=pwuser:pwuser desktop\/patches\/ \.\/patches\/$/m);
  assert.match(dockerfile, /^RUN chown -R pwuser:pwuser \/workspace$/m);
  assert.match(dockerfile, /^RUN corepack enable$/m);
  assert.match(dockerfile, /^USER pwuser$/m);
  assert.ok(dockerfile.indexOf('RUN corepack enable') < dockerfile.indexOf('USER pwuser'));
  assert.match(dockerfile, /^RUN pnpm install --frozen-lockfile$/m);
  assert.equal(packageJson.scripts.postinstall, 'node node_modules/electron/install.js');
  assert.match(dockerfile, /desktop\/pnpm-lock\.yaml desktop\/pnpm-workspace\.yaml/);
  assert.match(dockerfile, /^ENTRYPOINT \["xvfb-run", "-a"\]$/m);
  assert.match(dockerfile, /^CMD \["pnpm", "run", "test:e2e"\]$/m);
  assert.match(dockerfile, /COPY --chown=pwuser:pwuser desktop\/ \.\//);
  assert.equal(packageJson.scripts['pretest:e2e'], 'pnpm run build:typescript');
});

test('Electron Docker test command builds from the repository root with a disposable container', () => {
  assert.equal(
    packageJson.scripts['test:e2e:docker'],
    'docker build --file Dockerfile.test --tag bookstr-electron-tests .. && docker run --rm --init --ipc=host bookstr-electron-tests',
  );
  assert.match(dockerignore, /^!desktop\/\*\*$/m);
  assert.match(dockerignore, /^!shared\/\*\*$/m);
  assert.match(dockerignore, /^!web\/\*\*$/m);
  assert.match(dockerignore, /^desktop\/\.tmp\/$/m);
  assert.match(readme, /pnpm run test:e2e:docker/);
  assert.match(readme, /src\/\*\.ts` compile to JavaScript in the matching paths/);
  assert.match(readme, /pnpm run build:typescript/);
  assert.match(readme, /pnpm run typecheck/);
  assert.match(readme, /512 MB/);
  assert.match(readme, /GOMEMLIMIT=512MiB/);
  assert.match(readme, /GOMAXPROCS=2/);
  assert.match(readme, /does not leave a\s+watch process running/);
  assert.doesNotMatch(readme, /\bnpm\b|\bnpx\b/);
  assert.match(playwrightConfig, /workers: 1/);
});
