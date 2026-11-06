import '../book-metadata.js';
import type { BookMetadataApi } from '../src/book-metadata.js';

export const bookMetadata = (globalThis as typeof globalThis & { BookMetadata: BookMetadataApi }).BookMetadata;
