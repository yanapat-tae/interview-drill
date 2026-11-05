// db.js — small IndexedDB helpers. All data stays on this device.
//
// Stores:
//   kv         key → value: "content" (imported file), "slots" (current slot values), "settings"
//   progress   one record per question id: { id, box, due, lastRated, ... }
//   recordings reserved for Phase 2 (mock interview audio)

const DB_NAME = 'interview-drill';
const DB_VERSION = 1;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      // Migrations: add one `if (e.oldVersion < N)` block per new version. Never drop old stores.
      if (e.oldVersion < 1) {
        db.createObjectStore('kv');
        db.createObjectStore('progress', { keyPath: 'id' });
        db.createObjectStore('recordings', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database is open in another tab. Close it and reload.'));
  });
  return dbPromise;
}

// Runs fn(stores) inside one transaction. Resolves only when the transaction has committed,
// so either everything is saved or nothing is.
async function run(storeNames, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    const stores = Object.fromEntries(storeNames.map((n) => [n, t.objectStore(n)]));
    let result;
    const r = fn(stores);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

export const kvGet = (key) => run(['kv'], 'readonly', (s) => s.kv.get(key));
export const kvSet = (key, value) => run(['kv'], 'readwrite', (s) => { s.kv.put(value, key); });

/** Save imported content and its slot values together (atomic). Progress is not touched. */
export const saveContent = (content, slots) =>
  run(['kv'], 'readwrite', (s) => { s.kv.put(content, 'content'); s.kv.put(slots, 'slots'); });

/**
 * Restore a backup in ONE transaction: content, slots, settings and progress records.
 * Progress records from the backup overwrite records with the same id; other records are kept.
 */
export const restoreBackup = ({ content, slots, settings, progress }) =>
  run(['kv', 'progress'], 'readwrite', (s) => {
    s.kv.put(content, 'content');
    s.kv.put(slots, 'slots');
    if (settings) s.kv.put(settings, 'settings');
    for (const p of progress) s.progress.put(p);
  });

export async function getAllProgress() {
  const list = await run(['progress'], 'readonly', (s) => s.progress.getAll());
  return new Map((list || []).map((p) => [p.id, p]));
}
export const putProgress = (p) => run(['progress'], 'readwrite', (s) => { s.progress.put(p); });
export const clearProgress = () => run(['progress'], 'readwrite', (s) => { s.progress.clear(); });

/** Ask the browser not to auto-delete our data when storage is low (best effort). */
export async function requestPersistence() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { /* ignore */ }
}

// ---- Recordings (mock interview). Audio is stored as ArrayBuffer + mimeType (safest on iOS). ----
export const putRecording = (r) => run(['recordings'], 'readwrite', (s) => { s.recordings.put(r); });
export const countRecordings = () => run(['recordings'], 'readonly', (s) => s.recordings.count());
export const clearRecordings = () => run(['recordings'], 'readwrite', (s) => { s.recordings.clear(); });
