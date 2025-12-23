/**
 * IndexedDB storage for chat messages
 * Replaces localStorage to avoid size limits and truncation issues
 */

import { Chat } from '@/types/chat';

const DB_NAME = "VolleyBallChatStorage";
const DB_VERSION = 1;
const STORE_NAME = "chats";

// IndexedDB instance
let dbInstance: IDBDatabase | null = null;

/**
 * Initialize IndexedDB for chat storage
 */
export const initChatDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("Chat IndexedDB open error:", request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        objectStore.createIndex("createdAt", "createdAt", { unique: false });
        objectStore.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
  });
};

/**
 * Save a single chat to IndexedDB
 */
export const saveChat = async (chat: Chat): Promise<void> => {
  try {
    const db = await initChatDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      // Store the full chat without any truncation
      const chatToStore = {
        ...chat,
        updatedAt: Date.now()
      };

      const request = store.put(chatToStore);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        console.error("Error saving chat:", request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error("Error in saveChat:", error);
    throw error;
  }
};

/**
 * Save all chats to IndexedDB
 */
export const saveAllChats = async (chats: Chat[]): Promise<void> => {
  try {
    const db = await initChatDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      // Clear existing chats first
      const clearRequest = store.clear();

      clearRequest.onsuccess = () => {
        // Add all chats
        const promises: Promise<void>[] = [];

        for (const chat of chats) {
          const chatToStore = {
            ...chat,
            updatedAt: Date.now()
          };

          promises.push(new Promise((res, rej) => {
            const request = store.put(chatToStore);
            request.onsuccess = () => res();
            request.onerror = () => rej(request.error);
          }));
        }

        Promise.all(promises)
          .then(() => resolve())
          .catch(reject);
      };

      clearRequest.onerror = () => {
        console.error("Error clearing chats:", clearRequest.error);
        reject(clearRequest.error);
      };
    });
  } catch (error) {
    console.error("Error in saveAllChats:", error);
    throw error;
  }
};

/**
 * Load all chats from IndexedDB
 */
export const loadAllChats = async (): Promise<Chat[]> => {
  try {
    const db = await initChatDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const chats = request.result || [];
        // Sort by createdAt descending (newest first)
        chats.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        resolve(chats);
      };

      request.onerror = () => {
        console.error("Error loading chats:", request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error("Error in loadAllChats:", error);
    throw error;
  }
};

/**
 * Load a single chat by ID
 */
export const loadChat = async (chatId: string): Promise<Chat | null> => {
  try {
    const db = await initChatDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(chatId);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        console.error("Error loading chat:", request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error("Error in loadChat:", error);
    throw error;
  }
};

/**
 * Delete a chat from IndexedDB
 */
export const deleteChat = async (chatId: string): Promise<void> => {
  try {
    const db = await initChatDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(chatId);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        console.error("Error deleting chat:", request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error("Error in deleteChat:", error);
    throw error;
  }
};

/**
 * Delete all chats from IndexedDB
 */
export const deleteAllChats = async (): Promise<void> => {
  try {
    const db = await initChatDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        console.error("Error clearing all chats:", request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error("Error in deleteAllChats:", error);
    throw error;
  }
};

/**
 * Migrate chats from localStorage to IndexedDB
 * Call this once during initialization to migrate existing data
 */
export const migrateFromLocalStorage = async (): Promise<void> => {
  try {
    const savedChats = localStorage.getItem("volleyball-chats");
    if (!savedChats) {
      return; // Nothing to migrate
    }

    const chats = JSON.parse(savedChats) as Chat[];
    if (!Array.isArray(chats) || chats.length === 0) {
      return;
    }

    await saveAllChats(chats);

    // After successful migration, remove from localStorage
    localStorage.removeItem("volleyball-chats");
  } catch (error) {
    console.error("Error migrating chats from localStorage:", error);
    // Don't throw - allow app to continue even if migration fails
  }
};
