(function (root) {
  'use strict';

  const HEX_PUBKEY = /^[0-9a-f]{64}$/;
  const TRUSTROOTS_USERNAME_NAMESPACE = 'org.trustroots:username';
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

  function trustrootsUsernameFromEvent(event) {
    const label = (Array.isArray(event?.tags) ? event.tags : []).find(tag =>
      Array.isArray(tag) && tag[0] === 'l'
      && String(tag[2] || '').toLowerCase() === TRUSTROOTS_USERNAME_NAMESPACE
    )?.[1];
    const username = String(label || '').trim().toLowerCase();
    return /^[a-z0-9][a-z0-9_.-]{0,63}$/.test(username) ? username : '';
  }

  function trustrootsProfiles(events, followedPubkeys, importPubkey) {
    const followed = new Set((Array.isArray(followedPubkeys) ? followedPubkeys : [])
      .map(normalizedPubkey).filter(Boolean));
    const importer = normalizedPubkey(importPubkey);
    const byPubkey = new Map(latestProfiles(events, followedPubkeys)
      .map(profile => [profile.pubkey, profile]));
    const identities = new Map();
    const claims = new Map();

    for (const event of Array.isArray(events) ? events : []) {
      const author = normalizedPubkey(event?.pubkey);
      if (event?.kind === 10390 && followed.has(author)) {
        const current = identities.get(author);
        if (!current || Number(event.created_at || 0) > Number(current.created_at || 0)) {
          identities.set(author, event);
        }
        continue;
      }
      if (event?.kind !== 30390 || (author !== importer && !followed.has(author))) continue;
      const targets = (Array.isArray(event.tags) ? event.tags : [])
        .filter(tag => Array.isArray(tag) && tag[0] === 'p')
        .map(tag => normalizedPubkey(tag[1])).filter(pubkey => followed.has(pubkey));
      if (!targets.length && followed.has(author)) targets.push(author);
      for (const pubkey of targets) {
        const current = claims.get(pubkey);
        if (!current || Number(event.created_at || 0) > Number(current.created_at || 0)) {
          claims.set(pubkey, event);
        }
      }
    }

    for (const pubkey of followed) {
      const base = byPubkey.get(pubkey) || {
        pubkey, name: '', about: '', picture: '', nip05: '', createdAt: 0,
      };
      const identity = identities.get(pubkey);
      const claim = claims.get(pubkey);
      let imported = {};
      try {
        const parsed = JSON.parse(String(claim?.content || '{}'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) imported = parsed;
      } catch { /* ignore malformed imported metadata */ }
      const username = trustrootsUsernameFromEvent(identity)
        || trustrootsUsernameFromEvent(claim)
        || String(imported.trustrootsUsername || '').trim().toLowerCase();
      const importedPicture = String(imported.picture || '').trim();
      const merged = {
        ...base,
        name: String(base.name || imported.display_name || imported.name || '').trim(),
        about: String(base.about || imported.about || '').trim(),
        picture: base.picture || (/^https?:\/\//i.test(importedPicture) ? importedPicture : ''),
        nip05: String(base.nip05 || imported.nip05 || (username ? `${username}@trustroots.org` : '')).trim(),
        createdAt: Math.max(base.createdAt, Number(identity?.created_at || 0), Number(claim?.created_at || 0)),
      };
      if (merged.name || merged.about || merged.picture || merged.nip05) byPubkey.set(pubkey, merged);
    }
    return Array.from(byPubkey.values());
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
      if (d === 'libvault-favorites'
        || d.startsWith('libvault-favorites-chunk')
        || d.startsWith('bookstr-collection-')
        || d.startsWith('bookstr-chunk-')) continue;
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

  const NIP51_LIST_KINDS = new Set([30000, 30001, 30002, 30003, 30004, 30005, 30006, 30007, 30008, 30009]);

  function publicNip51Lists(events, followedPubkeys) {
    const followed = new Set((Array.isArray(followedPubkeys) ? followedPubkeys : [])
      .map(normalizedPubkey).filter(Boolean));
    const newestByAddress = new Map();
    for (const event of Array.isArray(events) ? events : []) {
      const author = normalizedPubkey(event?.pubkey);
      if (!NIP51_LIST_KINDS.has(event?.kind) || !followed.has(author)) continue;
      const tags = Array.isArray(event.tags) ? event.tags : [];
      const d = tags.find(tag => Array.isArray(tag) && tag[0] === 'd')?.[1] || '';
      const key = `${author}:${event.kind}:${d}`;
      const current = newestByAddress.get(key);
      if (!current || Number(event.created_at || 0) > Number(current.created_at || 0)) {
        newestByAddress.set(key, event);
      }
    }
    return Array.from(newestByAddress.values()).map(event => {
      const tags = Array.isArray(event.tags) ? event.tags : [];
      const title = tags.find(tag => Array.isArray(tag) && tag[0] === 'title')?.[1];
      const d = tags.find(tag => Array.isArray(tag) && tag[0] === 'd')?.[1];
      return {
        pubkey: normalizedPubkey(event.pubkey),
        title: String(title || d || 'NIP-51 list').trim() || 'NIP-51 list',
        kind: Number(event.kind),
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
    trustrootsUsernameFromEvent,
    trustrootsProfiles,
    nip05Parts,
    nip05Matches,
    nip42AuthTemplate,
    hasPublicBookReference,
    publicBookLists,
    publicNip51Lists,
  };
})(globalThis);
