import { parseCsvText, stringifyCsv, StreamingCsvParser } from "@/lib/csvUtils";

const DB_NAME = "VolleyBallCSVStorage";
const DB_VERSION = 5; // Updated to match existing database version
const STORE_NAME = "csvFiles";
const METADATA_STORE = "csvMetadata"; // Store for CSVFile metadata (without data arrays)
const CSV_INDEX_STORE = "csvIndexes"; // Store for unique values indexes
const CSV_DATA_PREFIX = "db_csv_data_";
const CSV_INDEX_PREFIX = "db_csv_index_";

// In-memory cache for parsed data with size tracking
const csvDataCache = new Map<string, any[]>();
const MAX_CACHE_SIZE = 20; // Increased from 5 - modern browsers can handle more

// Clear a specific file from cache
export function clearCsvCacheEntry(fileId: string): void {
  csvDataCache.delete(fileId);
}

// Clear all cached data
export function clearAllCsvCache(): void {
  csvDataCache.clear();
}

// Get cache size
export function getCsvCacheSize(): number {
  return csvDataCache.size;
}

// Manage cache size - remove oldest entries if over limit
function manageCacheSize(): void {
  if (csvDataCache.size > MAX_CACHE_SIZE) {
    // Remove oldest entries (first inserted)
    const keysToRemove = Array.from(csvDataCache.keys()).slice(0, csvDataCache.size - MAX_CACHE_SIZE);
    keysToRemove.forEach(key => csvDataCache.delete(key));
  }
}

// IndexedDB instance
let dbInstance: IDBDatabase | null = null;

// Initialize IndexedDB
export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    // CRITICAL FIX: Check version before returning cached instance
    // If cached instance is old version, close it and reinitialize
    if (dbInstance) {
      if (dbInstance.version !== DB_VERSION) {
        console.warn(`🔄 IndexedDB version mismatch (cached: ${dbInstance.version}, expected: ${DB_VERSION}) - reinitializing...`);
        dbInstance.close();
        dbInstance = null;
      } else {
        resolve(dbInstance);
        return;
      }
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
      // Create metadata store for CSVFile metadata (without data arrays)
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        const metadataStore = db.createObjectStore(METADATA_STORE, { keyPath: "id" });
        metadataStore.createIndex("uploadedAt", "uploadedAt", { unique: false });
        metadataStore.createIndex("name", "name", { unique: false });
      }
      // Create index store for unique values
      if (!db.objectStoreNames.contains(CSV_INDEX_STORE)) {
        const indexStore = db.createObjectStore(CSV_INDEX_STORE, { keyPath: "fileId" });
        indexStore.createIndex("uploadedAt", "uploadedAt", { unique: false });
      }
    };
  });
};

