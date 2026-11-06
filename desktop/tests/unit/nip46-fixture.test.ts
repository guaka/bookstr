const test: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const { createNip46Fixture } = require('../e2e/nip46.fixture.ts') as typeof import('../e2e/nip46.fixture');
import type { Event } from 'nostr-tools/pure' with { 'resolution-mode': 'import' };

type Packet = [string, ...unknown[]];

test('NIP-46 relay fixture filters subscriptions and exchanges signed encrypted requests', { timeout: 15000 }, async t => {
  const [pure, nip44] = await Promise.all([import('nostr-tools/pure'), import('nostr-tools/nip44')]);
  const fixture = await createNip46Fixture();
  const socket = new WebSocket(fixture.relayUrl);
  const packets: Packet[] = [];
  const pending = new Set<() => void>();
  socket.addEventListener('message', message => {
    packets.push(JSON.parse(String(message.data)) as Packet);
    for (const notify of pending) notify();
  });
  t.after(async () => {
    const closed = new Promise<void>(resolve => socket.addEventListener('close', () => resolve(), { once: true }));
    socket.close();
    await closed;
    await fixture.close();
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('Fixture connection failed')), { once: true });
  });
  function waitFor(predicate: (packet: Packet) => boolean): Promise<Packet> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(check); reject(new Error('Fixture response timed out')); }, 3000);
      const check = () => {
        const packet = packets.find(predicate);
        if (!packet) return;
        clearTimeout(timer);
        pending.delete(check);
        resolve(packet);
      };
      pending.add(check);
      check();
    });
  }
  const secret = pure.generateSecretKey();
  const pubkey = pure.getPublicKey(secret);
  socket.send(JSON.stringify(['REQ', 'matched', { kinds: [24133], '#p': [pubkey] }]));
  await waitFor(packet => packet[0] === 'EOSE' && packet[1] === 'matched');
  await fixture.approve(`nostrconnect://${pubkey}?secret=fixture-secret`);
  const approved = await waitFor(packet => packet[0] === 'EVENT');
  const remote = approved[2] as Event;
  assert.equal(pure.verifyEvent(remote), true);
  const key = nip44.getConversationKey(secret, remote.pubkey);
  const decode = (event: Event): { id: string; result?: string; error?: string } => JSON.parse(nip44.decrypt(event.content, key));
  assert.deepEqual(decode(remote), { id: 'connect', result: 'fixture-secret' });

  for (const [id, filter] of [
    ['wrong-kind', { kinds: [1] }],
    ['wrong-author', { authors: [pubkey] }],
    ['wrong-recipient', { '#p': [fixture.peerPubkey] }],
    ['right-author', { authors: [remote.pubkey] }],
  ] as const) {
    socket.send(JSON.stringify(['REQ', id, filter]));
    await waitFor(packet => packet[0] === 'EOSE' && packet[1] === id);
  }
  let sequence = 0;
  async function request(method: string, params: string[] = []) {
    const id = `request-${++sequence}`;
    const event = pure.finalizeEvent({ kind: 24133, created_at: 1700000000, tags: [['p', remote.pubkey]], content: nip44.encrypt(JSON.stringify({ id, method, params }), key) }, secret);
    socket.send(JSON.stringify(['EVENT', event]));
    await waitFor(packet => packet[0] === 'OK' && packet[1] === event.id);
    const response = await waitFor(packet => packet[0] === 'EVENT' && decode(packet[2] as Event).id === id);
    return decode(response[2] as Event);
  }
  assert.equal((await request('get_public_key')).result, fixture.userPubkey);
  const template = { kind: 1, created_at: 1700000000, tags: [], content: 'Fixture signing contract' };
  const signed = JSON.parse((await request('sign_event', [JSON.stringify(template)])).result!) as Event;
  assert.equal(signed.pubkey, fixture.userPubkey);
  assert.equal(signed.content, template.content);
  assert.equal(pure.verifyEvent(signed), true);
  const ciphertext = (await request('nip44_encrypt', [fixture.peerPubkey, 'outgoing'])).result!;
  assert.equal(fixture.decryptFromUser(ciphertext), 'outgoing');
  assert.equal((await request('nip44_decrypt', [fixture.peerPubkey, fixture.encryptForUser('incoming')])).result, 'incoming');
  assert.equal((await request('unsupported')).error, 'unsupported method: unsupported');
  assert.equal(packets.some(packet => packet[0] === 'EVENT' && String(packet[1]).startsWith('wrong-')), false);
  assert.equal(packets.some(packet => packet[0] === 'EVENT' && packet[1] === 'right-author'), true);

  socket.send(JSON.stringify(['CLOSE', 'matched']));
  await request('get_public_key');
  const finalId = `request-${sequence}`;
  assert.equal(packets.some(packet => packet[0] === 'EVENT' && packet[1] === 'matched' && decode(packet[2] as Event).id === finalId), false);
});
