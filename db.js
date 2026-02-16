const DB_NAME = 'pomodoroPwaDb';
const DB_VERSION = 1;

export const DEFAULT_TAGS = [
  'Aネーム',
  'Aペン入れ',
  'A仕上げ',
  'Bネーム',
  'Bペン入れ',
  'B仕上げ',
  'WEB落書き'
];

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        s.createIndex('startTs', 'startTs');
      }
      if (!db.objectStoreNames.contains('tags')) {
        db.createObjectStore('tags', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function seedTagsIfNeeded(db) {
  const tx = db.transaction('tags', 'readwrite');
  const store = tx.objectStore('tags');
  const all = await requestToPromise(store.getAll());
  if (!all.length) {
    DEFAULT_TAGS.forEach((name, i) => store.add({ name, color: `hsl(${(i * 47) % 360} 70% 55%)` }));
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAll(db, storeName) {
  const tx = db.transaction(storeName, 'readonly');
  return requestToPromise(tx.objectStore(storeName).getAll());
}

export async function add(db, storeName, item) {
  const tx = db.transaction(storeName, 'readwrite');
  const id = await requestToPromise(tx.objectStore(storeName).add(item));
  await txDone(tx);
  return id;
}

export async function put(db, storeName, item) {
  const tx = db.transaction(storeName, 'readwrite');
  await requestToPromise(tx.objectStore(storeName).put(item));
  await txDone(tx);
}

export async function remove(db, storeName, key) {
  const tx = db.transaction(storeName, 'readwrite');
  await requestToPromise(tx.objectStore(storeName).delete(key));
  await txDone(tx);
}

export async function getById(db, storeName, key) {
  const tx = db.transaction(storeName, 'readonly');
  return requestToPromise(tx.objectStore(storeName).get(key));
}

export async function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function mergeTag(db, fromId, toId) {
  const tx = db.transaction(['sessions', 'tags'], 'readwrite');
  const sessionStore = tx.objectStore('sessions');
  const sessions = await requestToPromise(sessionStore.getAll());
  sessions.filter((s) => s.tagId === fromId).forEach((s) => {
    s.tagId = toId;
    sessionStore.put(s);
  });
  tx.objectStore('tags').delete(fromId);
  await txDone(tx);
}

export async function deleteTagAndUnset(db, tagId) {
  const tx = db.transaction(['sessions', 'tags'], 'readwrite');
  const sessionStore = tx.objectStore('sessions');
  const sessions = await requestToPromise(sessionStore.getAll());
  sessions.filter((s) => s.tagId === tagId).forEach((s) => {
    s.tagId = null;
    sessionStore.put(s);
  });
  tx.objectStore('tags').delete(tagId);
  await txDone(tx);
}
