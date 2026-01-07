import * as duckdb from '@duckdb/duckdb-wasm';

let db: any = null;
let initialized = false;
let initializationPromise: Promise<any> | null = null; // Prevent race conditions during init
const registeredFiles = new Map<string, { file: File | Blob; tableName: string }>();
const MAX_REGISTERED_FILES = 10; // Maximum files to keep registered

// Debug flag - set to true to see what's happening

/**
 * Force reset DuckDB when memory corruption is detected
 */
export async function resetDuckDB(): Promise<void> {
  console.log('🔄 Resetting DuckDB due to memory corruption...');

  // Close all connections if possible
  if (db) {
    try {
      await db.terminate();
    } catch (e) {
      // Ignore errors during termination
    }
  }

  // Clear state
  db = null;
  initialized = false;
  initializationPromise = null;
  registeredFiles.clear();

  console.log('✅ DuckDB reset complete');
}

/**
 * Timeout wrapper for async operations
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

/**
 * Hydrate registeredFiles map from OPFS DB tables at startup
 * This ensures the app knows about existing tables without re-registering
 */
async function hydrateRegisteredFilesFromOPFS(): Promise<void> {
  if (!db || !initialized) {
    return;
  }

  try {
    
    const conn = await db.connect();
    
    try {
      // Query all tables in the database
      const result = await conn.query("SHOW TABLES");
      
      let tableNames: string[] = [];
      if (result.toArray && typeof result.toArray === 'function') {
        const rows = result.toArray();
        tableNames = rows.map((row: any) => {
          // Table name might be in different fields depending on DuckDB version
          return row.get?.('name') || row.name || row[0] || '';
        }).filter((name: string) => name.startsWith('csv_'));
      } else if (Array.isArray(result)) {
        tableNames = result.map((row: any) => {
          return row.name || row[0] || '';
        }).filter((name: string) => name.startsWith('csv_'));
      }
      
      
      // For each table, extract the file ID and add to registeredFiles
      for (const tableName of tableNames) {
        // Extract file ID from table name (format: csv_<fileId with special chars replaced>)
        // We need to reverse-engineer the original file ID
        // This is tricky because we replaced special chars, but we can try to match with metadata
        
        // Check if we already have this table registered
        let alreadyRegistered = false;
        for (const [fileId, info] of registeredFiles.entries()) {
          if (info.tableName === tableName) {
            alreadyRegistered = true;
            break;
          }
        }
        
        if (alreadyRegistered) {
          continue;
        }
        
        // Try to find matching file in metadata
        const fileId = await findFileIdForTable(tableName);
        
        if (fileId) {
          // Mark as registered with null file - will be loaded from storage when actually needed
          // Using null instead of empty Blob() to make it clear this needs to be loaded
          registeredFiles.set(fileId, { 
            file: null as any, // Will be loaded from IndexedDB when needed
            tableName 
          });
        } else {
        }
      }
      
      
      // Sync metadata to ensure consistency
      await syncMetadataWithRegisteredFiles();
      
    } finally {
      await conn.close();
    }
  } catch (error) {
  }
}

/**
 * Find file ID for a given table name by checking metadata
 */
async function findFileIdForTable(tableName: string): Promise<string | null> {
  try {
    // First check in-memory metadata (localStorage)
    try {
      const saved = localStorage.getItem("db_csv_files");
      if (saved) {
        const files = JSON.parse(saved);
        if (Array.isArray(files)) {
          const file = files.find((f: any) => f.tableName === tableName);
          if (file?.id) {
            return file.id;
          }
        }
      }
    } catch (parseError) {
    }
    
    // Try IndexedDB metadata
    try {
      const { getAllCsvFileMetadata } = await import('./csvStorage');
      const metadataFiles = await getAllCsvFileMetadata();
      const file = metadataFiles.find((f: any) => f.tableName === tableName);
      if (file?.id) {
        return file.id;
      }
    } catch (e) {
      // Ignore
    }
    
    // If not found in metadata, try to extract from table name
    // Format: csv_<timestamp>_<random> with special chars replaced by _
    // This is best-effort only
    const match = tableName.match(/^csv_(\d+_[a-z0-9]+)$/);
    if (match) {
      return match[1].replace(/_/g, '-'); // Convert back underscores to hyphens
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Sync metadata (localStorage and IndexedDB) with registeredFiles map
 * Ensures hasDuckDB and tableName are set correctly
 */
async function syncMetadataWithRegisteredFiles(): Promise<void> {
  try {
    
    // Update localStorage metadata
    try {
      const saved = localStorage.getItem("db_csv_files");
      if (saved) {
        const files = JSON.parse(saved);
        if (Array.isArray(files)) {
          let updated = false;
          
          for (const file of files) {
            const registered = registeredFiles.get(file.id);
            if (registered && registered.tableName) {
              if (!file.hasDuckDB || file.tableName !== registered.tableName) {
                file.hasDuckDB = true;
                file.tableName = registered.tableName;
                updated = true;
              }
            }
          }
          
          if (updated) {
            localStorage.setItem("db_csv_files", JSON.stringify(files));
          }
        }
      }
    } catch (parseError) {
    }
    
    // Update IndexedDB metadata
    try {
      const { getAllCsvFileMetadata, saveCsvFileMetadata } = await import('./csvStorage');
      const metadataFiles = await getAllCsvFileMetadata();
      
      for (const file of metadataFiles) {
        const registered = registeredFiles.get(file.id);
        if (registered && registered.tableName) {
          if (!file.hasDuckDB || file.tableName !== registered.tableName) {
            await saveCsvFileMetadata({
              ...file,
              hasDuckDB: true,
              tableName: registered.tableName
            });
          }
        }
      }
    } catch (e) {
    }
    
  } catch (error) {
  }
}

// Clear a specific file from registered files
export function clearRegisteredFile(fileId: string): void {
  registeredFiles.delete(fileId);
}

// Clear all registered files
export function clearAllRegisteredFiles(): void {
  registeredFiles.clear();
}

// Get number of registered files
export function getRegisteredFilesCount(): number {
  return registeredFiles.size;
}

// Track file access times for LRU eviction
const fileAccessTimes = new Map<string, number>();

// Manage registered files size - remove least recently used (LRU) if over limit
function manageRegisteredFilesSize(): void {
  if (registeredFiles.size > MAX_REGISTERED_FILES) {
    // Find least recently used files
    const filesWithAccess = Array.from(registeredFiles.keys()).map(key => ({
      key,
      lastAccess: fileAccessTimes.get(key) || 0
    }));
    
    // Sort by last access time (oldest first)
    filesWithAccess.sort((a, b) => a.lastAccess - b.lastAccess);
    
    // Remove oldest files
    const numToRemove = registeredFiles.size - MAX_REGISTERED_FILES;
    for (let i = 0; i < numToRemove; i++) {
      const fileId = filesWithAccess[i].key;
      registeredFiles.delete(fileId);
      fileAccessTimes.delete(fileId);
    }
  }
}

// Mark file as accessed (for LRU tracking)
function markFileAccessed(fileId: string): void {
  fileAccessTimes.set(fileId, Date.now());
}

// Helper function to convert BigInt values to numbers/strings for JSON serialization
// Uses iterative approach for large arrays to prevent stack overflow
function convertBigIntToNumber(obj: any, visited: WeakSet<any> = new WeakSet()): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'bigint') {
    // Convert BigInt to number if it's within safe integer range, otherwise string
    if (obj <= Number.MAX_SAFE_INTEGER && obj >= Number.MIN_SAFE_INTEGER) {
      return Number(obj);
    }
    return obj.toString();
  }
  
  // Handle primitive types
  if (typeof obj !== 'object') {
    return obj;
  }
  
  // Check for circular references
  if (visited.has(obj)) {
    return '[Circular Reference]';
  }
  visited.add(obj);
  
  if (Array.isArray(obj)) {
    // For arrays, use iterative approach to avoid stack overflow
    const result: any[] = new Array(obj.length);
    for (let i = 0; i < obj.length; i++) {
      const item = obj[i];
      if (item === null || item === undefined) {
        result[i] = item;
      } else if (typeof item === 'bigint') {
        result[i] = item <= Number.MAX_SAFE_INTEGER && item >= Number.MIN_SAFE_INTEGER 
          ? Number(item) 
          : item.toString();
      } else if (typeof item === 'object') {
        result[i] = convertBigIntToNumber(item, visited);
      } else {
        result[i] = item;
      }
    }
    return result;
  }
  
  // Handle objects
  const converted: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      converted[key] = value;
    } else if (typeof value === 'bigint') {
      converted[key] = value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER 
        ? Number(value) 
        : value.toString();
    } else if (typeof value === 'object') {
      converted[key] = convertBigIntToNumber(value, visited);
    } else {
      converted[key] = value;
    }
  }
  return converted;
}

export async function initDuckDB() {
  // Return existing DB if already initialized
  if (db && initialized) {
    return db;
  }
  
  // If initialization is in progress, wait for it to complete
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization and store the promise
  initializationPromise = (async () => {
    try {
    // Import DuckDB module
    const duckdbModule = await import('@duckdb/duckdb-wasm');

    // Use local MVP bundle (compatible - works on all browsers)
    const workerURL = '/duckdb-browser-mvp.worker.js';
    const wasmURL = '/duckdb-mvp.wasm';


    // Use AsyncDuckDB - the actual export from the package
    const AsyncDuckDB = duckdbModule.AsyncDuckDB;
    if (!AsyncDuckDB) {
      throw new Error('AsyncDuckDB not found');
    }

    // Use the recommended pattern: Create Worker manually, then instantiate
    const ConsoleLogger = duckdbModule.ConsoleLogger;

    // Create logger with WARN level (level 1) - always create a logger if available
    const logger = ConsoleLogger ? new ConsoleLogger(1) : null;

    // Create Worker manually - must use local path, not CDN URL
    const worker = new Worker(workerURL, { type: 'module' });

    // Listen for worker errors
    worker.onerror = (error) => {
      console.error('❌ DuckDB Worker error:', error);
    };

    // Create AsyncDuckDB instance with logger and worker
    // Logger is required by the constructor
    if (!logger) {
      throw new Error('ConsoleLogger is required for DuckDB initialization');
    }
    db = new AsyncDuckDB(logger, worker);


    // Instantiate with WASM URL (with 60s timeout for large file)
    try {
      await withTimeout(
        db.instantiate(wasmURL),
        60000,
        'DuckDB WASM instantiation'
      );
    } catch (err) {
      console.error('❌ WASM instantiation failed:', err);
      console.error('Check browser console Network tab - is', wasmURL, 'loading?');
      throw err;
    }

    // Open (or create) a persistent database in OPFS so tables survive reloads (with 10s timeout)
    try {
      await withTimeout(
        (db as any).open({ path: 'opfs:/duckdb/main.db' }),
        10000,
        'DuckDB OPFS open'
      );
    } catch (openErr) {
      console.warn('⚠️ OPFS open failed, continuing without persistence:', openErr);
    }

    // Configure DuckDB for virtual file-based processing
    try {
      const conn = await db.connect();

      // Set temp directory to OPFS for spilling to disk
      await conn.query("SET temp_directory='opfs:/duckdb/temp'");

      // Relaxed memory limit since we're not materializing tables
      await conn.query("SET memory_limit='6GB'");

      // Disable insertion order preservation for better query performance
      await conn.query("SET preserve_insertion_order=false");

      // Use multiple threads for parallel query execution
      await conn.query("SET threads=4");

      await conn.close();
    } catch (configErr) {
    }


    initialized = true;

    // Hydrate registeredFiles from existing OPFS tables (with timeout to prevent hanging)
    try {
      await withTimeout(
        hydrateRegisteredFilesFromOPFS(),
        5000,
        'OPFS table hydration'
      );
    } catch (hydrateErr) {
    }
    
    return db;
    } catch (err) {
      console.error("DuckDB init failed:", err);
      db = null;
      initialized = false;
      throw err;
    } finally {
      // Clear the initialization promise when done (success or failure)
      initializationPromise = null;
    }
  })();
  
  return initializationPromise;
}

