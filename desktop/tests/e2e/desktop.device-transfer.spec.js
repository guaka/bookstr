const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron, test, expect } = require('@playwright/test');

function electronArgs() {
  const output = path.join(__dirname, '../../test-results');
  fs.mkdirSync(output, { recursive: true });
  const userData = fs.mkdtempSync(path.join(output, 'device-transfer-user-data-'));
  return [path.join(__dirname, '../..'), `--user-data-dir=${userData}`];
}

test('Electron exposes private device discovery and guarded transfer controls', async () => {
  const app = await electron.launch({ args: electronArgs() });
  try {
    const window = await app.firstWindow();
    await window.getByRole('button', { name: 'People' }).click();
    const panel = window.locator('#device-transfer-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Devices & transfers' })).toBeVisible();
    await expect(panel).not.toContainText(/torrent|magnet|peer/i);
    await expect(window.locator('#device-transfer-summary')).toContainText('Bookstr desktop');
    await window.getByRole('button', { name: 'Prepare private presence' }).click();
    await expect(window.locator('#device-transfer-result')).toContainText('Private presence prepared');

    await window.locator('#device-private-torrent').fill('book-transfer-code');
    await window.locator('#device-private-peer').fill('paired-device-code');
    await window.locator('#device-private-transfer-form').getByRole('button', { name: 'Receive book privately' }).click();
    await expect(window.locator('#device-transfer-result')).toContainText('Private book transfer could not start');
  } finally {
    await app.close();
  }
});
