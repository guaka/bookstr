import { expect, test } from '@playwright/test'

test.describe('bookstr web', () => {
  test('loads the seed catalog in the library', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.getByRole('button', { name: 'Bookstr home' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Favorites' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Reading' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Examples' })).toBeVisible()
    await expect(page.getByText('Little Brother')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('The Time Machine')).toBeVisible()
  })

  test('opens settings and returns to the library', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Little Brother')).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page).toHaveURL(/#\/settings$/)
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Nostr sync' })).toBeVisible()

    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.getByRole('heading', { name: 'Favorites' })).toBeVisible()
    await expect(page.getByText('Little Brother')).toBeVisible()
  })

  test('opens every seed book in the reader and can leave', async ({ page }) => {
    await page.goto('/')
    const titles = [
      'Little Brother',
      'Down and Out in the Magic Kingdom',
      'O Banqueiro Anarquista',
      'Da Terra à Lua',
      'The Time Machine',
    ]

    for (const title of titles) {
      await expect(page.getByText(title)).toBeVisible({ timeout: 30_000 })
      await page.getByText(title, { exact: true }).locator('..').click()
      await expect(page).toHaveURL(/#\/read\//)
      await expect(page.locator('.reader')).toBeVisible()
      await expect(page.getByText('Opening…')).toBeHidden({ timeout: 60_000 })
      await expect(page.locator('.reader-status.error')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Previous section' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Next section' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Decrease font size' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Increase font size' })).toBeVisible()

      if (title === titles[0]) {
        await expect(page.locator('.font-size-value')).toHaveText('100%')
        await page.getByRole('button', { name: 'Increase font size' }).click()
        await expect(page.locator('.font-size-value')).toHaveText('110%')
        await expect.poll(() => page.evaluate(() => localStorage.getItem('bookstr.fontSize'))).toBe('110')
        const iframe = page.locator('.reader-surface iframe').first()
        await expect(iframe).toBeVisible()
        const margins = await iframe.evaluate((element) => {
          const frame = element as HTMLIFrameElement
          const body = frame.contentDocument?.body
          if (!body) return null
          const rect = body.getBoundingClientRect()
          return { left: rect.left, right: frame.clientWidth - rect.right }
        })
        expect(margins).not.toBeNull()
        expect(Math.abs((margins?.left ?? 0) - (margins?.right ?? 0))).toBeLessThan(2)
      } else {
        await expect(page.locator('.font-size-value')).toHaveText('110%')
      }

      const scroller = page.locator('.reader-surface .epub-container')
      await expect(scroller).toBeVisible()
      await expect
        .poll(
          () =>
            scroller.evaluate((element) => element.scrollHeight > element.clientHeight),
          { timeout: 10_000 },
        )
        .toBe(true)
      await scroller.evaluate((element) => element.scrollTo(0, 0))
      await page.keyboard.press('Space')
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0)
      const afterSpace = await scroller.evaluate((element) => element.scrollTop)
      await page.keyboard.press('ArrowUp')
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollTop))
        .toBeLessThan(afterSpace)
      const afterUp = await scroller.evaluate((element) => element.scrollTop)
      await page.keyboard.press('ArrowDown')
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(afterUp)

      if (title === titles[0]) {
        await page.getByRole('button', { name: 'Next section' }).click()
        await expect
          .poll(async () => page.locator('.reader-meta span').textContent())
          .not.toBe('0%')
      }

      const home = page.getByRole('button', { name: 'Back to library' })
      await expect(home).toBeVisible()
      if (title === titles[0]) {
        await home.click()
      } else {
        await page.keyboard.press('Escape')
      }
      await expect(page).toHaveURL(/#\/$/)
      await expect(page.getByRole('heading', { name: 'Favorites' })).toBeVisible()
      if (title === titles[0]) {
        const reading = page.locator('section[aria-labelledby="reading-heading"]')
        await expect(reading.getByText('Little Brother')).toBeVisible()
        await expect(reading.getByText(/^(<1|[1-9]\d*)% read$/)).toBeVisible()
      }
    }
  })

  test('favorites books locally and shows them first on the home page', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Little Brother')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Add Little Brother to favorites' }).click()
    await page.getByRole('button', { name: 'Favorites', exact: true }).click()
    await expect(page).toHaveURL(/#\/favorites$/)
    const favorites = page.locator('section[aria-labelledby="favorites-heading"]')
    const examples = page.locator('section[aria-labelledby="examples-heading"]')
    await expect(favorites.getByText('Little Brother')).toBeVisible()
    await expect(examples.getByText('Little Brother')).toHaveCount(0)
    await expect(examples.getByText('The Time Machine')).toBeVisible()

    await page.reload()
    await expect(page.getByText('Little Brother')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Remove Little Brother from favorites' })).toBeVisible()
  })
})
