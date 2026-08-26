(function (root) {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function creatorText(value) {
    if (Array.isArray(value)) return value.filter(Boolean).join(', ');
    return String(value || '');
  }

  function sourceFilename(uri) {
    try {
      const parts = new URL(String(uri || '')).pathname.split('/').filter(Boolean);
      return decodeURIComponent(parts.at(-1) || '');
    } catch {
      return '';
    }
  }

  function normalizePassageHits(payload) {
    if (!Array.isArray(payload?.hits)) return [];
    return payload.hits.flatMap(hit => {
      const citation = hit?.citation;
      if (!citation || typeof citation !== 'object' || !String(citation.snippet || '').trim()) return [];
      const book = hit?.book && typeof hit.book === 'object' ? hit.book : null;
      const dc = citation.metadata?.dublin_core || {};
      const format = String(book?.extension || dc.format || '').replace(/^\./, '').toUpperCase();
      const page = Number(citation.block?.page || 0);
      const filename = sourceFilename(citation.uri);
      const provenance = [format, page > 0 ? `p. ${page}` : '', filename].filter(Boolean).join(' · ');
      return [{
        citation,
        book,
        md5: String(book?.md5 || '').toLowerCase(),
        title: String(book?.title || citation.title || dc.title || 'Downloaded book'),
        authors: creatorText(book?.authors || book?.author || dc.creator),
        heading: Array.isArray(citation.heading_path) ? citation.heading_path.filter(Boolean).join(' › ') : '',
        snippet: String(citation.snippet),
        provenance: provenance || 'Indexed passage',
      }];
    });
  }

  function passageResultsMarkup(entries) {
    if (!entries.length) return '<p class="note">No matching passages.</p>';
    return entries.map((entry, index) => `
      <article class="passage-result">
        <div class="passage-result-heading">
          ${entry.canOpen
            ? `<button type="button" class="passage-book-title" data-passage-open="${index}">${escapeHtml(entry.title)}</button>`
            : `<h3>${escapeHtml(entry.title)}</h3>`}
          ${entry.authors ? `<p>${escapeHtml(entry.authors)}</p>` : ''}
        </div>
        ${entry.heading ? `<p class="passage-heading-path">${escapeHtml(entry.heading)}</p>` : ''}
        <blockquote>${escapeHtml(entry.snippet)}</blockquote>
        <p class="passage-provenance">${escapeHtml(entry.provenance)}</p>
      </article>
    `).join('');
  }

  root.PassageResults = { normalizePassageHits, passageResultsMarkup, sourceFilename };
})(globalThis);
