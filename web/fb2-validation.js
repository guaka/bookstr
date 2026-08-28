(function (root) {
  'use strict';

  const MAX_BYTES = 50 * 1024 * 1024;

  function validXML(bytes) {
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_BYTES) return false;
    const source = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) return false;
    const parsed = new DOMParser().parseFromString(source, 'application/xml');
    if (parsed.querySelector('parsererror') || parsed.documentElement?.localName !== 'FictionBook') return false;
    return parsed.querySelectorAll('section').length > 0;
  }

  function safeName(name) {
    const normalized = String(name || '').replaceAll('\\', '/');
    return normalized && !normalized.startsWith('/')
      && !normalized.split('/').some(part => !part || part === '..')
      && normalized.toLowerCase().endsWith('.fb2');
  }

  async function inspect(blob) {
    if (!(blob instanceof Blob) || !blob.size || blob.size > MAX_BYTES) return { format: '', blob: null };
    const prefix = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    const isZip = prefix[0] === 0x50 && prefix[1] === 0x4b;
    if (!isZip) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const valid = validXML(bytes);
      return { format: valid ? 'fb2' : '', blob: valid ? blob : null };
    }
    if (!root.JSZip) return { format: '', blob: null };
    try {
      const archive = await root.JSZip.loadAsync(blob, { checkCRC32: true, createFolders: false });
      const entries = Object.values(archive.files || {});
      const files = entries.filter(entry => !entry.dir);
      if (entries.length !== 1 || files.length !== 1 || !safeName(files[0].name)) return { format: 'zip', blob: null };
      const declaredSize = Number(files[0]._data?.uncompressedSize);
      if (Number.isFinite(declaredSize) && (declaredSize <= 0 || declaredSize > MAX_BYTES)) return { format: 'zip', blob: null };
      const bytes = new Uint8Array(await files[0].async('uint8array'));
      if (!validXML(bytes)) return { format: 'zip', blob: null };
      return { format: 'fb2', blob: new Blob([bytes], { type: 'application/fb2+xml' }) };
    } catch {
      return { format: 'zip', blob: null };
    }
  }

  root.BookstrFB2 = Object.freeze({
    MAX_BYTES,
    inspect,
    isValidBlob: async blob => (await inspect(blob)).format === 'fb2',
    normalizeBlob: async blob => {
      const result = await inspect(blob);
      if (result.format !== 'fb2' || !result.blob) throw new Error('Invalid or unsafe FB2 file.');
      return result.blob;
    },
  });
}(globalThis));
