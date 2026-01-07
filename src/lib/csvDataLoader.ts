import { getCsvFileData, getValueInfo, autoInspectData } from "./chatApi";
import { getCsvFileMetadata } from "./chatApiHelpers";

// Progress callback type
export interface ProgressUpdate {
  file: string;
  percent: number;
  rows?: number;
  message?: string;
  error?: string;
}

// Cache for filtered CSV data - key is csvId + filter signature
const filteredCsvDataCache = new Map<string, { data: any[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL
const MAX_CACHE_SIZE_MB = 50; // Maximum 50MB of cached data
const MAX_CACHE_ENTRIES = 10; // Maximum 10 cached datasets

// Track pending background operations for cancellation
const pendingOperations = new Map<string, { 
  aborted: boolean;
  operationId: number;
}>();
let nextOperationId = 0;

/**
 * Generate a stable cache key based on CSV ID and filters
 * Uses unambiguous delimiters to prevent collisions
 */
function getCacheKey(
  csvId: string | string[],
  filterColumns: string[] | null,
  filterValues: Record<string, string | string[] | null> | null
): string {
  // Stable serialization with type markers to prevent collisions
  const idsKey = Array.isArray(csvId) 
    ? `[${csvId.sort().join('|')}]`  // Array: use | delimiter and wrap in []
    : `(${csvId})`;  // Single: wrap in ()
  
  if (!filterColumns || !filterValues) {
    return `${idsKey}::NO_FILTERS`;
  }
  
  // Sort both keys and values for stable ordering
  const sortedEntries = filterColumns
    .sort()
    .map(col => {
      const val = filterValues[col];
      // Normalize array vs single value
      const normalizedVal = Array.isArray(val) 
        ? `[${val.sort().join('|')}]`
        : `(${val})`;
      return `${col}=${normalizedVal}`;
    })
    .join('&');
  
  return `${idsKey}::${sortedEntries}`;
}

/**
 * Estimate cache entry size in MB
 */
function estimateSizeInMB(data: any[]): number {
  if (!data || data.length === 0) return 0;
  // Sample first 100 rows to estimate average row size
  const sample = data.slice(0, Math.min(100, data.length));
  const str = JSON.stringify(sample);
  const avgRowSize = str.length / sample.length;
  return (avgRowSize * data.length) / (1024 * 1024);
}

/**
 * Get current cache statistics
 */
function getCacheStats(): { totalSizeMB: number; entryCount: number } {
  let totalSize = 0;
  for (const entry of filteredCsvDataCache.values()) {
    totalSize += estimateSizeInMB(entry.data);
  }
  return { totalSizeMB: totalSize, entryCount: filteredCsvDataCache.size };
}

/**
 * Evict oldest cache entry to free up space
 */
function evictOldestCache(): void {
  let oldest: { key: string; timestamp: number } | null = null;
  
  for (const [key, value] of filteredCsvDataCache.entries()) {
    if (!oldest || value.timestamp < oldest.timestamp) {
      oldest = { key, timestamp: value.timestamp };
    }
  }
  
  if (oldest) {
    filteredCsvDataCache.delete(oldest.key);
    console.log('🗑️ Evicted oldest cache entry:', oldest.key);
  }
}

// Clear old cache entries
function cleanCache(): void {
  const now = Date.now();
  for (const [key, value] of filteredCsvDataCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      filteredCsvDataCache.delete(key);
    }
  }
}

/**
 * Clear cache entries for specific CSV file(s)
 * Parses cache keys properly to avoid false matches
 */
export function clearCsvDataCache(csvId: string | string[]): void {
  const idsToRemove = new Set(Array.isArray(csvId) ? csvId : [csvId]);
  
  for (const key of Array.from(filteredCsvDataCache.keys())) {
    // Parse the cache key to extract CSV IDs
    const idsMatch = key.match(/^\[([^\]]+)\]|^\(([^)]+)\)/);
    if (!idsMatch) continue;
    
    const keyIds = idsMatch[1] 
      ? idsMatch[1].split('|')  // Array format: [id1|id2]
      : [idsMatch[2]];           // Single format: (id)
    
    // Remove if any ID matches
    if (keyIds.some(id => idsToRemove.has(id))) {
      filteredCsvDataCache.delete(key);
      console.log('🗑️ Cleared cache for:', key);
    }
  }
}

/**
 * Get cache statistics for monitoring
 */
