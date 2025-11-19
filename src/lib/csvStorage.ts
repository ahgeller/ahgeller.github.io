import { parseCsvText, stringifyCsv } from "@/lib/csvUtils";

const DB_NAME = "VolleyBallCSVStorage";
const DB_VERSION = 1;
const STORE_NAME = "csvFiles";
const CSV_DATA_PREFIX = "db_csv_data_";

// In-memory cache for parsed data
const csvDataCache = new Map<string, any[]>();

// IndexedDB instance
let dbInstance: IDBDatabase | null = null;

// Initialize IndexedDB
const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("IndexedDB open error:", request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = db.createObjectStore(STORE_NAME, { keyPath: "fileId" });
        objectStore.createIndex("uploadedAt", "uploadedAt", { unique: false });
      }
    };
  });
};

// Save CSV data to IndexedDB
export const saveCsvDataText = async (
  fileId: string,
  csvText: string,
  parsedData?: any[]
): Promise<void> => {
  const storageKey = `${CSV_DATA_PREFIX}${fileId}`;
  console.log('saveCsvDataText (IndexedDB): Saving data for file ID:', fileId, 'CSV text length:', csvText.length);

  try {
    const db = await initDB();
    
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    
    const data = {
      fileId: storageKey,
      csvText: csvText,
      uploadedAt: Date.now(),
      size: csvText.length
    };

    await new Promise<void>((resolve, reject) => {
      const request = store.put(data);
      request.onsuccess = () => {
        console.log('saveCsvDataText (IndexedDB): Data saved successfully');
        resolve();
      };
      request.onerror = () => {
        console.error('saveCsvDataText (IndexedDB): Error saving:', request.error);
        reject(request.error);
      };
    });

    // Also save to localStorage as backup (for migration purposes)
    try {
      localStorage.setItem(storageKey, csvText);
    } catch (e) {
      // Ignore localStorage errors - IndexedDB is primary
      console.warn('saveCsvDataText (IndexedDB): Could not save to localStorage backup:', e);
    }

    // Cache parsed data if provided
    if (parsedData) {
      csvDataCache.set(fileId, parsedData);
    } else {
      const { data: parsed } = parseCsvText(csvText);
      csvDataCache.set(fileId, parsed);
    }
  } catch (error) {
    console.error('saveCsvDataText (IndexedDB): Error:', error);
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'UnknownError')) {
      throw new Error('Storage quota exceeded. Please remove some files and try again.');
    }
    throw error;
  }
};

// Get CSV data from IndexedDB
export const getCsvDataRows = async (file: any): Promise<any[] | null> => {
  if (!file || !file.id) {
    console.warn('getCsvDataRows (IndexedDB): Invalid file or missing id', file);
    return null;
  }

  console.log('getCsvDataRows (IndexedDB): Getting data for file:', file.name, 'id:', file.id);

  // First check if file has data array (legacy support)
  if (Array.isArray(file.data)) {
    console.log('getCsvDataRows (IndexedDB): Using file.data array, length:', file.data.length);
    try {
      const headers = file.headers || (file.data[0] ? Object.keys(file.data[0]) : []);
      const csvText = stringifyCsv(headers, file.data);
      await saveCsvDataText(file.id, csvText, file.data);
      console.log('getCsvDataRows (IndexedDB): Saved legacy file.data to IndexedDB');
    } catch (e) {
      console.error('getCsvDataRows (IndexedDB): Error saving legacy data:', e);
    }
    csvDataCache.set(file.id, file.data);
    return file.data;
  }

  // Check cache
  if (csvDataCache.has(file.id)) {
    const cached = csvDataCache.get(file.id)!;
    console.log('getCsvDataRows (IndexedDB): Using cached data, length:', cached.length);
    return cached;
  }

  // Check IndexedDB
  const storageKey = `${CSV_DATA_PREFIX}${file.id}`;
  console.log('getCsvDataRows (IndexedDB): Checking IndexedDB for key:', storageKey);

  try {
    const db = await initDB();
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);

    const csvText = await new Promise<string | null>((resolve, reject) => {
      const request = store.get(storageKey);
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.csvText : null);
      };
      request.onerror = () => {
        console.error('getCsvDataRows (IndexedDB): Error reading:', request.error);
        reject(request.error);
      };
    });

    if (!csvText) {
      console.warn('getCsvDataRows (IndexedDB): No CSV text found in IndexedDB for key:', storageKey);
      // Fallback to localStorage for migration
      const localData = localStorage.getItem(storageKey);
      if (localData) {
        console.log('getCsvDataRows (IndexedDB): Found in localStorage, migrating to IndexedDB');
        try {
          await saveCsvDataText(file.id, localData);
          const { data } = parseCsvText(localData);
          csvDataCache.set(file.id, data);
          return data;
        } catch (e) {
          console.error('getCsvDataRows (IndexedDB): Error migrating from localStorage:', e);
          // Still return the data even if migration fails
          const { data } = parseCsvText(localData);
          csvDataCache.set(file.id, data);
          return data;
        }
      }
      console.warn('getCsvDataRows (IndexedDB): File exists but data is missing. File may need to be re-uploaded.');
      return null;
    }

    console.log('getCsvDataRows (IndexedDB): Found CSV text, length:', csvText.length);
    const { data } = parseCsvText(csvText);
    console.log('getCsvDataRows (IndexedDB): Parsed CSV data, rows:', data?.length || 0);
    csvDataCache.set(file.id, data);
    return data;
  } catch (error) {
    console.error('getCsvDataRows (IndexedDB): Error:', error);
    // Fallback to localStorage
    const storageKey = `${CSV_DATA_PREFIX}${file.id}`;
    const localData = localStorage.getItem(storageKey);
    if (localData) {
      console.log('getCsvDataRows (IndexedDB): Falling back to localStorage');
      const { data } = parseCsvText(localData);
      csvDataCache.set(file.id, data);
      return data;
    }
    return null;
  }
};

