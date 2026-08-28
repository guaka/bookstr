(function initBookstrBlossomAuthorization(root) {
  const KIND = 24242;
  const SHA256 = /^[a-f0-9]{64}$/i;

  function unsignedGetEvent(hash, server, nowSeconds, content) {
    if (typeof hash !== 'string' || !SHA256.test(hash)) throw new Error('Invalid Blossom SHA-256');
    if (typeof server !== 'string' || !server || server.includes('/')) {
      throw new Error('Invalid Blossom server name');
    }
    return {
      kind: KIND,
      created_at: nowSeconds,
      tags: [
        ['t', 'get'],
        ['expiration', String(nowSeconds + 120)],
        ['server', server],
        ['x', hash.toLowerCase()],
      ],
      content,
    };
  }

  function authorizationHeader(event) {
    const bytes = new TextEncoder().encode(JSON.stringify(event));
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return `Nostr ${btoa(binary)}`;
  }

  root.BookstrBlossomAuthorization = { KIND, authorizationHeader, unsignedGetEvent };
})(globalThis);
