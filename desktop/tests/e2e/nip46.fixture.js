const http = require('node:http');
const { wsServer: WebSocketServer } = require('playwright-core/lib/utilsBundle');

function eventMatchesFilter(event, filter) {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter['#p']) {
    const recipients = event.tags.filter(tag => tag[0] === 'p').map(tag => tag[1]);
    if (!filter['#p'].some(pubkey => recipients.includes(pubkey))) return false;
  }
  return true;
}

async function createNip46Fixture() {
  const [pure, nip44] = await Promise.all([
    import('nostr-tools/pure'),
    import('nostr-tools/nip44'),
  ]);
  const remoteSecret = pure.generateSecretKey();
  const remotePubkey = pure.getPublicKey(remoteSecret);
  const userSecret = pure.generateSecretKey();
  const userPubkey = pure.getPublicKey(userSecret);
  const peerSecret = pure.generateSecretKey();
  const peerPubkey = pure.getPublicKey(peerSecret);
  const sockets = new Set();
  const subscriptions = new Map();
  let connection = null;

  const server = http.createServer();
  const websocketServer = new WebSocketServer({ server });

  function publish(event) {
    for (const socket of sockets) {
      const socketSubscriptions = subscriptions.get(socket) || new Map();
      for (const [subscriptionId, filters] of socketSubscriptions) {
        if (filters.some(filter => eventMatchesFilter(event, filter))) {
          socket.send(JSON.stringify(['EVENT', subscriptionId, event]));
        }
      }
    }
  }

  function remoteEvent(payload) {
    const conversationKey = nip44.getConversationKey(remoteSecret, connection.clientPubkey);
    return pure.finalizeEvent({
      kind: 24133,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', connection.clientPubkey]],
      content: nip44.encrypt(JSON.stringify(payload), conversationKey),
    }, remoteSecret);
  }

  async function handleRequest(event) {
    if (!connection || event.kind !== 24133 || event.pubkey !== connection.clientPubkey) return;
    const conversationKey = nip44.getConversationKey(remoteSecret, connection.clientPubkey);
    const request = JSON.parse(nip44.decrypt(event.content, conversationKey));
    let result;
    if (request.method === 'get_public_key') {
      result = userPubkey;
    } else if (request.method === 'sign_event') {
      const template = JSON.parse(request.params[0]);
      result = JSON.stringify(pure.finalizeEvent(template, userSecret));
    } else if (request.method === 'nip44_encrypt') {
      const peerKey = nip44.getConversationKey(userSecret, request.params[0]);
      result = nip44.encrypt(request.params[1], peerKey);
    } else if (request.method === 'nip44_decrypt') {
      const peerKey = nip44.getConversationKey(userSecret, request.params[0]);
      result = nip44.decrypt(request.params[1], peerKey);
    } else {
      publish(remoteEvent({ id: request.id, error: `unsupported method: ${request.method}` }));
      return;
    }
    publish(remoteEvent({ id: request.id, result }));
  }

  websocketServer.on('connection', socket => {
    sockets.add(socket);
    subscriptions.set(socket, new Map());
    socket.on('message', raw => {
      const packet = JSON.parse(String(raw));
      if (packet[0] === 'REQ') {
        const filters = packet.slice(2);
        subscriptions.get(socket).set(packet[1], filters);
        socket.send(JSON.stringify(['EOSE', packet[1]]));
      } else if (packet[0] === 'CLOSE') {
        subscriptions.get(socket).delete(packet[1]);
      } else if (packet[0] === 'EVENT') {
        socket.send(JSON.stringify(['OK', packet[1].id, true, '']));
        void handleRequest(packet[1]);
      }
    });
    socket.on('close', () => {
      sockets.delete(socket);
      subscriptions.delete(socket);
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const relayUrl = `ws://127.0.0.1:${server.address().port}/`;

  return {
    relayUrl,
    userPubkey,
    peerPubkey,
    encryptForUser(plaintext) {
      const key = nip44.getConversationKey(peerSecret, userPubkey);
      return nip44.encrypt(plaintext, key);
    },
    decryptFromUser(ciphertext) {
      const key = nip44.getConversationKey(peerSecret, userPubkey);
      return nip44.decrypt(ciphertext, key);
    },
    async approve(uri) {
      const parsed = new URL(uri);
      connection = {
        clientPubkey: parsed.hostname || parsed.pathname.replace(/^\/+/, ''),
        secret: parsed.searchParams.get('secret'),
      };
      publish(remoteEvent({ id: 'connect', result: connection.secret }));
    },
    close() {
      for (const socket of sockets) socket.close();
      return new Promise((resolve, reject) => {
        websocketServer.close(() => server.close(error => error ? reject(error) : resolve()));
      });
    },
  };
}

module.exports = { createNip46Fixture };