// Save CSV file as Blob for very large files
export const saveCsvDataBlob = async (
  fileId: string,
  file: File,
  sampleData: any[],
  headers: string[],
  totalRows: number,
  onProgress?: (progress: { percent: number; message: string }) => void
): Promise<void> => {
  const storageKey = `${CSV_DATA_PREFIX}${fileId}`;
  const fileSizeGB = file.size / (1024 * 1024 * 1024);
  const fileSizeMB = file.size / (1024 * 1024);
  
  console.log('saveCsvDataBlob (IndexedDB): Saving file as Blob, file ID:', fileId, 'file size:', fileSizeMB.toFixed(1), 'MB');

  try {
    const db = await initDB();
    
    if (fileSizeGB > 1) {
      console.log(`saveCsvDataBlob: Large file detected (${fileSizeGB.toFixed(2)}GB), this may take several minutes...`);
      onProgress?.({ percent: 5, message: `Preparing to save ${fileSizeGB.toFixed(2)}GB file...` });
    }
    
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    
    const blobToStore = file instanceof Blob ? file : new Blob([file], { type: 'text/csv' });
    
    onProgress?.({ percent: 10, message: 'Creating file record...' });
    
    const data = {
      fileId: storageKey,
      fileBlob: blobToStore,
      headers: headers,
      totalRows: totalRows,
      uploadedAt: Date.now(),
      size: file.size,
      isBlob: true
    };

    const TIMEOUT_MS = 30 * 60 * 1000;
    let timeoutId: NodeJS.Timeout | null = null;
    let progressInterval: NodeJS.Timeout | null = null;
    
    await new Promise<void>((resolve, reject) => {
      const startTime = Date.now();
      
      timeoutId = setTimeout(() => {
        const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
        reject(new Error(`Save operation timed out after ${elapsed} minutes. File may be too large (${fileSizeGB.toFixed(2)}GB). Please try a smaller file or check browser storage.`));
      }, TIMEOUT_MS);
      
      if (fileSizeMB > 100) {
        progressInterval = setInterval(() => {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
          const elapsedMin = Math.floor(Number(elapsed) / 60);
          const elapsedSec = Number(elapsed) % 60;
          onProgress?.({
            percent: 50,
            message: `Saving... (${elapsedMin}m ${elapsedSec}s elapsed)`
          });
        }, 5000);
      }
      
      onProgress?.({ percent: 20, message: 'Writing to IndexedDB...' });
      
      const request = store.put(data);
      
      if (fileSizeGB > 1) {
        console.log(`saveCsvDataBlob: Starting save for ${fileSizeGB.toFixed(2)}GB file - this may take several minutes...`);
      }
      
      request.onsuccess = () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (progressInterval) clearInterval(progressInterval);
        
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const elapsedMin = Math.floor(Number(elapsed) / 60);
        const elapsedSec = (Number(elapsed) % 60).toFixed(0);
        console.log(`saveCsvDataBlob (IndexedDB): Blob saved successfully, size: ${fileSizeGB.toFixed(2)}GB, took ${elapsedMin}m ${elapsedSec}s`);
        
        onProgress?.({ percent: 100, message: 'Save complete!' });
        resolve();
      };
      
      request.onerror = () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (progressInterval) clearInterval(progressInterval);
        
        const error = request.error;
        console.error('saveCsvDataBlob (IndexedDB): Error saving:', error, 'File size:', fileSizeGB.toFixed(2), 'GB');
        
        onProgress?.({ percent: 0, message: 'Error saving file' });
        
        if (error && (error.name === 'QuotaExceededError' || (error as any).code === 22)) {
          reject(new Error(`Storage quota exceeded. File size: ${fileSizeGB.toFixed(2)}GB. Please free up space or remove older files.`));
        } else if (error && (error.name === 'DataCloneError' || (error as any).code === 25)) {
          reject(new Error(`Cannot store file in IndexedDB. File may be too large (${fileSizeGB.toFixed(2)}GB) or in an unsupported format. Try a smaller file or clear browser storage.`));
        } else if (error) {
          reject(new Error(`IndexedDB error: ${error.name || 'Unknown'} - ${error.message || 'Failed to save file'}`));
        } else {
          reject(new Error('Unknown error saving file to IndexedDB'));
        }
      };
    });

    if (sampleData && sampleData.length > 0) {
      csvDataCache.set(fileId, sampleData);
      manageCacheSize();
    }
    
    const MAX_AUTO_INDEX_SIZE_GB = 1;
    
    if (headers.length > 0 && fileSizeGB < MAX_AUTO_INDEX_SIZE_GB) {
      // Use requestIdleCallback for true background processing that doesn't block UI
      const scheduleIndexing = () => {
        if ('requestIdleCallback' in window) {
          (window as any).requestIdleCallback(() => performIndexing(), { timeout: 5000 });
        } else {
          // Fallback: use setTimeout with longer delay
          setTimeout(() => performIndexing(), 1000);
        }
      };
      
      const performIndexing = async () => {
        try {
          console.log(`saveCsvDataBlob: Starting background indexing for ${fileSizeGB.toFixed(2)}GB file...`);
          const columnIndexes = new Map<string, Set<string>>();
          headers.forEach(col => columnIndexes.set(col, new Set<string>()));
          
          const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks for better responsiveness
          const LINES_PER_YIELD = 1000; // Yield every 1000 lines to prevent UI freezing
          let offset = 0;
          let buffer = '';
          let isFirstChunk = true;
          let delimiter = ',';
          let headerArray: string[] = [];
          let rowCount = 0;
          let linesSinceYield = 0;
          
          while (offset < file.size) {
            const chunk = file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size));
            const chunkText = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = (e) => resolve(e.target?.result as string);
              reader.onerror = () => reject(new Error('Failed to read chunk'));
              reader.readAsText(chunk);
            });
            
            buffer += chunkText;
            const lines = buffer.split(/\r?\n|\r/);
            buffer = lines.pop() || '';
            
            for (const line of lines) {
              if (!line.trim()) continue;
              
              if (isFirstChunk) {
                delimiter = detectDelimiterFromHeaders(line);
                headerArray = parseCsvLine(line, delimiter).map(h => h.replace(/^"|"$/g, ""));
                isFirstChunk = false;
                continue;
              }
              
              // Fast path for simple CSVs without quotes
              let values: string[];
              if (delimiter === ',' && !line.includes('"')) {
                values = line.split(',');
              } else {
                values = parseCsvLine(line, delimiter);
              }
              
              // Remove quotes from values
              values = values.map(v => v.replace(/^"|"$/g, ""));
              
              headerArray.forEach((header, index) => {
                const value = values[index];
                if (value !== null && value !== undefined && value !== '') {
                  const set = columnIndexes.get(header);
                  if (set) {
                    set.add(String(value).trim());
                  }
                }
              });
              rowCount++;
              linesSinceYield++;
              
              // Yield to UI thread every N lines to prevent freezing
              if (linesSinceYield >= LINES_PER_YIELD) {
                await new Promise(resolve => setTimeout(resolve, 0));
                linesSinceYield = 0;
              }
            }
            
            offset += CHUNK_SIZE;
            
            // Also yield after each chunk
            await new Promise(resolve => setTimeout(resolve, 0));
          }
          
          // Process remaining buffer
          if (buffer.trim() && !isFirstChunk) {
            let values: string[];
            if (delimiter === ',' && !buffer.includes('"')) {
              values = buffer.split(',');
            } else {
              values = parseCsvLine(buffer, delimiter);
            }
            
            values = values.map(v => v.replace(/^"|"$/g, ""));
            
            headerArray.forEach((header, index) => {
              const value = values[index];
              if (value !== null && value !== undefined && value !== '') {
                const set = columnIndexes.get(header);
                if (set) {
                  set.add(String(value).trim());
                }
              }
            });
          }
          
          // Convert Sets to arrays with yielding for large sets
          const index: Record<string, string[]> = {};
          let colIndex = 0;
          for (const [column, set] of columnIndexes.entries()) {
            index[column] = Array.from(set).sort();
            
            // Yield after sorting large columns to prevent UI blocking
            if (set.size > 5000) {
              await new Promise(resolve => setTimeout(resolve, 0));
            }
            
            colIndex++;
            // Yield every 10 columns
            if (colIndex % 10 === 0) {
              await new Promise(resolve => setTimeout(resolve, 0));
            }
          }
          
          // Store index
          const db = await initDB();
          const transaction = db.transaction([CSV_INDEX_STORE], "readwrite");
          const store = transaction.objectStore(CSV_INDEX_STORE);
          const indexKey = `${CSV_INDEX_PREFIX}${fileId}`;
          
          await new Promise<void>((resolve, reject) => {
            const request = store.put({
              fileId: indexKey,
              indexes: index,
              uploadedAt: Date.now(),
              columnCount: headers.length,
              totalUniqueValues: Object.values(index).reduce((sum, arr) => sum + arr.length, 0),
              rowsProcessed: rowCount
            });
            request.onsuccess = () => {
              console.log('saveCsvDataBlob: Index stored successfully', {
                columns: headers.length,
                totalUniqueValues: Object.values(index).reduce((sum, arr) => sum + arr.length, 0),
                rowsProcessed: rowCount
              });
              resolve();
            };
            request.onerror = () => reject(request.error);
          });
        } catch (err) {
          console.warn('saveCsvDataBlob: Failed to build index (non-critical):', err);
        }
      };
      
      scheduleIndexing();
    } else if (fileSizeGB >= MAX_AUTO_INDEX_SIZE_GB) {
      console.log(`saveCsvDataBlob: Skipping automatic indexing for large file (${fileSizeGB.toFixed(2)}GB). Index will be built on-demand when needed.`);
    }
  } catch (error) {
    console.error('saveCsvDataBlob (IndexedDB): Error:', error);
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'UnknownError')) {
      throw new Error('Storage quota exceeded. Please remove some files and try again.');
    }
    throw error;
  }
};

