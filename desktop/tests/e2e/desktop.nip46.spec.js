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

test('approved NIP-46 QR signer becomes active, signs, encrypts, and survives restart', async () => {
  const fixture = await createNip46Fixture();
  const userData = newUserData();
  let electronApp = await electron.launch({
    args: launchArgs(userData),
    env: launchEnvironment(fixture.relayUrl),
  });

  try {
    let library = await electronApp.firstWindow();
    const invitation = await library.evaluate(() => window.bookstrDesktop.signer.startNip46Qr());
    const parsedInvitation = new URL(invitation.uri);
    expect(parsedInvitation.searchParams.getAll('relay')).toEqual([fixture.relayUrl]);
    expect(parsedInvitation.searchParams.get('perms')).toContain('sign_event:22242');

    await fixture.approve(invitation.uri);
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

    await electronApp.close();
    electronApp = await electron.launch({
      args: launchArgs(userData),
      env: launchEnvironment(fixture.relayUrl),
    });
    library = await electronApp.firstWindow();
    await expect.poll(() => library.evaluate(() => window.bookstrDesktop.signer.status()))
      .toMatchObject({ mode: 'nip46', configured: true, pubkey: fixture.userPubkey });
    await expect(library.evaluate(() => window.bookstrDesktop.signer.getPublicKey())).resolves.toBe(fixture.userPubkey);
  } finally {
    await electronApp?.close();
    await fixture.close();
  }
});
