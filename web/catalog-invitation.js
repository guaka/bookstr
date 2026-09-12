(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BookstrCatalogInvitation = api;
})(globalThis, function() {
  'use strict';
  function parseCatalogInvitation(value, decodeNPub) {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid catalog invitation');
    const url = new URL(value);
    if (url.protocol !== 'bookstr:' || url.hostname !== 'catalog' || url.username || url.password || url.port || url.hash ||
        !['', '/'].includes(url.pathname)) throw new Error('Invalid catalog invitation');
    const params = url.searchParams;
    if ([...params.keys()].some(key => !['v', 'npub', 'name', 'relay'].includes(key)) ||
        ['v', 'npub', 'name'].some(key => params.getAll(key).length !== 1) || params.get('v') !== '1') throw new Error('Invalid catalog invitation fields');
    const npub = params.get('npub'), name = params.get('name').trim(), relays = [...new Set(params.getAll('relay'))];
    if (!/^npub1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(npub) || !name || new TextEncoder().encode(name).length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(name) ||
        !relays.length || params.getAll('relay').length > 3) throw new Error('Invalid catalog identity');
    const decoded = decodeNPub(npub);
    if (decoded.type !== 'npub' || !/^[a-f0-9]{64}$/.test(decoded.data)) throw new Error('Invalid catalog public key');
    for (const relay of relays) {
      const endpoint = new URL(relay);
      if (relay.length > 256 || /\s/.test(relay) || endpoint.protocol !== 'wss:' || !endpoint.hostname || endpoint.username || endpoint.password || endpoint.hash || endpoint.search) throw new Error('Invalid catalog relay');
    }
    return { version: 1, name, npub, pubkey: decoded.data, relays, uri: value };
  }
  return { parseCatalogInvitation };
});