// Save CSV data to IndexedDB
export const saveCsvDataText = async (
  fileId: string,
  csvText: string,
  parsedData?: any[]
): Promise<void> => {
  const storageKey = `${CSV_DATA_PREFIX}${fileId}`;
  console.log('saveCsvDataText: Saving data for file ID:', fileId, 'CSV text length:', csvText.length);

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
        console.log('saveCsvDataText: Data saved successfully');
        resolve();
      };
      request.onerror = () => {
        console.error('saveCsvDataText: Error saving:', request.error);
        reject(request.error);
      };
    });

    try {
      localStorage.setItem(storageKey, csvText);
    } catch (e) {
      console.warn('saveCsvDataText: Could not save to localStorage backup:', e);
    }

    if (parsedData) {
      csvDataCache.set(fileId, parsedData);
      manageCacheSize();
    } else {
      const { data: parsed } = parseCsvText(csvText);
      csvDataCache.set(fileId, parsed);
      manageCacheSize();
    }
    
    const headers = parsedData && parsedData.length > 0 
      ? Object.keys(parsedData[0])
      : (csvText.split(/\r?\n|\r/)[0]?.split(',') || []);
    
    const fileSizeGB = csvText.length / (1024 * 1024 * 1024);
    const MAX_AUTO_INDEX_SIZE_GB = 1;
    
    // SAME PROBLEM - Background indexing WITHOUT proper yielding
    if (headers.length > 0 && fileSizeGB < MAX_AUTO_INDEX_SIZE_GB) {
      buildAndStoreUniqueValuesIndex(fileId, csvText, headers).catch(err => {
        console.warn('saveCsvDataText: Failed to build index (non-critical):', err);
      });
    } else if (fileSizeGB >= MAX_AUTO_INDEX_SIZE_GB) {
      console.log(`saveCsvDataText: Skipping automatic indexing for large file (${fileSizeGB.toFixed(2)}GB). Index will be built on-demand when needed.`);
    }
  } catch (error) {
    console.error('saveCsvDataText: Error:', error);
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'UnknownError')) {
      throw new Error('Storage quota exceeded. Please remove some files and try again.');
    }
    throw error;
  }
};

// Auto-migrate on first access
let migrationChecked = false;
const ensureMigration = async () => {
  if (migrationChecked) return;
  migrationChecked = true;
  try {
    const saved = localStorage.getItem("db_csv_files");
    if (saved) {
      const files = JSON.parse(saved);
      if (Array.isArray(files) && files.length > 0) {
        // Check if any files need migration
        const needsMigration = files.some((f: any) => {
          const storageKey = `${CSV_DATA_PREFIX}${f.id}`;
          return localStorage.getItem(storageKey) && !f.hasDuckDB;
        });
        if (needsMigration) {
          console.log('Auto-migrating CSV files to IndexedDB...');
          await migrateAllToIndexedDB();
        }
      }
    }
  } catch (error) {
    console.warn('Auto-migration failed:', error);
  }
};