export async function runQuery(sql: string) {
  const db = await initDuckDB();
  const conn = await db.connect();
  try {
    const result = await conn.query(sql);
    return result;
      } finally {
        await conn.close();
  }
}

// Export function to check if file is registered in DuckDB
export function isFileRegisteredInDuckDB(csvId: string): boolean {
  return registeredFiles.has(csvId);
}

// Auto-register file if it's marked as having DuckDB but not in the Map
// This handles cases where the in-memory Map was cleared (page refresh, etc.)
async function ensureFileRegistered(csvId: string, file: File | Blob, tableName?: string): Promise<void> {
  if (!registeredFiles.has(csvId)) {
    const virtualTableName = tableName || `csv_${csvId.replace(/[^a-zA-Z0-9]/g, '_')}`;
    registeredFiles.set(csvId, { file, tableName: virtualTableName });
    manageRegisteredFilesSize();
  }
}

// Export function to get table name for a file
// Checks both in-memory map and localStorage metadata
// Can also derive table name from file ID if not found
export function getDuckDBTableName(csvId: string, deriveIfMissing: boolean = true): string | null {
  // First check in-memory map
  const registered = registeredFiles.get(csvId);
  if (registered?.tableName) {
    return registered.tableName;
  }
  
  // Fallback: check localStorage for file metadata
  try {
    const saved = localStorage.getItem("db_csv_files");
    if (saved) {
      const files = JSON.parse(saved);
      const file = Array.isArray(files) ? files.find((f: any) => f.id === csvId) : null;
      if (file?.tableName) {
        return file.tableName;
      }
      // If file exists but no tableName, and deriveIfMissing is true, derive it
      if (file && deriveIfMissing) {
        const cleanCsvId = csvId.replace(/[^a-zA-Z0-9]/g, '_');
        const derivedTableName = cleanCsvId.startsWith('csv_') ? cleanCsvId : `csv_${cleanCsvId}`;
        return derivedTableName;
      }
    }
  } catch (parseError) {
  }
  
  // Last resort: derive table name from file ID if deriveIfMissing is true
  if (deriveIfMissing) {
    const cleanCsvId = csvId.replace(/[^a-zA-Z0-9]/g, '_');
    const derivedTableName = cleanCsvId.startsWith('csv_') ? cleanCsvId : `csv_${cleanCsvId}`;
    return derivedTableName;
  }
  
  return null;
}

// Register a file in DuckDB's virtual file system
export async function registerFileInDuckDB(
  fileId: string,
  file: File | Blob,
  tableName?: string
): Promise<string> {
  if (!db || !initialized) {
    throw new Error('DuckDB not initialized');
  }

  const virtualTableName = tableName || `csv_${fileId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  
  try {
    // Store reference for later use
    registeredFiles.set(fileId, { file, tableName: virtualTableName });
    manageRegisteredFilesSize();
    
    return virtualTableName;
  } catch (error) {
    console.error('❌ Failed to register file in DuckDB:', error);
    throw error;
  }
}

// Initialize DuckDB (alias for compatibility)
export async function initializeDuckDB() {
  return await initDuckDB();
}

// Safe initialize with fallback
export async function safeInitializeDuckDB(): Promise<boolean> {
  try {
    await initDuckDB();
    return true;
  } catch (error) {
    return false;
  }
}

// Check if DuckDB is initialized
export function isDuckDBInitialized(): boolean {
  return initialized && db !== null;
}

// Process CSV files using DuckDB's native read_csv function
export async function processCSVWithDuckDB(
  file: File,
  onProgress?: (progress: { file: string; percent: number; rows?: number; message?: string }) => void,
  existingFileId?: string,  // Allow passing in the file ID from CSVSelector
  convertToParquet: boolean = true  // NEW: Allow skipping Parquet conversion
): Promise<{
  headers: string[];
  rowCount: number;
  data?: any[];
  fileBlob?: Blob;
  hasDuckDB: boolean;
  tableName?: string;
  fileId?: string;  // Return the fileId so CSVSelector can use it
}> {
  try {
    // Ensure DuckDB is initialized
    const db = await initDuckDB();
    
    if (!db) {
      throw new Error('DuckDB instance is not available');
    }
    
    // Verify worker is ready by testing a connection first
    let testConn;
    try {
      testConn = await db.connect();
      await testConn.query('SELECT 1 as test');
      await testConn.close();
    } catch (testError: any) {
      console.error('❌ DuckDB worker test failed:', testError);

      // If we get "memory access out of bounds", DuckDB is corrupted
      // This is a fatal error - throw and let the fallback handler deal with it
      if (testError?.message?.includes('memory access out of bounds') ||
          testError?.toString?.()?.includes('memory access out of bounds')) {
        console.error('❌ DuckDB memory corrupted - cannot recover in this session');
        throw new Error(`DuckDB memory corrupted: ${testError?.message || 'Unknown error'}. Please refresh the page.`);
      } else {
        throw new Error(`DuckDB worker not ready: ${testError?.message || 'Unknown error'}`);
      }
    }
    
    // Now proceed with actual connection
    const conn = await db.connect();
    const fileName = file.name || 'unknown';
    // CRITICAL FIX: Use existingFileId if provided, otherwise generate new one
    const fileId = existingFileId || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Generate table name from file ID
    // If fileId already starts with 'csv', don't add another prefix (avoid csv_csv_...)
    const cleanFileId = fileId.replace(/[^a-zA-Z0-9]/g, '_');
    const tableName = cleanFileId.startsWith('csv_') ? cleanFileId : `csv_${cleanFileId}`;
    
    onProgress?.({ file: fileName, percent: 0, message: 'Reading CSV with DuckDB...' });
    
    try {
      const fileSizeMB = file.size / (1024 * 1024);
      const fileSizeGB = file.size / (1024 * 1024 * 1024);

      onProgress?.({ file: fileName, percent: 5, message: 'Loading file into DuckDB...' });

      // Keep original filename safe but preserve it - only replace truly problematic chars
      const safeFileName = fileName.replace(/[<>:"|?*\\]/g, '_').replace(/\s+/g, '_');
      
      // PROPER FIX: Use DuckDB's registerFileHandle + insertCSVFromPath for streaming
      onProgress?.({ file: fileName, percent: 10, message: `Registering file with DuckDB...` });
      
      try {
        // Register the file handle with DuckDB - this allows DuckDB to read the file without loading it all into memory
        await db.registerFileHandle(safeFileName, file, 2, true); // 2 = BROWSER_FILEREADER protocol

        const escapedCsvFileName = safeFileName.replace(/'/g, "''");
        const escapedTableName = tableName.replace(/"/g, '""');

        if (convertToParquet) {
          onProgress?.({ file: fileName, percent: 20, message: 'Converting to Parquet format...' });

          // OPTIMIZATION: Convert to Parquet FIRST (before loading into table)
          // This compresses the data and reduces memory usage
          const parquetFileName = `${cleanFileId}.parquet`;
          const safeParquetName = parquetFileName.replace(/[<>:"|?*\\]/g, '_').replace(/\s+/g, '_');


          // Stream CSV directly to Parquet in OPFS (no intermediate table - saves memory!)
          const escapedParquetName = safeParquetName.replace(/'/g, "''");
          const opfsParquetPath = `opfs:/duckdb/${escapedParquetName}`;

          await conn.query(`
            COPY (
              SELECT * FROM read_csv('${escapedCsvFileName}', header=true, auto_detect=true, ignore_errors=true, sample_size=-1)
            ) TO '${opfsParquetPath}' (FORMAT PARQUET, COMPRESSION 'ZSTD')
          `);

          onProgress?.({ file: fileName, percent: 70, message: 'Loading from Parquet...' });

          // Now create table from the smaller, compressed Parquet file
          await conn.query(`DROP TABLE IF EXISTS "${escapedTableName}"`);
          await conn.query(`
            CREATE TABLE "${escapedTableName}" AS
            SELECT * FROM read_parquet('${opfsParquetPath}')
          `);

        } else {
          onProgress?.({ file: fileName, percent: 20, message: 'Loading CSV directly...' });


          // Create table directly from CSV without Parquet conversion
          await conn.query(`DROP TABLE IF EXISTS "${escapedTableName}"`);
          await conn.query(`
            CREATE TABLE "${escapedTableName}" AS
            SELECT * FROM read_csv('${escapedCsvFileName}', header=true, auto_detect=true, ignore_errors=true, sample_size=-1)
          `);

        }

        onProgress?.({ file: fileName, percent: 90, message: 'Verifying data...' });

      } catch (readError: any) {
        console.error('Failed to load CSV with native method:', readError);

        // Check if this is a malformed CSV error (quote errors, parse errors, etc.)
        const errorMessage = readError?.message || readError?.toString?.() || '';
        const isMalformedCSV =
          errorMessage.includes('quote should be followed by') ||
          errorMessage.includes('Invalid Input Error') ||
          errorMessage.includes('Error in file') ||
          errorMessage.includes('CSV Error') ||
          errorMessage.includes('Parser Error');

        if (isMalformedCSV) {
          // Malformed CSV file - skip it to prevent DuckDB corruption
          console.error(`⚠️ SKIPPING malformed CSV file "${fileName}":`, errorMessage);
          await conn.close();

          // Throw a user-friendly error that won't corrupt DuckDB
          throw new Error(`File "${fileName}" has malformed data and cannot be processed. ${errorMessage.substring(0, 200)}`);
        }

        // For other errors, try fallback
        await conn.close();
        return await processCSVWithDuckDBManual(file, fileId, tableName, onProgress);
      }

      // Get row count and headers
      onProgress?.({ file: fileName, percent: 92, message: 'Getting table info...' });
      
      // Materialize as a permanent table (persists in OPFS DB)
      try {
        const escapedTable = tableName.replace(/"/g, '""');
        await conn.query(`CREATE TABLE IF NOT EXISTS "${escapedTable}" AS SELECT * FROM ${tableName}`);
      } catch (e) {
        // Ignore if already materialized
      }

      const countResult = await conn.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      let rowCount = 0;
      
      if (countResult.toArray && typeof countResult.toArray === 'function') {
        const rows = countResult.toArray();
        rowCount = rows[0]?.get?.('count') || rows[0]?.count || rows[0]?.[0] || 0;
      } else if (Array.isArray(countResult)) {
        rowCount = countResult[0]?.count || countResult[0]?.[0] || 0;
      } else if (countResult && typeof countResult === 'object') {
        rowCount = countResult.count || countResult[0] || 0;
      }
      
      // Get headers from table schema
      const schemaResult = await conn.query(`DESCRIBE ${tableName}`);
      const headers: string[] = [];

      if (schemaResult.toArray && typeof schemaResult.toArray === 'function') {
        const schemaRows = schemaResult.toArray();
        schemaRows.forEach((row: any) => {
          const colName = row.get?.('column_name') || row.column_name || row[0];
          if (colName) headers.push(String(colName));
        });
      } else if (Array.isArray(schemaResult)) {
        schemaResult.forEach((row: any) => {
          const colName = row.column_name || row[0];
          if (colName) headers.push(String(colName));
        });
      }

      // Check if we have a malformed CSV where all columns ended up as a single comma-separated string
      if (headers.length === 1 && headers[0].includes(',')) {
        console.warn(`⚠️ Detected malformed CSV header: "${headers[0]}". This file may have delimiter issues.`);
        console.warn(`⚠️ Column names containing commas will appear as a single column in the group by dropdown.`);
        console.warn(`⚠️ Please check the source CSV file's delimiter and format.`);
      }
      
      onProgress?.({ 
        file: fileName, 
        percent: 100, 
        rows: rowCount,
        message: `CSV loaded: ${rowCount.toLocaleString()} rows, ${headers.length} columns` 
      });
      
      // Store file reference for later queries
      registeredFiles.set(fileId, { file, tableName });
      manageRegisteredFilesSize();
      
      await conn.close();
      
      return {
        headers,
        rowCount: Number(rowCount),
        data: [],
        fileBlob: file,
        hasDuckDB: true,
        tableName,
        fileId,  // NEW: Return the fileId
      };
    } catch (csvError: any) {
      await conn.close();
      // If native read_csv fails, fall back to manual processing
      return processCSVWithDuckDBManual(file, fileId, tableName, onProgress);
    }
  } catch (error) {
    console.error('DuckDB processing failed:', error);
    throw new Error(`DuckDB processing failed: ${error instanceof Error ? error.message : 'Unknown error'}. DuckDB is required for CSV processing.`);
  }
}

