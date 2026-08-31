import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { publishScreenshotGallery, renderGallery, selectScreenshots } from './pr-screenshot-gallery.mjs';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

test('selects two valid, meaningful PNGs from each artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bookstr-screenshots-'));
  const web = join(root, 'bookstr-e2e-screenshots-web-42');
  const ios = join(root, 'bookstr-e2e-screenshots-ios-43');
  await mkdir(web);
  await mkdir(ios);
  await writeFile(join(web, 'plain.png'), png);
  await writeFile(join(web, 'home-filter.png'), png);
  await writeFile(join(web, 'reader.png'), png);
  await writeFile(join(web, 'fake.png'), 'not a png');
  await writeFile(join(ios, 'one.png'), png);

  const selected = await selectScreenshots(root);
  assert.deepEqual(selected.map(item => item.relativePath), ['one.png', 'home-filter.png', 'reader.png']);
  assert.deepEqual(await selectScreenshots(join(root, 'missing')), []);
});

test('renders an inline gallery with a stable workflow marker', () => {
  const body = renderGallery({
    workflowName: 'Android CI',
    runUrl: 'https://github.com/guaka/bookstr/actions/runs/42',
    marker: 'android-ci',
    images: [{ label: 'Android: [library](unsafe)', url: 'https://raw.example/library.png' }],
  });
  assert.match(body, /bookstr-e2e-screenshot-gallery:android-ci/);
  assert.match(body, /!\[Android:  library  unsafe\]\(https:\/\/raw\.example\/library\.png\)/);
  assert.doesNotMatch(body, /\[library\]\(unsafe\)/);
});

test('publishes screenshots and creates the workflow gallery comment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bookstr-publish-screenshots-'));
  const artifact = join(root, 'bookstr-e2e-screenshots-android-42');
  await mkdir(artifact);
  await writeFile(join(artifact, 'library-filter.png'), png);
  const uploaded = [];
  const comments = [];
  const notFound = Object.assign(new Error('missing'), { status: 404 });
  const github = {
    paginate: async () => [],
    rest: {
      git: { getRef: async () => ({ data: { object: { sha: 'base123' } } }) },
      repos: {
        getContent: async () => { throw notFound; },
        createOrUpdateFileContents: async payload => {
          uploaded.push(payload);
          return { data: { commit: { sha: 'abc123' } } };
        },
      },
      issues: {
        listComments: async () => ({ data: [] }),
        createComment: async payload => { comments.push(payload); },
      },
    },
  };

  const count = await publishScreenshotGallery({
    github,
    owner: 'guaka',
    repo: 'bookstr',
    pullRequests: [{ number: 76 }],
    workflowName: 'Android CI',
    runId: 42,
    runUrl: 'https://github.com/guaka/bookstr/actions/runs/42',
    screenshotRoot: root,
  });
  assert.equal(count, 1);
  assert.equal(uploaded.length, 1);
  assert.match(uploaded[0].path, /^docs\/e2e-screenshots\/pr-76\/android-ci\//);
  assert.match(comments[0].body, /raw\.githubusercontent\.com\/guaka\/bookstr\/abc123/);
});
