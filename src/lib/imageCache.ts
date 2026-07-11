
const DB_NAME = 'ImageCacheDB';
const STORE_NAME = 'images';
const DB_VERSION = 1;

interface CachedItem {
  url: string;
  blob: Blob;
  timestamp: number;
}

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'url' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const getCachedImage = async (url: string): Promise<Blob | null> => {
  try {
    const db = await initDB();
    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(url);

      request.onsuccess = () => {
        const item = request.result as CachedItem | undefined;
        if (item) {
          resolve(item.blob);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  } catch (err) {
    console.error('Failed to get cached image', err);
    return null;
  }
};

export const cacheImage = async (url: string, blob: Blob): Promise<void> => {
  try {
    const db = await initDB();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put({
      url,
      blob,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error('Failed to cache image', err);
  }
};