export function getCacheStatistics(): {
  entries: number;
  totalSizeMB: number;
  oldestEntry: Date | null;
  newestEntry: Date | null;
} {
  const stats = getCacheStats();
  let oldest: number | null = null;
  let newest: number | null = null;
  
  for (const entry of filteredCsvDataCache.values()) {
    if (oldest === null || entry.timestamp < oldest) oldest = entry.timestamp;
    if (newest === null || entry.timestamp > newest) newest = entry.timestamp;
  }
  
  return {
    entries: stats.entryCount,
    totalSizeMB: stats.totalSizeMB,
    oldestEntry: oldest ? new Date(oldest) : null,
    newestEntry: newest ? new Date(newest) : null
  };
}

/**
 * Cancel pending background operations for specific CSV(s)
 */
export function cancelPendingOperations(csvId?: string | string[]): void {
  if (!csvId) {
    // Cancel all operations
    for (const op of pendingOperations.values()) {
      op.aborted = true;
    }
    pendingOperations.clear();
    console.log('🛑 Cancelled all pending operations');
  } else {
    // Cancel specific operations
    const ids = Array.isArray(csvId) ? csvId : [csvId];
    for (const id of ids) {
      const op = pendingOperations.get(id);
      if (op) {
        op.aborted = true;
        pendingOperations.delete(id);
        console.log('🛑 Cancelled operation for:', id);
      }
    }
  }
}

/**
 * Cleanup function to call on component unmount
 * Cancels pending operations and optionally clears cache
 */
export function cleanup(clearCache: boolean = false): void {
  cancelPendingOperations();
  if (clearCache) {
    clearAllCsvDataCache();
    console.log('🧹 Cleaned up: cancelled operations and cleared cache');
  } else {
    console.log('🧹 Cleaned up: cancelled pending operations');
  }
}

// Clear all cached filtered data
export function clearAllCsvDataCache(): void {
  filteredCsvDataCache.clear();
}

/**
 * Load CSV data with value info generation
 * Handles large datasets efficiently
 */
