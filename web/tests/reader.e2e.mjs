import { test, expect } from '@playwright/test';

const books = [
  { id: '30142', title: 'Little Brother' },
  { id: '48320', title: 'Adventures of Sherlock Holmes' },
];

for (const book of books) {
  test(`${book.title} keeps a large cover and advances`, async ({ page }) => {
    const readUrl = `https://books-api.guaka.org/api/books/${book.id}/download`;
    await page.goto(`/#read=${encodeURIComponent(readUrl)}`);

    await expect(page.locator('#reader-frame')).toHaveAttribute('src', /reader\.html/);
    const reader = page.frameLocator('#reader-frame');
    await expect(reader.locator('#reader-next')).toBeVisible();
    await expect(reader.locator('body')).toHaveAttribute('data-location', /epubcfi\(/);

    const content = reader.frameLocator('#viewer iframe').first();
    const cover = content.locator('html.bookstr-cover img, html.bookstr-cover svg').first();
    await expect(cover).toBeVisible();
    const coverBox = await cover.boundingBox();
    expect(coverBox).not.toBeNull();
    expect(coverBox.height).toBeGreaterThan(430);

    const scrollContainer = reader.locator('.epub-container');
    await expect.poll(() => scrollContainer.evaluate(node => node.scrollHeight - node.clientHeight))
      .toBeGreaterThan(300);
    const scrollBefore = await scrollContainer.evaluate(node => node.scrollTop);
    const readerBox = await page.locator('#reader-frame').boundingBox();
    expect(readerBox).not.toBeNull();
    await page.mouse.move(readerBox.x + readerBox.width / 2, readerBox.y + readerBox.height / 2);
    await page.mouse.wheel(0, 650);
    await expect.poll(() => scrollContainer.evaluate(node => node.scrollTop)).toBeGreaterThan(scrollBefore);

    const arrowScrollBefore = await scrollContainer.evaluate(node => node.scrollTop);
    await page.keyboard.press('ArrowRight');
    await expect.poll(
      () => scrollContainer.evaluate(node => node.scrollTop),
      { message: 'ArrowRight should advance the vertically scrolling reader' },
    ).toBeGreaterThan(arrowScrollBefore);
  });
}
