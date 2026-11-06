interface IpcFrame {
  url: string;
}

interface IpcWebContents {
  isDestroyed(): boolean;
  getURL(): string;
  mainFrame: IpcFrame;
  send(channel: string, ...args: unknown[]): void;
}

interface IpcEvent {
  sender: IpcWebContents;
  senderFrame: IpcFrame | null;
}

interface IpcMainLike {
  handle(channel: string, listener: (event: IpcEvent, ...args: any[]) => unknown): unknown;
  on(channel: string, listener: (event: IpcEvent, ...args: any[]) => unknown): unknown;
}

function isLocalAppUrl(value: string, appOrigin: string) {
  try {
    const url = new URL(value);
    const origin = new URL(appOrigin);
    return url.protocol === origin.protocol
      && url.hostname === origin.hostname
      && url.port === origin.port
      && url.username === ''
      && url.password === '';
  } catch {
    return false;
  }
}

export function isAuthorizedIpcEvent(
  event: IpcEvent,
  expectedWebContents: readonly IpcWebContents[],
  appOrigin: string,
) {
  const sender = event.sender;
  const frame = event.senderFrame;
  if (!sender || sender.isDestroyed() || !expectedWebContents.includes(sender)) return false;
  if (!frame || frame !== sender.mainFrame) return false;
  return isLocalAppUrl(frame.url, appOrigin) && isLocalAppUrl(sender.getURL(), appOrigin);
}

export function createAuthorizedIpcMain(
  ipcMain: IpcMainLike,
  getExpectedWebContents: () => readonly IpcWebContents[],
  appOrigin: string,
) {
  return {
    handle(channel: string, listener: (event: IpcEvent, ...args: any[]) => unknown) {
      return ipcMain.handle(channel, (event, ...args) => {
        if (!isAuthorizedIpcEvent(event, getExpectedWebContents(), appOrigin)) {
          throw new Error('Unauthorized IPC sender.');
        }
        return listener(event, ...args);
      });
    },
    on(channel: string, listener: (event: IpcEvent, ...args: any[]) => unknown) {
      return ipcMain.on(channel, (event, ...args) => {
        if (!isAuthorizedIpcEvent(event, getExpectedWebContents(), appOrigin)) return;
        return listener(event, ...args);
      });
    },
  };
}
