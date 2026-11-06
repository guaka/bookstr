import * as http from 'node:http';
import type { Event } from 'nostr-tools/pure' with { 'resolution-mode': 'import' };
interface RelayFilter { kinds?:number[]; authors?:string[]; '#p'?:string[] }
interface RelaySocket {
 send(value:string):void;
 close():void;
 on(event:'message',callback:(raw:Buffer)=>void):void;
 on(event:'close',callback:()=>void):void;
}
interface RelayServer { on(event:'connection',callback:(socket:RelaySocket)=>void):void;close(callback:()=>void):void }
type WebSocketBundle = { wsServer: new(options:{server:import('node:http').Server})=>RelayServer };


function eventMatchesFilter(event: Event, filter: RelayFilter) {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter['#p']) {
    const recipients = event.tags.filter(tag => tag[0] === 'p').map(tag => tag[1]);
    if (!filter['#p'].some(pubkey => recipients.includes(pubkey))) return false;
  }
  return true;
}

export async function createNip46Fixture() {
  const bundlePath: string = 'playwright-core/lib/utilsBundle';
  const { default: bundle } = await import(bundlePath) as {default: WebSocketBundle};
  const { wsServer: WebSocketServer } = bundle;
  const [pure, nip44] = await Promise.all([
    import('nostr-tools/pure'),
    import('nostr-tools/nip44'),
  ]);
  const remoteSecret = pure.generateSecretKey();
  const userSecret = pure.generateSecretKey();
  const userPubkey = pure.getPublicKey(userSecret);
  const peerSecret = pure.generateSecretKey();
  const peerPubkey = pure.getPublicKey(peerSecret);
  const sockets = new Set<RelaySocket>();
  const subscriptions = new Map<RelaySocket, Map<string,RelayFilter[]>>();
  let connection: {clientPubkey:string;secret:string|null} | null = null;

  const server = http.createServer();
  const websocketServer = new WebSocketServer({ server });

  function publish(event: Event) {
    for (const socket of sockets) {
      const socketSubscriptions = subscriptions.get(socket) || new Map<string,RelayFilter[]>();
      for (const [subscriptionId, filters] of socketSubscriptions) {
        if (filters.some(filter => eventMatchesFilter(event, filter))) {
          socket.send(JSON.stringify(['EVENT', subscriptionId, event]));
        }
      }
    }
  }

  function remoteEvent(payload: {id:string;error?:string;result?:string|null}) {
    const conversationKey = nip44.getConversationKey(remoteSecret, connection!.clientPubkey);
    return pure.finalizeEvent({
      kind: 24133,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', connection!.clientPubkey]],
      content: nip44.encrypt(JSON.stringify(payload), conversationKey),
    }, remoteSecret);
  }

  async function handleRequest(event: Event) {
    if (!connection || event.kind !== 24133 || event.pubkey !== connection!.clientPubkey) return;
    const conversationKey = nip44.getConversationKey(remoteSecret, connection!.clientPubkey);
    const request = JSON.parse(nip44.decrypt(event.content, conversationKey)) as {method:string;id:string;params:string[]};
    let result;
    if (request.method === 'get_public_key') {
      result = userPubkey;
    } else if (request.method === 'sign_event') {
      const template = JSON.parse(request.params[0]!) as Parameters<typeof pure.finalizeEvent>[0];
      result = JSON.stringify(pure.finalizeEvent(template, userSecret));
    } else if (request.method === 'nip44_encrypt') {
      const peerKey = nip44.getConversationKey(userSecret, request.params[0]!);
      result = nip44.encrypt(request.params[1]!, peerKey);
    } else if (request.method === 'nip44_decrypt') {
      const peerKey = nip44.getConversationKey(userSecret, request.params[0]!);
      result = nip44.decrypt(request.params[1]!, peerKey);
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
      const packet = JSON.parse(String(raw)) as ['REQ',string,...RelayFilter[]] | ['CLOSE',string] | ['EVENT',Event];
      if (packet[0] === 'REQ') {
        const filters = packet.slice(2) as RelayFilter[];
        subscriptions.get(socket)!.set(packet[1], filters);
        socket.send(JSON.stringify(['EOSE', packet[1]]));
      } else if (packet[0] === 'CLOSE') {
        subscriptions.get(socket)!.delete(packet[1]);
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

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const relayUrl = `ws://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/`;

  return {
    relayUrl,
    userPubkey,
    peerPubkey,
    encryptForUser(plaintext: string) {
      const key = nip44.getConversationKey(peerSecret, userPubkey);
      return nip44.encrypt(plaintext, key);
    },
    decryptFromUser(ciphertext: string) {
      const key = nip44.getConversationKey(peerSecret, userPubkey);
      return nip44.decrypt(ciphertext, key);
    },
    async approve(uri: string) {
      const parsed = new URL(uri);
      connection = {
        clientPubkey: parsed.hostname || parsed.pathname.replace(/^\/+/, ''),
        secret: parsed.searchParams.get('secret'),
      };
      publish(remoteEvent({ id: 'connect', result: connection.secret }));
    },
    close() {
      for (const socket of sockets) socket.close();
      return new Promise<void>((resolve, reject) => {
        websocketServer.close(() => server.close(error => error ? reject(error) : resolve()));
      });
    },
  };
}