// Get all CSV data rows (for multiple files)
export const getAllCsvDataRows = async (
  files: any[],
  csvId?: string | string[] | null
): Promise<any[]> => {
  if (csvId) {
    const ids = Array.isArray(csvId) ? csvId : [csvId];
    const combined: any[] = [];
    for (const id of ids) {
      const file = files.find((f: any) => f.id === id);
      if (file) {
        const data = await getCsvDataRows(file);
        if (data && data.length > 0) {
          combined.push(...data);
        }
      }
    }
    return combined;
  }

  const combined: any[] = [];
  for (const file of files) {
    const data = await getCsvDataRows(file);
    if (data && data.length > 0) {
      combined.push(...data);
    }
  }
  return combined;
};

// Delete CSV data from IndexedDB
export const deleteCsvData = async (fileId: string): Promise<void> => {
  const storageKey = `${CSV_DATA_PREFIX}${fileId}`;
  try {
    const db = await initDB();
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    await new Promise<void>((resolve, reject) => {
      const request = store.delete(storageKey);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    csvDataCache.delete(fileId);
    // Also remove from localStorage if it exists (migration cleanup)
    localStorage.removeItem(storageKey);
  } catch (error) {
    console.error('deleteCsvData (IndexedDB): Error:', error);
    // Fallback to localStorage
    localStorage.removeItem(storageKey);
    csvDataCache.delete(fileId);
  }
};

// Migrate legacy CSV file
export const migrateLegacyCsvFile = async (
  file: any
): Promise<{ updatedFile: any; migrated: boolean }> => {
  if (file && Array.isArray(file.data) && file.id) {
    try {
      const headers =
        (file.headers && file.headers.length > 0
          ? file.headers
          : Object.keys(file.data[0] || {})) || [];
      const csvText = stringifyCsv(headers, file.data);
      await saveCsvDataText(file.id, csvText, file.data);
      const updatedFile = { ...file, rowCount: file.rowCount ?? file.data.length };
      delete updatedFile.data;
      console.log(
        "migrateLegacyCsvFile (IndexedDB): Migrated file",
        file.name,
        "with",
        file.data.length,
        "rows"
      );
      return { updatedFile, migrated: true };
    } catch (error) {
      console.error("Error migrating CSV file data:", error);
    }
  }
  // Also check if data exists in localStorage but file doesn't have it
  if (file && file.id && !Array.isArray(file.data)) {
    const storageKey = `${CSV_DATA_PREFIX}${file.id}`;
    const localData = localStorage.getItem(storageKey);
    if (localData) {
      console.log("migrateLegacyCsvFile (IndexedDB): Migrating from localStorage");
      try {
        await saveCsvDataText(file.id, localData);
        return { updatedFile: file, migrated: true };
      } catch (error) {
        console.error("Error migrating from localStorage:", error);
      }
    } else {
      console.warn(
        "migrateLegacyCsvFile (IndexedDB): File",
        file.name,
        "has no data in IndexedDB or localStorage. Data may be lost."
      );
    }
  }
  return { updatedFile: file, migrated: false };
};

// Get storage usage info
export const getStorageInfo = async (): Promise<{
  used: number;
  quota: number;
  percentage: number;
}> => {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    return {
      used: estimate.usage || 0,
      quota: estimate.quota || 0,
      percentage: estimate.quota
        ? (estimate.usage || 0) / estimate.quota
        : 0,
    };
  }
  return { used: 0, quota: 0, percentage: 0 };
};
