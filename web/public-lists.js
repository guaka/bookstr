(function (root) {
  'use strict';

  const PRIVATE_D_TAGS = new Set(['libvault-favorites', 'bookstr-collections']);

  function tagValue(tags, name) {
    const tag = tags.find(value => Array.isArray(value) && value[0] === name);
    return String(tag?.[1] || '').trim();
  }

  function isPrivateCollection(dTag) {
    return PRIVATE_D_TAGS.has(dTag)
      || dTag.startsWith('libvault-favorites-chunk')
      || dTag.startsWith('bookstr-collection-')
      || dTag.startsWith('bookstr-chunk-');
  }

  function parseEvent(event) {
    if (Number(event?.kind) !== 30003 || !Array.isArray(event.tags)) return null;
    const dTag = tagValue(event.tags, 'd');
    const title = tagValue(event.tags, 'title');
    if (!dTag || !title || isPrivateCollection(dTag)) return null;

    const compactLocators = new Map(event.tags
      .filter(tag => Array.isArray(tag) && tag[0] === 'book' && tag[2])
      .map(tag => [String(tag[2]), String(tag[4] || '')]));
    const seen = new Set();
    const books = [];
    for (const tag of event.tags) {
      if (!Array.isArray(tag) || tag[0] !== 'bookstr-book') continue;
      const id = String(tag[1] || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      books.push({
        id,
        title: String(tag[2] || 'Untitled book').trim(),
        authors: String(tag[3] || '').trim(),
        extension: String(tag[4] || '').trim().toLowerCase(),
        filesize: Number(tag[5] || 0) || 0,
        coverUrl: String(tag[6] || '').trim(),
        readUrl: String(tag[7] || compactLocators.get(id) || '').trim(),
        language: String(tag[8] || '').trim().toLowerCase(),
        source: String(tag[9] || '').trim(),
      });
    }
    if (!books.length) return null;
    return {
      id: `${String(event.pubkey || '')}:${dTag}`,
      dTag,
      title,
      description: tagValue(event.tags, 'description'),
      createdAt: Number(event.created_at || 0),
      books,
    };
  }

  function parseEvents(events) {
    const latest = new Map();
    for (const event of [...(Array.isArray(events) ? events : [])]
      .sort((left, right) => Number(right?.created_at || 0) - Number(left?.created_at || 0))) {
      const parsed = parseEvent(event);
      if (parsed && !latest.has(parsed.dTag)) latest.set(parsed.dTag, parsed);
    }
    return [...latest.values()].sort((left, right) => left.title.localeCompare(right.title));
  }

  root.BookstrPublicLists = { parseEvent, parseEvents };
})(globalThis);
