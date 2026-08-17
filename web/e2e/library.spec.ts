import { expect, test } from '@playwright/test'

test.describe('bookstr web', () => {
  test('loads the seed catalog in the library', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.getByRole('heading', { name: 'bookstr' })).toBeVisible()
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
    await expect(page.getByRole('heading', { name: 'bookstr' })).toBeVisible()
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
      await page.getByRole('button', { name: title, exact: false }).click()
      await expect(page).toHaveURL(/#\/read\//)
      await expect(page.locator('.reader')).toBeVisible()
      await expect(page.getByText('Opening…')).toBeHidden({ timeout: 60_000 })
      await expect(page.locator('.reader-status.error')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Previous section' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Next section' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Decrease font size' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Increase font size' })).toBeVisible()

      if (title === titles[0]) {
        await expect(page.getByText('100%')).toBeVisible()
        await page.getByRole('button', { name: 'Increase font size' }).click()
        await expect(page.getByText('110%')).toBeVisible()
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
        await expect(page.getByText('110%')).toBeVisible()
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

      const home = page.getByRole('button', { name: 'Back to library' })
      await expect(home).toBeVisible()
      if (title === titles[0]) {
        await home.click()
      } else {
        await page.keyboard.press('Escape')
      }
      await expect(page).toHaveURL(/#\/$/)
      await expect(page.getByRole('heading', { name: 'bookstr' })).toBeVisible()
    }
  })
})
