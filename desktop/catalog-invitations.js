'use strict';

const { parseCatalogInvitation } = require('../web/catalog-invitation');

class CatalogInvitations {
  constructor({ app, dialog, loadState, saveState, decodeNPub, getWindow }) {
    Object.assign(this, { app, dialog, loadState, saveState, decodeNPub, getWindow });
    this.pending = [];
    this.running = false;
    this.started = false;
    app.on('open-url', (event, uri) => { event.preventDefault(); void this.receive(uri); });
    app.on('second-instance', (_event, argv) => { for (const arg of argv) if (arg.startsWith('bookstr://')) void this.receive(arg); });
  }

  async current() {
    try {
      const uri = (await this.loadState()).catalogInvitation?.uri;
      return parseCatalogInvitation(uri, this.decodeNPub);
    } catch { return null; }
  }

  async receive(uri) {
    try {
      const invitation = parseCatalogInvitation(uri, this.decodeNPub);
      if (this.pending.length >= 4) return false;
      this.pending.push(invitation);
      if (this.started) await this.drain();
      return true;
    } catch { return false; }
  }

  async start(argv, executable, defaultApp, appPath) {
    if (defaultApp) this.app.setAsDefaultProtocolClient('bookstr', executable, [appPath]);
    else this.app.setAsDefaultProtocolClient('bookstr');
    for (const arg of argv) if (arg.startsWith('bookstr://')) await this.receive(arg);
    this.started = true;
    await this.drain();
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length) {
        const invitation = this.pending.shift();
        const window = this.getWindow();
        window.show(); window.focus();
        const existing = await this.current();
        if (existing?.pubkey === invitation.pubkey && JSON.stringify(existing.relays) === JSON.stringify(invitation.relays) && existing.name === invitation.name) continue;
        const result = await this.dialog.showMessageBox(window, {
          type: 'question', title: 'Connect catalog', message: `Add ${invitation.name}?`,
          detail: `${invitation.npub}\n${invitation.relays.join('\n')}`,
          buttons: ['Cancel', 'Add catalog'], defaultId: 1, cancelId: 0, noLink: true,
        });
        if (result.response !== 1) continue;
        await this.saveState({ catalogInvitation: invitation });
        window.reload();
      }
    } finally { this.running = false; }
  }
}

module.exports = { CatalogInvitations };
