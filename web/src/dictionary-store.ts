export type DictionaryPack = {
  id: string;
  source: string;
  target: string;
  label: string;
  bytes: ArrayBuffer;
  size: number;
  lastUsed: number;
};

export type DictionaryStore = {
  records(): Promise<DictionaryPack[]>;
  put(record: DictionaryPack): Promise<void>;
  delete(id: string): Promise<void>;
};

const DATABASE_NAME = 'bookstr_dictionaries_v1';
const STORE_NAME = 'packs';
let defaultStore: DictionaryStore | undefined;

export function createDictionaryStore(factory: Pick<IDBFactory, 'open'>, databaseName = DATABASE_NAME): DictionaryStore {
  let databasePromise: Promise<IDBDatabase> | undefined;

  function database(): Promise<IDBDatabase> {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(databaseName, 1);
      request.onerror = () => {
        reject(request.error || new Error('Unable to open dictionary database'));
      };
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
    }).catch(error => {
      databasePromise = undefined;
      throw error;
    });
    return databasePromise;
  }

  async function records(): Promise<DictionaryPack[]> {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.onerror = () => reject(request.error || transaction.error || new Error('Unable to read dictionary packs'));
      request.onsuccess = () => resolve((request.result || []) as DictionaryPack[]);
      transaction.onabort = () => reject(transaction.error || new Error('Dictionary read was aborted'));
      transaction.onerror = () => reject(transaction.error || new Error('Unable to read dictionary packs'));
    });
  }

  async function mutate(operation: (store: IDBObjectStore) => IDBRequest): Promise<void> {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      operation(transaction.objectStore(STORE_NAME));
      transaction.onerror = () => reject(transaction.error || new Error('Unable to update dictionary packs'));
      transaction.onabort = () => reject(transaction.error || new Error('Dictionary update was aborted'));
      transaction.oncomplete = () => resolve();
    });
  }

  return {
    records,
    put: record => mutate(store => store.put(record)),
    delete: id => mutate(store => store.delete(id)),
  };
}

export function openDictionaryStore(): DictionaryStore {
  if (!defaultStore) defaultStore = createDictionaryStore(globalThis.indexedDB);
  return defaultStore;
}
