interface FB2ZipEntry {
  name: string;
  dir: boolean;
  _data?: { uncompressedSize?: number };
  async(type: 'uint8array'): Promise<Uint8Array>;
}
interface FB2ZipArchive { files: Record<string, FB2ZipEntry> }
interface FB2ZipLibrary { loadAsync(blob: Blob, options: { checkCRC32: boolean; createFolders: boolean }): Promise<FB2ZipArchive> }
type FB2Root = typeof globalThis & { JSZip?: FB2ZipLibrary; BookstrFB2?: unknown };

(function (root: FB2Root) {
  'use strict';

  const MAX_BYTES = 50 * 1024 * 1024;

  function validXML(bytes: Uint8Array): boolean {
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_BYTES) return false;
    const source = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) return false;
    const parsed = new DOMParser().parseFromString(source, 'application/xml');
    if (parsed.querySelector('parsererror') || parsed.documentElement?.localName !== 'FictionBook') return false;
    return parsed.querySelectorAll('section').length > 0;
  }

  function safeName(name: string): string | false {
    const normalized = String(name || '').replaceAll('\\', '/');
    return (normalized && !normalized.startsWith('/')
      && !normalized.split('/').some(part => !part || part === '..')
      && normalized.toLowerCase().endsWith('.fb2')) as string | false;
  }

  async function inspect(blob: unknown): Promise<{ format: string; blob: Blob | null }> {
    if (!(blob instanceof Blob) || !blob.size || blob.size > MAX_BYTES) return { format: '', blob: null };
    const prefix = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    const isZip = prefix[0]! === 0x50 && prefix[1]! === 0x4b;
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
      if (entries.length !== 1 || files.length !== 1 || !safeName(files[0]!.name)) return { format: 'zip', blob: null };
      const entry = files[0]!;
      const declaredSize = Number(entry._data?.uncompressedSize);
      if (Number.isFinite(declaredSize) && (declaredSize <= 0 || declaredSize > MAX_BYTES)) return { format: 'zip', blob: null };
      const bytes = new Uint8Array(await entry.async('uint8array'));
      if (!validXML(bytes)) return { format: 'zip', blob: null };
      return { format: 'fb2', blob: new Blob([bytes], { type: 'application/fb2+xml' }) };
    } catch {
      return { format: 'zip', blob: null };
    }
  }

  root.BookstrFB2 = Object.freeze({
    MAX_BYTES,
    inspect,
    isValidBlob: async (blob: unknown) => (await inspect(blob)).format === 'fb2',
    normalizeBlob: async (blob: unknown) => {
      const result = await inspect(blob);
      if (result.format !== 'fb2' || !result.blob) throw new Error('Invalid or unsafe FB2 file.');
      return result.blob;
    },
  });
}(globalThis as FB2Root));

export interface FB2ValidationApi {
  readonly MAX_BYTES: number;
  inspect(blob: unknown): Promise<{ format: string; blob: Blob | null }>;
  isValidBlob(blob: unknown): Promise<boolean>;
  normalizeBlob(blob: unknown): Promise<Blob>;
}
