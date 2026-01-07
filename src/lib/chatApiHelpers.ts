import { getValueInfo } from "./chatApi";
import { getAllCsvFileMetadata } from "./csvStorage";

// Cache for localStorage CSV files (avoids repeated JSON.parse)
let csvFilesCache: any[] | null = null;
let csvFilesCacheTimestamp = 0;
const CSV_FILES_CACHE_TTL = 5000; // 5 seconds cache TTL

/**
 * Get CSV files from localStorage with caching (synchronous)
 * Use this for hot paths where async isn't needed
 */
export function getCsvFilesFromStorageSync(): any[] {
  const now = Date.now();
  
  // Return cached if valid
  if (csvFilesCache && (now - csvFilesCacheTimestamp) < CSV_FILES_CACHE_TTL) {
    return csvFilesCache;
  }
  
  try {
    const saved = localStorage.getItem("db_csv_files");
    if (saved) {
      csvFilesCache = JSON.parse(saved);
      csvFilesCacheTimestamp = now;
      return Array.isArray(csvFilesCache) ? csvFilesCache : [];
    }
  } catch (e) {
    // Ignore parse errors
  }
  
  csvFilesCache = [];
  csvFilesCacheTimestamp = now;
  return [];
}

/**
 * Invalidate the CSV files cache (call after modifying localStorage)
 */
export function invalidateCsvFilesCache(): void {
  csvFilesCache = null;
  csvFilesCacheTimestamp = 0;
}

/**
 * Helper to get CSV file metadata from IndexedDB or localStorage
 */
export async function getCsvFileMetadata(): Promise<any[]> {
  try {
    const metadataFiles = await getAllCsvFileMetadata();
    return metadataFiles;
  } catch (e) {
    console.warn('Error loading from IndexedDB, trying localStorage:', e);
    const saved = localStorage.getItem("db_csv_files");
    if (saved) {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    }
  }
  return [];
}

/**
 * Helper to get CSV file name(s) from ID(s)
 */
export async function getCsvFileNames(csvId: string | string[] | null, chatId?: string): Promise<string | null> {
  if (!csvId) return null;
  
  try {
    const files = await getCsvFileMetadata();
    
    if (files.length > 0) {
      if (Array.isArray(csvId)) {
        // Multiple CSV files - create a combined name
        const fileNames = csvId.map(id => {
          const file = files.find((f: any) => f.id === id);
          return file ? file.name : null;
        }).filter(Boolean);
        return fileNames.length > 0 ? fileNames.join(', ') : null;
      } else {
        // Single CSV file
        const file = files.find((f: any) => f.id === csvId);
        return file ? file.name : null;
      }
    }
    
    // Fallback: Try to get from value info
    const csvIds = Array.isArray(csvId) ? csvId : [csvId];
    for (const id of csvIds) {
      const valueInfo = getValueInfo(id, 'csv', chatId);
      if (valueInfo && valueInfo.name) {
        return valueInfo.name;
      }
    }
  } catch (e) {
    console.warn('Error getting CSV file name:', e);
  }
  
  return null;
}

/**
 * Helper to check if CSV has filters set
 */
export function hasCsvFilters(
  csvFilterColumns: string[] | null,
  csvFilterValues: Record<string, string | string[] | null> | null
): boolean {
  return !!(csvFilterColumns && csvFilterColumns.length > 0 && 
    csvFilterValues && Object.keys(csvFilterValues).some(col => csvFilterValues[col] !== null));
}

/**
 * Helper to check if match has filters set
 */
export function hasMatchFilters(
  matchFilterColumns: string[] | null,
  matchFilterValues: Record<string, string | string[] | null> | null
): boolean {
  return !!(matchFilterColumns && matchFilterColumns.length > 0 && 
    matchFilterValues && Object.keys(matchFilterValues).some(col => matchFilterValues[col] !== null));
}

/**
 * Helper to check if value info exists for all CSV IDs
 */
export function hasValueInfoForCsvs(csvId: string | string[] | null, chatId?: string): boolean {
  if (!csvId) return false;
  const csvIds = Array.isArray(csvId) ? csvId : [csvId];

  if (csvIds.length > 1) {
    // Multiple files - check for combined value info
    // Use slice() to avoid mutating the original array
    const combinedId = `combined_${[...csvIds].sort().join('_')}`;
    const combinedValueInfo = getValueInfo(combinedId, 'csv', chatId);
    return !!combinedValueInfo;
  } else if (csvIds.length === 1) {
    // Single file - check for individual value info
    const valueInfo = getValueInfo(csvIds[0], 'csv', chatId);
    return !!valueInfo;
  }

  return false;
}

