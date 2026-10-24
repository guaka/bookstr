import { app, BrowserWindow, dialog } from 'electron';
import type { nip19 } from 'nostr-tools' with { 'resolution-mode': 'import' };
import type { DesktopBridge } from '../../src/desktop-bridge';
import { CatalogInvitations } from '../../src/catalog-invitations';

declare const decodeNPub: typeof nip19.decode;

declare const bridge: DesktopBridge;

void bridge.library.acquire({ id: 'book' });
void bridge.library.acquire({ id: 'book' }, { quality: 'best' });
void bridge.library.acquireLibgen({ id: 'book' });
void bridge.library.acquireLibgen({ id: 'book' }, { format: 'epub' });
void bridge.kindle.preview('device');
void bridge.kindle.preview('device', 'book');
void bridge.kindle.presence('mtp:darwin:1-2');
void bridge.kindle.transfer('device');
void bridge.kindle.transfer('device', 'book');
void bridge.library.linkFolder();
void bridge.library.linkFolder('/books');
void bridge.devices.announce();
void bridge.devices.announce({ name: 'reader' });
void bridge.transfers.setPreferences();
void bridge.transfers.setPreferences({ enabled: true });

// @ts-expect-error acquire requires its book record
void bridge.library.acquire();
// @ts-expect-error preview requires a device id
void bridge.kindle.preview();
// @ts-expect-error openPane accepts only a declared pane
bridge.openPane('catalog');

new CatalogInvitations({
  app,
  dialog,
  loadState: async () => ({}),
  saveState: async (_state) => {},
  decodeNPub,
  getWindow: () => new BrowserWindow(),
});
