import { createDevLogger } from "./devLogger";

const logger = createDevLogger("InviteStorage");

const DB_NAME = "babyshower-invite-cache";
const DB_VERSION = 1;
const STORE_NAME = "invites";
const INVITE_KEY = "latest";
const METADATA_KEY = "babyshower-invite-metadata";

function isIndexedDBSupported() {
  try {
    return !!window.indexedDB;
  } catch {
    return false;
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBSupported()) {
      reject(new Error("IndexedDB not supported"));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });
}

export async function saveInvite(blob, metadata) {
  try {
    const storedMetadata = {
      parentsName: metadata?.parentsName || "",
      venue: metadata?.venue || "",
      createdAt: new Date().toISOString(),
      mimeType: blob?.type || "",
      size: blob?.size || 0,
    };

    localStorage.setItem(METADATA_KEY, JSON.stringify(storedMetadata));

    if (!isIndexedDBSupported()) {
      logger.warn("IndexedDB not supported, metadata saved only");
      return;
    }

    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    store.put({
      id: INVITE_KEY,
      data: blob,
      createdAt: Date.now(),
    });

    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    logger.warn("Failed to save invite", error?.message || error);
  }
}

export async function loadInvite() {
  try {
    const metadataRaw = localStorage.getItem(METADATA_KEY);
    const metadata = metadataRaw ? JSON.parse(metadataRaw) : null;

    if (!metadata) {
      return null;
    }

    if (!isIndexedDBSupported()) {
      return null;
    }

    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(INVITE_KEY);

    const record = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });

    if (!record?.data) {
      return null;
    }

    return { blob: record.data, metadata };
  } catch (error) {
    logger.warn("Failed to load invite", error?.message || error);
    return null;
  }
}

export async function clearInvite() {
  try {
    localStorage.removeItem(METADATA_KEY);

    if (!isIndexedDBSupported()) {
      return;
    }

    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    store.delete(INVITE_KEY);

    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    logger.warn("Failed to clear invite cache", error?.message || error);
  }
}
