import { open, readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const PREFERRED_WORDS = ['filter', 'library', 'reader', 'home', 'progress'];

const slug = (value) => String(value || 'screenshots')
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'screenshots';

const safePath = (value) => value.split(sep).map(slug).join('/');
const markdownText = (value) => String(value).replace(/[\[\]()`\r\n]/g, ' ').trim();

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return files.flat();
}

async function isPng(path) {
  if (!path.toLowerCase().endsWith('.png')) return false;
  const metadata = await stat(path);
  if (metadata.size < PNG_SIGNATURE.length || metadata.size > MAX_SCREENSHOT_BYTES) return false;
  const handle = await open(path, 'r');
  try {
    const signature = Buffer.alloc(PNG_SIGNATURE.length);
    await handle.read(signature, 0, signature.length, 0);
    return signature.equals(PNG_SIGNATURE);
  } finally {
    await handle.close();
  }
}

function preference(path) {
  const lower = path.toLowerCase();
  return PREFERRED_WORDS.reduce((score, word, index) => (
    lower.includes(word) ? score + PREFERRED_WORDS.length - index : score
  ), 0);
}

export async function selectScreenshots(root, perArtifact = 2) {
  let artifacts;
  try {
    artifacts = (await readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const selected = [];
  for (const artifact of artifacts) {
    const directory = join(root, artifact.name);
    const candidates = [];
    for (const path of await walk(directory)) {
      if (await isPng(path)) candidates.push(path);
    }
    candidates.sort((left, right) => preference(right) - preference(left) || left.localeCompare(right));
    selected.push(...candidates.slice(0, perArtifact).map(path => ({
      artifact: artifact.name,
      path,
      relativePath: relative(directory, path),
    })));
  }
  return selected;
}

async function ensureBranch(github, owner, repo, branch) {
  try {
    const ref = await github.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    return ref.data.object.sha;
  } catch (error) {
    if (error?.status !== 404) throw error;
    const repository = await github.rest.repos.get({ owner, repo });
    const base = await github.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${repository.data.default_branch}`,
    });
    const ref = await github.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: base.data.object.sha,
    });
    return ref.data.object.sha;
  }
}

async function existingFile(github, owner, repo, branch, path) {
  try {
    const response = await github.rest.repos.getContent({ owner, repo, path, ref: branch });
    return Array.isArray(response.data) ? undefined : response.data;
  } catch (error) {
    if (error?.status === 404) return undefined;
    throw error;
  }
}

export function renderGallery({ workflowName, runUrl, marker, images }) {
  const safeWorkflowName = markdownText(workflowName);
  const lines = [
    `<!-- bookstr-e2e-screenshot-gallery:${marker} -->`,
    `## E2E screenshots — ${safeWorkflowName}`,
    '',
    `[Open workflow run](${runUrl})`,
    '',
  ];
  for (const image of images) {
    const label = markdownText(image.label);
    lines.push(`### ${label}`, `![${label}](${image.url})`, '');
  }
  lines.push('Published automatically from successful GitHub Actions screenshot artifacts.');
  return `${lines.join('\n')}\n`;
}

export async function publishScreenshotGallery({
  github,
  owner,
  repo,
  pullRequests,
  workflowName,
  runId,
  runUrl,
  screenshotRoot,
  branch = 'automation/e2e-screenshots',
}) {
  if (!pullRequests.length) return 0;
  const screenshots = await selectScreenshots(screenshotRoot);
  if (!screenshots.length) return 0;
  let branchCommit = await ensureBranch(github, owner, repo, branch);

  for (const pullRequest of pullRequests) {
    const published = [];
    let commit = branchCommit;
    for (const screenshot of screenshots) {
      const destination = [
        'docs',
        'e2e-screenshots',
        `pr-${pullRequest.number}`,
        slug(workflowName),
        slug(screenshot.artifact),
        safePath(screenshot.relativePath),
      ].join('/');
      const content = (await readFile(screenshot.path)).toString('base64');
      const existing = await existingFile(github, owner, repo, branch, destination);
      if (existing?.content?.replace(/\s/g, '') !== content) {
        const response = await github.rest.repos.createOrUpdateFileContents({
          owner,
          repo,
          branch,
          path: destination,
          message: `Publish ${workflowName} screenshots for PR ${pullRequest.number}`,
          content,
          ...(existing?.sha ? { sha: existing.sha } : {}),
        });
        commit = response.data.commit.sha;
      }
      published.push({
        destination,
        label: `${screenshot.artifact.replace(/^bookstr-e2e-screenshots-/, '').replace(new RegExp(`-${runId}$`), '')}: ${basename(screenshot.relativePath, '.png')}`,
      });
    }
    branchCommit = commit;

    const marker = slug(workflowName);
    const images = published.map(image => ({
      label: image.label,
      url: `https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${image.destination}`,
    }));
    const body = renderGallery({ workflowName, runUrl, marker, images });
    const comments = await github.paginate(github.rest.issues.listComments, {
      owner,
      repo,
      issue_number: pullRequest.number,
      per_page: 100,
    });
    const commentMarker = `<!-- bookstr-e2e-screenshot-gallery:${marker} -->`;
    const existing = comments.find(comment => comment.body?.includes(commentMarker));
    const payload = { owner, repo, body };
    if (existing) {
      await github.rest.issues.updateComment({ ...payload, comment_id: existing.id });
    } else {
      await github.rest.issues.createComment({ ...payload, issue_number: pullRequest.number });
    }
  }
  return screenshots.length;
}
