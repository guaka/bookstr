import { catalogUpstreamUrl, proxyCatalogRequest } from '../../src/catalog-proxy';
import { LibraryImporter, hashFile, safeExtension } from '../../src/library-import';
import { detectedFormat, downloadsForRenderer } from '../../src/library-downloads';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

export type CatalogRoute = Expect<Equal<ReturnType<typeof catalogUpstreamUrl>, string>>;
export type CatalogResponse = Expect<Equal<ReturnType<typeof proxyCatalogRequest>, Promise<Response | null>>>;
export type CatalogRequestBoundary = Expect<Equal<Parameters<typeof proxyCatalogRequest>[0], Request>>;
export type FileDigest = Expect<Equal<Awaited<ReturnType<typeof hashFile>>, { sha256: string; size: number }>>;
export type ExtensionBoundary = Expect<Equal<Parameters<typeof safeExtension>[0], unknown>>;
export type ImportedPath = Expect<Equal<ReturnType<InstanceType<typeof LibraryImporter>['resolveRelativePath']>, string>>;
export type Format = Expect<Equal<Awaited<ReturnType<typeof detectedFormat>>, string>>;
export type ListedDownload = Expect<Equal<Awaited<ReturnType<typeof downloadsForRenderer>>[number]['readable'], boolean>>;

import { LibraryStore } from '../../src/library-store';
import { DownloadQueue, libgenRequest } from '../../src/download-queue';
export type StoredDigest = Expect<Equal<NonNullable<ReturnType<InstanceType<typeof LibraryStore>['getBook']>>['sha256'], string>>;
export type StoredSeedPermission = Expect<Equal<NonNullable<ReturnType<InstanceType<typeof LibraryStore>['getBook']>>['public_seed_allowed'], boolean>>;
export type SearchResultTitle = Expect<Equal<ReturnType<InstanceType<typeof LibraryStore>['search']>['books'][number]['title'], string>>;
export type DownloadBookId = Expect<Equal<ReturnType<InstanceType<typeof LibraryStore>['downloads']>[number]['bookId'], string>>;
export type QueueInput = Expect<Equal<Parameters<InstanceType<typeof DownloadQueue>['enqueue']>[0], unknown>>;
export type LibgenIdentity = Expect<Equal<ReturnType<typeof libgenRequest>['md5'], string>>;