export async function loadCsvDataWithValueInfo(
  csvId: string | string[],
  csvFilterColumns: string[] | null,
  csvFilterValues: Record<string, string | string[] | null> | null,
  chatId?: string,
  onProgress?: (progress: ProgressUpdate) => void
): Promise<any[] | null> {
  try {
    // Check cache first (only for filtered data - no filters means DuckDB handles it)
    let csvData: any[] | null = null;
    const hasFilters = csvFilterColumns && csvFilterColumns.length > 0 && csvFilterValues;
    
    if (hasFilters) {
      cleanCache(); // Remove old entries
      const cacheKey = getCacheKey(csvId, csvFilterColumns, csvFilterValues);
      const cached = filteredCsvDataCache.get(cacheKey);
      
      if (cached) {
        console.log('✅ Using cached CSV data:', cacheKey, cached.data.length, 'rows');
        if (onProgress) {
          onProgress({ file: 'Cached', percent: 100, rows: cached.data.length, message: 'Using cached data' });
        }
        csvData = cached.data;
      }
    }
    
    // Not in cache - check if we can use DuckDB instead of loading full data
    if (!csvData) {
      // CRITICAL: Check if valueInfo already exists - if it does, skip loading even if DuckDB table doesn't exist yet
      // The table will be created on-demand when queries are executed
      const { hasValueInfoForCsvs } = await import("@/lib/chatApiHelpers");
      const { getValueInfo } = await import("@/lib/chatApi");
      const valueInfoExists = hasValueInfoForCsvs(csvId, chatId);
      
      // Also check if any of the CSV files have valueInfo (more lenient check)
      const csvIds = Array.isArray(csvId) ? csvId : [csvId];
      let anyValueInfoExists = valueInfoExists;
      if (!anyValueInfoExists) {
        for (const id of csvIds) {
          const vi = getValueInfo(id, 'csv', chatId);
          if (vi) {
            anyValueInfoExists = true;
            break;
          }
        }
      }
      
      if (anyValueInfoExists) {
        // ValueInfo already exists - skip loading, DuckDB will create table on-demand
        // DON'T call onProgress - this triggers the loading bar
        return null;
      }
      
      // Check if DuckDB is available for these CSV files
      const duckDBAvailable = await checkDuckDBAvailability(csvId);
      
      if (duckDBAvailable) {
        // DuckDB is available - but if valueInfo doesn't exist, create it from a small sample
        if (!anyValueInfoExists) {
          // Create valueInfo from a small sample query (max 1000 rows for efficiency)
          try {
            const { queryCSVWithDuckDB } = await import("@/lib/duckdb");
            const { getCsvFilesFromStorageSync } = await import("@/lib/chatApiHelpers");
            const sampleSize = 1000;

            // Get file names for progress display
            const files = getCsvFilesFromStorageSync();
            const fileNames = csvIds.map(id => {
              const file = files.find((f: any) => f.id === id);
              return file?.name || id;
            });
            const displayName = fileNames.length > 1
              ? `${fileNames.length} files`
              : fileNames[0] || 'CSV file';

            // Show progress: generating value info summary
            if (onProgress) {
              onProgress({ file: displayName, percent: 0, message: 'Generating value info summary for AI...' });
            }

            // IMPORTANT: For multiple files, create ONE combined value info
            // For single file, create value info for that file
            try {
              // Check if value info already exists
              let valueInfoExists = false;

              if (csvIds.length > 1) {
                // Multiple files - check if combined value info exists
                const combinedId = `combined_${[...csvIds].sort().join('_')}`;
                const combinedValueInfo = getValueInfo(combinedId, 'csv', chatId);
                valueInfoExists = !!combinedValueInfo;
              } else {
                // Single file - check if value info exists for that file
                const singleValueInfo = getValueInfo(csvIds[0], 'csv', chatId);
                valueInfoExists = !!singleValueInfo;
              }

              if (!valueInfoExists) {
                // Query combined data from all CSV files
                if (onProgress) {
                  onProgress({
                    file: displayName,
                    percent: 30,
                    message: csvIds.length > 1 ? 'Querying combined data from all files...' : 'Querying data...'
                  });
                }

                // Query all files together to get combined data
                const { queryCombinedCSVsWithDuckDB } = await import("@/lib/duckdb");
                const sampleData = await queryCombinedCSVsWithDuckDB(
                  csvIds, // Pass all IDs to combine data
                  csvFilterColumns,
                  csvFilterValues,
                  undefined // No progress callback to avoid nested loading bars
                );

                if (onProgress) {
                  onProgress({
                    file: displayName,
                    percent: 60,
                    message: 'Generating value info summary...'
                  });
                }

                // Use a smaller sample for valueInfo creation (max 1000 rows)
                const valueInfoSample = sampleData.slice(0, sampleSize);
                if (valueInfoSample.length > 0) {
                  // This will create ONE combined value info for multiple files
                  await createValueInfoForCsvs(valueInfoSample, csvIds, chatId);
                }

                if (onProgress) {
                  onProgress({
                    file: displayName,
                    percent: 90,
                    message: csvIds.length > 1
                      ? 'Created combined value info for all files'
                      : 'Created value info'
                  });
                }
              } else {
                console.log('✅ Value info already exists, skipping generation');
              }
            } catch (e) {
              console.warn(`Failed to create valueInfo from DuckDB sample:`, e);
            }

            // Complete
            if (onProgress) {
              onProgress({ file: displayName, percent: 100, message: 'Value info ready' });
            }
          } catch (e) {
            console.warn('Failed to create valueInfo from DuckDB sample:', e);
            // Continue anyway - valueInfo will be created later when data is actually queried
          }
        }
        
        // DuckDB is available - skip loading full data, let code executor query DuckDB
        // DON'T call onProgress - this triggers the loading bar
        // Just return null to signal data exists in DuckDB
        // The code executor will use csvId to query DuckDB directly
        return null;
      }
      
      // DuckDB not available and no valueInfo - load data normally
      csvData = await getCsvFileData(csvId, csvFilterColumns, csvFilterValues, onProgress);
      
      // Store in cache if we have filters (unfiltered data uses DuckDB which is already fast)
      if (csvData && hasFilters) {
        const sizeInMB = estimateSizeInMB(csvData);
        
        // Check if dataset alone is too large
        if (sizeInMB > MAX_CACHE_SIZE_MB) {
          console.warn(`⚠️ Dataset too large to cache (${sizeInMB.toFixed(1)}MB > ${MAX_CACHE_SIZE_MB}MB)`);
        } else {
          let stats = getCacheStats();
          let evictionAttempts = 0;
          const MAX_EVICTIONS = MAX_CACHE_ENTRIES; // Prevent infinite loop
          
          // Evict old entries if we're over limits
          while (
            (stats.totalSizeMB + sizeInMB > MAX_CACHE_SIZE_MB || 
             stats.entryCount >= MAX_CACHE_ENTRIES) &&
            filteredCsvDataCache.size > 0 &&
            evictionAttempts < MAX_EVICTIONS
          ) {
            evictOldestCache();
            stats = getCacheStats();
            evictionAttempts++;
          }
          
          // Only cache if we successfully made space
          if (stats.totalSizeMB + sizeInMB <= MAX_CACHE_SIZE_MB) {
            const cacheKey = getCacheKey(csvId, csvFilterColumns, csvFilterValues);
            filteredCsvDataCache.set(cacheKey, { data: csvData, timestamp: Date.now() });
            console.log(`✅ Cached CSV data: ${cacheKey} (${csvData.length} rows, ~${sizeInMB.toFixed(1)}MB)`);
          } else {
            console.warn(`⚠️ Could not make space in cache for ${sizeInMB.toFixed(1)}MB dataset`);
          }
        }
      }
    }
    
    if (!csvData || csvData.length === 0) {
      return null;
    }
    
    // Check if __SELECT_ALL__ is used
    const hasSelectAll = csvFilterValues && Object.values(csvFilterValues).some(val => val === '__SELECT_ALL__');
    
    // For very large datasets, handle differently
    const LARGE_DATASET_THRESHOLD = 100000; // 100k rows
    if (csvData.length > LARGE_DATASET_THRESHOLD && !hasSelectAll) {
      await handleLargeDataset(csvData, csvId, chatId, onProgress);
      
      // Check if DuckDB is available - if so, keep data for context
      const shouldKeepData = await checkDuckDBAvailability(csvId);
      return shouldKeepData ? csvData : null;
    } else {
      // Create value info immediately for smaller datasets
      await createValueInfoForCsvs(csvData, csvId, chatId);
      return csvData;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Failed to load CSV data';
    const errorDetails = error instanceof Error ? error.stack : String(error);
    
    console.error('loadCsvDataWithValueInfo: Error loading CSV data', {
      csvId,
      filterColumns: csvFilterColumns,
      error: errorMsg,
      stack: errorDetails
    });
    
    if (onProgress) {
      onProgress({ 
        file: Array.isArray(csvId) ? csvId.join(', ') : csvId, 
        percent: 0, 
        rows: 0, 
        message: errorMsg 
      });
    }
    return null;
  }
}

/**
 * Handle large dataset loading with progress updates
 */
async function handleLargeDataset(
  csvData: any[],
  csvId: string | string[],
  chatId?: string,
  onProgress?: (progress: ProgressUpdate) => void
): Promise<void> {
  // Show progress message
  if (onProgress) {
    onProgress({ 
      file: 'Processing...', 
      percent: 100, 
      rows: csvData.length,
      message: `Large dataset loaded (${csvData.length.toLocaleString()} rows). Processing in background...`
    });
  }
  
  const csvIds = Array.isArray(csvId) ? csvId : [csvId];
  
  // Cancel any existing operations for these IDs
  for (const id of csvIds) {
    const existing = pendingOperations.get(id);
    if (existing) {
      existing.aborted = true;
      pendingOperations.delete(id);
    }
  }
  
  // Create new operation
  const operationId = nextOperationId++;
  const operation = { aborted: false, operationId };
  
  for (const id of csvIds) {
    pendingOperations.set(id, operation);
  }
  
  // Schedule work
  const scheduleWork = (callback: () => void) => {
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(callback, { timeout: 2000 });
    } else {
      setTimeout(callback, 500);
    }
  };
  
  // Don't clone - use reference (captured in closure, safe from GC)
  // Cloning would duplicate 100k+ rows unnecessarily
  scheduleWork(() => {
    // Check if operation was cancelled
    if (operation.aborted) {
      console.log(`⏭️ Operation ${operationId} cancelled for:`, csvIds);
      return;
    }
    
    for (const id of csvIds) {
      // Double-check not cancelled during loop
      if (operation.aborted) break;
      
      const existingValueInfo = getValueInfo(id, 'csv', chatId);
      if (!existingValueInfo && csvData.length > 0) {
        createValueInfoForCsv(csvData, id, chatId, true);
      }
    }
    
    // Clean up operation tracking
    for (const id of csvIds) {
      if (pendingOperations.get(id)?.operationId === operationId) {
        pendingOperations.delete(id);
      }
    }
  });
}