/**
 * Efficiently read only the CSV headers (first line) without loading entire file
 */
async function readCsvHeadersOnly(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const chunkSize = 64 * 1024; // Read first 64KB (more than enough for headers)
    
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const firstLineEnd = text.indexOf('\n');
        const firstLine = firstLineEnd > 0 ? text.substring(0, firstLineEnd) : text;
        
        // Parse headers from first line
        const rawHeaders = firstLine
          .replace(/\r$/, '') // Remove carriage return if present
          .split(',')
          .map(h => h.replace(/^"|"$/g, "").trim());
        
        if (rawHeaders.length === 0) {
          reject(new Error('CSV file has no headers'));
        } else {
          resolve(rawHeaders);
        }
      } catch (error) {
        reject(new Error(`Failed to parse CSV headers: ${error}`));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read CSV file'));
    };
    
    // Read only first chunk (much faster than reading entire file)
    const blob = file.slice(0, chunkSize);
    reader.readAsText(blob);
  });
}

// Fallback: Manual CSV processing with DuckDB
// Fallback: Manual CSV processing with DuckDB
async function processCSVWithDuckDBManual(
  file: File,
  fileId: string,
  tableName: string,
  onProgress?: (progress: { file: string; percent: number; rows?: number; message?: string }) => void
): Promise<{
  headers: string[];
  rowCount: number;
  data?: any[];
  fileBlob?: Blob;
  hasDuckDB: boolean;
  tableName?: string;
  fileId?: string;
}> {
  const db = await initDuckDB();
  const conn = await db.connect();
  const fileName = file.name || 'unknown';
  
  try {
    onProgress?.({ file: fileName, percent: 0, message: 'Reading CSV file...' });
    
    const text = await file.text();
    const lines = text.split(/\r?\n|\r/).filter(line => line.trim());
    if (lines.length < 2) {
      throw new Error('CSV file must have at least headers and one data row');
    }
    
    // Parse headers and handle empty column names
    const rawHeaders = lines[0].split(',').map(h => h.replace(/^"|"$/g, "").trim());
    
    // Generate valid column names for empty headers
    const headers = rawHeaders.map((h, idx) => {
      if (!h || h === '') {
        return `column_${idx + 1}`;
      }
      return h.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || `column_${idx + 1}`;
    });
    
    // Ensure all headers are unique
    const uniqueHeaders = headers.map((h, idx) => {
      let unique = h;
      let counter = 1;
      while (headers.slice(0, idx).includes(unique)) {
        unique = `${h}_${counter}`;
        counter++;
      }
      return unique;
    });
    
    onProgress?.({ file: fileName, percent: 10, message: 'Creating table in DuckDB...' });
    
    // Create or replace as a permanent table (persists in OPFS)
    try {
      const escapedTable = tableName.replace(/"/g, '""');
      await conn.query(`DROP TABLE IF EXISTS "${escapedTable}"`);
      const createTableQuery = `CREATE TABLE "${escapedTable}" (${uniqueHeaders.map(h => `"${h.replace(/"/g, '""')}" VARCHAR`).join(', ')})`;
      await conn.query(createTableQuery);
    } catch (e) {
      const createTableQuery = `CREATE TABLE ${tableName} (${uniqueHeaders.map(h => `"${h.replace(/"/g, '""')}" VARCHAR`).join(', ')})`;
      await conn.query(createTableQuery);
    }
    
    const dataLines = lines.slice(1);
    const BATCH_SIZE = 50000; // Reduced from 100k for better responsiveness
    const YIELD_INTERVAL = 5; // Yield every 5 batches
    let totalRows = 0;
    let batchCount = 0;
    
    onProgress?.({ file: fileName, percent: 15, message: 'Loading data into DuckDB...' });
    
    for (let i = 0; i < dataLines.length; i += BATCH_SIZE) {
      const batch = dataLines.slice(i, i + Math.min(BATCH_SIZE, dataLines.length - i));
      
      // Process batch values with better memory management
      const values = batch.map(line => {
        const values = line.split(',').map(v => {
          const cleaned = v.replace(/^"|"$/g, "").trim();
          return `'${cleaned.replace(/'/g, "''")}'`;
        });
        return `(${values.join(', ')})`;
      }).join(', ');
      
      if (values) {
        const insertQuery = `INSERT INTO ${tableName} VALUES ${values}`;
        await conn.query(insertQuery);
      }
      
      totalRows += batch.length;
      batchCount++;
      
      const percent = Math.min(15 + (i / dataLines.length) * 85, 99);
      onProgress?.({ 
        file: fileName, 
        percent, 
        rows: totalRows,
        message: `Loaded ${totalRows.toLocaleString()} rows...` 
      });
      
      // Yield to UI thread every N batches
      if (batchCount % YIELD_INTERVAL === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    
    registeredFiles.set(fileId, { file, tableName });
    manageRegisteredFilesSize();
    
    onProgress?.({ 
      file: fileName, 
      percent: 100, 
      rows: totalRows,
      message: `CSV loaded: ${totalRows.toLocaleString()} rows` 
    });
    
    await conn.close();
    
    return {
      headers,
      rowCount: totalRows,
      data: [],
      fileBlob: file,
      hasDuckDB: true,
      tableName,
      fileId,  // NEW: Return the fileId
    };
  } finally {
    await conn.close();
  }
}

// Query CSV data using DuckDB SQL
// Verify if a table exists in DuckDB
export async function verifyTableExists(tableName: string): Promise<boolean> {
  try {
    const db = await initDuckDB();
    const conn = await db.connect();
    try {
      // Try to query the table's schema
      await conn.query(`DESCRIBE ${tableName}`);
      await conn.close();
      return true;
    } catch (error) {
      await conn.close();
      return false;
    }
  } catch (error) {
    return false;
  }
}

/**
 * Query multiple CSV files and combine them using UNION ALL
 * This allows querying across multiple CSV files as if they were one dataset
 */
