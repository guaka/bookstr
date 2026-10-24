import type { nip19 } from 'nostr-tools' with { 'resolution-mode': 'import' };
import type { BrowserWindow, Dialog } from 'electron';

interface CatalogInvitation {
  version: 1;
  name: string;
  npub: string;
  pubkey: string;
  relays: string[];
  uri: string;
}

type DecodedNpub = ReturnType<typeof nip19.decode>;

type DecodeNpub = (value: string) => DecodedNpub;
type CatalogInvitationParser = (value: unknown, decodeNpub: DecodeNpub) => CatalogInvitation;

interface CatalogInvitationModule {
  parseCatalogInvitation: CatalogInvitationParser;
}

// The shared browser file is a CommonJS module in Electron and also attaches
// the same API to globalThis for the static web application.
const catalogInvitationApi: CatalogInvitationModule = require('../web/catalog-invitation');
const { parseCatalogInvitation } = catalogInvitationApi;

interface ProtocolEvent {
  preventDefault(): void;
}

interface AppEvents {
  on(event: 'open-url', listener: (event: ProtocolEvent, uri: string) => void): void;
  on(event: 'second-instance', listener: (_event: unknown, argv: string[]) => void): void;
  isPackaged: boolean;
  setAsDefaultProtocolClient(protocol: string): boolean;
}

interface CatalogInvitationState {
  catalogInvitation?: { uri?: unknown } | null;
}

interface CatalogInvitationPatch {
  catalogInvitation: CatalogInvitation;
}

type CatalogDialog = Pick<Dialog, 'showMessageBox'>;
type CatalogWindow = BrowserWindow;

interface CatalogInvitationsOptions {
  app: AppEvents;
  dialog: CatalogDialog;
  loadState(): Promise<CatalogInvitationState>;
  saveState(state: CatalogInvitationPatch): Promise<void>;
  decodeNPub: DecodeNpub;
  getWindow(): CatalogWindow;
}

export class CatalogInvitations {
  private readonly app: AppEvents;
  private readonly dialog: CatalogDialog;
  private readonly loadState: CatalogInvitationsOptions['loadState'];
  private readonly saveState: CatalogInvitationsOptions['saveState'];
  private readonly decodeNPub: DecodeNpub;
  private readonly getWindow: () => CatalogWindow;
  private readonly pending: CatalogInvitation[] = [];
  private running = false;
  private started = false;

  constructor({ app, dialog, loadState, saveState, decodeNPub, getWindow }: CatalogInvitationsOptions) {
    this.app = app;
    this.dialog = dialog;
    this.loadState = loadState;
    this.saveState = saveState;
    this.decodeNPub = decodeNPub;
    this.getWindow = getWindow;
    app.on('open-url', (event, uri) => { event.preventDefault(); void this.receive(uri); });
    app.on('second-instance', (_event, argv) => {
      for (const arg of argv) if (arg.startsWith('bookstr://')) void this.receive(arg);
    });
  }

  async current(): Promise<CatalogInvitation | null> {
    try {
      const invitationUri = (await this.loadState()).catalogInvitation?.uri;
      return parseCatalogInvitation(invitationUri, this.decodeNPub);
    } catch {
      return null;
    }
  }

  async receive(uri: string): Promise<boolean> {
    try {
      const invitation = parseCatalogInvitation(uri, this.decodeNPub);
      if (this.pending.length >= 4) return false;
      this.pending.push(invitation);
      if (this.started) await this.drain();
      return true;
    } catch {
      return false;
    }
  }

  async start(argv: string[], _executable: string, _defaultApp: boolean, _appPath: string): Promise<void> {
    // Development Electron and E2E runs must never take over the installed app's URL scheme.
    if (this.app.isPackaged) this.app.setAsDefaultProtocolClient('bookstr');
    for (const arg of argv) if (arg.startsWith('bookstr://')) await this.receive(arg);
    this.started = true;
    await this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let invitation: CatalogInvitation | undefined;
      while ((invitation = this.pending.shift())) {
        const window = this.getWindow();
        window.show();
        window.focus();
        const existing = await this.current();
        if (existing?.pubkey === invitation.pubkey &&
            JSON.stringify(existing.relays) === JSON.stringify(invitation.relays) &&
            existing.name === invitation.name) continue;
        const result = await this.dialog.showMessageBox(window, {
          type: 'question',
          title: 'Connect catalog',
          message: `Add ${invitation.name}?`,
          detail: `${invitation.npub}\n${invitation.relays.join('\n')}`,
          buttons: ['Cancel', 'Add catalog'],
          defaultId: 1,
          cancelId: 0,
          noLink: true,
        });
        if (result.response !== 1) continue;
        await this.saveState({ catalogInvitation: invitation });
        window.reload();
      }
    } finally {
      this.running = false;
    }
  }
}