// Get CSV data from IndexedDB
// onProgress: optional callback to report loading progress { file: string; percent: number; rows?: number; message?: string; error?: string }
// skipDuckDB: if true, skip DuckDB check to prevent infinite recursion
export const getCsvDataRows = async (
  file: any,
  onProgress?: (progress: { file: string; percent: number; rows?: number; message?: string; error?: string }) => void,
  skipDuckDB: boolean = false
) => {
  try {
    // Ensure migration on first access
    await ensureMigration();
    
    if (!file) {
      throw new Error('No file provided to getCsvDataRows');
    }
    
    const fileName = file.name || 'unknown';
    console.log(`getCsvDataRows: Starting to read CSV file: ${fileName}`);
    
    // FAST PATH 1: Check in-memory cache first (fastest)
    if (csvDataCache.has(file.id)) {
      const cachedData = csvDataCache.get(file.id)!;
      console.log(`getCsvDataRows: Using cached data for ${fileName} (${cachedData.length} rows)`);
      if (onProgress) {
        onProgress({ file: fileName, percent: 100, rows: cachedData.length });
      }
      return cachedData;
    }
    
    // FAST PATH 2: Check if data is embedded in file object
    if (file.data && Array.isArray(file.data) && file.data.length > 0) {
      console.log(`getCsvDataRows: Using embedded data from file object for ${fileName}`);
      // Cache it for next time
      csvDataCache.set(file.id, file.data);
      manageCacheSize();
      if (onProgress) {
        onProgress({ file: fileName, percent: 100, rows: file.data.length });
      }
      return file.data;
    }
    
    // PATH 3: Try DuckDB if registered (avoids loading blob into memory)
    // BUT: Skip if skipDuckDB is true to prevent infinite recursion
    if (!skipDuckDB) {
      try {
        const { isDuckDBInitialized, queryCSVWithDuckDB, isFileRegisteredInDuckDB, getDuckDBTableName } = await import('./duckdb');
        if (isDuckDBInitialized()) {
          // Check if file is registered in DuckDB (even if hasDuckDB flag is false)
          const tableName = getDuckDBTableName(file.id) || file.tableName;
          const isRegistered = isFileRegisteredInDuckDB(file.id);
          
          if (isRegistered || (tableName && file.hasDuckDB)) {
            console.log('getCsvDataRows: Using DuckDB for data retrieval (no blob reading needed), table:', tableName);
            const rows = await queryCSVWithDuckDB(file.id, null, null, (progress) => {
              if (onProgress) {
                onProgress({
                  file: fileName,
                  percent: progress.percent || 0,
                  rows: progress.rows
                });
              }
            });
            console.log(`getCsvDataRows: DuckDB returned ${rows?.length || 0} rows for ${fileName}`);
            // Cache the results
            if (rows && rows.length > 0) {
              csvDataCache.set(file.id, rows);
              manageCacheSize();
            }
            return rows || [];
          }
        }
      } catch (error) {
        console.warn('getCsvDataRows: DuckDB not available or failed, falling back to blob reading:', error);
        // Fall through to standard retrieval only if DuckDB fails
      }
    } else {
      console.log('getCsvDataRows: Skipping DuckDB check (skipDuckDB=true) to prevent recursion');
    }
    if (file.data && Array.isArray(file.data) && file.data.length > 0) {
      console.log(`getCsvDataRows: Using embedded data directly, rows: ${file.data.length}`);
      if (onProgress) {
        onProgress({ file: fileName, percent: 100, rows: file.data.length });
      }
      return file.data;
    }
    
    // For blob files, read from IndexedDB with optimized chunking
    if (file.id) {
      const storageKey = `db_csv_data_${file.id}`;
      const db = await initDB();
      const transaction = db.transaction(["csvFiles"], "readonly");
      const store = transaction.objectStore("csvFiles");
      
      const result = await new Promise<any>((resolve, reject) => {
        const request = store.get(storageKey);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      if (!result) {
        throw new Error(`CSV data not found for file: ${fileName}`);
      }
      
      // Check cache first
      if (csvDataCache.has(file.id)) {
        const cachedData = csvDataCache.get(file.id);
        if (cachedData && Array.isArray(cachedData) && cachedData.length > 0) {
          console.log(`getCsvDataRows: Using cached data for ${fileName}, rows: ${cachedData.length}`);
          if (onProgress) {
            onProgress({ file: fileName, percent: 100, rows: cachedData.length });
          }
          return cachedData;
        }
      }
      
      if (result.data && Array.isArray(result.data)) {
        // Regular file stored as JSON
        console.log(`getCsvDataRows: Retrieved ${result.data.length} rows from IndexedDB for ${fileName}`);
        if (onProgress) {
          onProgress({ file: fileName, percent: 100, rows: result.data.length });
        }
        // Cache the data
        csvDataCache.set(file.id, result.data);
        manageCacheSize();
        return result.data;
      } else if (result.csvText) {
        // File stored as CSV text - parse it
        console.log(`getCsvDataRows: Parsing CSV text for ${fileName}, length: ${result.csvText.length}`);
        if (onProgress) {
          onProgress({ file: fileName, percent: 50, message: 'Parsing CSV...' });
        }
        const { parseCsvText } = await import("@/lib/csvUtils");
        const parsedData = parseCsvText(result.csvText).data;
        console.log(`getCsvDataRows: Parsed ${parsedData.length} rows from CSV text for ${fileName}`);
        // Cache the parsed data
        csvDataCache.set(file.id, parsedData);
        manageCacheSize();
        if (onProgress) {
          onProgress({ file: fileName, percent: 100, rows: parsedData.length });
        }
        return parsedData;
      } else if (result.isBlob && result.fileBlob) {
        // DuckDB-only: Blob files MUST use DuckDB
        // CRITICAL: Respect skipDuckDB flag to prevent infinite recursion
        if (skipDuckDB) {
          const fileSizeMB = (result.fileBlob.size / (1024 * 1024)).toFixed(1);
          console.error(`❌ File ${fileName} is stored as blob (${fileSizeMB}MB) but skipDuckDB=true - cannot load without DuckDB`);
          throw new Error(`File ${fileName} is stored as blob but DuckDB is not available. Blob files require DuckDB for all operations. Please re-upload the file.`);
        }
        
        // Try to auto-recover by registering and querying with DuckDB
        const fileSizeMB = (result.fileBlob.size / (1024 * 1024)).toFixed(1);
        console.log(`⚠️ File ${fileName} is stored as blob (${fileSizeMB}MB) - attempting to auto-register in DuckDB`);
        
        try {
          const { queryCSVWithDuckDB } = await import('./duckdb');
          
          // queryCSVWithDuckDB expects a csvId (string), not a File object
          // It will look up the file by ID and auto-register it if needed
          // Pass progress callback to show registration progress
          const rows = await queryCSVWithDuckDB(
            file.id, 
            null, 
            null,
            (progress) => {
              if (onProgress) {
                // Map DuckDB progress to our format
                onProgress({ 
                  file: fileName, 
                  percent: progress.percent || 0, 
                  rows: progress.rows,
                  message: progress.message 
                });
              }
            }
          );
          // Demoted to debug-only to avoid surfacing in UI progress
          console.debug(`Auto-recovered blob file ${fileName} with DuckDB, rows: ${rows.length}`);
          
          // Cache the data
          csvDataCache.set(file.id, rows);
          manageCacheSize();
          if (onProgress) {
            onProgress({ file: fileName, percent: 100, rows: rows.length });
          }
          return rows;
        } catch (duckdbError: any) {
          console.error(`❌ Failed to auto-recover blob file ${fileName} with DuckDB:`, duckdbError);
          throw new Error(`File ${fileName} is stored as blob but could not be loaded in DuckDB. Please re-upload the file. Error: ${duckdbError.message}`);
        }
      } else {
        // Log the actual result structure for debugging
        console.error(`getCsvDataRows: Unknown data format for file: ${fileName}`, {
          hasData: !!result.data,
          hasCsvText: !!result.csvText,
          hasFileBlob: !!result.fileBlob,
          isBlob: result.isBlob,
          keys: Object.keys(result)
        });
        throw new Error(`Unknown data format for file: ${fileName}. Available keys: ${Object.keys(result).join(', ')}`);
      }
    }
    
    throw new Error(`Cannot load CSV data for file: ${fileName}`);
  } catch (error) {
    console.error(`getCsvDataRows: Failed to read file ${file?.name || 'unknown'}:`, error);
    if (onProgress) {
      onProgress({ 
        file: file?.name || 'unknown', 
        percent: 0, 
        rows: 0, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
    throw error;
  }
};

// DuckDB data retrieval for maximum performance
async function getDuckDBData(
  file: any,
  onProgress?: (progress: { file: string; percent: number; rows?: number; message?: string; error?: string }) => void
) {
  try {
    const { queryCSVWithDuckDB } = await import('./duckdb');
    
    onProgress?.({ 
      file: file.name || 'unknown', 
      percent: 0, 
      message: 'Loading data with DuckDB...' 
    });
    
    // Query all data from DuckDB (no blob reading needed)
    const result = await queryCSVWithDuckDB(
      file.id,
      null, // No filter columns - get all data
      null, // No filter values
      (progress) => {
        onProgress?.({
          file: file.name || 'unknown',
          percent: progress.percent,
          rows: progress.rows,
          message: progress.message,
        });
      }
    );
    
    onProgress?.({ 
      file: file.name || 'unknown', 
      percent: 100, 
      rows: result.length,
      message: 'Data loaded successfully with DuckDB' 
    });
    
    return result;
  } catch (error) {
    console.error('getDuckDBData: DuckDB data retrieval failed:', error);
    // Don't fall back to blob reading - throw error instead
    // Blob reading should only happen in getCsvDataRows as a last resort
    throw error;
  }
}

// Optimized blob file reading for large files
// Optimized blob file reading with proper yielding and chunking
async function readBlobFile(
  blob: Blob,
  fileName: string,
  onProgress?: (progress: { file: string; percent: number; rows?: number; message?: string; error?: string }) => void,
  headers: string[] = []
) {
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks (smaller for better responsiveness)
  const YIELD_INTERVAL = 5; // Yield every 5 chunks
  const totalSize = blob.size;
  const fileSizeGB = totalSize / (1024 * 1024 * 1024);
  
  console.log(`readBlobFile: Reading blob file in chunks (${fileSizeGB.toFixed(2)}GB total)`);
  
  if (onProgress) {
    onProgress({ file: fileName, percent: 0, message: 'Starting to read file...' });
  }
  
  try {
    const parser = new StreamingCsvParser();
    
    let offset = 0;
    let parsedRowCount = 0;
    let lastProgressUpdate = Date.now();
    const PROGRESS_UPDATE_INTERVAL = 100; // Update every 100ms max
    let chunkCount = 0;
    
    while (offset < totalSize) {
      // Read chunk
      const chunk = blob.slice(offset, Math.min(offset + CHUNK_SIZE, totalSize));
      const chunkText = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const result = e.target?.result;
          if (typeof result === 'string') {
            resolve(result);
          } else {
            reject(new Error('Failed to read blob chunk as text'));
          }
        };
        reader.onerror = () => reject(new Error('Failed to read blob chunk'));
        reader.readAsText(chunk);
      });
      
      // Process chunk with throttled progress updates
      parser.processChunk(chunkText, (rows: number) => {
        parsedRowCount = rows;
        
        const now = Date.now();
        if (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
          const percent = Math.min((offset / totalSize) * 100, 99);
          onProgress?.({ file: fileName, percent, rows: parsedRowCount });
          lastProgressUpdate = now;
        }
      });
      
      offset += CHUNK_SIZE;
      chunkCount++;
      
      // Yield to UI thread every N chunks to prevent freezing
      if (chunkCount % YIELD_INTERVAL === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
        
        // Update progress after yielding
        const now = Date.now();
        if (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
          const percent = Math.min((offset / totalSize) * 100, 99);
          onProgress?.({ file: fileName, percent, rows: parsedRowCount, message: 'Processing...' });
          lastProgressUpdate = now;
        }
      }
    }
    
    const finalResult = parser.finalize();
    console.log(`readBlobFile: Successfully parsed ${finalResult.data.length} rows from blob file`);
    
    if (onProgress) {
      onProgress({ file: fileName, percent: 100, rows: finalResult.data.length, message: 'Complete!' });
    }
    
    return finalResult.data;
  } catch (error) {
    console.error(`readBlobFile: Error reading blob file:`, error);
    if (onProgress) {
      onProgress({ 
        file: fileName, 
        percent: 0, 
        rows: 0, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
    throw error;
  }
}
// Build and store unique values index for all columns during upload
// This makes "Load Column Values" instant instead of scanning the file
// Build index with proper yielding to prevent UI freezing
export const buildAndStoreUniqueValuesIndex = async (
  fileId: string,
  csvText: string,
  headers: string[]
): Promise<void> => {
  const indexKey = `${CSV_INDEX_PREFIX}${fileId}`;
  console.log('buildAndStoreUniqueValuesIndex: Building index for file:', fileId, 'columns:', headers.length);
  
  try {
    const db = await initDB();
    
    // Split lines once
    const lines = csvText.split(/\r?\n|\r/);
    if (lines.length === 0) return;
    
    // Detect delimiter
    const delimiter = detectDelimiterFromHeaders(lines[0]);
    
    // Initialize column indexes
    const columnIndexes = new Map<string, Set<string>>();
    headers.forEach(col => columnIndexes.set(col, new Set<string>()));
    
    // Process lines with yielding
    const YIELD_INTERVAL = 5000; // Yield every 5000 lines
    
// In buildAndStoreUniqueValuesIndex, around line where you process values:
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.length === 0) continue;
      
      // Fast path for simple CSVs
      let values: string[];
      if (delimiter === ',' && !line.includes('"')) {
        values = line.split(',').map(v => v.trim());
      } else {
        values = parseCsvLine(line, delimiter);
      }
      
      // Add values to index
      headers.forEach((header, index) => {
        const value = values[index];
        if (value !== null && value !== undefined && value !== '') {
          const set = columnIndexes.get(header);
          if (set) {
            set.add(String(value).trim());
          }
        }
      });
      
      // Yield to UI thread periodically
      if (i % YIELD_INTERVAL === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    
    // Convert Sets to sorted arrays
    const index: Record<string, string[]> = {};
    for (const [column, set] of columnIndexes.entries()) {
      index[column] = Array.from(set).sort();
      // Yield after sorting each column if it has many values
      if (set.size > 10000) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    
    // Store index
    const transaction = db.transaction([CSV_INDEX_STORE], "readwrite");
    const store = transaction.objectStore(CSV_INDEX_STORE);
    
    await new Promise<void>((resolve, reject) => {
      const request = store.put({
        fileId: indexKey,
        indexes: index,
        uploadedAt: Date.now(),
        columnCount: headers.length,
        totalUniqueValues: Object.values(index).reduce((sum, arr) => sum + arr.length, 0)
      });
      request.onsuccess = () => {
        console.log('buildAndStoreUniqueValuesIndex: Index stored successfully');
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('buildAndStoreUniqueValuesIndex: Error building index:', error);
  }
};
// Get unique values index from storage (fast path)
export const getUniqueValuesIndex = async (
  fileId: string,
  column: string
): Promise<string[] | null> => {
  const indexKey = `${CSV_INDEX_PREFIX}${fileId}`;
  
  try {
    const db = await initDB();
    const transaction = db.transaction([CSV_INDEX_STORE], "readonly");
    const store = transaction.objectStore(CSV_INDEX_STORE);
    
    const result = await new Promise<any | null>((resolve, reject) => {
      const request = store.get(indexKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    if (result && result.indexes && result.indexes[column]) {
      console.log(`getUniqueValuesIndex: Found cached index for column "${column}" (${result.indexes[column].length} values)`);
      return result.indexes[column];
    }
    
    return null;
  } catch (error) {
    console.error('getUniqueValuesIndex: Error reading index:', error);
    return null;
  }
};

// Get unique values from a column by streaming through the entire file
// Processes the entire file with no cap
// onProgress callback receives { processedMB, uniqueCount } for progress updates
// Get unique values from a column with proper yielding
export const getUniqueValuesFromFile = async (
  file: any,
  column: string,
  onProgress?: (progress: { processedMB: number; uniqueCount: number }) => void
): Promise<string[]> => {
  if (!file || !file.id) {
    console.warn('getUniqueValuesFromFile: Invalid file or missing id', file);
    return [];
  }

  console.log('getUniqueValuesFromFile: Getting unique values for column:', column, 'file:', file.name);
  
  const MAX_UNIQUE_VALUES = 100000;
  
  // Check index first (fast path)
  const indexedValues = await getUniqueValuesIndex(file.id, column);
  if (indexedValues) {
    console.log(`getUniqueValuesFromFile: Using cached index for column "${column}" (${indexedValues.length} values)`);
    if (indexedValues.length > MAX_UNIQUE_VALUES) {
      console.log(`getUniqueValuesFromFile: Index has ${indexedValues.length.toLocaleString()} values, limiting to first ${MAX_UNIQUE_VALUES.toLocaleString()} for display`);
      return indexedValues.slice(0, MAX_UNIQUE_VALUES);
    }
    return indexedValues;
  }
  
  // Try DuckDB first
  try {
    const { isDuckDBInitialized, executeDuckDBSql, isFileRegisteredInDuckDB, getDuckDBTableName } = await import('./duckdb');
    if (isDuckDBInitialized()) {
      const tableName = getDuckDBTableName(file.id) || file.tableName;
      const isRegistered = isFileRegisteredInDuckDB(file.id);

      if (isRegistered || (file.hasDuckDB && tableName)) {
        const finalTableName = tableName || file.tableName;
        if (finalTableName) {
          const escapedColumn = `"${column.replace(/"/g, '""')}"`;
          // Include NULL values in unique values list
          const query = `SELECT DISTINCT ${escapedColumn} FROM ${finalTableName} ORDER BY ${escapedColumn} LIMIT ${MAX_UNIQUE_VALUES}`;

          if (onProgress) onProgress({ processedMB: 0, uniqueCount: 0 });

          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('DuckDB query timeout')), 30000);
          });

          const rows = await Promise.race([
            executeDuckDBSql(file.id, query),
            timeoutPromise
          ]) as any[];

          if (!Array.isArray(rows)) throw new Error('DuckDB query did not return an array');

          const uniqueValues = rows
            .map((row: any) => {
              const val = row[column] || Object.values(row)[0];
              // Include NULL values as "(null)" for display
              if (val === null || val === undefined) return '(null)';
              const strVal = String(val).trim();
              return strVal === '' ? '(empty)' : strVal;
            });

          if (onProgress) onProgress({ processedMB: 0, uniqueCount: uniqueValues.length });

          return uniqueValues;
        }
      }
    }
  } catch (duckdbError) {
    console.warn('getUniqueValuesFromFile: DuckDB query failed, falling back to CSV text processing:', duckdbError);
    // Don't throw - fall through to CSV text processing fallback
  }
  
  // Fallback: Process CSV text with proper yielding
  const storageKey = `${CSV_DATA_PREFIX}${file.id}`;
  const uniqueValues = new Set<string>();

  try {
    const db = await initDB();
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    
    const result = await new Promise<any | null>((resolve, reject) => {
      const request = store.get(storageKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    if (!result) {
      console.warn('getUniqueValuesFromFile: No data found for file:', file.name);
      return [];
    }

    if (result.isBlob && result.fileBlob) {
      throw new Error(`File ${file.name} is stored as blob but not registered in DuckDB. Please re-upload the file to register it in DuckDB. DuckDB is required for all CSV operations.`);
    }

    const csvText = result.csvText;
    if (!csvText) {
      console.warn('getUniqueValuesFromFile: No CSV text in result');
      return [];
    }

    // Process lines with yielding to prevent freezing
    const lines = csvText.split(/\r?\n|\r/);
    if (lines.length === 0) return [];
    
    const delimiter = detectDelimiterFromHeaders(lines[0]);
    const headers = parseCsvLine(lines[0], delimiter);
    const columnIndex = headers.findIndex((h: string) => h.toLowerCase() === column.toLowerCase());
    
    if (columnIndex === -1) {
      console.warn('getUniqueValuesFromFile: Column not found:', column, 'Available columns:', headers);
      return [];
    }

    const totalLines = lines.length;
    const YIELD_INTERVAL = 5000; // Yield every 5000 lines
    const PROGRESS_INTERVAL = 10000; // Update progress every 10000 lines
    
    for (let i = 1; i < lines.length; i++) {
      // Early exit if limit reached
      if (uniqueValues.size >= MAX_UNIQUE_VALUES) {
        console.log(`getUniqueValuesFromFile: Reached ${MAX_UNIQUE_VALUES.toLocaleString()} unique values limit at line ${i.toLocaleString()}`);
        break;
      }
      
      const line = lines[i];
      if (!line || line.length === 0) continue;
      
      // Fast path for simple CSVs
      if (delimiter === ',' && !line.includes('"')) {
        const values = line.split(',');
        if (values[columnIndex] !== undefined) {
          const value = values[columnIndex].trim();
          // Include NULL/empty values
          if (value === '' || value === null || value === undefined) {
            uniqueValues.add('(null)');
          } else {
            uniqueValues.add(value);
          }
        }
      } else {
        const values = parseCsvLine(line, delimiter);
        if (values[columnIndex] !== undefined) {
          const strVal = values[columnIndex] === null || values[columnIndex] === undefined || values[columnIndex] === ''
            ? '(null)'
            : String(values[columnIndex]).trim();
          uniqueValues.add(strVal === '' ? '(null)' : strVal);
        }
      }
      
      // Yield to UI thread periodically
      if (i % YIELD_INTERVAL === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      
      // Report progress
      if (i % PROGRESS_INTERVAL === 0 && onProgress) {
        const processedMB = (csvText.length * i / totalLines) / (1024 * 1024);
        onProgress({ processedMB, uniqueCount: uniqueValues.size });
      }
    }
    
    // Final progress update
    if (onProgress) {
      const totalMB = csvText.length / (1024 * 1024);
      onProgress({ processedMB: totalMB, uniqueCount: uniqueValues.size });
    }
    
    const resultArray = Array.from(uniqueValues);
    const limitedResult = resultArray.length > MAX_UNIQUE_VALUES 
      ? resultArray.slice(0, MAX_UNIQUE_VALUES)
      : resultArray;
    
    console.log(`getUniqueValuesFromFile: Found ${uniqueValues.size.toLocaleString()} unique values for column "${column}"`);
    return limitedResult;
  } catch (error) {
    console.error('getUniqueValuesFromFile: Error:', error);
    return [];
  }
};
// Helper functions for CSV parsing
const detectDelimiterFromHeaders = (headerLine: string | string[]): string => {
  // If it's already an array, we can't detect delimiter - default to comma
  if (Array.isArray(headerLine)) {
    return ',';
  }
  
  // If it's a string (header line), detect delimiter
  const firstHeader = headerLine;
  const commaCount = (firstHeader.match(/,/g) || []).length;
  const semicolonCount = (firstHeader.match(/;/g) || []).length;
  const tabCount = (firstHeader.match(/\t/g) || []).length;
  if (semicolonCount > commaCount && semicolonCount > tabCount) return ';';
  if (tabCount > commaCount && tabCount > semicolonCount) return '\t';
  return ',';
};

const parseCsvLine = (line: string, delimiter: string): string[] => {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const char = line[i];
    const nextChar = line[i + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }
    if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
      i++;
      continue;
    }
    current += char;
    i++;
  }
  result.push(current.trim());
  return result;
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
      // Only warn once per file - check if we've already warned about this file
      const warningKey = `migration_warned_${file.id}`;
      if (!sessionStorage.getItem(warningKey)) {
      console.warn(
        "migrateLegacyCsvFile (IndexedDB): File",
        file.name,
        "has no data in IndexedDB or localStorage. Data may be lost."
      );
        sessionStorage.setItem(warningKey, 'true');
      }
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

// Get storage analysis - shows what can be cleaned without actually cleaning
export const analyzeStorage = async (): Promise<{
  csvFiles: Array<{ file: any; isDuplicate: boolean; duplicateGroup?: any[] }>;
  orphanedData: Array<{ key: string; fileId: string; size: number }>;
  valueInfoDuplicates: number;
  totalDuplicates: number;
  estimatedFreedSpace: number;
}> => {
  const result = {
    csvFiles: [] as Array<{ file: any; isDuplicate: boolean; duplicateGroup?: any[] }>,
    orphanedData: [] as Array<{ key: string; fileId: string; size: number }>,
    valueInfoDuplicates: 0,
    totalDuplicates: 0,
    estimatedFreedSpace: 0
  };

  try {
    // Analyze CSV files
    const saved = localStorage.getItem("db_csv_files");
    if (saved) {
      const files = JSON.parse(saved);
      if (Array.isArray(files)) {
        // Find duplicates by exact match (name, rowCount, and uploaded within 1 hour)
        const fileMap = new Map<string, any[]>();
        files.forEach((file: any) => {
          const key = `${file.name}_${file.rowCount || 0}_${file.uploadedAt || 0}`;
          if (!fileMap.has(key)) {
            fileMap.set(key, []);
          }
          fileMap.get(key)!.push(file);
        });

        // Also check for near-duplicates (same name and size, uploaded close together)
        const nearDuplicateMap = new Map<string, any[]>();
        files.forEach((file: any) => {
          const key = `${file.name}_${file.rowCount || 0}`;
          if (!nearDuplicateMap.has(key)) {
            nearDuplicateMap.set(key, []);
          }
          nearDuplicateMap.get(key)!.push(file);
        });

        files.forEach((file: any) => {
          const nearDupGroup = nearDuplicateMap.get(`${file.name}_${file.rowCount || 0}`) || [];
          const isDuplicate = nearDupGroup.length > 1;
          result.csvFiles.push({
            file,
            isDuplicate,
            duplicateGroup: isDuplicate ? nearDupGroup : undefined
          });
          if (isDuplicate) {
            result.totalDuplicates += nearDupGroup.length - 1; // Count extras
          }
        });
      }
    }

    // Analyze orphaned data
    try {
      const db = await initDB();
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const allKeys = await new Promise<string[]>((resolve, reject) => {
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result as string[]);
        request.onerror = () => reject(request.error);
      });

      const savedFiles = localStorage.getItem("db_csv_files");
      const files = savedFiles ? JSON.parse(savedFiles) : [];
      const validFileIds = new Set(Array.isArray(files) ? files.map((f: any) => `${CSV_DATA_PREFIX}${f.id}`) : []);

      for (const key of allKeys) {
        if (key.startsWith(CSV_DATA_PREFIX) && !validFileIds.has(key)) {
          try {
            const fileId = key.replace(CSV_DATA_PREFIX, '');
            const data = await new Promise<any>((resolve, reject) => {
              const getRequest = store.get(key);
              getRequest.onsuccess = () => resolve(getRequest.result);
              getRequest.onerror = () => reject(getRequest.error);
            });
            const size = data?.size || data?.csvText?.length || 0;
            result.orphanedData.push({ key, fileId, size });
            result.estimatedFreedSpace += size;
          } catch (error) {
            console.warn(`Failed to analyze orphaned data ${key}:`, error);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to analyze orphaned data:', error);
    }

    // Analyze value info duplicates
    try {
      const saved = localStorage.getItem("db_value_infos");
      if (saved) {
        const valueInfos = JSON.parse(saved);
        if (Array.isArray(valueInfos)) {
          const seen = new Map<string, number>();
          valueInfos.forEach((info: any, index: number) => {
            if (info.filterColumns && info.filterValues && info.type) {
              const filterKeys = Object.keys(info.filterValues)
                .filter(k => info.filterValues[k] != null)
                .sort();
              const filterValuesStr = filterKeys
                .map(k => `${k}=${String(info.filterValues[k]).trim()}`)
                .join('|');
              const criteriaKey = `${info.type}:${[...(info.filterColumns || [])].sort().join(',')}:${filterValuesStr}`;
              
              if (seen.has(criteriaKey)) {
                result.valueInfoDuplicates++;
              } else {
                seen.set(criteriaKey, index);
              }
            }
          });
        }
      }
    } catch (error) {
      console.warn('Failed to analyze value info duplicates:', error);
    }

    return result;
  } catch (error) {
    console.error('Storage analysis failed:', error);
    throw error;
  }
};

// Clean up specific items (safer - user selects what to remove)
export const cleanupSelectedItems = async (options: {
  removeCsvFileIds?: string[];
  removeOrphanedKeys?: string[];
  removeValueInfoDuplicates?: boolean;
}): Promise<{
  removedCsvFiles: number;
  removedOrphans: number;
  removedValueInfos: number;
  freedSpace: number;
}> => {
  let removedCsvFiles = 0;
  let removedOrphans = 0;
  let removedValueInfos = 0;
  let freedSpace = 0;

  try {
    // Remove selected CSV files
    if (options.removeCsvFileIds && options.removeCsvFileIds.length > 0) {
      const saved = localStorage.getItem("db_csv_files");
      if (saved) {
        const files = JSON.parse(saved);
        if (Array.isArray(files)) {
          const remainingFiles = files.filter((f: any) => !options.removeCsvFileIds!.includes(f.id));
          localStorage.setItem("db_csv_files", JSON.stringify(remainingFiles));
          removedCsvFiles = files.length - remainingFiles.length;

          // Delete data for removed files
          for (const fileId of options.removeCsvFileIds) {
            try {
              await deleteCsvData(fileId);
              const storageKey = `${CSV_DATA_PREFIX}${fileId}`;
              const localData = localStorage.getItem(storageKey);
              if (localData) {
                freedSpace += localData.length;
                localStorage.removeItem(storageKey);
              }
            } catch (error) {
              console.warn(`Failed to delete CSV file ${fileId}:`, error);
            }
          }
        }
      }
    }

    // Remove selected orphaned data
    if (options.removeOrphanedKeys && options.removeOrphanedKeys.length > 0) {
      const db = await initDB();
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      for (const key of options.removeOrphanedKeys) {
        try {
          // Get size before deleting
          const data = await new Promise<any>((resolve, reject) => {
            const getRequest = store.get(key);
            getRequest.onsuccess = () => resolve(getRequest.result);
            getRequest.onerror = () => reject(getRequest.error);
          });
          const size = data?.size || data?.csvText?.length || 0;
          freedSpace += size;

          await new Promise<void>((resolve, reject) => {
            const deleteRequest = store.delete(key);
            deleteRequest.onsuccess = () => resolve();
            deleteRequest.onerror = () => reject(deleteRequest.error);
          });
          removedOrphans++;
        } catch (error) {
          console.warn(`Failed to delete orphaned data ${key}:`, error);
        }
      }
    }

    // Remove value info duplicates
    if (options.removeValueInfoDuplicates) {
      const { removeDuplicateValueInfos } = await import('./chatApi');
      removeDuplicateValueInfos();
      // Count how many were removed (this is approximate)
      removedValueInfos = 1; // Flag that cleanup was done
    }

    // Clear cache
    csvDataCache.clear();

    return { removedCsvFiles, removedOrphans, removedValueInfos, freedSpace };
  } catch (error) {
    console.error('Selected cleanup failed:', error);
    throw error;
  }
};

// Migrate all localStorage CSV data to IndexedDB
export const migrateAllToIndexedDB = async (): Promise<{
  migrated: number;
  errors: number;
}> => {
  let migrated = 0;
  let errors = 0;

  try {
    const saved = localStorage.getItem("db_csv_files");
    if (!saved) return { migrated: 0, errors: 0 };
    
    const files = JSON.parse(saved);
    if (!Array.isArray(files)) return { migrated: 0, errors: 0 };

    for (const file of files) {
      if (!file.id) continue;

      try {
        // Check if already in IndexedDB
        const storageKey = `${CSV_DATA_PREFIX}${file.id}`;
        const db = await initDB();
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const existing = await new Promise<any>((resolve, reject) => {
          const request = store.get(storageKey);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });

        // If not in IndexedDB but in localStorage, migrate it
        if (!existing) {
          const localData = localStorage.getItem(storageKey);
          if (localData) {
            await saveCsvDataText(file.id, localData);
            migrated++;
            console.log(`Migrated ${file.name} to IndexedDB`);
          }
        }
      } catch (error) {
        console.error(`Failed to migrate ${file.name}:`, error);
        errors++;
      }
    }

    return { migrated, errors };
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
};

// Save CSVFile metadata to IndexedDB (without data arrays to save space)
export const saveCsvFileMetadata = async (csvFile: {
  id: string;
  name: string;
  headers: string[];
  rowCount?: number;
  uploadedAt: number;
  hasDuckDB?: boolean;
  tableName?: string;
  size?: number;
  type?: string;
}): Promise<void> => {
  try {
    const db = await initDB();
    const transaction = db.transaction([METADATA_STORE], "readwrite");
    const store = transaction.objectStore(METADATA_STORE);

    // Store only metadata, no data arrays
    const metadata = {
      id: csvFile.id,
      name: csvFile.name,
      headers: csvFile.headers,
      rowCount: csvFile.rowCount || 0,
      uploadedAt: csvFile.uploadedAt,
      hasDuckDB: csvFile.hasDuckDB || false,
      tableName: csvFile.tableName || null,
      size: csvFile.size || null,
      type: csvFile.type || null,
    };
    
    await new Promise<void>((resolve, reject) => {
      const request = store.put(metadata);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('saveCsvFileMetadata: Error saving metadata:', error);
    throw error;
  }
};

// Get all CSVFile metadata from IndexedDB
export const getAllCsvFileMetadata = async (): Promise<any[]> => {
  try {
    const db = await initDB();
    const transaction = db.transaction([METADATA_STORE], "readonly");
    const store = transaction.objectStore(METADATA_STORE);
    const index = store.index("uploadedAt");
    
    return new Promise<any[]>((resolve, reject) => {
      const request = index.getAll();
      request.onsuccess = () => {
        const files = request.result || [];
        // Sort by uploadedAt descending (newest first)
        files.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
        resolve(files);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('getAllCsvFileMetadata: Error loading metadata:', error);
    return [];
  }
};

// Delete CSVFile metadata from IndexedDB
export const deleteCsvFileMetadata = async (fileId: string): Promise<void> => {
  try {
    const db = await initDB();
    const transaction = db.transaction([METADATA_STORE], "readwrite");
    const store = transaction.objectStore(METADATA_STORE);
    
    await new Promise<void>((resolve, reject) => {
      const request = store.delete(fileId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('deleteCsvFileMetadata: Error deleting metadata:', error);
    throw error;
  }
};

// Save all CSVFile metadata (batch operation)
export const saveAllCsvFileMetadata = async (files: any[]): Promise<void> => {
  try {
    const db = await initDB();
    const transaction = db.transaction([METADATA_STORE], "readwrite");
    const store = transaction.objectStore(METADATA_STORE);
    
    // Clear existing metadata
    await new Promise<void>((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
    // Save all metadata (without data arrays)
    const metadataPromises = files.map(file => {
      const metadata = {
        id: file.id,
        name: file.name,
        headers: file.headers || [],
        rowCount: file.rowCount || 0,
        uploadedAt: file.uploadedAt || Date.now(),
        hasDuckDB: file.hasDuckDB || false,
        tableName: file.tableName || null,
      };
      return new Promise<void>((resolve, reject) => {
        const request = store.put(metadata);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });
    
    await Promise.all(metadataPromises);
  } catch (error) {
    console.error('saveAllCsvFileMetadata: Error saving metadata:', error);
    throw error;
  }
};