export async function queryCombinedCSVsWithDuckDB(
  csvIds: string[],
  filterColumns?: string[] | null,
  filterValues?: Record<string, string | string[] | null> | null,
  onProgress?: (progress: { percent: number; message?: string; rows?: number }) => void
): Promise<any[]> {
  if (csvIds.length === 0) {
    return [];
  }

  // Single file - use regular query
  if (csvIds.length === 1) {
    return queryCSVWithDuckDB(csvIds[0], filterColumns, filterValues, onProgress);
  }

  // Multiple files - combine using UNION ALL
  const db = await initDuckDB();
  const conn = await db.connect();

  try {
    onProgress?.({ percent: 10, message: `Combining ${csvIds.length} files...` });

    // Get table names for all CSV IDs
    const tableNames: string[] = [];
    for (const csvId of csvIds) {
      const cleanCsvId = csvId.replace(/[^a-zA-Z0-9]/g, '_');
      const tableName = cleanCsvId.startsWith('csv_') ? cleanCsvId : `csv_${cleanCsvId}`;
      tableNames.push(tableName);
    }

    // Build WHERE clause for filters
    let whereClause = '';
    const whereClauses: string[] = [];
    if (filterColumns && filterColumns.length > 0 && filterValues) {
      for (const column of filterColumns) {
        const value = filterValues[column];
        if (value !== null && value !== undefined) {
          const escapedColumn = `"${column.replace(/"/g, '""')}"`;
          if (Array.isArray(value)) {
            if (value.length > 0) {
              const valuesList = value.map(v => `'${String(v).replace(/'/g, "''")}'`).join(', ');
              whereClauses.push(`${escapedColumn} IN (${valuesList})`);
            }
          } else {
            const escapedValue = String(value).replace(/'/g, "''");
            whereClauses.push(`${escapedColumn} = '${escapedValue}'`);
          }
        }
      }
    }
    if (whereClauses.length > 0) {
      whereClause = ` WHERE ${whereClauses.join(' AND ')}`;
    }

    // Build UNION ALL query
    const unionQueries = tableNames.map(tableName => {
      const escapedTableName = `"${tableName.replace(/"/g, '""')}"`;
      return `SELECT * FROM ${escapedTableName}${whereClause}`;
    });
    const unionQuery = unionQueries.join(' UNION ALL ');

    onProgress?.({ percent: 50, message: 'Executing combined query...' });

    // Execute the query
    const result = await conn.query(unionQuery);

    onProgress?.({ percent: 80, message: 'Processing results...' });

    // Convert result to array
    let data: any[] = [];
    if (result.toArray && typeof result.toArray === 'function') {
      const rows = result.toArray();
      data = rows.map((row: any) => {
        const obj: any = {};
        const columns = result.schema.fields.map((f: any) => f.name);
        columns.forEach((col: string, idx: number) => {
          obj[col] = row.get?.(col) ?? row[idx] ?? null;
        });
        return obj;
      });
    } else if (Array.isArray(result)) {
      data = result;
    }

    // Convert BigInt values to regular numbers
    data = convertBigIntToNumber(data);

    onProgress?.({ percent: 100, message: 'Combined query complete', rows: data.length });

    return data;
  } catch (error) {
    console.error('❌ Failed to query combined CSVs with DuckDB:', error);
    throw new Error(`DuckDB combined query failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    await conn.close();
  }
}

export async function queryCSVWithDuckDB(
  csvId: string,
  filterColumns?: string[] | null,
  filterValues?: Record<string, string | string[] | null> | null,
  onProgress?: (progress: { percent: number; message?: string; rows?: number }) => void
): Promise<any[]> {
  const db = await initDuckDB();

  try {
    const { getAllCsvFileMetadata } = await import('./csvStorage');
    
    let file: any = null;
    try {
      const metadataFiles = await getAllCsvFileMetadata();
      file = metadataFiles.find((f: any) => f.id === csvId);
    } catch (e) {
    }
    
    if (!file) {
      const saved = localStorage.getItem("db_csv_files");
      if (saved) {
        const files = JSON.parse(saved);
        file = Array.isArray(files) ? files.find((f: any) => f.id === csvId) : null;
      }
    }
    
    if (!file) {
      throw new Error(`CSV file not found: ${csvId}`);
    }
    
    const registered = registeredFiles.get(csvId);
    let tableName: string | null = null;
    let fileBlob: Blob | File | null = null;
    
    if (registered) {
      tableName = registered.tableName;
      fileBlob = registered.file;
      markFileAccessed(csvId); // Update LRU tracking
    } else if (file.hasDuckDB && file.tableName) {
      // File was registered before but memory was cleared
      tableName = file.tableName;
      fileBlob = file.fileBlob || null;
      
      // Try to get blob from IndexedDB if not in memory
      if (!fileBlob) {
        try {
          const { initDB } = await import('./csvStorage');
          const dbInstance = await initDB();
          const transaction = dbInstance.transaction(['csvFiles'], 'readonly');
          const store = transaction.objectStore('csvFiles');
          const storageKey = `db_csv_data_${csvId}`;
          const result = await new Promise<any>((resolve, reject) => {
            const request = store.get(storageKey);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          if (result?.fileBlob) {
            fileBlob = result.fileBlob;
          } else if (result?.isBlob) {
            // Blob stored but needs to be loaded
            throw new Error(`File ${file.name || csvId} is stored as blob but not registered in DuckDB. Please re-upload the file to register it in DuckDB. DuckDB is required for all CSV operations.`);
          }
        } catch (e: any) {
          if (e.message && e.message.includes('stored as blob')) {
            throw e; // Re-throw the user-friendly error
          }
        }
      }
      
      // Re-register in memory if we have both tableName and fileBlob
      if (fileBlob && tableName) {
        registeredFiles.set(csvId, { file: fileBlob, tableName });
        manageRegisteredFilesSize();
      }
    }
    
    // Get connection early - we'll need it either way
    const conn = await db.connect();
    
    // ROBUST APPROACH: Always check if table actually exists in DuckDB (OPFS)
    // Don't trust in-memory registeredFiles - verify reality
    let tableExists = false;
    
    // Step 1: Determine what table name SHOULD be
    // CRITICAL: Always regenerate table name from file ID to fix old wrong names
    // Old versions created csv_csv_... (double prefix), so we regenerate to ensure consistency
    const cleanCsvId = csvId.replace(/[^a-zA-Z0-9]/g, '_');
    const correctTableName = cleanCsvId.startsWith('csv_') ? cleanCsvId : `csv_${cleanCsvId}`;
    
    // Check if saved table name is correct or needs fixing
    if (file.hasDuckDB && file.tableName) {
      if (file.tableName === correctTableName) {
        tableName = file.tableName;
      } else {
        // Old/wrong table name - use correct one and it will be updated
        tableName = correctTableName;
      }
    } else if (registeredFiles.has(csvId)) {
      const savedTableName = registeredFiles.get(csvId)!.tableName;
      if (savedTableName === correctTableName) {
        tableName = savedTableName;
      } else {
        tableName = correctTableName;
      }
    } else {
      tableName = correctTableName;
    }
    
    // Step 2: Check if table ACTUALLY exists in DuckDB (ground truth)
    // TypeScript safety: Ensure tableName is set
    if (!tableName) {
      tableName = correctTableName;
    }
    
    try {
      const escapedTableName = tableName.replace(/"/g, '""');
      await conn.query(`SELECT 1 FROM "${escapedTableName}" LIMIT 1`);
      // Table exists! Use it without re-registering
      tableExists = true;
      
      // OPTIMIZATION: Update progress to show table is ready (no loading needed)
      onProgress?.({ percent: 0, message: 'Table found, ready to query' });
      
      // Update in-memory registry for next time (optimization)
      if (!registeredFiles.has(csvId)) {
        registeredFiles.set(csvId, { file: fileBlob || null as any, tableName });
        markFileAccessed(csvId);
        manageRegisteredFilesSize();
      }
      
      // Clean up old wrong table name if it exists (migration from double prefix bug)
      if (file.tableName && file.tableName !== tableName) {
        try {
          const oldEscapedTableName = file.tableName.replace(/"/g, '""');
          await conn.query(`DROP TABLE IF EXISTS "${oldEscapedTableName}"`);
        } catch (e) {
          // Ignore - old table might not exist
        }
      }
    } catch (tableCheckError: any) {
      // Table doesn't exist - will need to register/create it
      tableExists = false;
      
      // Try to clean up old wrong table name if it exists
      if (file.tableName && file.tableName !== tableName) {
        try {
          const oldEscapedTableName = file.tableName.replace(/"/g, '""');
          await conn.query(`DROP TABLE IF EXISTS "${oldEscapedTableName}"`);
        } catch (e) {
          // Ignore - old table might not exist
        }
      }
    }
    
    // Only try to register if table doesn't exist
    if (!tableExists) {
      // Ensure tableName is set (should always be set by this point)
      if (!tableName) {
        tableName = correctTableName;
      }
      
      // OPTIMIZATION: Only load blob if table doesn't exist (saves memory and time)
      if (!fileBlob) {
        // Try to get blob from IndexedDB
        try {
          const { initDB } = await import('./csvStorage');
          const dbInstance = await initDB();
          const transaction = dbInstance.transaction(['csvFiles'], 'readonly');
          const store = transaction.objectStore('csvFiles');
          const storageKey = `db_csv_data_${csvId}`;
          const result = await new Promise<any>((resolve, reject) => {
            const request = store.get(storageKey);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          if (result?.fileBlob) {
            fileBlob = result.fileBlob;
            const sizeMB = (result.fileBlob.size / (1024 * 1024)).toFixed(1);
          } else {
            console.error(`❌ No fileBlob found in IndexedDB for key: ${storageKey}`, result);
          }
        } catch (e) {
          console.error('❌ Failed to retrieve file blob from IndexedDB:', e);
        }
      }
      
      // Also check if there's an OLD table with wrong name (csv_csv_...) that we should drop
      if (tableName && !tableName.startsWith('csv_csv_')) {
        const oldWrongName = `csv_${tableName}`;
        try {
          const escapedOldName = oldWrongName.replace(/"/g, '""');
          await conn.query(`DROP TABLE IF EXISTS "${escapedOldName}"`);
        } catch (e) {
          // Ignore - table probably doesn't exist
        }
      }
      
      if (!fileBlob) {
        await conn.close();
        throw new Error(`⚠️ Cannot load file "${file.name || csvId}" - blob data is not available in IndexedDB.\n\nThis usually happens when:\n1. The file was not properly uploaded\n2. Browser storage was cleared\n3. You're in a different browser/incognito mode\n\n💡 Solution: Please re-upload the CSV file.`);
      }
      
      // Generate table name if not available
      if (!tableName) {
        tableName = `csv_${csvId.replace(/[^a-zA-Z0-9]/g, '_')}`;
      }
      
      // Register the blob file - optimized for large files
      const fileName = file.name || `file_${csvId}.csv`;
      const safeFileName = fileName.replace(/[<>:"|?*\\]/g, '_').replace(/\s+/g, '_');
      const testEscapedFileName = safeFileName.replace(/'/g, "''");
      const escapedTableName = tableName.replace(/"/g, '""');
      
      // OPTIMIZATION: We already checked table existence above (line 1060-1099)
      // No need to check again - we know tableExists = false at this point
      // Proceed directly to table creation
      try {
          const fileSizeMB = (fileBlob.size / (1024 * 1024)).toFixed(1);
          const fileSizeGB = (fileBlob.size / (1024 * 1024 * 1024)).toFixed(2);
          
          onProgress?.({ percent: 5, message: `Loading ${fileSizeMB}MB file into memory...` });
          
          // Load file into memory
          const arrayBuffer = await fileBlob.arrayBuffer();
          onProgress?.({ percent: 15, message: 'Processing file buffer...' });
          
          const uint8Array = new Uint8Array(arrayBuffer);
          
          onProgress?.({ percent: 20, message: 'Registering file with DuckDB...' });
          await (db as any).registerFileBuffer(safeFileName, uint8Array);
          
          onProgress?.({ percent: 30, message: `Creating persistent table (${fileSizeMB}MB)...` });
          
          // Drop table if exists (clean slate)
          try {
            await conn.query(`DROP TABLE IF EXISTS "${escapedTableName}"`);
          } catch (e) {
            // Ignore
          }
          
          // Create table in OPFS (persists across sessions)
          // This is the slow part for large files (100MB+ can take 30+ seconds)
          const createStart = Date.now();
          const createTableQuery = `
            CREATE TABLE "${escapedTableName}" AS
            SELECT * FROM read_csv('${testEscapedFileName}', header=true, auto_detect=true)
          `;
          await conn.query(createTableQuery);
          const createTime = ((Date.now() - createStart) / 1000).toFixed(1);
          
          onProgress?.({ percent: 50, message: `Table created (${createTime}s)` });
          
          // Verify table exists
          try {
            const verifyResult = await conn.query(`SELECT COUNT(*) as cnt FROM "${escapedTableName}" LIMIT 1`);
          } catch (verifyError) {
          }
        } catch (registerError: any) {
          console.error(`❌ Failed to create table in DuckDB:`, registerError);
          await conn.close();
          
          // Provide helpful error message
          const errorMsg = registerError.message || 'Unknown error';
          throw new Error(
            `❌ Failed to create table for file "${file.name || csvId}"\n\n` +
            `Error: ${errorMsg}\n\n` +
            `💡 Possible solutions:\n` +
            `1. Refresh the page and try again\n` +
            `2. Re-upload the CSV file\n` +
            `3. Check browser console for detailed error\n` +
            `4. If file is very large (>100MB), it may take several minutes`
          );
      }
      
      // Update file metadata in storage to mark as registered
      try {
        const { getAllCsvFileMetadata, saveCsvFileMetadata } = await import('./csvStorage');
        const metadataFiles = await getAllCsvFileMetadata();
        const fileToUpdate = metadataFiles.find((f: any) => f.id === csvId);
        if (fileToUpdate) {
          fileToUpdate.hasDuckDB = true;
          fileToUpdate.tableName = tableName;
          await saveCsvFileMetadata(fileToUpdate);
        } else {
        }
      } catch (e) {
      }
      
      // CRITICAL: Update in-memory registry so next query is instant
      registeredFiles.set(csvId, { file: fileBlob, tableName });
      markFileAccessed(csvId);
      manageRegisteredFilesSize();
    }
    
    // At this point, table is guaranteed to exist (either existed before or was just created)
    // Ensure tableName is set before proceeding with query
    if (!tableName) {
      const cleanCsvId = csvId.replace(/[^a-zA-Z0-9]/g, '_');
      tableName = cleanCsvId.startsWith('csv_') ? cleanCsvId : `csv_${cleanCsvId}`;
    }
    const finalEscapedTableName = tableName.replace(/"/g, '""');
    
    // Execute the query
    try {
      onProgress?.({ percent: 0, message: 'Building query...' });
      
      const whereConditions: string[] = [];
      
      if (filterColumns && filterColumns.length > 0 && filterValues) {
        filterColumns.forEach(column => {
          const filterValue = filterValues[column];
          if (!filterValue || filterValue === '__SELECT_ALL__') {
            return;
          }

          const escapedColumn = `"${column.replace(/"/g, '""')}"`;

          if (Array.isArray(filterValue)) {
            // Check if array contains "(null)" - need to handle separately
            const hasNull = filterValue.some(v => String(v) === '(null)');
            const nonNullValues = filterValue.filter(v => String(v) !== '(null)');

            if (hasNull && nonNullValues.length > 0) {
              // Include both NULL and specific values
              const values = nonNullValues.map(v => `'${String(v).replace(/'/g, "''")}'`).join(', ');
              whereConditions.push(`(${escapedColumn} IN (${values}) OR ${escapedColumn} IS NULL)`);
            } else if (hasNull) {
              // Only NULL values
              whereConditions.push(`${escapedColumn} IS NULL`);
            } else {
              // Only non-NULL values
              const values = filterValue.map(v => `'${String(v).replace(/'/g, "''")}'`).join(', ');
              whereConditions.push(`${escapedColumn} IN (${values})`);
            }
          } else {
            // Single value
            if (String(filterValue) === '(null)') {
              whereConditions.push(`${escapedColumn} IS NULL`);
            } else {
              const value = `'${String(filterValue).replace(/'/g, "''")}'`;
              whereConditions.push(`${escapedColumn} = ${value}`);
            }
          }
        });
      }
      
      const whereClause = whereConditions.length > 0 
        ? `WHERE ${whereConditions.join(' AND ')}`
        : '';
      
      const query = `SELECT * FROM "${finalEscapedTableName}" ${whereClause}`;
      
      onProgress?.({ percent: 30, message: 'Executing query...' });
      
      const result = await conn.query(query);
      let rows: any[] = [];
      
      if (result.toArray && typeof result.toArray === 'function') {
        const rawRows = result.toArray();
        
        // Process rows with yielding for large result sets
        const CHUNK_SIZE = 1000;
        rows = new Array(rawRows.length);
        
        for (let i = 0; i < rawRows.length; i += CHUNK_SIZE) {
          const chunk = rawRows.slice(i, i + CHUNK_SIZE);
          
          for (let j = 0; j < chunk.length; j++) {
            const row = chunk[j];
            const json: any = {};
            
            if (row.toJSON && typeof row.toJSON === 'function') {
              const rowData = row.toJSON();
              if (typeof rowData === 'object' && rowData !== null) {
                Object.assign(json, rowData);
              }
            } else if (row.get && typeof row.get === 'function') {
              const columnNames = result.schema?.fields?.map((f: any) => f.name) || [];
              columnNames.forEach((col: string) => {
                json[col] = row.get(col);
              });
            } else if (typeof row === 'object' && row !== null) {
              Object.assign(json, row);
            }
            
            rows[i + j] = convertBigIntToNumber(json);
          }
          
          // Yield to UI thread every chunk
          if (i + CHUNK_SIZE < rawRows.length) {
            await new Promise(resolve => setTimeout(resolve, 0));
            
            // Update progress
            const percent = 30 + Math.floor((i / rawRows.length) * 70);
            onProgress?.({ percent, message: `Processing ${i + chunk.length} of ${rawRows.length} rows...` });
          }
        }
      } else if (Array.isArray(result)) {
        // Process with yielding
        const CHUNK_SIZE = 1000;
        rows = new Array(result.length);
        
        for (let i = 0; i < result.length; i += CHUNK_SIZE) {
          const chunk = result.slice(i, i + CHUNK_SIZE);
          
          for (let j = 0; j < chunk.length; j++) {
            rows[i + j] = convertBigIntToNumber(chunk[j]);
          }
          
          if (i + CHUNK_SIZE < result.length) {
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
      }
      
      onProgress?.({ percent: 100, message: 'Query completed', rows: rows.length });
      
      return rows;
    } catch (queryError) {
      // Close connection on error
      try {
        await conn.close();
      } catch (closeError) {
        // Ignore
      }
      throw queryError;
    } finally {
      try {
        await conn.close();
      } catch (closeError) {
        // Ignore
      }
    }
  } catch (error) {
    console.error('❌ DuckDB query failed:', error);
    // Don't attempt fallback for blob files - they require DuckDB
    // Fallback is only for text-based CSV files stored in IndexedDB
    const { getCsvDataRows, getAllCsvFileMetadata } = await import('./csvStorage');
    try {
      const metadataFiles = await getAllCsvFileMetadata();
      const file = metadataFiles.find((f: any) => f.id === csvId);
      if (file) {
        // Check if this is a blob file - if so, don't try fallback as it will recurse
        // Blob files are marked with hasDuckDB flag and need DuckDB for all operations
        const storageKey = `db_csv_data_${csvId}`;
        const { initDB } = await import('./csvStorage');
        const dbInstance = await initDB();
        const transaction = dbInstance.transaction(['csvFiles'], 'readonly');
        const store = transaction.objectStore('csvFiles');
        const result = await new Promise<any>((resolve, reject) => {
          const request = store.get(storageKey);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        
        // If it's a blob file, don't attempt fallback - just throw clear error
        if (result?.isBlob && result?.fileBlob) {
          const fileSizeMB = (result.fileBlob.size / (1024 * 1024)).toFixed(1);
          throw new Error(`File ${file.name || csvId} (${fileSizeMB}MB) is stored as blob and requires DuckDB, but DuckDB query failed. Please try refreshing the page or re-uploading the file. Original error: ${error instanceof Error ? error.message : String(error)}`);
        }
        
        // Not a blob file - safe to try text-based fallback
        return await getCsvDataRows(file, undefined, true);
      }
    } catch (fallbackError) {
      // If fallback also failed, try localStorage as last resort
      try {
        const saved = localStorage.getItem("db_csv_files");
        if (saved) {
          const files = JSON.parse(saved);
          const file = Array.isArray(files) ? files.find((f: any) => f.id === csvId) : null;
          if (file) {
            return await getCsvDataRows(file, undefined, true);
          }
        }
      } catch (parseError) {
      }
      // Re-throw the fallback error if it's more informative
      if (fallbackError instanceof Error && fallbackError.message.includes('blob')) {
        throw fallbackError;
      }
    }
    throw error;
  }
}

// Execute raw SQL query on DuckDB CSV table
// Execute raw SQL query on DuckDB CSV table
/**
 * Validate WHERE clause to prevent SQL injection
 */
function isValidWhereClause(clause: string): boolean {
  // Check for dangerous SQL keywords that could modify data
  const dangerous = /;\s*(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|EXEC|EXECUTE|GRANT|REVOKE)/i;
  if (dangerous.test(clause)) {
    console.error('Blocked dangerous SQL in WHERE clause:', clause);
    return false;
  }

  // Check for comment injection attempts
  if (clause.includes('--') || clause.includes('/*') || clause.includes('*/')) {
    console.error('Blocked SQL comment in WHERE clause:', clause);
    return false;
  }

  return true;
}

/**
 * Sanitize ORDER BY clause to only allow safe column names and directions
 */
function sanitizeOrderBy(orderBy: string): string | null {
  // Match pattern: "column_name ASC|DESC" or just "column_name"
  // Allow multiple columns separated by comma
  const columns = orderBy.split(',').map(col => col.trim());

  const sanitized = columns.map(col => {
    const match = col.match(/^"?([a-zA-Z0-9_]+)"?\s*(ASC|DESC)?$/i);
    if (!match) return null;

    const columnName = match[1].replace(/"/g, '""');
    const direction = match[2] ? ` ${match[2].toUpperCase()}` : '';

    return `"${columnName}"${direction}`;
  });

  if (sanitized.some(col => col === null)) {
    console.error('Invalid ORDER BY clause:', orderBy);
    return null;
  }

  return sanitized.join(', ');
}

/**
 * Fast preview query - reads directly from OPFS Parquet without loading from IndexedDB
 * Use this for quick data previews to avoid slow IndexedDB blob loading
 */
export async function queryParquetDirect(
  csvId: string,
  limit: number = 500,
  whereClause?: string,
  orderBy?: string
): Promise<any[]> {
  const db = await initDuckDB();
  const conn = await db.connect();

  // Validate and sanitize limit (prevent DOS attacks with huge limits)
  const safeLimit = Math.max(1, Math.min(limit, 100000));
  if (limit !== safeLimit) {
  }

  // Validate WHERE clause to prevent SQL injection
  if (whereClause && !isValidWhereClause(whereClause)) {
    throw new Error('Invalid WHERE clause: potentially unsafe SQL detected');
  }

  // Sanitize ORDER BY clause
  let sanitizedOrderBy: string | null = null;
  if (orderBy) {
    sanitizedOrderBy = sanitizeOrderBy(orderBy);
    if (!sanitizedOrderBy) {
      throw new Error('Invalid ORDER BY clause: must be valid column name(s) with optional ASC/DESC');
    }
  }

  // Construct OPFS Parquet path (csvId already has csv- prefix, just clean it)
  const parquetName = `${csvId.replace(/[^a-zA-Z0-9]/g, '_')}.parquet`;
  const opfsPath = `opfs:/duckdb/${parquetName}`;

  // Build SQL query with validated inputs
  let sql = `SELECT * FROM read_parquet('${opfsPath}')`;
  if (whereClause) {
    sql += ` WHERE ${whereClause}`;
  }
  if (sanitizedOrderBy) {
    sql += ` ORDER BY ${sanitizedOrderBy}`;
  }
  sql += ` LIMIT ${safeLimit}`;

  try {
    // Query directly from Parquet - no IndexedDB loading needed
    const result = await conn.query(sql);
    return result.toArray().map((row: any) => row.toJSON());
  } catch (error: any) {
    // Fallback: Try querying from table if it exists (still faster than IndexedDB)
    try {
      // Don't add csv_ prefix - csvId already has it
      const tableName = csvId.replace(/[^a-zA-Z0-9]/g, '_');
      const escapedTableName = tableName.replace(/"/g, '""');

      // Build SQL with table instead of Parquet (reuse validated clauses)
      let tableSql = `SELECT * FROM "${escapedTableName}"`;
      if (whereClause) {
        tableSql += ` WHERE ${whereClause}`;
      }
      if (sanitizedOrderBy) {
        tableSql += ` ORDER BY ${sanitizedOrderBy}`;
      }
      tableSql += ` LIMIT ${safeLimit}`;

      const result = await conn.query(tableSql);
      return result.toArray().map((row: any) => row.toJSON());
    } catch (tableError: any) {
      // Both Parquet and table failed - will fall back to IndexedDB
      throw error;
    }
  } finally {
    await conn.close();
  }
}

export async function executeDuckDBSql(
  csvId: string,
  sqlQuery: string,
  filterColumns?: string[] | null,
  filterValues?: Record<string, string | string[] | null> | null
): Promise<any[]> {
  const db = await initDuckDB();

  try {
    const { getAllCsvFileMetadata } = await import('./csvStorage');
    const metadataFiles = await getAllCsvFileMetadata();
    let file = metadataFiles.find((f: any) => f.id === csvId);
    
    if (!file) {
      const saved = localStorage.getItem("db_csv_files");
      if (saved) {
        const files = JSON.parse(saved);
        file = Array.isArray(files) ? files.find((f: any) => f.id === csvId) : null;
      }
    }
    
    if (!file) {
      throw new Error(`CSV file not found: ${csvId}`);
    }
    
    const registered = registeredFiles.get(csvId);
    let fileBlob: Blob | File | null = null;
    
    // Determine table name - always ensure we have one
    let tableName: string;
    if (registered?.tableName) {
      tableName = registered.tableName;
      fileBlob = registered.file;
    } else if (file.tableName) {
      tableName = file.tableName;
    } else {
      // Generate table name from file ID if not available
      tableName = `csv_${csvId.replace(/[^a-zA-Z0-9]/g, '_')}`;
    }
    
    // Try to get file blob from storage if not already in memory
    if (!fileBlob) {
      try {
        const { initDB } = await import('./csvStorage');
        const dbInstance = await initDB();
        const transaction = dbInstance.transaction(['csvFiles'], 'readonly');
        const store = transaction.objectStore('csvFiles');
        const storageKey = `db_csv_data_${csvId}`;
        const result = await new Promise<any>((resolve, reject) => {
          const request = store.get(storageKey);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        if (result?.fileBlob) {
          const loadedBlob: Blob = result.fileBlob;
          fileBlob = loadedBlob;
          registeredFiles.set(csvId, { file: loadedBlob, tableName });
          manageRegisteredFilesSize();
        } else if (result?.csvText) {
          // File stored as text - create blob from it
          const createdBlob = new Blob([result.csvText], { type: 'text/csv' });
          fileBlob = createdBlob;
          registeredFiles.set(csvId, { file: createdBlob, tableName });
          manageRegisteredFilesSize();
        } else if (result?.data && Array.isArray(result.data)) {
          // File stored as data array - convert to CSV and create blob
          const { stringifyCsv } = await import('./csvUtils');
          const headers = file.headers || (result.data[0] ? Object.keys(result.data[0]) : []);
          const csvText = stringifyCsv(headers, result.data);
          const createdBlob = new Blob([csvText], { type: 'text/csv' });
          fileBlob = createdBlob;
          registeredFiles.set(csvId, { file: createdBlob, tableName });
          manageRegisteredFilesSize();
        }
      } catch (e) {
      }
    }
    
    if (!fileBlob) {
      throw new Error(`CSV file ${file.name} data not found in storage. Please re-upload the file.`);
    }
  
    const conn = await db.connect();
    
    // CRITICAL: Ensure table exists on this connection (tables persist across connections)
    try {
      const escapedTableName = tableName.replace(/"/g, '""');
      await conn.query(`SELECT 1 FROM "${escapedTableName}" LIMIT 1`);
      // Table exists, continue
    } catch (e) {
      // Table doesn't exist - recreate it if we have fileBlob
      if (fileBlob) {
        const timestamp = new Date().toISOString();
        try {
          const fileName = file.name || `file_${csvId}.csv`;
          const safeFileName = fileName.replace(/[<>:"|?*\\]/g, '_').replace(/\s+/g, '_');
          const arrayBuffer = await fileBlob.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          
          // Re-register file
          await (db as any).registerFileBuffer(safeFileName, uint8Array);
          
          // Test file access
          const testEscapedFileName = safeFileName.replace(/'/g, "''");
          await conn.query(`SELECT COUNT(*) as count FROM read_csv('${testEscapedFileName}', header=true, auto_detect=true) LIMIT 1`);
          
          // Drop and recreate table
          const escapedTableName = tableName.replace(/"/g, '""');
          try {
            await conn.query(`DROP TABLE IF EXISTS "${escapedTableName}"`);
          } catch (dropError) {
            // Ignore
          }
          
          const createTableQuery = `
            CREATE TABLE "${escapedTableName}" AS
            SELECT * FROM read_csv('${testEscapedFileName}', header=true, auto_detect=true)
          `;
          await conn.query(createTableQuery);
          
          // Update registered files map
          registeredFiles.set(csvId, { file: fileBlob, tableName });
          manageRegisteredFilesSize();
        } catch (recreateError: any) {
          console.error(`executeDuckDBSql: Failed to recreate table:`, recreateError);
          await conn.close();
          throw new Error(`Table ${tableName} does not exist and could not be recreated: ${recreateError?.message || 'Unknown error'}`);
        }
      } else {
        await conn.close();
        throw new Error(`Table ${tableName} does not exist and file blob is not available to recreate it.`);
      }
    }
  
    try {
      let finalQuery = sqlQuery.trim();

      // Replace common table name placeholders with actual table name
      // AI might use: csvData, data, csv_data, csvdata, CSV_DATA, etc.
      // We need to replace these with the actual DuckDB table name
      const escapedTableName = `"${tableName.replace(/"/g, '""')}"`;

      // Use word boundaries to avoid replacing column names that contain these words
      // Match case-insensitive, but preserve the rest of the query
      // CRITICAL: Replace in all SQL contexts, not just FROM/JOIN
      finalQuery = finalQuery.replace(/\bFROM\s+(csvData|csvdata|CSVDATA|csv_data|CSV_DATA|data|DATA)\b/gi, `FROM ${escapedTableName}`);
      finalQuery = finalQuery.replace(/\bJOIN\s+(csvData|csvdata|CSVDATA|csv_data|CSV_DATA|data|DATA)\b/gi, `JOIN ${escapedTableName}`);
      finalQuery = finalQuery.replace(/\bDESCRIBE\s+(csvData|csvdata|CSVDATA|csv_data|CSV_DATA|data|DATA)\b/gi, `DESCRIBE ${escapedTableName}`);
      finalQuery = finalQuery.replace(/\bINTO\s+(csvData|csvdata|CSVDATA|csv_data|CSV_DATA|data|DATA)\b/gi, `INTO ${escapedTableName}`);
      finalQuery = finalQuery.replace(/\bUPDATE\s+(csvData|csvdata|CSVDATA|csv_data|CSV_DATA|data|DATA)\b/gi, `UPDATE ${escapedTableName}`);
      finalQuery = finalQuery.replace(/\bTABLE\s+(csvData|csvdata|CSVDATA|csv_data|CSV_DATA|data|DATA)\b/gi, `TABLE ${escapedTableName}`);
      

      if (filterColumns && filterColumns.length > 0 && filterValues) {
        const whereConditions: string[] = [];
        filterColumns.forEach(column => {
          const filterValue = filterValues[column];
          if (!filterValue || filterValue === '__SELECT_ALL__') {
            return;
          }

          const escapedColumn = `"${column.replace(/"/g, '""')}"`;

          if (Array.isArray(filterValue)) {
            // Check if array contains "(null)" - need to handle separately
            const hasNull = filterValue.some(v => String(v) === '(null)');
            const nonNullValues = filterValue.filter(v => String(v) !== '(null)');

            if (hasNull && nonNullValues.length > 0) {
              // Include both NULL and specific values
              const values = nonNullValues.map(v => `'${String(v).replace(/'/g, "''")}'`).join(', ');
              whereConditions.push(`(${escapedColumn} IN (${values}) OR ${escapedColumn} IS NULL)`);
            } else if (hasNull) {
              // Only NULL values
              whereConditions.push(`${escapedColumn} IS NULL`);
            } else {
              // Only non-NULL values
              const values = filterValue.map(v => `'${String(v).replace(/'/g, "''")}'`).join(', ');
              whereConditions.push(`${escapedColumn} IN (${values})`);
            }
          } else {
            // Single value
            if (String(filterValue) === '(null)') {
              whereConditions.push(`${escapedColumn} IS NULL`);
            } else {
              const value = `'${String(filterValue).replace(/'/g, "''")}'`;
              whereConditions.push(`${escapedColumn} = ${value}`);
            }
          }
        });
        
        if (whereConditions.length > 0) {
          const hasWhere = /WHERE\s+/i.test(finalQuery);
          if (hasWhere) {
            // Query already has WHERE clause - wrap existing conditions in parentheses and AND with filters
            // This ensures filter conditions are applied correctly
            // Example: "WHERE skill = 'Attack'" becomes "WHERE (match_id = 'xxx') AND (skill = 'Attack')"
            // CRITICAL: Match GROUP BY, ORDER BY, etc. with word boundaries to avoid breaking syntax
            finalQuery = finalQuery.replace(/WHERE\s+(.+?)(\s+ORDER\s+BY\s+|\s+GROUP\s+BY\s+|\s+LIMIT\s+|\s+HAVING\s+|$)/i,
              (match, conditions, suffix) => {
                return `WHERE (${whereConditions.join(' AND ')}) AND (${conditions.trim()})${suffix}`;
              });
          } else {
            // Query has no WHERE clause - need to insert WHERE before ORDER/GROUP/LIMIT/HAVING
            const hasFrom = /FROM\s+/i.test(finalQuery);
            if (!hasFrom) {
              finalQuery += ` FROM ${escapedTableName}`;
            }
            
            // CRITICAL FIX: Insert WHERE before ORDER BY, GROUP BY, LIMIT, or HAVING
            // Check if query has any of these clauses (use word boundaries to match full keywords)
            const clauseMatch = finalQuery.match(/(\s+ORDER\s+BY\s+|\s+GROUP\s+BY\s+|\s+LIMIT\s+|\s+HAVING\s+)/i);
            if (clauseMatch) {
              // Insert WHERE before the first clause
              const clausePosition = clauseMatch.index!;
              finalQuery = finalQuery.slice(0, clausePosition) + 
                           ` WHERE ${whereConditions.join(' AND ')}` + 
                           finalQuery.slice(clausePosition);
            } else {
              // No clauses, append WHERE at the end
              finalQuery += ` WHERE ${whereConditions.join(' AND ')}`;
            }
          }

        }
      } else {
        const hasFrom = /FROM\s+/i.test(finalQuery);
        if (!hasFrom && /SELECT\s+/i.test(finalQuery)) {
          finalQuery += ` FROM ${escapedTableName}`;
        }
      }
      
      
      const result = await conn.query(finalQuery);
      let rows: any[] = [];
      
      if (result.toArray && typeof result.toArray === 'function') {
        const rawRows = result.toArray();
        
        // Adaptive processing: optimize for both small and large datasets
        const totalRows = rawRows.length;
        rows = new Array(totalRows);
        
        // Extract column names once (reused in processing)
        const columnNames = result.schema?.fields?.map((f: any) => f.name) || [];
        
        if (totalRows < 1000) {
          // FAST PATH: Small datasets (<1k rows) - no chunking, no yielding
          for (let i = 0; i < totalRows; i++) {
            const row = rawRows[i];
            const json: any = {};
            
            if (row.toJSON && typeof row.toJSON === 'function') {
              const rowData = row.toJSON();
              if (typeof rowData === 'object' && rowData !== null) {
                Object.assign(json, rowData);
              }
            } else if (row.get && typeof row.get === 'function') {
              for (const col of columnNames) {
                json[col] = row.get(col);
              }
            } else if (typeof row === 'object') {
              Object.assign(json, row);
            }
            
            rows[i] = convertBigIntToNumber(json);
          }
        } else {
          // CHUNKED PATH: Large datasets - adaptive chunking and yielding
          // Larger chunks for medium datasets, smaller for huge ones
          const CHUNK_SIZE = totalRows > 50000 ? 500 : 1000;
          
          for (let i = 0; i < totalRows; i += CHUNK_SIZE) {
            const end = Math.min(i + CHUNK_SIZE, totalRows);
            
            for (let j = i; j < end; j++) {
              const row = rawRows[j];
              const json: any = {};
              
              if (row.toJSON && typeof row.toJSON === 'function') {
                const rowData = row.toJSON();
                if (typeof rowData === 'object' && rowData !== null) {
                  Object.assign(json, rowData);
                }
              } else if (row.get && typeof row.get === 'function') {
                for (const col of columnNames) {
                  json[col] = row.get(col);
                }
              } else if (typeof row === 'object') {
                Object.assign(json, row);
              }
              
              rows[j] = convertBigIntToNumber(json);
            }
            
            // Yield to UI thread to keep responsive
            if (end < totalRows) {
              await new Promise(resolve => setTimeout(resolve, 0));
            }
          }
        }
      } else if (Array.isArray(result)) {
        // Adaptive processing for array results
        const totalRows = result.length;
        rows = new Array(totalRows);
        
        if (totalRows < 1000) {
          // FAST PATH: Small datasets - process all at once
          for (let i = 0; i < totalRows; i++) {
            rows[i] = convertBigIntToNumber(result[i]);
          }
        } else {
          // CHUNKED PATH: Large datasets
          const CHUNK_SIZE = totalRows > 50000 ? 500 : 1000;
          
          for (let i = 0; i < totalRows; i += CHUNK_SIZE) {
            const end = Math.min(i + CHUNK_SIZE, totalRows);
            
            for (let j = i; j < end; j++) {
              rows[j] = convertBigIntToNumber(result[j]);
            }
            
            if (end < totalRows) {
              await new Promise(resolve => setTimeout(resolve, 0));
            }
          }
        }
      }
      
      if (!Array.isArray(rows)) {
        throw new Error('DuckDB query did not return an array');
      }
      
      return rows;
    } finally {
      await conn.close();
    }
  } catch (error: any) {
    console.error('❌ executeDuckDBSql failed:', error);
    const errorMsg = error?.message || 'Unknown error';
    
    // Handle specific DuckDB errors with helpful messages
    if (errorMsg.includes('Parser Error')) {
      // Special handling for PERCENTILE_CONT WITHIN GROUP syntax error
      if (errorMsg.includes('WITHIN GROUP') || errorMsg.includes('PERCENTILE_CONT')) {
        throw new Error(`DuckDB Error: PERCENTILE_CONT with WITHIN GROUP syntax is not supported in DuckDB WASM.\n\n❌ WRONG (PostgreSQL syntax):\nPERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY column)\n\n✅ CORRECT (DuckDB syntax):\nPERCENTILE_CONT(column, 0.5)\n\nOR use MEDIAN() function:\nMEDIAN(column)\n\nOR use QUANTILE() for percentiles:\nQUANTILE(column, 0.5)  -- for median\nQUANTILE(column, 0.25) -- for 25th percentile\nQUANTILE(column, 0.75) -- for 75th percentile`);
      }
      throw new Error(`DuckDB Parser Error: ${errorMsg}\n\nTip: Check your SQL syntax. DuckDB uses standard SQL.`);
    } else if (errorMsg.includes('Catalog Error')) {
      throw new Error(`DuckDB Catalog Error: Column or table not found.\n${errorMsg}\n\nTip: Use exact column names from the dataset. Check spelling and case sensitivity.`);
    } else if (errorMsg.includes('Binder Error')) {
      throw new Error(`DuckDB Binder Error: Invalid column reference.\n${errorMsg}\n\nTip: Make sure all columns exist in the dataset.`);
    }
    
    throw error;
  }
}

// Process Parquet files using DuckDB's native read_parquet function
export async function processParquetWithDuckDB(
  file: File,
  onProgress?: (progress: { file: string; percent: number; rows?: number; message?: string }) => void,
  existingFileId?: string
): Promise<{
  headers: string[];
  rowCount: number;
  data?: any[];
  fileBlob?: Blob;
  hasDuckDB: boolean;
  tableName?: string;
  fileId?: string;
}> {
  try {
    const db = await initDuckDB();
    if (!db) {
      throw new Error('DuckDB instance is not available');
    }

    const conn = await db.connect();
    const fileName = file.name || 'unknown.parquet';
    const fileId = existingFileId || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const cleanFileId = fileId.replace(/[^a-zA-Z0-9]/g, '_');
    const tableName = cleanFileId.startsWith('csv_') ? cleanFileId : `csv_${cleanFileId}`;

    onProgress?.({ file: fileName, percent: 0, message: 'Reading Parquet file with DuckDB...' });

    try {
      const fileSizeMB = file.size / (1024 * 1024);

      onProgress?.({ file: fileName, percent: 10, message: 'Registering file with DuckDB...' });

      // Register the file handle
      const safeFileName = fileName.replace(/[<>:"|?*\\]/g, '_').replace(/\s+/g, '_');
      await db.registerFileHandle(safeFileName, file, 2, true);

      onProgress?.({ file: fileName, percent: 30, message: 'Creating table from Parquet...' });

      // Use DuckDB's native read_parquet function
      const escapedFileName = safeFileName.replace(/'/g, "''");
      const escapedTableName = tableName.replace(/"/g, '""');

      await conn.query(`DROP TABLE IF EXISTS "${escapedTableName}"`);
      await conn.query(`
        CREATE TABLE "${escapedTableName}" AS
        SELECT * FROM read_parquet('${escapedFileName}')
      `);

      onProgress?.({ file: fileName, percent: 90, message: 'Verifying data...' });

      // Get row count and headers
      const countResult = await conn.query(`SELECT COUNT(*) as count FROM "${escapedTableName}"`);
      let rowCount = 0;

      if (countResult.toArray && typeof countResult.toArray === 'function') {
        const rows = countResult.toArray();
        rowCount = rows[0]?.get?.('count') || rows[0]?.count || rows[0]?.[0] || 0;
      }

      // Get headers
      const schemaResult = await conn.query(`DESCRIBE "${escapedTableName}"`);
      const headers: string[] = [];

      if (schemaResult.toArray && typeof schemaResult.toArray === 'function') {
        const schemaRows = schemaResult.toArray();
        schemaRows.forEach((row: any) => {
          const colName = row.get?.('column_name') || row.column_name || row[0];
          if (colName) headers.push(String(colName));
        });
      }

      onProgress?.({
        file: fileName,
        percent: 100,
        rows: rowCount,
        message: `Parquet loaded: ${rowCount.toLocaleString()} rows, ${headers.length} columns`
      });

      registeredFiles.set(fileId, { file, tableName });
      manageRegisteredFilesSize();

      await conn.close();

      return {
        headers,
        rowCount: Number(rowCount),
        data: [],
        fileBlob: file,
        hasDuckDB: true,
        tableName,
        fileId,
      };
    } catch (error: any) {
      await conn.close();
      throw new Error(`Parquet processing failed: ${error.message || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('DuckDB Parquet processing failed:', error);
    throw error;
  }
}

// Process Excel files (.xlsx, .xls) by converting to CSV and loading into DuckDB
export async function processExcelWithDuckDB(
  file: File,
  onProgress?: (progress: { file: string; percent: number; rows?: number; message?: string }) => void,
  existingFileId?: string,
  convertToParquet: boolean = true  // NEW: Allow skipping Parquet conversion
): Promise<{
  headers: string[];
  rowCount: number;
  data?: any[];
  fileBlob?: Blob;
  hasDuckDB: boolean;
  tableName?: string;
  fileId?: string;
}> {
  try {
    const XLSX = await import('xlsx');

    const db = await initDuckDB();
    if (!db) {
      throw new Error('DuckDB instance is not available');
    }

    const fileName = file.name || 'unknown.xlsx';
    const fileId = existingFileId || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    onProgress?.({ file: fileName, percent: 0, message: 'Reading Excel file...' });

    // Read Excel file
    const arrayBuffer = await file.arrayBuffer();
    onProgress?.({ file: fileName, percent: 20, message: 'Parsing Excel workbook...' });

    const workbook = XLSX.read(arrayBuffer, { type: 'array' });

    // Get first sheet (or we could let user select)
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('Excel file has no sheets');
    }

    onProgress?.({ file: fileName, percent: 40, message: `Processing sheet: ${sheetName}...` });

    const worksheet = workbook.Sheets[sheetName];

    // Convert to CSV text
    const csvText = XLSX.utils.sheet_to_csv(worksheet);

    // Create a blob from CSV text
    const csvBlob = new Blob([csvText], { type: 'text/csv' });

    // Create a File object with .csv extension
    const csvFile = new File([csvBlob], fileName.replace(/\.(xlsx?|xls)$/i, '.csv'), { type: 'text/csv' });

    onProgress?.({ file: fileName, percent: 60, message: 'Loading into DuckDB...' });

    // Process as CSV
    const result = await processCSVWithDuckDB(csvFile, (progress) => {
      // Adjust progress range from 60-100%
      const adjustedPercent = 60 + (progress.percent * 0.4);
      onProgress?.({
        file: fileName,
        percent: adjustedPercent,
        rows: progress.rows,
        message: progress.message
      });
    }, fileId);

    return {
      ...result,
      fileBlob: file, // Keep original Excel file as blob
    };
  } catch (error: any) {
    console.error('Excel processing failed:', error);
    throw new Error(`Excel processing failed: ${error.message || 'Unknown error'}`);
  }
}

// Process JSON files by converting to tabular format
export async function processJSONWithDuckDB(
  file: File,
  onProgress?: (progress: { file: string; percent: number; rows?: number; message?: string }) => void,
  existingFileId?: string,
  convertToParquet: boolean = true  // NEW: Allow skipping Parquet conversion
): Promise<{
  headers: string[];
  rowCount: number;
  data?: any[];
  fileBlob?: Blob;
  hasDuckDB: boolean;
  tableName?: string;
  fileId?: string;
}> {
  try {
    const db = await initDuckDB();
    if (!db) {
      throw new Error('DuckDB instance is not available');
    }

    const fileName = file.name || 'unknown.json';
    const fileId = existingFileId || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    onProgress?.({ file: fileName, percent: 0, message: 'Reading JSON file...' });

    // Read JSON file
    const text = await file.text();
    onProgress?.({ file: fileName, percent: 20, message: 'Parsing JSON...' });

    let jsonData: any;
    try {
      jsonData = JSON.parse(text);
    } catch (parseError: any) {
      throw new Error(`Invalid JSON: ${parseError.message}`);
    }

    // Handle different JSON structures
    let dataArray: any[] = [];

    if (Array.isArray(jsonData)) {
      dataArray = jsonData;
    } else if (typeof jsonData === 'object' && jsonData !== null) {
      // If it's an object, check if it has an array property
      const arrayKeys = Object.keys(jsonData).filter(key => Array.isArray(jsonData[key]));

      if (arrayKeys.length > 0) {
        // Use first array found
        dataArray = jsonData[arrayKeys[0]];
      } else {
        // Wrap single object in array
        dataArray = [jsonData];
      }
    } else {
      throw new Error('JSON must be an array or object with array properties');
    }

    if (dataArray.length === 0) {
      throw new Error('JSON file contains no data');
    }

    onProgress?.({ file: fileName, percent: 40, message: 'Converting to CSV format...' });

    // Extract headers from first object (flatten nested objects)
    const flattenObject = (obj: any, prefix = ''): any => {
      const flattened: any = {};
      for (const [key, value] of Object.entries(obj)) {
        const newKey = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          Object.assign(flattened, flattenObject(value, newKey));
        } else if (Array.isArray(value)) {
          flattened[newKey] = JSON.stringify(value);
        } else {
          flattened[newKey] = value;
        }
      }
      return flattened;
    };

    // Flatten all objects
    const flattenedData = dataArray.map(obj =>
      typeof obj === 'object' ? flattenObject(obj) : { value: obj }
    );

    // Get all unique headers
    const headersSet = new Set<string>();
    flattenedData.forEach(row => {
      Object.keys(row).forEach(key => headersSet.add(key));
    });
    const headers = Array.from(headersSet);

    if (headers.length === 0) {
      throw new Error('Could not extract headers from JSON data');
    }

    // Convert to CSV
    const { stringifyCsv } = await import('./csvUtils');

    // Ensure all rows have all headers
    const normalizedData = flattenedData.map(row => {
      const normalized: any = {};
      headers.forEach(header => {
        normalized[header] = row[header] !== undefined ? row[header] : '';
      });
      return normalized;
    });

    const csvText = stringifyCsv(headers, normalizedData);

    // Create CSV blob and file
    const csvBlob = new Blob([csvText], { type: 'text/csv' });
    const csvFile = new File([csvBlob], fileName.replace(/\.json$/i, '.csv'), { type: 'text/csv' });

    onProgress?.({ file: fileName, percent: 60, message: 'Loading into DuckDB...' });

    // Process as CSV
    const result = await processCSVWithDuckDB(csvFile, (progress) => {
      const adjustedPercent = 60 + (progress.percent * 0.4);
      onProgress?.({
        file: fileName,
        percent: adjustedPercent,
        rows: progress.rows,
        message: progress.message
      });
    }, fileId);

    return {
      ...result,
      fileBlob: file, // Keep original JSON file as blob
    };
  } catch (error: any) {
    console.error('JSON processing failed:', error);
    throw new Error(`JSON processing failed: ${error.message || 'Unknown error'}`);
  }
}

// Close DuckDB connection
export async function closeDuckDB(): Promise<void> {
  if (db) {
    try {
      await db.close();
    } catch (error) {
    }
    db = null;
    initialized = false;
    registeredFiles.clear();
  }
}

// Clean up DuckDB tables for CSV files that are no longer used by any chat
export async function cleanupUnusedDuckDBTables(deletedChatCsvIds: string[]): Promise<void> {
  if (!deletedChatCsvIds || deletedChatCsvIds.length === 0) {
    return;
  }

  try {
    // Get all existing chats to see which CSV IDs are still in use
    const savedChats = localStorage.getItem("volleyball-chats");
    const csvIdsStillInUse = new Set<string>();
    
    if (savedChats) {
      try {
        const chats = JSON.parse(savedChats);
        if (Array.isArray(chats)) {
          chats.forEach((chat: any) => {
            if (chat.selectedCsvIds && Array.isArray(chat.selectedCsvIds)) {
              chat.selectedCsvIds.forEach((csvId: string) => {
                csvIdsStillInUse.add(csvId);
              });
            }
          });
        }
      } catch (e) {
        console.error("Error parsing chats for cleanup:", e);
      }
    }

    // For each CSV ID from the deleted chat, check if it's still used
    for (const csvId of deletedChatCsvIds) {
      if (!csvIdsStillInUse.has(csvId)) {
        // CSV is no longer used by any chat - clean up its table
        await cleanupDuckDBTable(csvId);
      } else {
      }
    }
  } catch (error) {
    console.error("Error cleaning up unused DuckDB tables:", error);
    // Don't throw - cleanup is best-effort
  }
}

// Clean up DuckDB table and file registration when CSV is deleted
export async function cleanupDuckDBTable(csvId: string): Promise<void> {
  try {
    const registered = registeredFiles.get(csvId);
    if (!registered) {
      // File not registered, nothing to clean up
      return;
    }

    const tableName = registered.tableName;
    
    if (!db || !initialized) {
      // DuckDB not initialized, just clean up the map
      registeredFiles.delete(csvId);
      return;
    }

    const conn = await db.connect();
    try {
      // Drop the table if it exists
      const escapedTableName = tableName.replace(/"/g, '""');
      try {
        await conn.query(`DROP TABLE IF EXISTS "${escapedTableName}"`);
      } catch (dropError: any) {
        // Table might not exist or already dropped - log but don't fail
      }
    } finally {
      await conn.close();
    }

    // Remove from registered files map
    registeredFiles.delete(csvId);
  } catch (error) {
    console.error(`❌ Error cleaning up DuckDB table for ${csvId}:`, error);
    // Still remove from map even if drop fails
    registeredFiles.delete(csvId);
    // Don't throw - cleanup should be best-effort
  }
}

