const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

test('comic pages recover from an Android zero-height viewport and remain visible after rotation', async ({ page }, testInfo) => {
  const source = path.resolve(__dirname, '../../../web/comic-reader.html');
  await page.route('https://comic.test/**', async route => {
    if (route.request().url().endsWith('/comic-reader.html')) {
      await route.fulfill({ path: source, contentType: 'text/html' });
    } else await route.fulfill({ body: '', contentType: 'text/javascript' });
  });
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.coverage.startJSCoverage();
  await page.goto('https://comic.test/comic-reader.html');
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 794; canvas.height = 1150;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'blue'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    // The tablet decoded every page successfully, but its CSS containing block stayed at zero.
    document.documentElement.style.height = '0px';
    document.body.style.height = '0px';
    await window.loadComic({ format: 'cbz', pages: [
      { name: '1.png', url: canvas.toDataURL() },
      { name: '2.png', url: canvas.toDataURL() },
    ] });
  });
  const visiblePage = () => page.evaluate(() => {
    const stage = document.getElementById('stage').getBoundingClientRect();
    const image = document.querySelector('#stage img').getBoundingClientRect();
    return stage.height > innerHeight * 0.7 && image.width > 100 && image.height > 100 &&
      image.top >= stage.top - 1 && image.bottom <= stage.bottom + 1;
  });
  await expect.poll(visiblePage).toBe(true);
  await page.locator('#next').click();
  await expect(page.locator('#count')).toHaveText('2 / 2');
  await expect.poll(visiblePage).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(visiblePage).toBe(true);
  // An unattached WebView may initially report no height; do not replace a valid size with zero.
  await page.evaluate(() => {
    const previous = document.body.style.height;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 0 });
    syncComicViewport();
    if (document.body.style.height !== previous) throw new Error('Invalid viewport replaced valid size');
    delete window.innerHeight;
  });
  const coverage = await page.coverage.stopJSCoverage();
  await fs.writeFile(testInfo.outputPath('comic-coverage.json'), JSON.stringify(coverage));
  const reader = coverage.find(entry => entry.url.endsWith('/comic-reader.html'));
  const viewport = reader.functions.find(fn => fn.functionName === 'syncComicViewport');
  expect(viewport.ranges.every(range => range.count > 0)).toBe(true);
});