/**
 * Helper to check if __SELECT_ALL__ marker is used
 */
export function hasSelectAllMarker(filterValues: Record<string, string | string[] | null> | null): boolean {
  return !!(filterValues && Object.values(filterValues).some(val => val === '__SELECT_ALL__'));
}

/**
 * Helper to get current selection value info
 * Prioritizes CSV over match based on filter selections
 */
export function getCurrentSelectionValueInfo(
  hasCsvFilterSelections: boolean,
  hasMatchFilterSelections: boolean,
  csvId: string | string[] | null,
  hasValueInfo: boolean,
  chatId?: string
): any | null {
  let currentSelectionValueInfo: any | null = null;
  
  if ((hasCsvFilterSelections || csvId) && !hasMatchFilterSelections) {
    // CSV filters are set OR csvId exists, check for CSV current_selection
    currentSelectionValueInfo = getValueInfo('current_selection', 'csv', chatId);
    // If not found, also check if any CSV file has value info (columns were selected)
    if (!currentSelectionValueInfo && csvId && hasValueInfo) {
      const csvIds = Array.isArray(csvId) ? csvId : [csvId];
      for (const id of csvIds) {
        const valueInfo = getValueInfo(id, 'csv', chatId);
        if (valueInfo) {
          currentSelectionValueInfo = valueInfo;
          break;
        }
      }
    }
  } else if (hasMatchFilterSelections) {
    // Match filters are set, check for match current_selection
    currentSelectionValueInfo = getValueInfo('current_selection', 'match', chatId);
  } else {
    // No filters, try match first (backward compatibility)
    currentSelectionValueInfo = getValueInfo('current_selection', 'match', chatId);
  }
  
  return currentSelectionValueInfo;
}

/**
 * Helper to verify if value info belongs to current chat
 */
export function belongsToCurrentChat(valueInfo: any | null, chatId?: string): boolean {
  return !chatId || 
    !valueInfo || 
    valueInfo.chatId === chatId || 
    (valueInfo.usedByChats && valueInfo.usedByChats.includes(chatId));
}

/**
 * Helper to check if stored selection matches current selection
 */
export function matchesCurrentSelection(
  currentSelectionValueInfo: any | null,
  filterColumns: string[] | null,
  filterValues: Record<string, string | string[] | null> | null
): boolean {
  if (!currentSelectionValueInfo || !filterColumns || !filterValues) {
    return true; // No comparison needed
  }
  
  // Filter to only group columns (columns with values) for comparison
  const currentGroupColumns = filterColumns.filter(col => filterValues[col] != null).sort();
  const storedGroupColumns = (currentSelectionValueInfo.filterColumns || []).sort();
  
  // Check if columns match
  if (currentGroupColumns.length !== storedGroupColumns.length ||
      !currentGroupColumns.every((col, idx) => col === storedGroupColumns[idx])) {
    return false;
  }
  
  // Check if values match (handle arrays properly)
  for (const col of currentGroupColumns) {
    const storedValue = currentSelectionValueInfo.filterValues?.[col];
    const currentValue = filterValues[col];
    
    // Handle __SELECT_ALL__ marker - it should match any stored value
    if (currentValue === '__SELECT_ALL__' || storedValue === '__SELECT_ALL__') {
      continue; // Both mean "all values"
    }
    
    // Handle arrays - compare contents, not references
    if (Array.isArray(storedValue) && Array.isArray(currentValue)) {
      if (storedValue.length !== currentValue.length) {
        return false;
      }
      // Sort and compare as strings to handle order differences
      const storedSorted = [...storedValue].map(v => String(v)).sort().join(',');
      const currentSorted = [...currentValue].map(v => String(v)).sort().join(',');
      if (storedSorted !== currentSorted) {
        return false;
      }
    } else if (Array.isArray(storedValue) && !Array.isArray(currentValue)) {
      // Array should contain the single value
      if (!(storedValue.length === 1 && String(storedValue[0]) === String(currentValue))) {
        return false;
      }
    } else if (!Array.isArray(storedValue) && Array.isArray(currentValue)) {
      // Array should contain the single value
      if (!(currentValue.length === 1 && String(currentValue[0]) === String(storedValue))) {
        return false;
      }
    } else if (storedValue !== currentValue) {
      // For non-arrays, use strict equality
      return false;
    }
  }
  
  return true;
}

