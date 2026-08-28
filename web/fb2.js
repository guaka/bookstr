// FictionBook 2 parsing is deliberately structural: XML is never inserted as
// HTML, and only the small set of reading elements below can reach the reader.
const MIME_TYPES = new Set(['application/x-fictionbook+xml', 'application/fb2+xml']);
const INLINE = new Set(['emphasis', 'strong', 'strikethrough', 'code']);

export function isFB2Type(value = '') {
  return MIME_TYPES.has(String(value).split(';', 1)[0].trim().toLowerCase());
}

export function isFB2Name(value = '') {
  return /\.fb2(?:\.zip)?$/i.test(String(value).split(/[?#]/, 1)[0]);
}

export function isFB2ProgressLocator(value = '') {
  return /^fb2:[^:\s]+:\d+:\d+$/.test(String(value));
}

function text(element) {
  return String(element?.textContent || '').replace(/\s+/g, ' ').trim();
}

function safeInline(source, document) {
  const fragment = document.createDocumentFragment();
  for (const child of source.childNodes) {
    if (child.nodeType === child.TEXT_NODE) fragment.append(document.createTextNode(child.nodeValue || ''));
    else if (child.nodeType === child.ELEMENT_NODE) {
      const name = child.localName.toLowerCase();
      if (name === 'a') {
        const link = document.createElement('a');
        const href = child.getAttribute('l:href') || child.getAttribute('href') || '';
        if (/^#[-A-Za-z0-9_.:]+$/.test(href)) link.setAttribute('href', href);
        link.append(safeInline(child, document));
        fragment.append(link);
      } else if (INLINE.has(name)) {
        const tag = name === 'emphasis' ? 'em' : name === 'strong' ? 'strong' : name === 'code' ? 'code' : 's';
        const element = document.createElement(tag);
        element.append(safeInline(child, document));
        fragment.append(element);
      } else {
        fragment.append(safeInline(child, document));
      }
    }
  }
  return fragment;
}

function appendSection(section, article, toc, document, ordinal) {
  const id = section.getAttribute('id') || `section-${ordinal.value++}`;
  const heading = section.querySelector(':scope > title');
  const label = text(heading) || `Section ${ordinal.value}`;
  const node = document.createElement('section');
  node.id = id;
  node.dataset.fb2Section = id;
  if (heading) {
    const h = document.createElement('h2');
    h.append(safeInline(heading, document));
    node.append(h);
  }
  for (const child of section.children) {
    const name = child.localName.toLowerCase();
    if (name === 'title' || name === 'section') continue;
    if (name === 'p' || name === 'subtitle' || name === 'text-author') {
      const p = document.createElement(name === 'subtitle' ? 'h3' : 'p');
      p.append(safeInline(child, document));
      node.append(p);
    } else if (name === 'poem' || name === 'epigraph' || name === 'cite') {
      const block = document.createElement(name === 'poem' ? 'pre' : 'blockquote');
      block.textContent = text(child);
      node.append(block);
    } else if (name === 'image') {
      // Binary image resolution is intentionally deferred; external URLs are
      // never requested while opening a local FB2 file.
      const alt = document.createElement('span');
      alt.textContent = '[Illustration]';
      node.append(alt);
    }
  }
  toc.push({ id, label });
  article.append(node);
  for (const child of section.querySelectorAll(':scope > section')) appendSection(child, article, toc, document, ordinal);
}

export function parseFB2(xml, document = globalThis.document) {
  if (typeof xml !== 'string' || !document?.implementation?.createHTMLDocument) throw new Error('FB2 parser requires a browser document');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('FB2 files may not declare DTDs or entities');
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  if (parsed.querySelector('parsererror') || parsed.documentElement?.localName !== 'FictionBook') throw new Error('Invalid FictionBook 2 XML');
  const out = document.implementation.createHTMLDocument('FB2');
  const article = out.createElement('article');
  const title = text(parsed.querySelector('description > title-info > book-title')) || 'Untitled';
  article.dataset.fb2Title = title;
  const toc = [];
  const ordinal = { value: 1 };
  for (const body of parsed.querySelectorAll(':scope > body')) {
    for (const section of body.querySelectorAll(':scope > section')) appendSection(section, article, toc, out, ordinal);
  }
  if (!toc.length) throw new Error('FB2 has no readable sections');
  out.body.append(article);
  return { title, toc, document: out, html: article.outerHTML };
}
