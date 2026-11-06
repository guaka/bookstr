import fs = require('node:fs/promises');
import path = require('node:path');
import crypto = require('node:crypto');

export interface SpeechModelFile {
  path: string;
  expectedBytes: number;
}

export interface SpeechModel {
  id: string;
  label: string;
  language: string;
  repository: string;
  revision: string;
  files: SpeechModelFile[];
}

export interface PublicSpeechModel {
  id: string;
  label: string;
  language: string;
  approximateBytes: number;
  fileCount: number;
  installed: boolean;
  installing: boolean;
  completedFiles: number;
  error: string;
}

export interface SpeechModelProgress {
  id: string;
  completedFiles: number;
  fileCount: number;
  file: string;
  receivedBytes: number;
  totalBytes: number;
}

type FileSystem = typeof fs;
type Downloader = (url: string, destination: string, expectedBytes: number, onBytes: (received: number, total: number) => void) => Promise<void>;
type ActiveInstall = { id: string; completedFiles: number };

const COMMON_ESPEAK_FILES: Array<[string, number]> = [
  ['espeak-ng-data/intonations', 2_040],
  ['espeak-ng-data/phondata', 550_424],
  ['espeak-ng-data/phondata-manifest', 21_821],
  ['espeak-ng-data/phonindex', 39_074],
  ['espeak-ng-data/phontab', 55_796],
];

function files(entries: Array<[string, number]>): SpeechModelFile[] {
  return entries.map(([filePath, expectedBytes]) => ({ path: filePath, expectedBytes }));
}

export const SPEECH_MODELS: readonly SpeechModel[] = Object.freeze([
  {
    id: 'kokoro_en',
    label: 'Kokoro · English',
    language: 'en',
    repository: 'csukuangfj/kokoro-en-v0_19',
    revision: '92805c485745946a0d945562d3aba19e7cbb2104',
    files: files([
      ['model.onnx', 345_555_491], ['voices.bin', 5_755_904], ['tokens.txt', 1_078],
      ['espeak-ng-data/en_dict', 166_944], ['espeak-ng-data/lang/gmw/en', 140],
      ['espeak-ng-data/lang/gmw/en-US', 257], ...COMMON_ESPEAK_FILES,
    ]),
  },
  {
    id: 'piper_pt_pt',
    label: 'Tugão · Português (Portugal)',
    language: 'pt',
    repository: 'csukuangfj/vits-piper-pt_PT-tugao-medium',
    revision: '612042d3d5a504d6c65080b1b2b2f7981b831954',
    files: files([
      ['pt_PT-tugao-medium.onnx', 63_201_425], ['tokens.txt', 954],
      ['espeak-ng-data/pt_dict', 67_817], ['espeak-ng-data/lang/roa/pt', 95], ...COMMON_ESPEAK_FILES,
    ]),
  },
]);

export function sourceUrl(model: SpeechModel, file: SpeechModelFile): string {
  const encodedPath = file.path.split('/').map(encodeURIComponent).join('/');
  return `https://huggingface.co/${model.repository}/resolve/${model.revision}/${encodedPath}`;
}

function publicModel(model: SpeechModel, installed: boolean, installing = false, completedFiles = 0, error = ''): PublicSpeechModel {
  return {
    id: model.id,
    label: model.label,
    language: model.language,
    approximateBytes: model.files.reduce((total, file) => total + file.expectedBytes, 0),
    fileCount: model.files.length,
    installed,
    installing,
    completedFiles,
    error,
  };
}

export class SpeechModelStore {
  declare private readonly root: string;
  declare private readonly fs: FileSystem;
  private readonly randomId: () => string;
  declare private readonly downloader: Downloader;
  declare private readonly models: readonly SpeechModel[];
  declare private active: ActiveInstall | null;
  declare private readonly lastError: Map<string, string>;

  constructor(root: string, { downloader, fileSystem = fs, models = SPEECH_MODELS, randomId = () => crypto.randomUUID() }: {
    downloader?: Downloader;
    fileSystem?: FileSystem;
    models?: readonly SpeechModel[];
    randomId?: () => string;
  } = {}) {
    this.root = root;
    this.fs = fileSystem;
    this.randomId = randomId;
    this.downloader = downloader || this.download.bind(this);
    this.models = models;
    this.active = null;
    this.lastError = new Map();
  }

  model(id: string): SpeechModel | undefined {
    return this.models.find(model => model.id === id);
  }

  async isInstalled(model: SpeechModel): Promise<boolean> {
    try {
      for (const file of model.files) {
        const stat = await this.fs.stat(path.join(this.root, model.id, file.path));
        if (!stat.isFile() || stat.size !== file.expectedBytes) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async status(): Promise<PublicSpeechModel[]> {
    return Promise.all(this.models.map(async model => publicModel(
      model,
      await this.isInstalled(model),
      this.active?.id === model.id,
      this.active?.id === model.id ? this.active.completedFiles : 0,
      this.lastError.get(model.id) || '',
    )));
  }

  async download(url: string, destination: string, expectedBytes: number, onBytes: (received: number, total: number) => void): Promise<void> {
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`);
    const handle = await this.fs.open(destination, 'w');
    let received = 0;
    try {
      for await (const chunk of response.body) {
        await handle.write(chunk);
        received += chunk.byteLength;
        onBytes(received, expectedBytes);
      }
    } finally {
      await handle.close();
    }
    if (received !== expectedBytes) throw new Error(`Downloaded ${received} bytes; expected ${expectedBytes}`);
  }

  async install(id: string, onProgress: (progress: SpeechModelProgress) => void = () => {}): Promise<PublicSpeechModel[]> {
    const model = this.model(id);
    if (!model) throw new Error('Unknown speech model.');
    if (this.active) throw new Error('Another speech model is already downloading.');
    if (await this.isInstalled(model)) return this.status();
    const staging = path.join(this.root, `.install-${this.randomId()}`);
    this.active = { id, completedFiles: 0 };
    this.lastError.delete(id);
    try {
      await this.fs.mkdir(staging, { recursive: true });
      for (const file of model.files) {
        const destination = path.join(staging, file.path);
        await this.fs.mkdir(path.dirname(destination), { recursive: true });
        await this.downloader(sourceUrl(model, file), destination, file.expectedBytes, (receivedBytes, totalBytes) => {
          onProgress({ id, completedFiles: this.active!.completedFiles, fileCount: model.files.length, file: file.path, receivedBytes, totalBytes });
        });
        const stat = await this.fs.stat(destination);
        if (!stat.isFile() || stat.size !== file.expectedBytes) throw new Error(`${file.path} failed verification.`);
        this.active.completedFiles += 1;
        onProgress({ id, completedFiles: this.active.completedFiles, fileCount: model.files.length, file: file.path, receivedBytes: file.expectedBytes, totalBytes: file.expectedBytes });
      }
      await this.fs.mkdir(this.root, { recursive: true });
      await this.fs.rm(path.join(this.root, id), { recursive: true, force: true });
      await this.fs.rename(staging, path.join(this.root, id));
    } catch (error: unknown) {
      await this.fs.rm(staging, { recursive: true, force: true });
      this.lastError.set(id, (error as Error)?.message || String(error));
      throw error;
    } finally {
      this.active = null;
    }
    return this.status();
  }

  async remove(id: string): Promise<PublicSpeechModel[]> {
    const model = this.model(id);
    if (!model) throw new Error('Unknown speech model.');
    if (this.active?.id === id) throw new Error('This speech model is still downloading.');
    await this.fs.rm(path.join(this.root, id), { recursive: true, force: true });
    this.lastError.delete(id);
    return this.status();
  }
}