/**
 * Create value info for a single CSV file
 */
async function createValueInfoForCsv(
  csvData: any[],
  csvId: string,
  chatId?: string,
  useSample: boolean = false
): Promise<void> {
  try {
    const files = await getCsvFileMetadata();
    const file = files.find((f: any) => f.id === csvId);

    if (file) {
      // Get actual total row count from file metadata
      const actualTotalRows = file.rowCount || csvData.length;

      if (useSample) {
        // Use a sample for large datasets
        const sampleSize = Math.min(50000, csvData.length);
        const sample = csvData.slice(0, sampleSize);
        setTimeout(() => {
          // Pass actualTotalRows so AI knows the FULL dataset size, not just sample size
          autoInspectData(sample, csvId, 'csv', file.name, chatId, actualTotalRows);
        }, 0);
      } else {
        autoInspectData(csvData, csvId, 'csv', file.name, chatId, actualTotalRows);
      }
    }
  } catch (e) {
    console.warn('createValueInfoForCsv: Failed to create value info:', e);
  }
}

/**
 * Create value info for multiple CSV files
 * IMPORTANT: When multiple files are selected, creates ONE combined value info
 */
async function createValueInfoForCsvs(
  csvData: any[],
  csvId: string | string[],
  chatId?: string
): Promise<void> {
  const csvIds = Array.isArray(csvId) ? csvId : [csvId];

  // If multiple files, create ONE combined value info
  if (csvIds.length > 1) {
    try {
      const files = await getCsvFileMetadata();

      // Create a combined ID by joining all CSV IDs
      const combinedId = `combined_${[...csvIds].sort().join('_')}`;

      // Check if combined value info already exists
      const existingValueInfo = getValueInfo(combinedId, 'csv', chatId);
      if (existingValueInfo) {
        console.log('✅ Combined value info already exists:', combinedId);
        return;
      }

      // Get all file metadata
      const selectedFiles = files.filter((f: any) => csvIds.includes(f.id));
      const fileNames = selectedFiles.map((f: any) => f.name).join(' + ');
      const totalRowCount = selectedFiles.reduce((sum: number, f: any) => sum + (f.rowCount || 0), 0);

      // Create combined value info using the combined data
      console.log(`✅ Creating combined value info for ${csvIds.length} files: ${fileNames}`);
      autoInspectData(csvData, combinedId, 'csv', fileNames, chatId, totalRowCount);
    } catch (e) {
      console.warn('createValueInfoForCsvs: Failed to create combined value info:', e);
    }
  } else {
    // Single file - create value info for that file
    const id = csvIds[0];
    const existingValueInfo = getValueInfo(id, 'csv', chatId);
    if (!existingValueInfo) {
      await createValueInfoForCsv(csvData, id, chatId, false);
    }
  }
}

