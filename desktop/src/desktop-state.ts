import fs = require('node:fs/promises');
import crypto = require('node:crypto');

type State = Record<string, unknown>;
const isRecord = (value: unknown): value is State => value !== null && typeof value === 'object' && !Array.isArray(value);

/** One queue owns every read/merge/write transaction for the desktop state file. */
export class DesktopStateStore {
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly filename: string, private readonly fileSystem: Pick<typeof fs, 'readFile' | 'writeFile' | 'rename' | 'rm'> = fs) {}

  async load(): Promise<State> {
    try {
      const state: unknown = JSON.parse(await this.fileSystem.readFile(this.filename, 'utf8'));
      if (!isRecord(state)) throw new TypeError('Desktop state must be an object');
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }

  save(patch: State): Promise<void> {
    const update = this.pending.then(async () => {
      const existing = await this.load();
      const next = { ...existing, ...patch };
      if (isRecord(existing.desktopNostr) && isRecord(patch.desktopNostr)) {
        next.desktopNostr = { ...existing.desktopNostr, ...patch.desktopNostr };
      }
      const temporary = `${this.filename}.${crypto.randomUUID()}.tmp`;
      try {
        await this.fileSystem.writeFile(temporary, JSON.stringify(next), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await this.fileSystem.rename(temporary, this.filename);
      } catch (error) {
        await this.fileSystem.rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
    });
    // Recover the queue after an error while preserving the rejection for its caller.
    this.pending = update.catch(() => {});
    return update;
  }
}
