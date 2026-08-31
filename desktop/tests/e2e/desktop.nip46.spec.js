const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');
const { createNip46Fixture } = require('./nip46.fixture');

function newUserData() {
  const output = path.join(__dirname, '../../test-results');
  fs.mkdirSync(output, { recursive: true });
  return fs.mkdtempSync(path.join(output, 'nip46-user-data-'));
}

function launchArgs(userData) {
  return [path.join(__dirname, '../..'), `--user-data-dir=${userData}`];
}

function launchEnvironment(relayUrl) {
  return {
    ...process.env,
    NODE_ENV: 'test',
    BOOKSTR_DESKTOP_TEST_NIP46_RELAY_URL: relayUrl,
  };
}

test('approved NIP-46 QR signer becomes active, updates settings, and persists when secure storage is available', async () => {
  const fixture = await createNip46Fixture();
  const userData = newUserData();
  let electronApp = await electron.launch({
    args: launchArgs(userData),
    env: launchEnvironment(fixture.relayUrl),
  });

  try {
    let library = await electronApp.firstWindow();
    await library.getByRole('button', { name: 'Settings' }).click();
    await library.getByRole('button', { name: 'Connect with QR code' }).click();
    await expect(library.getByAltText('NIP-46 connection QR code')).toHaveAttribute('src', /^data:image\/png;base64,/);
    await library.getByRole('button', { name: 'Copy connection link' }).click();
    const invitationUri = await library.evaluate(() => navigator.clipboard.readText());
    const parsedInvitation = new URL(invitationUri);
    expect(parsedInvitation.searchParams.getAll('relay')).toEqual([fixture.relayUrl]);
    expect(parsedInvitation.searchParams.get('perms')).toContain('sign_event:22242');

    await fixture.approve(invitationUri);
    await expect.poll(() => library.evaluate(() => window.bookstrDesktop.signer.nip46QrStatus()))
      .toMatchObject({ status: 'connected', responseReceived: true, relays: [fixture.relayUrl] });

    const connected = await library.evaluate(async fixturePeerPubkey => ({
      status: await window.bookstrDesktop.signer.status(),
      pubkey: await window.bookstrDesktop.signer.getPublicKey(),
      signed: await window.bookstrDesktop.signer.signEvent({
        kind: 30078,
        created_at: 1_700_000_000,
        tags: [['d', 'nip46-test']],
        content: 'signed by the fixture',
      }),
      encrypted: await window.bookstrDesktop.signer.nip44.encrypt(
        fixturePeerPubkey,
        'encrypted by the fixture',
      ),
    }), fixture.peerPubkey);
    expect(connected.status).toMatchObject({ mode: 'nip46', configured: true, pubkey: fixture.userPubkey });
    expect(connected.pubkey).toBe(fixture.userPubkey);
    expect(connected.signed).toMatchObject({ pubkey: fixture.userPubkey, kind: 30078, content: 'signed by the fixture' });
    expect(fixture.decryptFromUser(connected.encrypted)).toBe('encrypted by the fixture');
    const encryptedForUser = fixture.encryptForUser('decrypted by Electron');
    await expect(library.evaluate(
      ({ peerPubkey, ciphertext }) => window.bookstrDesktop.signer.nip44.decrypt(peerPubkey, ciphertext),
      { peerPubkey: fixture.peerPubkey, ciphertext: encryptedForUser },
    )).resolves.toBe('decrypted by Electron');
    const signerStatus = library.locator('#desktop-signer-status');
    await expect(signerStatus).toContainText('Connected with NIP-46 remote signer');
    await expect(signerStatus).toHaveClass(/signer-connected/);
    await expect(library.getByRole('button', { name: 'Connect with QR code' })).toBeHidden();
    expect(await signerStatus.evaluate(element => getComputedStyle(element, '::before').content)).toBe('"✓"');

    await electronApp.close();
    electronApp = await electron.launch({
      args: launchArgs(userData),
      env: launchEnvironment(fixture.relayUrl),
    });
    library = await electronApp.firstWindow();
    const restartedStatus = await library.evaluate(() => window.bookstrDesktop.signer.status());
    if (connected.status.persistent) {
      expect(restartedStatus).toMatchObject({ mode: 'nip46', configured: true, pubkey: fixture.userPubkey });
      await expect(library.evaluate(() => window.bookstrDesktop.signer.getPublicKey())).resolves.toBe(fixture.userPubkey);
    } else {
      expect(restartedStatus).toMatchObject({ mode: '', configured: false, pubkey: '' });
    }
  } finally {
    await electronApp?.close();
    await fixture.close();
  }
});