/**
 * Check if DuckDB is available for the CSV files
 */
async function checkDuckDBAvailability(csvId: string | string[]): Promise<boolean> {
  try {
    const { isDuckDBInitialized, isFileRegisteredInDuckDB, getDuckDBTableName, verifyTableExists } = await import("@/lib/duckdb");
    if (!isDuckDBInitialized()) {
      return false;
    }
    
    const csvIds = Array.isArray(csvId) ? csvId : [csvId];
    
    // Check if any file is registered in memory OR if table exists in DuckDB OPFS
    for (const id of csvIds) {
      if (isFileRegisteredInDuckDB(id)) {
        return true; // Fast path - in memory
      }
      
      // Even if not in memory, check if table exists in DuckDB OPFS
      // Derive table name from file ID if not found in metadata
      const tableName = getDuckDBTableName(id, true); // deriveIfMissing = true
      
      if (tableName) {
        const tableExists = await verifyTableExists(tableName);
        if (tableExists) {
          return true; // Table exists in DuckDB, even if not in memory
        }
      }
    }
    
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * Get current selection data from value info
 * Returns data if available in memory, otherwise null
 */
export function getCurrentSelectionData(currentSelectionValueInfo: any | null): any[] | null {
  if (!currentSelectionValueInfo) {
    return null;
  }
  
  if (currentSelectionValueInfo.data && 
      Array.isArray(currentSelectionValueInfo.data) && 
      currentSelectionValueInfo.data.length > 0) {
    return currentSelectionValueInfo.data;
  }
  
  return null;
}

