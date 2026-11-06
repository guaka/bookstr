interface BrowserBook extends Record<string, unknown> {
  id?: string;
  bookId?: string;
  md5?: string;
  libvaultMd5?: string;
  sha256?: string;
  title?: string;
  authors?: string | string[];
  author?: string;
  extension?: string;
  language?: string;
  year?: string | number;
  source?: string;
  sourceNativeId?: string;
  readUrl?: string;
  readable?: boolean;
  status?: string;
  rights_status?: string;
  license?: string;
  license_url?: string;
  rights_source?: string;
}

interface BrowserDownloadRow extends BrowserBook {
  bookId: string;
  status: string;
  authors?: string;
  peers?: number;
  bytes?: number;
  totalBytes?: number;
  progress?: number;
  downloadSpeed?: number;
  uploadSpeed?: number;
  completedAt?: number | null;
  updatedAt?: number;
  error?: string;
}

interface BrowserKindleDevice { id: string; name: string; kind: 'mtp' | 'mounted' }
interface BrowserKindleTransferResult {
  transferred: string[];
  alreadyPresent: number;
  skipped: Array<{ bookId?: string; title?: string; reason: string }>;
  errors: Array<{ bookId: string; title?: string; error: string }>;
}
interface BrowserTransferStatus extends Record<string, unknown> {
  bookId?: string;
  bookIds?: string[];
  seeding?: boolean;
  downloadSpeed?: number;
  uploadSpeed?: number;
}
