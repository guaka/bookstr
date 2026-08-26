(function (root) {
  'use strict';

  const HEX_PUBKEY = /^[0-9a-f]{64}$/;
  const BOOK_TAGS = new Set([
    'libvault', 'libvault-book', 'bookstr', 'bookstr-book', 'blossom',
  ]);

  function normalizedPubkey(value) {
    const pubkey = String(value || '').trim().toLowerCase();
    return HEX_PUBKEY.test(pubkey) ? pubkey : '';
  }

  function latestFollowEvent(events, author) {
    const expected = normalizedPubkey(author);
    return (Array.isArray(events) ? events : [])
      .filter(event => event?.kind === 3 && normalizedPubkey(event.pubkey) === expected)
      .sort((left, right) => Number(right.created_at || 0) - Number(left.created_at || 0)
        || String(right.id || '').localeCompare(String(left.id || '')))[0] || null;
  }

  function followsFromEvent(event) {
    const seen = new Set();
    const follows = [];
    for (const tag of Array.isArray(event?.tags) ? event.tags : []) {
      if (!Array.isArray(tag) || tag[0] !== 'p') continue;
      const pubkey = normalizedPubkey(tag[1]);
      if (!pubkey || seen.has(pubkey)) continue;
      seen.add(pubkey);
      follows.push({
        pubkey,
        relay: /^wss?:\/\//i.test(String(tag[2] || '')) ? String(tag[2]) : '',
        petname: String(tag[3] || '').trim(),
      });
    }
    return follows;
  }

  function profileFromEvent(event) {
    let content = {};
    try {
      const parsed = JSON.parse(String(event?.content || '{}'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) content = parsed;
    } catch { /* keep an empty profile for malformed content */ }
    const picture = String(content.picture || '').trim();
    return {
      pubkey: normalizedPubkey(event?.pubkey),
      name: String(content.display_name || content.name || '').trim(),
      about: String(content.about || '').trim(),
      picture: /^https?:\/\//i.test(picture) ? picture : '',
      nip05: String(content.nip05 || '').trim(),
      createdAt: Number(event?.created_at || 0),
    };
  }

  function latestProfiles(events, followedPubkeys) {
    const followed = new Set((Array.isArray(followedPubkeys) ? followedPubkeys : [])
      .map(normalizedPubkey).filter(Boolean));
    const newest = new Map();
    for (const event of Array.isArray(events) ? events : []) {
      const pubkey = normalizedPubkey(event?.pubkey);
      if (event?.kind !== 0 || !followed.has(pubkey)) continue;
      const current = newest.get(pubkey);
      if (!current || Number(event.created_at || 0) > Number(current.created_at || 0)
        || (Number(event.created_at || 0) === Number(current.created_at || 0)
          && String(event.id || '').localeCompare(String(current.id || '')) > 0)) {
        newest.set(pubkey, event);
      }
    }
    return Array.from(newest.values()).map(profileFromEvent);
  }

  function nip05Parts(identifier) {
    const value = String(identifier || '').trim();
    const match = /^([^@\s]+)@([^@\s]+)$/.exec(value);
    if (!match) return null;
    const name = match[1].toLowerCase();
    let domain;
    try {
      const url = new URL(`https://${match[2]}/.well-known/nostr.json`);
      if (!url.hostname || url.username || url.password || url.port
        || url.host.toLowerCase() !== match[2].toLowerCase()) return null;
      domain = url.hostname.toLowerCase();
    } catch {
      return null;
    }
    return {
      address: `${name}@${domain}`,
      name,
      url: `https://${domain === 'trustroots.org' ? 'www.trustroots.org' : domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`,
    };
  }

  function nip05Matches(document, name, pubkey) {
    const expected = normalizedPubkey(pubkey);
    if (!expected || !document?.names || typeof document.names !== 'object') return false;
    const names = Object.entries(document.names);
    const match = names.find(([candidate]) => String(candidate).toLowerCase() === String(name).toLowerCase());
    return normalizedPubkey(match?.[1]) === expected;
  }

  function nip42AuthTemplate(relay, challenge, createdAt = Math.floor(Date.now() / 1000)) {
    return {
      kind: 22242,
      created_at: Number(createdAt),
      tags: [
        ['relay', String(relay || '')],
        ['challenge', String(challenge || '')],
      ],
      content: '',
    };
  }

  function hasPublicBookReference(tags) {
    return (Array.isArray(tags) ? tags : []).some(tag => {
      if (!Array.isArray(tag) || typeof tag[0] !== 'string') return false;
      if (BOOK_TAGS.has(tag[0])) return Boolean(String(tag[1] || '').trim());
      if (tag[0] === 'book') {
        return ['libvault', 'bookstr', 'isbn', 'url', 'blossom'].includes(String(tag[1] || '').toLowerCase())
          && Boolean(String(tag[2] || '').trim());
      }
      return tag[0] === 'i' && /^isbn:/i.test(String(tag[1] || ''));
    });
  }

  function publicBookLists(events, followedPubkeys) {
    const followed = new Set((Array.isArray(followedPubkeys) ? followedPubkeys : [])
      .map(normalizedPubkey).filter(Boolean));
    const newestByAddress = new Map();
    for (const event of Array.isArray(events) ? events : []) {
      const author = normalizedPubkey(event?.pubkey);
      if (event?.kind !== 30003 || !followed.has(author) || !hasPublicBookReference(event.tags)) continue;
      const d = (Array.isArray(event.tags) ? event.tags : [])
        .find(tag => Array.isArray(tag) && tag[0] === 'd')?.[1] || '';
      const key = `${author}:${d}`;
      const current = newestByAddress.get(key);
      if (!current || Number(event.created_at || 0) > Number(current.created_at || 0)) {
        newestByAddress.set(key, event);
      }
    }
    return Array.from(newestByAddress.values()).map(event => {
      const title = (Array.isArray(event.tags) ? event.tags : [])
        .find(tag => Array.isArray(tag) && tag[0] === 'title')?.[1];
      return {
        pubkey: normalizedPubkey(event.pubkey),
        title: String(title || 'Book list').trim() || 'Book list',
        createdAt: Number(event.created_at || 0),
        eventId: String(event.id || ''),
      };
    }).sort((left, right) => right.createdAt - left.createdAt);
  }

  root.NostrSocial = {
    normalizedPubkey,
    latestFollowEvent,
    followsFromEvent,
    profileFromEvent,
    latestProfiles,
    nip05Parts,
    nip05Matches,
    nip42AuthTemplate,
    hasPublicBookReference,
    publicBookLists,
  };
})(globalThis);
