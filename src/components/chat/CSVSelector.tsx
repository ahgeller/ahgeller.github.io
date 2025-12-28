import { useState, useEffect, useRef, useCallback, memo } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { FileText, X, Upload, Check } from "lucide-react";
import { getCsvFileData, getValueInfo } from "@/lib/chatApi";
import { stringifyCsv } from "@/lib/csvUtils";
import { migrateLegacyCsvFile, saveCsvDataText, saveCsvDataBlob, getUniqueValuesFromFile, initDB, saveCsvFileMetadata, getAllCsvFileMetadata, saveAllCsvFileMetadata } from "@/lib/csvStorage";
import MultiSelectGroupBy from "./MultiSelectGroupBy";
import { safeInitializeDuckDB, processCSVWithDuckDB, processParquetWithDuckDB, processExcelWithDuckDB, processJSONWithDuckDB, isDuckDBInitialized } from '@/lib/duckdb';
import { generatePrefixedId } from '@/lib/idGenerator';


interface CSVSelectorProps {
  selectedCsvIds: string[]; // Changed to array for multiple CSV selection
  selectedFilterColumns: string[];
  selectedFilterValues: Record<string, string | string[] | null>;
  onSelectCsv: (csvIds: string[], filterColumns?: string[], filterValues?: Record<string, string | string[] | null>, displayColumns?: string[], displayValues?: Record<string, string | null>) => void;
  chatId?: string; // Chat ID for tracking Value Info associations
  showGroupBy?: boolean; // Whether to show the group by section separately
  disabled?: boolean; // Disable when SQL selection is active
}

interface CSVFile {
  id: string;
  name: string;
  headers: string[];
  uploadedAt: number;
  rowCount?: number;
  data?: any[]; // Legacy support
  hasDuckDB?: boolean;
  fileBlob?: Blob;
  tableName?: string; // DuckDB table name for efficient querying
  size?: number; // Original file size in bytes
}

type ColumnMode = 'group' | 'display';

const CSVSelector = ({ selectedCsvIds, selectedFilterColumns, selectedFilterValues, onSelectCsv, chatId, showGroupBy = false, disabled = false }: CSVSelectorProps) => {
  const [csvFiles, setCsvFiles] = useState<CSVFile[]>([]);
  const [filteredCsvFiles, setFilteredCsvFiles] = useState<CSVFile[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [columnModes, setColumnModes] = useState<Record<string, ColumnMode>>({});
  const [groupedRowsWithDisplay, setGroupedRowsWithDisplay] = useState<Array<{groupValues: Record<string, string>, displayValues: Record<string, string>}>>([]);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [finalizeProgress, setFinalizeProgress] = useState<string>("");
  
  // Cache for unique values to prevent re-running expensive searches
  const uniqueValuesCache = useRef<Map<string, { values: string[], timestamp: number, isComplete: boolean, totalCount?: number }>>(new Map());
  const activeSearches = useRef<Map<string, Promise<string[]>>>(new Map());
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  const [displayValuesState, setDisplayValuesState] = useState<Record<string, string | null>>({});
  // Persist upload status across chat navigation
  const [uploadStatus, setUploadStatus] = useState<{ status: 'idle' | 'reading' | 'parsing' | 'saving' | 'verifying' | 'success' | 'error', message?: string, fileName?: string, percent?: number, timestamp?: number }>(() => {
    try {
      const saved = sessionStorage.getItem('csv_upload_status');
      if (saved) {
        const parsed = JSON.parse(saved);

        // Clear any in-progress statuses - if we're mounting fresh, the upload process has stopped
        const inProgressStatuses = ['reading', 'parsing', 'saving', 'verifying'];
        if (inProgressStatuses.includes(parsed.status)) {
          sessionStorage.removeItem('csv_upload_status');
          return { status: 'idle' };
        }

        // Clear stale statuses (older than 30 seconds)
        if (parsed.timestamp && Date.now() - parsed.timestamp > 30000) {
          sessionStorage.removeItem('csv_upload_status');
          return { status: 'idle' };
        }

        return parsed;
      }
      return { status: 'idle' };
    } catch {
      return { status: 'idle' };
    }
  });

  // Sync upload status to sessionStorage
  useEffect(() => {
    try {
      if (uploadStatus.status === 'idle') {
        sessionStorage.removeItem('csv_upload_status');
      } else {
        sessionStorage.setItem('csv_upload_status', JSON.stringify({
          ...uploadStatus,
          timestamp: Date.now()
        }));
      }
    } catch (error) {
      console.warn('Failed to persist upload status:', error);
    }
  }, [uploadStatus]);
  const [uniqueValuesProgress, setUniqueValuesProgress] = useState<Record<string, { processedMB: number, uniqueCount: number, totalMB?: number }>>({});
  const [loadingColumn, setLoadingColumn] = useState<string | null>(null);
  const [largeFileConfirmations, setLargeFileConfirmations] = useState<Set<string>>(new Set()); // Track confirmed large files
  const [pendingLargeFileColumn, setPendingLargeFileColumn] = useState<{ column: string, fileSizeGB: number } | null>(null);
  const [isInitializingDuckDB, setIsInitializingDuckDB] = useState(false);

  useEffect(() => {
    const loadCsvFiles = async () => {
      try {
        // Try to load from IndexedDB first
        const metadataFiles = await getAllCsvFileMetadata();
        
        if (metadataFiles.length > 0) {
          const files: CSVFile[] = metadataFiles.map((meta: any) => ({
            id: meta.id,
            name: meta.name,
            headers: meta.headers || [],
            rowCount: meta.rowCount || 0,
            uploadedAt: meta.uploadedAt || Date.now(),
            hasDuckDB: meta.hasDuckDB || false,
            tableName: meta.tableName || undefined,
            size: meta.size || undefined,
            data: [],
          }));
          
          setCsvFiles(files);
          setFilteredCsvFiles(files);
          return;
        }
        
        // Fallback to localStorage for migration
        const saved = localStorage.getItem("db_csv_files");
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (!Array.isArray(parsed)) {
              setCsvFiles([]);
              setFilteredCsvFiles([]);
              return;
            }
  
            let needsSave = false;
            
            // Process files in chunks with yielding to prevent blocking
            const CHUNK_SIZE = 5;
            const cleanedFiles: CSVFile[] = [];
            
            for (let i = 0; i < parsed.length; i += CHUNK_SIZE) {
              const chunk = parsed.slice(i, i + CHUNK_SIZE);
              
              const chunkPromises = chunk.map(async (file: CSVFile | null) => {
                if (!file) return null;
                
                if (Array.isArray(file.data) && file.data.length > 0) {
                  const storageKey = `db_csv_data_${file.id}`;
                  const existingData = localStorage.getItem(storageKey);
                  if (!existingData) {
                    console.log('CSVSelector: File has data but not in storage, saving it...', file.name);
                    try {
                      const headers = file.headers || (file.data[0] ? Object.keys(file.data[0]) : []);
                      const csvText = stringifyCsv(headers, file.data);
                      await saveCsvDataText(file.id, csvText, file.data);
                      console.log('CSVSelector: Successfully saved data for', file.name);
                    } catch (e) {
                      console.error('CSVSelector: Error saving file data:', e);
                    }
                  }
                }
                
                const { updatedFile, migrated } = await migrateLegacyCsvFile(file);
                if (migrated) {
                  needsSave = true;
                }
                if (!updatedFile.rowCount && Array.isArray(file.data)) {
                  updatedFile.rowCount = file.data.length;
                }
                return updatedFile;
              });
              
              const chunkResults = await Promise.all(chunkPromises);
              cleanedFiles.push(...chunkResults.filter(Boolean) as CSVFile[]);
              
              // Yield to UI thread after each chunk
              if (i + CHUNK_SIZE < parsed.length) {
                await new Promise(resolve => setTimeout(resolve, 0));
              }
            }
  
            // Migrate to IndexedDB and clear localStorage
            if (cleanedFiles.length > 0) {
              try {
                await saveAllCsvFileMetadata(cleanedFiles);
                localStorage.removeItem("db_csv_files");
                console.log('CSVSelector: Migrated CSV metadata to IndexedDB');
              } catch (e) {
                console.error('CSVSelector: Error migrating to IndexedDB:', e);
                if (needsSave) {
                  try {
                    localStorage.setItem("db_csv_files", JSON.stringify(cleanedFiles));
                  } catch (quotaError) {
                    console.error('CSVSelector: localStorage quota exceeded, metadata not saved:', quotaError);
                  }
                }
              }
            }
  
            setCsvFiles(cleanedFiles);
            setFilteredCsvFiles(cleanedFiles);
          } catch (e) {
            console.error("Error loading CSV files:", e);
            setCsvFiles([]);
            setFilteredCsvFiles([]);
          }
        } else {
          setCsvFiles([]);
          setFilteredCsvFiles([]);
        }
      } catch (e) {
        console.error("Error loading CSV files:", e);
        setCsvFiles([]);
        setFilteredCsvFiles([]);
      }
    };
  
    loadCsvFiles();
  
    const handleStorageChange = () => {
      loadCsvFiles();
    };
  
    window.addEventListener("storage", handleStorageChange);

    // Reduced from 1s to 5s to reduce CPU usage
    // Keep running even when tab is hidden to allow background processing
    const interval = setInterval(() => {
      loadCsvFiles();
    }, 5000);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  // Initialize DuckDB for better performance with graceful fallback
  const initializeDuckDBConnection = async () => {
    if (isDuckDBInitialized() || isInitializingDuckDB) return;
    
    setIsInitializingDuckDB(true);
    try {
      const success = await safeInitializeDuckDB();
      if (success) {
        console.log('✅ DuckDB initialized for enhanced CSV processing');
      } else {
        console.error('❌ DuckDB initialization failed - DuckDB is required for data file processing');
        setUploadStatus({
          status: 'error',
          message: 'DuckDB initialization failed. Please refresh the page and try again. DuckDB is required for data file processing.',
        });
      }
    } catch (error) {
      console.error('❌ DuckDB initialization error:', error);
      setUploadStatus({ 
        status: 'error', 
        message: `DuckDB initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}. Please refresh the page and try again.`, 
      });
    } finally {
      setIsInitializingDuckDB(false);
    }
  };

  useEffect(() => {
    initializeDuckDBConnection();
  }, []);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const fileSizeMB = file.size / (1024 * 1024);
    const fileSizeGB = file.size / (1024 * 1024 * 1024);

    // Files larger than 2GB will automatically use chunking
    const fileSize = fileSizeGB >= 1 ? fileSizeGB.toFixed(2) + 'GB' : fileSizeMB.toFixed(1) + 'MB';
    const processingMessage = fileSizeGB > 2.0
      ? `Processing large file (${fileSize}) with chunking...`
      : `Processing file (${fileSize})...`;

    setUploadStatus({ status: 'reading', message: processingMessage, fileName: file.name });

    try {
      // Try to initialize DuckDB if not already initialized
      let duckDBAvailable = isDuckDBInitialized();
      
      if (!duckDBAvailable && !isInitializingDuckDB) {
        console.log('DuckDB not initialized, attempting initialization...');
        setIsInitializingDuckDB(true);
        try {
          duckDBAvailable = await safeInitializeDuckDB();
          if (duckDBAvailable) {
            console.log('✅ DuckDB initialized successfully');
          } else {
            console.error('❌ DuckDB initialization failed - DuckDB is required');
            setUploadStatus({
              status: 'error',
              message: 'DuckDB initialization failed. Please refresh the page and try again. DuckDB is required for data file processing.',
              fileName: file.name
            });
            setTimeout(() => setUploadStatus({ status: 'idle' }), 10000);
            return;
          }
        } catch (initError) {
          console.error('❌ DuckDB initialization error:', initError);
          setUploadStatus({ 
            status: 'error', 
            message: `DuckDB initialization failed: ${initError instanceof Error ? initError.message : 'Unknown error'}. Please refresh the page and try again.`, 
            fileName: file.name 
          });
          setTimeout(() => setUploadStatus({ status: 'idle' }), 10000);
          return;
        } finally {
          setIsInitializingDuckDB(false);
        }
      }
      
      // If still not available after initialization attempt, show error
      if (!duckDBAvailable) {
        setUploadStatus({
          status: 'error',
          message: 'DuckDB is not available. Please refresh the page and try again. DuckDB is required for data file processing.',
          fileName: file.name
        });
        setTimeout(() => setUploadStatus({ status: 'idle' }), 10000);
        return;
      }
      
      if (duckDBAvailable) {
        // Detect file type from extension
        const fileExtension = file.name.toLowerCase().split('.').pop() || '';
        const fileType = fileExtension === 'csv' ? 'CSV' :
                        fileExtension === 'parquet' ? 'Parquet' :
                        fileExtension === 'xlsx' || fileExtension === 'xls' ? 'Excel' :
                        fileExtension === 'json' ? 'JSON' : 'CSV';

        console.log(`Using DuckDB for ${fileType} processing (${fileSizeMB.toFixed(1)}MB file)`);

        try {
          // Generate the ID first, then pass it to the appropriate processor
          const csvFileId = generatePrefixedId('csv');

          // Route to appropriate processor based on file type
          let result;
          if (fileExtension === 'parquet') {
            result = await processParquetWithDuckDB(file, (progress) => {
              setUploadStatus({
                status: 'parsing',
                message: progress.message || `Processing ${progress.percent.toFixed(1)}%`,
                fileName: progress.file,
                percent: progress.percent,
              });
            }, csvFileId);
          } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
            result = await processExcelWithDuckDB(file, (progress) => {
              setUploadStatus({
                status: 'parsing',
                message: progress.message || `Processing ${progress.percent.toFixed(1)}%`,
                fileName: progress.file,
                percent: progress.percent,
              });
            }, csvFileId);
          } else if (fileExtension === 'json') {
            result = await processJSONWithDuckDB(file, (progress) => {
              setUploadStatus({
                status: 'parsing',
                message: progress.message || `Processing ${progress.percent.toFixed(1)}%`,
                fileName: progress.file,
                percent: progress.percent,
              });
            }, csvFileId);
          } else {
            // Default to CSV processing
            result = await processCSVWithDuckDB(file, (progress) => {
              setUploadStatus({
                status: 'parsing',
                message: progress.message || `Processing ${progress.percent.toFixed(1)}%`,
                fileName: progress.file,
                percent: progress.percent,
              });
            }, csvFileId);
          }
        
          const csvFile: CSVFile = {
            id: csvFileId,  // Use the same ID that was registered in DuckDB
            name: file.name,
            headers: result.headers,
            rowCount: result.rowCount,
            uploadedAt: Date.now(),
            hasDuckDB: result.hasDuckDB,
            fileBlob: result.fileBlob,
            data: result.data,
            tableName: (result as any).tableName, // Store DuckDB table name
          };
          
          // Save the file to IndexedDB
          setUploadStatus({ status: 'saving', message: `Saving ${result.rowCount.toLocaleString()} rows...`, fileName: file.name });
          if (result.fileBlob) {
            await saveCsvDataBlob(csvFile.id, file, result.data || [], csvFile.headers, result.rowCount, (progress) => {
              setUploadStatus({ 
                status: 'saving', 
                message: progress.message || `Saving ${result.rowCount.toLocaleString()} rows... (${progress.percent}%)`, 
                fileName: file.name 
              });
            });
          } else if (result.data) {
            const csvText = stringifyCsv(csvFile.headers, result.data);
            await saveCsvDataText(csvFile.id, csvText, result.data);
          }
          
          const updatedFiles = [...csvFiles, csvFile];
          setCsvFiles(updatedFiles);
          // Save metadata to IndexedDB (without data arrays to avoid localStorage quota)
          try {
            await saveCsvFileMetadata({
              id: csvFile.id,
              name: csvFile.name,
              headers: csvFile.headers,
              rowCount: csvFile.rowCount || 0,
              uploadedAt: csvFile.uploadedAt,
              hasDuckDB: csvFile.hasDuckDB,
              tableName: csvFile.tableName,
            });
            await saveAllCsvFileMetadata(updatedFiles.map(f => ({
              id: f.id,
              name: f.name,
              headers: f.headers,
              rowCount: f.rowCount,
              uploadedAt: f.uploadedAt,
              hasDuckDB: f.hasDuckDB || false,
              tableName: f.tableName,
            })));
          } catch (metadataError) {
            console.error('CSVSelector: Error saving metadata to IndexedDB:', metadataError);
          }
          
          console.log("CSVSelector: File uploaded successfully with DuckDB:", csvFile.name, "Rows:", result.rowCount, "ID:", csvFile.id);
          
          // Reset status after brief delay
          setTimeout(() => setUploadStatus({ status: 'idle' }), 1000);
          return;
        } catch (duckDBError) {
          console.error('DuckDB processing failed:', duckDBError);
          setUploadStatus({
            status: 'error',
            message: `DuckDB processing failed: ${duckDBError instanceof Error ? duckDBError.message : 'Unknown error'}. DuckDB is required for data file processing.`,
            fileName: file.name
          });
          setTimeout(() => setUploadStatus({ status: 'idle' }), 5000);
          return;
        }
      } else {
        // DuckDB-only: No fallback
        setUploadStatus({
          status: 'error',
          message: 'DuckDB is required for data file processing. Please ensure DuckDB is available.',
          fileName: file.name
        });
        setTimeout(() => setUploadStatus({ status: 'idle' }), 5000);
        return;
      }

      // DuckDB-only: This code should never be reached
      throw new Error('DuckDB is required for data file processing. Please ensure DuckDB is available.');
    } catch (error) {
      const displayMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      const errorDetails = error instanceof Error ? error.stack : String(error);
      
      console.error('CSVSelector: Error uploading file:', error);
      console.error('Error details:', errorDetails);
      
      setUploadStatus({ 
        status: 'error', 
        message: `Error: ${displayMessage}. Check console for details.`, 
        fileName: file.name 
      });
      
      // Show error for 10 seconds, then reset
      setTimeout(() => setUploadStatus({ status: 'idle' }), 10000);
    }
  };

  // Filter CSV files based on search query
  useEffect(() => {
    if (!fileSearchQuery.trim()) {
      setFilteredCsvFiles(csvFiles);
    } else {
      const query = fileSearchQuery.toLowerCase();
      const filtered = csvFiles.filter(file => 
        file.name.toLowerCase().includes(query) ||
        file.headers.some(header => header.toLowerCase().includes(query))
      );
      setFilteredCsvFiles(filtered);
    }
  }, [fileSearchQuery, csvFiles]);
  
  // Get available columns from selected CSV files (or all if none selected)
  const availableColumns = (() => {
    const filesToUse = selectedCsvIds.length > 0 
      ? csvFiles.filter(f => selectedCsvIds.includes(f.id))
      : csvFiles;
    
    if (filesToUse.length === 0) return [];
    
    // Combine headers from selected CSV files
    const allHeaders = new Set<string>();
    filesToUse.forEach(file => {
      if (file.headers && Array.isArray(file.headers)) {
        file.headers.forEach(header => allHeaders.add(header));
      }
    });
    
    // Try to get from Value Info if available (for selected files)
    selectedCsvIds.forEach(csvId => {
      try {
        const valueInfo = getValueInfo(csvId, 'csv');
        if (valueInfo && valueInfo.columns) {
          valueInfo.columns.forEach((col: any) => {
            if (col.name) allHeaders.add(col.name);
          });
        }
      } catch (e) {
        // Fallback to headers
      }
    });
    
    return Array.from(allHeaders).map(col => ({ value: col, label: col })).sort((a, b) => a.label.localeCompare(b.label));
  })();
  
  // Get unique values from a column (from selected CSV files combined)
  // Uses caching and prevents duplicate searches
  // For columns with millions of values, returns a sample and indicates there are more
  const getUniqueValues = useCallback(async (column: string): Promise<string[]> => {
    const cacheKey = `${selectedCsvIds.join(',')}:${column}`;

    // Check cache first
    const cached = uniqueValuesCache.current.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
      return cached.values;
    }
    
    // Check if search is already in progress - return it immediately without waiting
    const activeSearch = activeSearches.current.get(cacheKey);
    if (activeSearch) return activeSearch;

    // Start new search
    const searchPromise = (async () => {
      let timeoutId: NodeJS.Timeout | null = null;
      try {
        setLoadingColumn(column);

        // Add timeout to prevent infinite hanging
        timeoutId = setTimeout(() => {
          setLoadingColumn(null);
          activeSearches.current.delete(cacheKey);
        }, 60000);

        if (csvFiles.length === 0 || selectedCsvIds.length === 0) {
          if (timeoutId) clearTimeout(timeoutId);
          setLoadingColumn(null);
          return [];
        }
    
        // For large files, use streaming to get unique values from entire file
        // Try IndexedDB first, then localStorage fallback
        let files: any[] = [];
        try {
          const metadataFiles = await getAllCsvFileMetadata();
          // Convert metadata to file format for compatibility
          files = metadataFiles.map((meta: any) => ({
            id: meta.id,
            name: meta.name,
            headers: meta.headers || [],
            rowCount: meta.rowCount || 0,
            uploadedAt: meta.uploadedAt || Date.now(),
            hasDuckDB: meta.hasDuckDB || false,
            tableName: meta.tableName || undefined,
          }));
        } catch (e) {
          console.warn('Error loading from IndexedDB, trying localStorage:', e);
          // Fallback to localStorage
          const saved = localStorage.getItem("db_csv_files");
          if (saved) {
            const parsed = JSON.parse(saved);
            files = Array.isArray(parsed) ? parsed : [];
          }
        }
        
        if (files.length === 0) {
          setLoadingColumn(null);
          return [];
        }
        const allUniqueValues = new Set<string>();
        let totalProcessed = 0;
        
        // Check if any file is larger than 1GB and requires confirmation
        let totalSizeGB = 0;
          for (const id of selectedCsvIds) {
            const file = files.find((f: any) => f.id === id);
          if (file) {
            // Try to get actual file size from IndexedDB
            try {
              const db = await initDB();
              const transaction = db.transaction(['csvFiles'], "readonly");
              const store = transaction.objectStore('csvFiles');
              const storageKey = `db_csv_data_${file.id}`;
              const result = await new Promise<any | null>((resolve, reject) => {
                const request = store.get(storageKey);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              });
              
              if (result) {
                // Use actual size from IndexedDB if available
                if (result.size) {
                  totalSizeGB += result.size / (1024 * 1024 * 1024);
                } else if (result.fileBlob) {
                  totalSizeGB += result.fileBlob.size / (1024 * 1024 * 1024);
                } else if (result.csvText) {
                  totalSizeGB += result.csvText.length / (1024 * 1024 * 1024);
                } else if (file.rowCount) {
                  // Estimate: assume ~200 bytes per row on average
                  totalSizeGB += (file.rowCount * 200) / (1024 * 1024 * 1024);
                }
              } else if (file.rowCount) {
                // Fallback: estimate from rowCount
                totalSizeGB += (file.rowCount * 200) / (1024 * 1024 * 1024);
          }
        } catch (e) {
              // If we can't check, estimate from rowCount
              if (file.rowCount) {
                totalSizeGB += (file.rowCount * 200) / (1024 * 1024 * 1024);
              }
            }
          }
        }
        
        // If total size > 1GB and not yet confirmed, require confirmation
        const confirmationKey = `${selectedCsvIds.join(',')}:${column}`;
        if (totalSizeGB > 1 && !largeFileConfirmations.has(confirmationKey)) {
          setPendingLargeFileColumn({ column, fileSizeGB: totalSizeGB });
          setLoadingColumn(null);
          // Don't cache empty results - return empty but don't store in cache
          // Remove from activeSearches immediately since we're returning early
          activeSearches.current.delete(cacheKey);
          return []; // Return empty array - will be populated after confirmation
        }
        
        // Process each selected file
        for (const id of selectedCsvIds) {
          const file = files.find((f: any) => f.id === id);
          if (file) {
            // Use streaming function - no cap, process entire file with progress updates
            const fileUniqueValues = await getUniqueValuesFromFile(file, column, (progress) => {
              setUniqueValuesProgress(prev => ({
                ...prev,
                [cacheKey]: {
                  ...progress,
                  totalMB: file.size / (1024 * 1024)
                }
              }));
            });
            fileUniqueValues.forEach(val => {
              allUniqueValues.add(val);
              totalProcessed++;
            });
          }
        }
        
        const allValues = Array.from(allUniqueValues).sort();
        
        // Limit displayed values to 100,000 for UI performance
        // But mark as incomplete if there are more, so "select all" still works with full dataset
        const MAX_DISPLAY_VALUES = 100000;
        const isComplete = allValues.length <= MAX_DISPLAY_VALUES;
        const result = allValues.slice(0, MAX_DISPLAY_VALUES);
        
        // Clear progress after completion
        setUniqueValuesProgress(prev => {
          const newProgress = { ...prev };
          delete newProgress[cacheKey];
          return newProgress;
        });
        if (timeoutId) clearTimeout(timeoutId);
        setLoadingColumn(null);
        
        // Cache the result with completion status
        uniqueValuesCache.current.set(cacheKey, {
          values: result,
          timestamp: Date.now(),
          isComplete: isComplete,
          totalCount: allValues.length
        });

        return result;
      } catch (error) {
        console.error('CSVSelector: Error getting unique values:', error);
        setLoadingColumn(null);
        activeSearches.current.delete(cacheKey);

        // Fallback to old method
        try {
          let csvData = await getCsvFileData(selectedCsvIds, null, null);
          if (!csvData || csvData.length === 0) return [];

          const firstRow = csvData[0];
          if (!firstRow) return [];

          let actualColumnName: string | undefined = column;
          if (!(column in firstRow)) {
            actualColumnName = Object.keys(firstRow).find(
              key => key.toLowerCase() === column.toLowerCase()
            );
            if (!actualColumnName) return [];
          }
    
    const values = new Set<string>();
    csvData.forEach((row: any) => {
      if (row && actualColumnName && row[actualColumnName] !== null && row[actualColumnName] !== undefined) {
        const value = String(row[actualColumnName]).trim();
        if (value !== '' && !(value.toLowerCase().includes('custom code:') && value.trim().length <= 20)) {
          values.add(value);
        }
      }
    });
    
    const allValues = Array.from(values).sort();
    
    // Limit displayed values to 100,000 for UI performance
    const MAX_DISPLAY_VALUES = 100000;
    const isComplete = allValues.length <= MAX_DISPLAY_VALUES;
    const result = allValues.slice(0, MAX_DISPLAY_VALUES);
          
    // Cache the result with completion status
    uniqueValuesCache.current.set(cacheKey, {
      values: result,
      timestamp: Date.now(),
      isComplete: isComplete,
      totalCount: allValues.length
    });

    if (timeoutId) clearTimeout(timeoutId);
    return result;
        } catch (fallbackError) {
          console.error('CSVSelector: Fallback failed:', fallbackError);
          if (timeoutId) clearTimeout(timeoutId);
          return [];
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        activeSearches.current.delete(cacheKey);
        setLoadingColumn(null);
      }
    })();
    
    // Store active search immediately to prevent duplicate calls
    activeSearches.current.set(cacheKey, searchPromise);
    
    return searchPromise;
  }, [selectedCsvIds, csvFiles, largeFileConfirmations]); // Recreate when CSV selection, files, or confirmations change
  
  // Clear cache when CSV selection changes
  useEffect(() => {
    // Only clear cache entries that don't match current selection
    const currentKeyPrefix = selectedCsvIds.join(',');
    for (const [key] of uniqueValuesCache.current) {
      if (!key.startsWith(currentKeyPrefix + ':')) {
        uniqueValuesCache.current.delete(key);
      }
    }
  }, [selectedCsvIds]);
  
  // Get first value for display indicator
  // Use useCallback to ensure function updates when getUniqueValues changes
  const getFirstValue = useCallback(async (column: string): Promise<string | null> => {
    const uniqueValues = await getUniqueValues(column);
    return uniqueValues.length > 0 ? uniqueValues[0] : null;
  }, [getUniqueValues]);

  // Get unique combinations of values from multiple columns (like pandas groupby)
  // Updated to support display columns like MatchSelector
  // Use useCallback to ensure function updates when selectedCsvIds changes
  // Now uses DuckDB for fast GROUP BY queries instead of loading all data into memory
  const getCombinedGroupValues = useCallback(async (columns: string[], modesOverride?: Record<string, ColumnMode>): Promise<string[]> => {
    if (columns.length === 0 || csvFiles.length === 0 || selectedCsvIds.length === 0) {
      return [];
    }

    const currentModes = modesOverride || columnModes;
    const groupOnlyColumns = columns.filter(col => currentModes[col] === 'group' || !currentModes[col]);

    // If no group columns, just return empty - display columns don't need unique values
    if (groupOnlyColumns.length === 0) {
      return [];
    }

    const displayColumns = selectedFilterColumns
      .filter(col => currentModes[col] === 'display')
      .filter(col => !groupOnlyColumns.includes(col));

    // Try to use DuckDB for fast GROUP BY query
    try {
      const { executeDuckDBSql, isFileRegisteredInDuckDB } = await import('@/lib/duckdb');

      // Check if CSV is registered in DuckDB
      const csvId = Array.isArray(selectedCsvIds) ? selectedCsvIds[0] : selectedCsvIds;
      if (isFileRegisteredInDuckDB(csvId)) {
        // Build DuckDB GROUP BY query
        const quotedGroupCols = groupOnlyColumns.map(col => `"${col.replace(/"/g, '""')}"`);
        const columnList = quotedGroupCols.join(', ');

        let selectClause = columnList;
        if (displayColumns.length > 0) {
          const displaySelects = displayColumns.map(col => {
            const quotedCol = `"${col.replace(/"/g, '""')}"`;
            return `MIN(${quotedCol}) as ${quotedCol}`;
          }).join(', ');
          selectClause = `${columnList}, ${displaySelects}`;
        }

        // Use DuckDB for fast GROUP BY - limit to 100k for performance
        const query = `SELECT ${selectClause} FROM csv_data GROUP BY ${columnList} ORDER BY ${columnList} LIMIT 100000`;
        const rows = await executeDuckDBSql(csvId, query);

        // Store grouped rows with display values
        const groupedData = rows.map((row: any) => {
          const groupValues: Record<string, string> = {};
          const displayValues: Record<string, string> = {};

          groupOnlyColumns.forEach(col => {
            const val = row[col];
            if (val != null) groupValues[col] = String(val);
          });

          displayColumns.forEach(col => {
            const val = row[col];
            if (val != null && val !== undefined) {
              displayValues[col] = String(val);
            }
          });

          return { groupValues, displayValues };
        });

        setGroupedRowsWithDisplay(groupedData);

        // Format as "val1, val2, ..." for display
        const combinedValues = rows.map((row: any) => {
          return groupOnlyColumns.map(col => {
            const val = row[col];
            return val != null ? String(val) : '';
          }).filter((v: string) => v !== '').join(', ');
        }).filter((v: string) => {
          if (!v || v.trim() === '') return false;
          if (v.toLowerCase().includes('custom code:') && v.trim().length <= 20) return false;
          return true;
        });

        console.log('🔍 getCombinedGroupValues (DuckDB):', {
          groupOnlyColumns,
          displayColumns,
          rowCount: rows.length,
          sampleRows: rows.slice(0, 3),
          sampleCombinedValues: combinedValues.slice(0, 5),
          groupedDataSample: groupedData.slice(0, 3)
        });

        return combinedValues;
      }
    } catch (duckdbError) {
      console.warn('DuckDB query failed, falling back to in-memory processing:', duckdbError);
    }

    // Fallback: Load data into memory (slower for large datasets)
    const csvData = await getCsvFileData(selectedCsvIds, null, null);
    if (!csvData || csvData.length === 0) {
      return [];
    }
    
    const firstRow = csvData[0];
    if (!firstRow) return [];

    // Find actual column names (case-insensitive match) for group columns
    const actualGroupColumnNames: string[] = [];
    for (const column of groupOnlyColumns) {
      let actualColumnName: string | undefined = column;
      if (!(column in firstRow)) {
        actualColumnName = Object.keys(firstRow).find(
          key => key.toLowerCase() === column.toLowerCase()
        );
        if (!actualColumnName) return [];
      }
      actualGroupColumnNames.push(actualColumnName);
    }

    // Find actual column names for display columns
    const actualDisplayColumnNames: string[] = [];
    for (const column of displayColumns) {
      let actualColumnName: string | undefined = column;
      if (!(column in firstRow)) {
        actualColumnName = Object.keys(firstRow).find(
          key => key.toLowerCase() === column.toLowerCase()
        );
        if (!actualColumnName) continue;
      }
      actualDisplayColumnNames.push(actualColumnName);
    }
    
    // Group data by group columns and collect display values with yielding
    const groupedMap = new Map<string, { groupValues: Record<string, string>, displayValues: Record<string, string> }>();

    const YIELD_INTERVAL = 1000; // Yield every 1000 rows
    const MAX_COMBINATIONS = 100000; // Limit to 100k combinations for performance

    for (let i = 0; i < csvData.length; i++) {
      const row = csvData[i];
      if (!row) continue;

      // Get group values (include NULL values as "(null)")
      const groupValues: string[] = [];

      for (const colName of actualGroupColumnNames) {
        const cellValue = row[colName];
        // Include NULL values as "(null)"
        if (cellValue === null || cellValue === undefined || cellValue === '') {
          groupValues.push('(null)');
        } else {
          groupValues.push(String(cellValue).trim());
        }
      }

      const groupKey = groupValues.join('|');

      if (!groupedMap.has(groupKey)) {
        // Stop if we've reached the limit
        if (groupedMap.size >= MAX_COMBINATIONS) {
          console.warn(`Reached maximum of ${MAX_COMBINATIONS} unique combinations. Some values may not be shown.`);
          break;
        }

        const groupValuesObj: Record<string, string> = {};
        groupOnlyColumns.forEach((col, idx) => {
          groupValuesObj[col] = groupValues[idx];
        });
        groupedMap.set(groupKey, {
          groupValues: groupValuesObj,
          displayValues: {}
        });
      }

      // Add display values
      const entry = groupedMap.get(groupKey)!;
      displayColumns.forEach((col, idx) => {
        if (!entry.displayValues[col] && actualDisplayColumnNames[idx]) {
          const cellValue = row[actualDisplayColumnNames[idx]];
          if (cellValue != null && cellValue !== undefined) {
            entry.displayValues[col] = String(cellValue).trim();
          }
        }
      });

      // Yield to UI thread periodically
      if (i % YIELD_INTERVAL === 0 && i > 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    // Store grouped rows with display values
    const groupedData = Array.from(groupedMap.values());
    setGroupedRowsWithDisplay(groupedData);

    // Format as "val1, val2, ..." for display and selection
    const result = groupedData.map(entry => {
      return groupOnlyColumns.map(col => entry.groupValues[col]).filter(v => v !== '').join(', ');
    }).filter(v => {
      if (!v || v.trim() === '') return false;
      if (v.toLowerCase().includes('custom code:') && v.trim().length <= 20) return false;
      return true;
    }).sort();

    return result;
  }, [selectedCsvIds, csvFiles, selectedFilterColumns, columnModes]);


  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const targetElement = target as HTMLElement;

      // Don't close if clicking on a button (like remove buttons in MultiSelectGroupBy)
      if (targetElement.closest('button')) {
        return;
      }

      // Check if click is outside the dropdown
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setIsOpen(false);
      }
    };

    const handleScroll = () => {
      // Close dropdown when any parent scrolls
      if (isOpen) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      // Listen for scroll on window and all parent elements
      window.addEventListener("scroll", handleScroll, true);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        window.removeEventListener("scroll", handleScroll, true);
      };
    }
  }, [isOpen]);

  const handleColumnsChange = async (columns: string[]) => {
    const newValues: Record<string, string | string[] | null> = { ...selectedFilterValues };
    const newModes: Record<string, ColumnMode> = { ...columnModes };
    
    // CRITICAL FIX: Get all currently selected columns (group + display)
    // Display columns are tracked in columnModes but not in selectedFilterColumns
    // IMPORTANT: Only preserve display columns that are still in the new columns list
    // This allows display columns to be removed when user clicks X
    const currentDisplayColumns = Object.keys(columnModes)
      .filter(col => columnModes[col] === 'display' && columns.includes(col));
    
    // Merge new columns with existing display columns that are still selected
    const allColumns = [...new Set([...columns, ...currentDisplayColumns])];
    
    // Remove values and modes for columns that are no longer selected
    // Only remove if they're not in the merged column list
    Object.keys(newValues).forEach(col => {
      if (!allColumns.includes(col)) {
        delete newValues[col];
      }
    });
    Object.keys(newModes).forEach(col => {
      if (!allColumns.includes(col)) {
        delete newModes[col];
      }
    });
    
    // Set default mode to 'group' for newly added columns
    // IMPORTANT: Don't reset mode for existing display columns
    allColumns.forEach(col => {
      // If column is not in newModes, it's either new or was previously deselected
      // In either case, set it to 'group' mode (unless it's a display column we're preserving)
      if (!newModes[col]) {
        // Only set to 'group' if it's not already a display column
        if (!currentDisplayColumns.includes(col)) {
          newModes[col] = 'group';
        }
      }
    });
    
    setColumnModes(newModes);
    
    // IMPORTANT: Remove values for columns that are in display mode
    const groupColumns = allColumns.filter(col => newModes[col] === 'group' || !newModes[col]);
    const filteredNewValues: Record<string, string | string[] | null> = {};
    groupColumns.forEach(col => {
      if (newValues[col] != null) {
        filteredNewValues[col] = newValues[col];
      }
    });
    
    // Get display columns and try to find their values from the currently selected row
    const displayColumns = allColumns.filter(col => newModes[col] === 'display');
    // Preserve existing display values for columns that are still selected
    let displayValues: Record<string, string | null> = {};
    displayColumns.forEach(col => {
      if (displayValuesState[col] != null) {
        displayValues[col] = displayValuesState[col];
      }
    });
    
    // Try to find display values from the currently selected row if we have a selection
    // IMPORTANT: Only auto-populate display values if we have an exact match
    // Don't auto-select based on partial matches to avoid restoring old selections
    if (displayColumns.length > 0 && groupedRowsWithDisplay.length > 0 && Object.keys(filteredNewValues).length > 0) {
      const matchingRow = groupedRowsWithDisplay.find(row => {
        return groupColumns.every(col => {
          const rowValue = row.groupValues[col];
          const selectedValue = filteredNewValues[col];
          // For arrays, check if any value matches
          if (Array.isArray(selectedValue)) {
            return selectedValue.some(val => String(rowValue) === String(val));
          }
          return String(rowValue) === String(selectedValue);
        });
      });
      
      if (matchingRow && matchingRow.displayValues) {
        // Only merge display values for columns that don't already have values
        // This prevents overwriting user selections
        displayColumns.forEach(col => {
          if (!displayValues[col] && matchingRow.displayValues[col]) {
            displayValues[col] = matchingRow.displayValues[col];
          }
        });
      }
    }
    
    // Update display values in state
    setDisplayValuesState(displayValues);
    
    // Re-query grouped values when columns change
    if (allColumns.length > 0) {
      getCombinedGroupValues(groupColumns, newModes);
    } else {
      setGroupedRowsWithDisplay([]);
    }

    onSelectCsv(selectedCsvIds, groupColumns, filteredNewValues, displayColumns, displayValues);
  };

  const handleBatchValueSelect = async (column: string, values: string[], select: boolean) => {
    const SELECT_ALL_MARKER = '__SELECT_ALL__';
    const LARGE_SELECTION_THRESHOLD = 10000;
    const MAX_DISPLAY_VALUES = 100000;
    
    const cacheKey = `${selectedCsvIds.join(',')}:${column}`;
    const cached = uniqueValuesCache.current.get(cacheKey);
    const hasMoreValues = cached && cached.totalCount && cached.totalCount > MAX_DISPLAY_VALUES;
    const isSelectingAllDisplayed = select && values.length >= MAX_DISPLAY_VALUES && hasMoreValues;
    
    const groupColumns = selectedFilterColumns.filter(col => columnModes[col] === 'group' || !columnModes[col]);
    
    const newValues: Record<string, string | string[] | null> = {};
    groupColumns.forEach(col => {
      if (selectedFilterValues[col] != null) {
        const val = selectedFilterValues[col];
        newValues[col] = val === SELECT_ALL_MARKER ? SELECT_ALL_MARKER : val;
      }
    });
    
    if (select && (values.length > LARGE_SELECTION_THRESHOLD || isSelectingAllDisplayed)) {
      if (isSelectingAllDisplayed) {
        console.log(`Selecting all displayed values (${values.length.toLocaleString()}) but total is ${cached?.totalCount?.toLocaleString()} - using SELECT_ALL marker for entire dataset`);
      } else {
        console.log(`Large selection (${values.length.toLocaleString()} values) - using SELECT_ALL marker`);
      }
      newValues[column] = SELECT_ALL_MARKER;
      
      // Update immediately without waiting
      const displayColumns = selectedFilterColumns.filter(col => columnModes[col] === 'display');
      const newDisplayValues: Record<string, string | null> = {};
      displayColumns.forEach(col => {
        if (displayValuesState[col] != null) {
          newDisplayValues[col] = displayValuesState[col];
        }
      });
      setDisplayValuesState(newDisplayValues);

      // Use requestAnimationFrame for smooth update
      requestAnimationFrame(() => {
        onSelectCsv(selectedCsvIds, groupColumns, newValues, displayColumns, newDisplayValues);
      });
      return;
    }
    
    // Process values with yielding for medium to large selections
    const existingValue = newValues[column];
    const stringValues = values.map(v => String(v));
    
    if (values.length > 1000) {
      // Process in chunks with yielding for large selections
      const CHUNK_SIZE = 500;
      let processedValues: string[] = [];
      
      // Start with existing values
      if (existingValue === SELECT_ALL_MARKER) {
        if (!select) {
          newValues[column] = null;
        }
        // For select with SELECT_ALL, no change needed
      } else if (Array.isArray(existingValue)) {
        processedValues = [...existingValue.map(v => String(v))];
      } else if (existingValue != null) {
        processedValues = [String(existingValue)];
      }
      
      // Process in chunks
      for (let i = 0; i < stringValues.length; i += CHUNK_SIZE) {
        const chunk = stringValues.slice(i, i + CHUNK_SIZE);
        
        if (select) {
          // Add values from chunk
          const existingSet = new Set(processedValues);
          const newToAdd = chunk.filter(v => !existingSet.has(v));
          processedValues.push(...newToAdd);
          
          // Check if we've exceeded threshold
          if (processedValues.length > LARGE_SELECTION_THRESHOLD) {
            newValues[column] = SELECT_ALL_MARKER;
            break;
          }
        } else {
          // Remove values from chunk
          const chunkSet = new Set(chunk);
          processedValues = processedValues.filter(v => !chunkSet.has(v));
        }
        
        // Yield to UI thread every chunk
        if (i + CHUNK_SIZE < stringValues.length) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      
      // Set final value if not SELECT_ALL
      if (newValues[column] !== SELECT_ALL_MARKER) {
        newValues[column] = processedValues.length > 0 ? processedValues : null;
      }
    } else {
      // Small selection - process immediately
      if (select) {
        if (existingValue === SELECT_ALL_MARKER) {
          // Already selecting all, no change needed
        } else if (Array.isArray(existingValue)) {
          const existingSet = new Set(existingValue.map(v => String(v)));
          const newValuesToAdd = stringValues.filter(v => !existingSet.has(v));
          if (newValuesToAdd.length > 0) {
            newValues[column] = [...existingValue, ...newValuesToAdd];
          }
        } else if (existingValue != null) {
          const existingString = String(existingValue);
          const newValuesToAdd = stringValues.filter(v => v !== existingString);
          if (newValuesToAdd.length > 0) {
            newValues[column] = [existingValue, ...newValuesToAdd];
          }
        } else {
          newValues[column] = stringValues.length === 1 ? stringValues[0] : stringValues;
        }
      } else {
        // Deselect
        if (existingValue === SELECT_ALL_MARKER) {
          newValues[column] = null;
        } else if (Array.isArray(existingValue)) {
          const stringSet = new Set(stringValues);
          const filtered = existingValue.filter(v => !stringSet.has(String(v)));
          newValues[column] = filtered.length > 0 ? filtered : null;
        } else if (existingValue != null && stringValues.includes(String(existingValue))) {
          newValues[column] = null;
        }
      }
    }
    
    // Update display values and selection
    const displayColumns = selectedFilterColumns.filter(col => columnModes[col] === 'display');
    const newDisplayValues: Record<string, string | null> = {};
    displayColumns.forEach(col => {
      if (displayValuesState[col] != null) {
        newDisplayValues[col] = displayValuesState[col];
      }
    });
    setDisplayValuesState(newDisplayValues);

    // Use requestAnimationFrame for smooth update
    requestAnimationFrame(() => {
      onSelectCsv(selectedCsvIds, groupColumns, newValues, displayColumns, newDisplayValues);
    });
  };

  const handleValueSelect = async (column: string, value: string | null) => {
    // Get only group columns (not display columns)
    const groupColumns = selectedFilterColumns.filter(col => columnModes[col] === 'group' || !columnModes[col]);
    
    // If value is null, just remove from values
    if (!value) {
      const newValues: Record<string, string | string[] | null> = {};
      groupColumns.forEach(col => {
        if (col !== column && selectedFilterValues[col] != null) {
          newValues[col] = selectedFilterValues[col];
        }
      });
      const displayColumns = selectedFilterColumns.filter(col => columnModes[col] === 'display');
      // Preserve display values - don't clear them on value selection
      onSelectCsv(selectedCsvIds, groupColumns, newValues, displayColumns, displayValuesState);
      return;
    }
    
    // Parse the selected grouped row - format is now just values without column prefixes
    let parsedValues: Record<string, string> = {};
    
    if (groupColumns.length === 1) {
      // Single column - value is just the raw value
      parsedValues[groupColumns[0]] = value;
    } else if (groupColumns.length > 1 && value.includes(',')) {
      // Multi-column - values are comma-separated in the same order as groupColumns
      const values = value.split(',').map(v => v.trim());
      groupColumns.forEach((col, idx) => {
        if (values[idx]) {
          parsedValues[col] = values[idx];
        }
      });
    } else if (value) {
      // Fallback: single value for single column
      const targetCol = groupColumns.find(col => col === column) || groupColumns[0];
      if (targetCol) {
        parsedValues[targetCol] = value;
      }
    }
    
    // Create newValues that ONLY includes group columns
    // Support multiple value selection: toggle values in/out of arrays
    // IMPORTANT: Start with ALL existing values to preserve selections in other columns
    const newValues: Record<string, string | string[] | null> = {};
    
    // First, copy all existing values to preserve them
    groupColumns.forEach(col => {
      if (selectedFilterValues[col] != null) {
        newValues[col] = selectedFilterValues[col];
      }
    });
    
    // Then, update only the columns that have new parsed values
    // CRITICAL FIX: For multi-column grouping, we need to ensure all values in the combination
    // are added/removed together at the same array index to maintain alignment
    
    if (groupColumns.length > 1) {
      // Multi-column: Check if this exact combination already exists
      // We need to find if ALL column values match at the SAME index
      let combinationIndex = -1;
      let allArrays = true;
      
      // First check if all columns have arrays (or can be converted to arrays)
      for (const col of groupColumns) {
        const existingValue = newValues[col];
        if (existingValue != null && !Array.isArray(existingValue)) {
          allArrays = false;
          break;
        }
      }
      
      if (allArrays) {
        // Check if this combination exists at any index
        const firstCol = groupColumns[0];
        const firstColValues = newValues[firstCol];
        
        if (Array.isArray(firstColValues)) {
          // Check each index to see if the combination matches
          for (let idx = 0; idx < firstColValues.length; idx++) {
            const matches = groupColumns.every(col => {
              const colValues = newValues[col];
              const parsedValue = parsedValues[col];
              if (Array.isArray(colValues) && parsedValue) {
                return String(colValues[idx]) === String(parsedValue);
              }
              return false;
            });
            
            if (matches) {
              combinationIndex = idx;
              break;
            }
          }
        }
      }
      
      if (combinationIndex >= 0) {
        // Combination exists: remove it from all columns at the same index
        Object.keys(parsedValues).forEach(col => {
          const existingValue = newValues[col];
          if (Array.isArray(existingValue)) {
            const filtered = existingValue.filter((_, idx) => idx !== combinationIndex);
            newValues[col] = filtered.length > 0 ? filtered : null;
          }
        });
      } else {
        // Combination doesn't exist: add all values at the same position (end of arrays)
        Object.keys(parsedValues).forEach(col => {
          const parsedValue = String(parsedValues[col]);
          const existingValue = newValues[col];
          
          if (parsedValue != null && parsedValue !== '') {
            if (Array.isArray(existingValue)) {
              // Add to end of array
              newValues[col] = [...existingValue, parsedValue];
            } else if (existingValue != null) {
              // Convert to array with existing value first, then new value
              newValues[col] = [String(existingValue), parsedValue];
            } else {
              // No existing value: set as single value (will become array when more are added)
              newValues[col] = parsedValue;
            }
          }
        });
      }
    } else {
      // Single column: use simple toggle logic (original behavior)
      Object.keys(parsedValues).forEach(col => {
        const parsedValue = String(parsedValues[col]);
        const existingValue = newValues[col];
        
        if (parsedValue != null && parsedValue !== '') {
          // Check if this value is already selected (for multiple selection)
          if (Array.isArray(existingValue)) {
            // Toggle: if value is in array, remove it; otherwise add it
            // Use string comparison to handle number/string mismatches
            const valueIndex = existingValue.findIndex(v => String(v) === parsedValue);
            if (valueIndex >= 0) {
              // Value is in array, remove it
              const filtered = existingValue.filter((_, idx) => idx !== valueIndex);
              newValues[col] = filtered.length > 0 ? filtered : null;
            } else {
              // Value not in array, add it
              newValues[col] = [...existingValue, parsedValue];
            }
          } else if (existingValue != null && String(existingValue) === parsedValue) {
            // Toggle: if same value, deselect
            newValues[col] = null;
          } else if (existingValue != null) {
            // Existing value exists: convert to array and add new value
            newValues[col] = [String(existingValue), parsedValue];
          } else {
            // No existing value: set as single value
            newValues[col] = parsedValue;
          }
        }
      });
    }
    
    // Find display columns and their values for the selected row
    // IMPORTANT: Preserve display columns and values - don't clear them on value selection
    const displayColumns = selectedFilterColumns.filter(col => columnModes[col] === 'display');
    
    // Preserve existing display values - start with what we have in state
    let newDisplayValues: Record<string, string | null> = {};
    displayColumns.forEach(col => {
      // First, try to preserve from state
      if (displayValuesState[col] != null) {
        newDisplayValues[col] = displayValuesState[col];
      }
    });
    
    // Only update display values if we have a matching row (for the first selected value)
    // IMPORTANT: Only auto-populate display values for columns that don't already have values
    // This prevents overwriting user selections when toggling values
    if (displayColumns.length > 0 && groupedRowsWithDisplay.length > 0) {
      // Find the matching row in groupedRowsWithDisplay for the first selected value
      const matchingRow = groupedRowsWithDisplay.find(row => {
        return groupColumns.every(col => {
          const rowValue = row.groupValues[col];
          const selectedValue = Array.isArray(newValues[col]) ? newValues[col][0] : newValues[col];
          return String(rowValue) === String(selectedValue);
        });
      });
      
      if (matchingRow && matchingRow.displayValues) {
        // Only add display values for columns that don't already have values
        // Preserve existing display values
        displayColumns.forEach(col => {
          if (!newDisplayValues[col] && matchingRow.displayValues[col]) {
            newDisplayValues[col] = matchingRow.displayValues[col];
          }
        });
      }
    }
    
    // Update display values in state (preserve them)
    setDisplayValuesState(newDisplayValues);

    // IMPORTANT: Keep display columns and values visible - they'll be removed only on finalization
    // IMPORTANT: Do NOT generate Value Info here - only generate it when checkmark is clicked
    onSelectCsv(selectedCsvIds, groupColumns, newValues, displayColumns, newDisplayValues);
  };

  const handleColumnModeChange = async (column: string, mode: ColumnMode) => {
    const newModes = { ...columnModes, [column]: mode };
    setColumnModes(newModes);

    const groupColumns = selectedFilterColumns.filter(col => newModes[col] === 'group' || !newModes[col]);
    const displayColumns = selectedFilterColumns.filter(col => newModes[col] === 'display');

    // If switching to display mode, remove from filter values
    if (mode === 'display' && selectedFilterValues[column] != null) {
      const newValues: Record<string, string | string[] | null> = {};
      groupColumns.forEach(col => {
        if (selectedFilterValues[col] != null) {
          newValues[col] = selectedFilterValues[col];
        }
      });

      // Preserve existing display values for columns that are still selected
      let displayValues: Record<string, string | null> = {};
      displayColumns.forEach(col => {
        if (displayValuesState[col] != null) {
          displayValues[col] = displayValuesState[col];
        }
      });

      if (displayColumns.length > 0 && groupedRowsWithDisplay.length > 0 && Object.keys(newValues).length > 0) {
        const matchingRow = groupedRowsWithDisplay.find(row => {
          return groupColumns.every(col => {
            const rowValue = row.groupValues[col];
            const selectedValue = newValues[col];
            return rowValue === selectedValue || String(rowValue) === String(selectedValue);
          });
        });

        if (matchingRow && matchingRow.displayValues) {
          // Merge with existing display values
          displayValues = { ...displayValues, ...matchingRow.displayValues };
        }
      }

      // Update display values in state
      setDisplayValuesState(displayValues);

      onSelectCsv(selectedCsvIds, groupColumns, newValues, displayColumns, displayValues);
    }

    // Re-query grouped values when mode changes
    if (selectedFilterColumns.length > 0) {
      getCombinedGroupValues(groupColumns, newModes);
    }
  };
  
  // Handle CSV selection toggle
  const handleCsvToggle = async (csvId: string) => {
    // Separate group columns from display columns based on columnModes
    const groupColumns = selectedFilterColumns.filter(col => columnModes[col] === 'group' || !columnModes[col]);
    const displayColumns = selectedFilterColumns.filter(col => columnModes[col] === 'display');

    if (selectedCsvIds.includes(csvId)) {
      // Remove from selection
      const newIds = selectedCsvIds.filter(id => id !== csvId);

      // CRITICAL: Clear filter values for columns that don't exist in remaining CSVs
      const remainingFiles = csvFiles.filter((f: any) => newIds.includes(f.id));
      const remainingHeaders = new Set<string>();
      remainingFiles.forEach((file: any) => {
        if (file.headers && Array.isArray(file.headers)) {
          file.headers.forEach((h: string) => remainingHeaders.add(h));
        }
      });

      // Filter out values for columns that don't exist in remaining CSVs
      const validFilterValues: Record<string, string | string[] | null> = {};
      Object.keys(selectedFilterValues).forEach(col => {
        if (remainingHeaders.has(col)) {
          validFilterValues[col] = selectedFilterValues[col];
        }
      });

      // Filter out columns that don't exist in remaining CSVs
      const validGroupColumns = groupColumns.filter(col => remainingHeaders.has(col));
      const validDisplayColumns = displayColumns.filter(col => remainingHeaders.has(col));

      onSelectCsv(newIds, validGroupColumns, validFilterValues, validDisplayColumns, undefined);
    } else {
      // Add to selection
      const newIds = [...selectedCsvIds, csvId];

      // Get headers from all selected files
      const selectedFiles = csvFiles.filter((f: any) => newIds.includes(f.id));
      const allHeaders = new Set<string>();
      selectedFiles.forEach((file: any) => {
        if (file.headers && Array.isArray(file.headers)) {
          file.headers.forEach((h: string) => allHeaders.add(h));
        }
      });

      // CRITICAL: Only keep filter values for columns that exist in the new selection
      let newFilterValues: Record<string, string | string[] | null> = {};
      Object.keys(selectedFilterValues).forEach(col => {
        if (allHeaders.has(col)) {
          newFilterValues[col] = selectedFilterValues[col];
        }
      });

      let newGroupColumns = groupColumns.filter(col => allHeaders.has(col));
      let newDisplayColumns = displayColumns.filter(col => allHeaders.has(col));

      // AUTO-SELECT __SELECT_ALL__: Only if no valid group columns remain
      if (newGroupColumns.length === 0 && allHeaders.size > 0) {
        // Get the first column from the newly selected CSV
        const newFile = csvFiles.find((f: any) => f.id === csvId);
        if (newFile && newFile.headers && newFile.headers.length > 0) {
          const firstColumn = newFile.headers[0];
          newGroupColumns = [firstColumn];
          newFilterValues[firstColumn] = '__SELECT_ALL__';
        }
      }

      onSelectCsv(newIds, newGroupColumns, newFilterValues, newDisplayColumns, undefined);
    }
  };

  const handleClearSelection = async () => {
    // Clear valueInfo when clearing selection
    const { deleteValueInfo } = await import("@/lib/chatApi");
    deleteValueInfo('current_selection', 'csv');
    setDisplayValuesState({});
    // Clear all filter values but keep columns, CSV IDs, and modes
    const emptyValues: Record<string, string | string[] | null> = {};
    const groupColumns = selectedFilterColumns.filter(col => columnModes[col] === 'group' || !columnModes[col]);
    const displayColumns = selectedFilterColumns.filter(col => columnModes[col] === 'display');
    onSelectCsv(selectedCsvIds, groupColumns, emptyValues, displayColumns, {});
  };

  // Helper function to handle valueInfo for DuckDB files (called asynchronously)
  const handleDuckDBValueInfo = async (
    selectedCsvIds: string[],
    groupColumns: string[],
    finalFilterValues: Record<string, string | string[] | null>,
    chatId?: string,
    csvFiles?: CSVFile[]
  ) => {
    const { saveValueInfo, deleteValueInfo } = await import("@/lib/chatApi");
    
    // Check if current_selection already exists with the same filters
    const existingCurrentSelection = getValueInfo('current_selection', 'csv', chatId);
    if (existingCurrentSelection) {
      const existingFilterColumns = existingCurrentSelection.filterColumns || [];
      const existingFilterValues = existingCurrentSelection.filterValues || {};
      
      // Check if filters match (same columns and same values)
      const columnsMatch = existingFilterColumns.length === groupColumns.length &&
        existingFilterColumns.every(col => groupColumns.includes(col)) &&
        groupColumns.every(col => existingFilterColumns.includes(col));
      
      const valuesMatch = Object.keys(existingFilterValues).length === Object.keys(finalFilterValues).length &&
        Object.keys(existingFilterValues).every(key => {
          const existingVal = existingFilterValues[key];
          const newVal = finalFilterValues[key];
          if (Array.isArray(existingVal) && Array.isArray(newVal)) {
            return existingVal.length === newVal.length && existingVal.every(v => newVal.includes(v));
          }
          return existingVal === newVal;
        });
      
      if (columnsMatch && valuesMatch) {
        console.log('handleDuckDBValueInfo: ✅ current_selection already exists with same filters, skipping recreation');
        return; // Skip - valueInfo already exists with same filters
      }
    }
    
    // Delete old current_selection if filters don't match
    if (chatId) {
      deleteValueInfo('current_selection', 'csv');
    }
    
    // Generate unique ID for this selection
    const groupValuesForKey = Object.keys(finalFilterValues)
      .filter(k => finalFilterValues[k] != null && groupColumns.includes(k))
      .sort()
      .map(k => {
        const val = finalFilterValues[k];
        return `${k}=${Array.isArray(val) ? val.join(',') : val}`;
      });
    const selectionKey = `${groupColumns.sort().join(',')}:${groupValuesForKey.join(',')}`;
    const selectionHash = selectionKey.split('').reduce((acc, char) => {
      acc = ((acc << 5) - acc) + char.charCodeAt(0);
      return acc & acc;
    }, 0);
    const uniqueValueInfoId = chatId ? `csv_selection_${chatId}_${Math.abs(selectionHash)}` : `csv_selection_${Math.abs(selectionHash)}`;
    const valueInfoId = 'current_selection';
    
    // Build name using only group columns and their values
    const nameParts = groupColumns
      .filter(col => finalFilterValues[col] != null)
      .map(col => {
        const val = finalFilterValues[col];
        if (val === '__SELECT_ALL__') {
          return `${col}=All`;
        }
        if (Array.isArray(val)) {
          const maxDisplay = 2;
          if (val.length > maxDisplay) {
            return `${col}=${val.slice(0, maxDisplay).join(',')}... (${val.length} total)`;
          }
          return `${col}=${val.join(',')}`;
        }
        return `${col}=${val}`;
      });

    const csvFileNames = selectedCsvIds.map(id => {
      const file = csvFiles?.find(f => f.id === id);
      return file ? file.name : id;
    });
    const csvFilesDisplay = selectedCsvIds.length > 1
      ? ` [${csvFileNames.length} files: ${csvFileNames.slice(0, 2).join(', ')}${csvFileNames.length > 2 ? '...' : ''}]`
      : ` [${csvFileNames[0] || 'CSV'}]`;

    const valueInfoName = nameParts.length > 0
      ? `Selected Group: ${nameParts.join(', ')}${csvFilesDisplay}`
      : `Selected Group: ${groupColumns.join(', ')}${csvFilesDisplay}`;
    
    // For DuckDB files, use existing CSV valueInfo if available
    const existingValueInfo = getValueInfo(selectedCsvIds[0], 'csv');
    let valueInfo: any;
    
    if (existingValueInfo && existingValueInfo.columns && Array.isArray(existingValueInfo.columns) && existingValueInfo.columns.length > 0) {
      valueInfo = {
        ...existingValueInfo,
        id: uniqueValueInfoId,
        name: valueInfoName,
        filterColumns: groupColumns,
        filterValues: finalFilterValues,
        rowCount: 0,
        uniqueId: uniqueValueInfoId
      };
    } else {
      valueInfo = {
        id: uniqueValueInfoId,
        type: 'csv' as const,
        name: valueInfoName,
        columns: [],
        summary: '',
        generatedAt: Date.now(),
        filterColumns: groupColumns,
        filterValues: finalFilterValues,
        rowCount: 0,
        uniqueId: uniqueValueInfoId
      };
    }
    
    const valueInfoToSave = { 
      ...valueInfo,
      uniqueId: uniqueValueInfoId
    };
    delete valueInfoToSave.data;
    
    saveValueInfo(valueInfoToSave, chatId);
    
    const currentSelectionCopy: any = {
      ...valueInfo,
      id: valueInfoId,
      uniqueId: uniqueValueInfoId,
      filterColumns: groupColumns,
      filterValues: finalFilterValues,
      rowCount: 0,
      hasData: true,
      dataLength: 0,
      chatId: chatId,
    };
    
    saveValueInfo(currentSelectionCopy, chatId);
    
    // Check base CSV files
    for (const id of selectedCsvIds) {
      const existingValueInfo = getValueInfo(id, 'csv', chatId);
      if (!existingValueInfo) {
        console.log('handleDuckDBValueInfo: DuckDB file has no valueInfo (will be created on-demand if needed):', id);
      }
    }
  };

  const handleFinalizeSelection = async () => {
    if (isFinalizing) return;
    
    setIsFinalizing(true);
    setFinalizeProgress("Preparing data...");
    
    try {
      // Get only group columns (not display columns)
      const groupColumns = selectedFilterColumns.filter(col => columnModes[col] === 'group' || !columnModes[col]);
      
      // Remove display columns - this is the key change: only remove on finalization
      setFinalizeProgress("Removing display columns...");
      const finalFilterColumns = groupColumns;
      const finalDisplayColumns: string[] = [];
      const finalDisplayValues: Record<string, string | null> = {};
      
      // Build final filter values (only group columns)
      const finalFilterValues: Record<string, string | string[] | null> = {};
      groupColumns.forEach(col => {
        if (selectedFilterValues[col] != null) {
          finalFilterValues[col] = selectedFilterValues[col];
        }
      });
      
      // If no filters, ensure we still load data to create value info for base CSV files
      const hasFilters = Object.keys(finalFilterValues).length > 0 && 
                         Object.values(finalFilterValues).some(v => v != null && v !== '');
      
      console.log('handleFinalizeSelection: Filter state:', {
        groupColumns: groupColumns.length,
        hasFilters,
        finalFilterValues,
        selectedCsvIds: selectedCsvIds.length
      });
      
      // OPTIMIZATION: Skip loading full CSV data when using DuckDB
      // The code executor will query DuckDB directly - no need to load everything into memory
      // This dramatically improves performance for large files (100MB+)
      
      // Check if files are DuckDB-registered
      const selectedFiles = csvFiles.filter(f => selectedCsvIds.includes(f.id));
      const allHaveDuckDB = selectedFiles.every(f => f.hasDuckDB);
      
      let csvData: any[] | null = null;
      
      if (allHaveDuckDB) {
        // Files are in DuckDB - skip loading, just verify they exist
        console.log('✅ Files are DuckDB-registered - skipping full data load (will query on-demand)');
        setFinalizeProgress("Verifying DuckDB tables...");
        
        try {
          // Quick verification that tables exist (lightweight query)
          const { executeDuckDBSql, isDuckDBInitialized } = await import('@/lib/duckdb');
          if (isDuckDBInitialized()) {
            // Just verify first file has a table (lightweight check)
            const testQuery = `SELECT COUNT(*) as cnt FROM csvData LIMIT 1`;
            await executeDuckDBSql(selectedCsvIds[0], testQuery);
            console.log('✅ DuckDB table verified and ready');
          }
          
          // Set csvData to empty array to signal "use DuckDB queries instead"
          // The code executor will handle queries via DuckDB
          csvData = [];
          
          // For DuckDB files, clear loading bar immediately after verification
          // Then do valueInfo operations (they're fast since we reuse existing or create minimal)
          setFinalizeProgress("✅ Ready!");
          
          // Do valueInfo operations (they should be fast for DuckDB files)
          try {
            await handleDuckDBValueInfo(selectedCsvIds, groupColumns, finalFilterValues, chatId, csvFiles);
          } catch (e) {
            console.warn('ValueInfo operation failed (non-critical):', e);
          }
          
          // Clear loading bar and call onSelectCsv
          setIsFinalizing(false);
          setTimeout(() => {
            setFinalizeProgress("");
          }, 300);
          
          // Call onSelectCsv so user can start using the data
          onSelectCsv(selectedCsvIds, finalFilterColumns, finalFilterValues, finalDisplayColumns, finalDisplayValues);
          setDisplayValuesState({});
          return; // Exit early - we're done
        } catch (verifyError) {
          console.warn('DuckDB verification failed, falling back to full load:', verifyError);
          // Fall through to load data the old way
        }
      }
      
      // Fallback: Load data for non-DuckDB files or if verification failed
      if (!csvData || (csvData.length === 0 && !allHaveDuckDB)) {
        setFinalizeProgress("Loading CSV data...");
        
        try {
          console.log('handleFinalizeSelection: Loading CSV data for IDs:', selectedCsvIds, 'groupColumns:', groupColumns, 'filters:', finalFilterValues);
          
          // Check if we have actual filters (not just empty columns)
          const hasActualFilters = Object.keys(finalFilterValues).length > 0 && 
                                   Object.values(finalFilterValues).some(v => v != null && v !== '' && v !== '__SELECT_ALL__');
          
          // If we have filters, use them; otherwise load all data
          if (hasActualFilters && groupColumns.length > 0) {
            csvData = await getCsvFileData(selectedCsvIds, groupColumns, finalFilterValues);
          } else {
            // No filters - load all data from selected CSV files
            console.log('handleFinalizeSelection: No filters, loading all data from CSV files');
            csvData = await getCsvFileData(selectedCsvIds, null, null);
          }
          
          console.log('handleFinalizeSelection: Loaded CSV data:', csvData?.length || 0, 'rows');
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Failed to load CSV data';
          console.error('handleFinalizeSelection: Error loading CSV data:', errorMsg, error);
          setFinalizeProgress(`Error loading data: ${errorMsg}`);
          setIsFinalizing(false);
          setTimeout(() => {
            setFinalizeProgress("");
          }, 5000);
          return; // Stop here if data loading fails
        }
      }
      
      // For DuckDB files, we allow empty csvData (queries will use DuckDB)
      // For non-DuckDB files, we need actual data
      if (!allHaveDuckDB && (!csvData || csvData.length === 0)) {
        console.warn('handleFinalizeSelection: No CSV data loaded. csvData:', csvData);
        console.warn('handleFinalizeSelection: selectedCsvIds:', selectedCsvIds);
        setFinalizeProgress(`No data found. Please ensure the CSV file is properly loaded.`);
        setIsFinalizing(false);
        setTimeout(() => {
          setFinalizeProgress("");
        }, 5000);
        return;
      }
      
      if (csvData && csvData.length > 0) {
        setFinalizeProgress(`Processing ${csvData.length} rows...`);
      } else if (allHaveDuckDB) {
        // For DuckDB files, valueInfo operations are fast (reusing existing or creating minimal)
        // So we can do them quickly without blocking
        const { generateValueInfoFromData, saveValueInfo, deleteValueInfo } = await import("@/lib/chatApi");
        
        // Delete old current_selection
        if (chatId) {
          deleteValueInfo('current_selection', 'csv');
        }
        
        // Generate unique ID for this selection
        const groupValuesForKey = Object.keys(finalFilterValues)
          .filter(k => finalFilterValues[k] != null && groupColumns.includes(k))
          .sort()
          .map(k => {
            const val = finalFilterValues[k];
            return `${k}=${Array.isArray(val) ? val.join(',') : val}`;
          });
        const selectionKey = `${groupColumns.sort().join(',')}:${groupValuesForKey.join(',')}`;
        const selectionHash = selectionKey.split('').reduce((acc, char) => {
          acc = ((acc << 5) - acc) + char.charCodeAt(0);
          return acc & acc;
        }, 0);
        const uniqueValueInfoId = chatId ? `csv_selection_${chatId}_${Math.abs(selectionHash)}` : `csv_selection_${Math.abs(selectionHash)}`;
        const valueInfoId = 'current_selection';
        
        // Build name using only group columns and their values
        const nameParts = groupColumns
          .filter(col => finalFilterValues[col] != null)
          .map(col => {
            const val = finalFilterValues[col];
            // Handle __SELECT_ALL__ marker
            if (val === '__SELECT_ALL__') {
              return `${col}=All`;
            }
            if (Array.isArray(val)) {
              const maxDisplay = 2;
              if (val.length > maxDisplay) {
                return `${col}=${val.slice(0, maxDisplay).join(',')}... (${val.length} total)`;
              }
              return `${col}=${val.join(',')}`;
            }
            return `${col}=${val}`;
          });

        // Include CSV file names in the value info name for multiple CSVs
        const csvFileNames = selectedCsvIds.map(id => {
          const file = csvFiles.find(f => f.id === id);
          return file ? file.name : id;
        });
        const csvFilesDisplay = selectedCsvIds.length > 1
          ? ` [${csvFileNames.length} files: ${csvFileNames.slice(0, 2).join(', ')}${csvFileNames.length > 2 ? '...' : ''}]`
          : ` [${csvFileNames[0] || 'CSV'}]`;

        const valueInfoName = nameParts.length > 0
          ? `Selected Group: ${nameParts.join(', ')}${csvFilesDisplay}`
          : `Selected Group: ${groupColumns.join(', ')}${csvFilesDisplay}`;
        
        // For DuckDB files, use existing CSV valueInfo if available (no need to regenerate from empty data)
        let valueInfo;
        if (allHaveDuckDB && csvData && csvData.length === 0) {
          // For DuckDB files, try to use existing valueInfo from the CSV file
          const existingValueInfo = getValueInfo(selectedCsvIds[0], 'csv');
          console.log('handleFinalizeSelection: Checking for existing CSV valueInfo:', {
            csvId: selectedCsvIds[0],
            found: !!existingValueInfo,
            hasColumns: (existingValueInfo?.columns?.length || 0) > 0,
            hasSummary: !!existingValueInfo?.summary
          });
          
          if (existingValueInfo && existingValueInfo.columns && Array.isArray(existingValueInfo.columns) && existingValueInfo.columns.length > 0) {
            // Reuse the CSV's valueInfo structure but with the selection name
            valueInfo = {
              ...existingValueInfo,
              id: uniqueValueInfoId,
              name: valueInfoName
            };
            console.log('handleFinalizeSelection: ✅ Reusing existing CSV valueInfo for DuckDB file (columns:', existingValueInfo.columns?.length || 0, ')');
          } else {
            // No existing valueInfo - create minimal one (will be populated later if needed)
            valueInfo = {
              id: uniqueValueInfoId,
              type: 'csv',
              name: valueInfoName,
              columns: [],
              summary: '',
              generatedAt: Date.now()
            };
            console.log('handleFinalizeSelection: ⚠️ Created minimal valueInfo for DuckDB file (no existing valueInfo found with columns)');
          }
        } else {
          // For non-DuckDB files or files with data, generate valueInfo normally
          const dataForValueInfo = csvData || [];
          console.log('handleFinalizeSelection: Generating value info for', dataForValueInfo.length, 'rows');
          valueInfo = generateValueInfoFromData(
            dataForValueInfo,
            uniqueValueInfoId,
            'csv',
            valueInfoName
          );
          
          if (!valueInfo) {
            console.error('handleFinalizeSelection: ❌ Failed to generate value info - generateValueInfoFromData returned null/undefined');
            setFinalizeProgress(`Error: Failed to generate value info`);
            setIsFinalizing(false);
            setTimeout(() => {
              setFinalizeProgress("");
            }, 5000);
            return;
          }
        }
        
        // Validate value info structure
        if (!valueInfo.id || !valueInfo.type) {
          console.error('handleFinalizeSelection: ❌ Invalid value info structure:', valueInfo);
          setFinalizeProgress(`Error: Invalid value info structure`);
          setIsFinalizing(false);
          setTimeout(() => {
            setFinalizeProgress("");
          }, 5000);
          return;
        }
        
        console.log('handleFinalizeSelection: Value info generated:', {
          id: valueInfo.id,
          type: valueInfo.type,
          name: valueInfo.name,
          rowCount: csvData?.length || 0,
          columnCount: valueInfo.columns?.length || 0,
          hasSummary: !!valueInfo.summary
        });
        
        // Set additional properties
        valueInfo.filterColumns = groupColumns;
        valueInfo.filterValues = finalFilterValues;
        valueInfo.rowCount = csvData?.length || 0;
        valueInfo.uniqueId = uniqueValueInfoId;
        
        // Save main value info (without data to save space)
        const valueInfoToSave = { 
          ...valueInfo,
          uniqueId: uniqueValueInfoId
        };
        delete valueInfoToSave.data; // Remove data to save space
        
        console.log('handleFinalizeSelection: Saving value info (without data):', uniqueValueInfoId, 'Structure:', {
          id: valueInfoToSave.id,
          type: valueInfoToSave.type,
          uniqueId: valueInfoToSave.uniqueId,
          hasColumns: !!valueInfoToSave.columns,
          columnCount: valueInfoToSave.columns?.length || 0
        });
        
        saveValueInfo(valueInfoToSave, chatId);
        console.log('handleFinalizeSelection: ✅ Main value info saved');
        
        // CRITICAL: Save current_selection WITHOUT data array to prevent localStorage quota exceeded
        // Data should be loaded from DuckDB/IndexedDB when needed, not stored in localStorage
        // IMPORTANT: Include chatId to ensure current_selection is isolated per chat
        const currentSelectionCopy = {
          ...valueInfo,
          id: valueInfoId, // Override with 'current_selection'
          uniqueId: uniqueValueInfoId,
          filterColumns: groupColumns,
          filterValues: finalFilterValues,
          rowCount: csvData?.length || 0,
          hasData: true,
          dataLength: csvData?.length || 0,
          chatId: chatId, // CRITICAL: Store chatId to isolate current_selection per chat
          // DO NOT include data array - it causes localStorage quota exceeded errors
        };
        
        console.log('handleFinalizeSelection: Saving current_selection for chat:', chatId, 'Structure:', {
          id: currentSelectionCopy.id,
          type: currentSelectionCopy.type,
          uniqueId: currentSelectionCopy.uniqueId,
          chatId: currentSelectionCopy.chatId,
          hasData: !!currentSelectionCopy.data,
          dataLength: currentSelectionCopy.data?.length || 0
        });
        
        saveValueInfo(currentSelectionCopy, chatId);
        console.log('handleFinalizeSelection: ✅ Current selection saved');
        
        // Verify it was saved
        const savedValueInfo = getValueInfo(valueInfoId, 'csv', chatId);
        if (savedValueInfo) {
          console.log('handleFinalizeSelection: ✅ Verified value info saved successfully:', savedValueInfo.id, savedValueInfo.name);
        } else {
          console.error('handleFinalizeSelection: ❌ Value info not found after saving!');
        }
        
        // Also ensure base CSV file has value info (if it doesn't already)
        // This creates value info for the CSV file itself, not just the filtered selection
        // SKIP for DuckDB files if valueInfo already exists (no need to regenerate)
        if (!allHaveDuckDB || csvData && csvData.length > 0) {
          for (const id of selectedCsvIds) {
            const existingValueInfo = getValueInfo(id, 'csv', chatId);
            if (!existingValueInfo) {
              console.log('handleFinalizeSelection: Creating value info for base CSV file:', id);
              try {
                const saved = localStorage.getItem("db_csv_files");
                if (saved) {
                  const parsed = JSON.parse(saved);
                  const files = Array.isArray(parsed) ? parsed : [];
                  const file = files.find((f: any) => f.id === id);
                  if (file && csvData && csvData.length > 0) {
                    // Use the loaded CSV data to generate value info for the base file
                    const { autoInspectData } = await import("@/lib/chatApi");
                    autoInspectData(csvData, id, 'csv', file.name, chatId);
                    console.log('✅ Created value info for base CSV file:', file.name);
                  }
                }
              } catch (e) {
                console.warn('handleFinalizeSelection: Failed to create value info for base CSV file:', e);
              }
            } else {
              console.log('handleFinalizeSelection: ✅ Base CSV file already has valueInfo, skipping regeneration:', id);
            }
          }
        } else {
          // For DuckDB files with no data, check if valueInfo exists but don't try to create it
          for (const id of selectedCsvIds) {
            const existingValueInfo = getValueInfo(id, 'csv', chatId);
            if (existingValueInfo) {
              console.log('handleFinalizeSelection: ✅ DuckDB file already has valueInfo, skipping regeneration:', id);
            } else {
              console.log('handleFinalizeSelection: ⚠️ DuckDB file has no valueInfo (will be created on-demand if needed):', id);
            }
          }
        }
      } else {
        // Even if no filtered data, ensure base CSV files have value info
        for (const id of selectedCsvIds) {
          const existingValueInfo = getValueInfo(id, 'csv', chatId);
          if (!existingValueInfo) {
            console.log('handleFinalizeSelection: No filtered data, but creating value info for base CSV file:', id);
            try {
              // Load data without filters to create base value info
              const baseCsvData = await getCsvFileData([id], null, null);
              if (baseCsvData && baseCsvData.length > 0) {
                const saved = localStorage.getItem("db_csv_files");
                if (saved) {
                  const parsed = JSON.parse(saved);
                  const files = Array.isArray(parsed) ? parsed : [];
                  const file = files.find((f: any) => f.id === id);
                  if (file) {
                    const { autoInspectData } = await import("@/lib/chatApi");
                    autoInspectData(baseCsvData, id, 'csv', file.name, chatId);
                    console.log('✅ Created value info for base CSV file:', file.name);
                  }
                }
              }
            } catch (e) {
              console.warn('handleFinalizeSelection: Failed to create value info for base CSV file:', e);
            }
          }
        }
      }

      // Update selection: remove display columns, keep only group columns
      onSelectCsv(selectedCsvIds, finalFilterColumns, finalFilterValues, finalDisplayColumns, finalDisplayValues);

      // Clear display values from state
      setDisplayValuesState({});
      
      // For DuckDB files, clear immediately since we don't need to wait for data processing
      if (allHaveDuckDB) {
        setFinalizeProgress("✅ Ready!");
        setIsFinalizing(false);
        setTimeout(() => {
          setFinalizeProgress("");
        }, 500);
      } else {
        setFinalizeProgress("✅ Dataset finalized!");
        // Clear progress message after a short delay for non-DuckDB files
        setTimeout(() => {
          setFinalizeProgress("");
          setIsFinalizing(false);
        }, 1500);
      }
    } catch (e) {
      console.error('Error finalizing selection:', e);
      setFinalizeProgress(`Error: ${e instanceof Error ? e.message : 'Failed to finalize selection'}`);
      setIsFinalizing(false);
      setTimeout(() => {
        setFinalizeProgress("");
      }, 3000);
    }
  };

  // If showGroupBy is true, only render the group by section (for separate display in ChatMain)
  if (showGroupBy) {
    if (csvFiles.length === 0 || availableColumns.length === 0) {
      return null;
    }
    
    return (
      <div className="w-full">
        <MultiSelectGroupBy
          availableColumns={availableColumns}
          selectedColumns={selectedFilterColumns}
          onColumnsChange={handleColumnsChange}
          selectedValues={selectedFilterValues}
          onValueSelect={handleValueSelect}
          columnModes={columnModes}
          onColumnModeChange={handleColumnModeChange}
          getUniqueValues={getUniqueValues}
          getFirstValue={getFirstValue}
          getCombinedGroupValues={getCombinedGroupValues}
          groupedRowsWithDisplay={groupedRowsWithDisplay}
          placeholder="Group by..."
          disabled={disabled}
          uniqueValuesProgress={loadingColumn && uniqueValuesProgress[`${selectedCsvIds.join(',')}:${loadingColumn}`] ? uniqueValuesProgress[`${selectedCsvIds.join(',')}:${loadingColumn}`] : undefined}
          onConfirmLargeFile={() => {
            if (pendingLargeFileColumn) {
              const confirmationKey = `${selectedCsvIds.join(',')}:${pendingLargeFileColumn.column}`;
              setLargeFileConfirmations(prev => new Set(prev).add(confirmationKey));
              setPendingLargeFileColumn(null);
              // Clear cache for this column to force reload
              const cacheKey = `${selectedCsvIds.join(',')}:${pendingLargeFileColumn.column}`;
              uniqueValuesCache.current.delete(cacheKey);
              activeSearches.current.delete(cacheKey);
              // Trigger reload by calling getUniqueValues again (will use DuckDB now)
              setTimeout(() => {
                getUniqueValues(pendingLargeFileColumn.column).catch(err => {
                  console.error('Error reloading unique values after confirmation:', err);
                });
              }, 100);
            }
          }}
          pendingLargeFile={pendingLargeFileColumn}
        />
      </div>
    );
  }

  // Check if any loading operation is in progress
  const isAnyLoading = isFinalizing || isInitializingDuckDB || loadingColumn !== null || 
    uploadStatus.status === 'reading' || uploadStatus.status === 'parsing' || 
    uploadStatus.status === 'saving' || uploadStatus.status === 'verifying';
  
  // Otherwise, render the file upload/selection UI with group by on the right
  return (
    <div className="relative w-full">
      {(isAnyLoading || finalizeProgress) && (
        <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-2 duration-300">
          <div className="bg-card/95 backdrop-blur-sm border border-border shadow-lg rounded-xl p-4 min-w-[280px] max-w-sm">
            <div className="flex items-start gap-3">
              {/* Spinner */}
              <div className="flex-shrink-0 mt-0.5">
                <div className="h-5 w-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>

              {/* Status text */}
              <div className="flex-1 min-w-0 space-y-2">
                <div className="text-sm font-medium text-foreground">
                  {isFinalizing ? finalizeProgress :
                   isInitializingDuckDB ? 'Initializing Database' :
                   loadingColumn ? `Loading ${loadingColumn}` :
                   uploadStatus.message || (
                     uploadStatus.status === 'reading' ? 'Reading File' :
                     uploadStatus.status === 'parsing' ? 'Processing File' :
                     uploadStatus.status === 'saving' ? 'Saving Data' :
                     uploadStatus.status === 'verifying' ? 'Verifying' :
                     'Processing'
                   )}
                </div>
                {uploadStatus.fileName && (
                  <div className="text-xs text-muted-foreground truncate">
                    {uploadStatus.fileName}
                  </div>
                )}
                {/* Progress bar */}
                {uploadStatus.percent !== undefined && uploadStatus.status === 'parsing' && (
                  <div className="space-y-1">
                    <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-primary h-full transition-all duration-300 ease-out rounded-full"
                        style={{ width: `${Math.min(100, Math.max(0, uploadStatus.percent))}%` }}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground text-right">
                      {uploadStatus.percent.toFixed(0)}%
                    </div>
                  </div>
                )}
                {!uploadStatus.message && uploadStatus.status !== 'idle' && !uploadStatus.percent && (
                  <div className="text-xs text-muted-foreground">Please wait...</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="flex gap-2 items-center">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.parquet,.xlsx,.xls,.json"
          onChange={handleFileUpload}
          className="hidden"
          disabled={isAnyLoading || disabled}
        />
        <div className="flex items-center gap-2 flex-shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
            disabled={(uploadStatus.status !== 'idle' && uploadStatus.status !== 'success' && uploadStatus.status !== 'error') || isAnyLoading || disabled}
          className="flex-shrink-0"
          title="Upload data file (CSV, Parquet, Excel, JSON)"
        >
            {uploadStatus.status === 'reading' || uploadStatus.status === 'parsing' || uploadStatus.status === 'saving' || uploadStatus.status === 'verifying' ? (
              <div className="h-4 w-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
            ) : uploadStatus.status === 'success' ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
          <Upload className="h-4 w-4" />
            )}
        </Button>
          {uploadStatus.status !== 'idle' && uploadStatus.message && (
            <div className={`text-xs whitespace-nowrap ${
              uploadStatus.status === 'error' ? 'text-red-400' : 
              uploadStatus.status === 'success' ? 'text-green-400' : 
              'text-blue-400'
            }`}>
              {uploadStatus.message}
            </div>
          )}
        </div>
        
        <div className="relative flex-1">
          <Button
            ref={buttonRef}
            variant="outline"
            size="sm"
            onClick={() => {
              if (buttonRef.current) {
                setButtonRect(buttonRef.current.getBoundingClientRect());
              }
              setIsOpen(!isOpen);
            }}
            className="w-full justify-start"
            disabled={csvFiles.length === 0 || isAnyLoading || disabled}
          >
            <FileText className="h-4 w-4 mr-2" />
            {selectedCsvIds.length > 0
              ? `${selectedCsvIds.length} file${selectedCsvIds.length > 1 ? 's' : ''} selected`
              : csvFiles.length === 0
              ? "No data files"
              : "Select files to combine"}
          </Button>

          {isOpen && buttonRect && typeof document !== 'undefined' && createPortal(
            <>
              <div
                className="fixed inset-0 z-[9998]"
                onClick={() => setIsOpen(false)}
                onMouseDown={(e) => e.preventDefault()}
              />
              <div
                ref={dropdownRef}
                style={{
                  position: 'fixed',
                  top: `${buttonRect.bottom + window.scrollY}px`,
                  left: `${buttonRect.left + window.scrollX}px`,
                  width: `${buttonRect.width / 0.875}px`,
                  maxHeight: '384px',
                  transform: 'scale(0.875)',
                  transformOrigin: 'top left',
                }}
                className="bg-chat-bg border border-border rounded-md shadow-lg z-[9999] overflow-hidden flex flex-col"
              >
                {selectedCsvIds.length > 0 && (
                  <div className="px-2 py-1 border-b border-border flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {selectedCsvIds.length} CSV{selectedCsvIds.length > 1 ? 's' : ''} selected
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => {
                        onSelectCsv([], selectedFilterColumns, selectedFilterValues, [], {});
                        setIsOpen(false);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
                {/* Search input for CSV files */}
                {csvFiles.length > 3 && (
                  <div className="p-2 border-b border-border">
                    <input
                      type="text"
                      value={fileSearchQuery}
                      onChange={(e) => setFileSearchQuery(e.target.value)}
                      placeholder="Search CSV files..."
                      className="w-full px-2 py-1 text-sm bg-secondary border border-border rounded"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                )}
                <div className="overflow-y-auto flex-1">
                  {filteredCsvFiles.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                      {fileSearchQuery.trim() ? "No CSV files match your search" : "No CSV files"}
                  </div>
                ) : (
                    filteredCsvFiles.map((file) => {
                      const isSelected = selectedCsvIds.includes(file.id);
                      return (
                        <button
                          key={file.id}
                          onClick={() => {
                            handleCsvToggle(file.id);
                            setFileSearchQuery("");
                            setIsOpen(false);
                          }}
                          className={`w-full text-left px-2 py-1.5 hover:bg-accent transition-colors ${
                            isSelected ? "bg-accent" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center flex-1 min-w-0">
                              <div className={`w-3.5 h-3.5 border-2 rounded mr-2 flex items-center justify-center flex-shrink-0 ${
                                isSelected ? 'bg-primary border-primary' : 'border-gray-400'
                              }`}>
                                {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
                              </div>
                              <FileText className="h-3.5 w-3.5 mr-1.5 flex-shrink-0" />
                              <span className="truncate" style={{ fontSize: '13px' }}>{file.name}</span>
                            </div>
                            <span className="text-muted-foreground ml-2 flex-shrink-0" style={{ fontSize: '11px' }}>
                              ({(file.rowCount ?? file.data?.length ?? 0).toLocaleString()} rows, {file.headers.length} cols • Parquet)
                            </span>
                          </div>
                        </button>
                      );
                    })
                )}
                </div>
              </div>
            </>,
            document.body
          )}
        </div>
        
        {/* Group By on the right side */}
        {selectedCsvIds.length > 0 && csvFiles.length > 0 && availableColumns.length > 0 && (
          <div className="flex-1 min-w-0">
            <MultiSelectGroupBy
              availableColumns={availableColumns}
              selectedColumns={selectedFilterColumns}
              onColumnsChange={handleColumnsChange}
              selectedValues={selectedFilterValues}
              onValueSelect={handleValueSelect}
              onBatchValueSelect={handleBatchValueSelect}
              columnModes={columnModes}
              onColumnModeChange={handleColumnModeChange}
              getUniqueValues={getUniqueValues}
              getFirstValue={getFirstValue}
              getCombinedGroupValues={getCombinedGroupValues}
              groupedRowsWithDisplay={groupedRowsWithDisplay}
              placeholder="Group by..."
              dataSourceKey={selectedCsvIds.join(',')} // Key that changes when CSV selection changes
              disabled={disabled}
              uniqueValuesProgress={loadingColumn && uniqueValuesProgress[`${selectedCsvIds.join(',')}:${loadingColumn}`] ? uniqueValuesProgress[`${selectedCsvIds.join(',')}:${loadingColumn}`] : undefined}
              onConfirmLargeFile={() => {
                if (pendingLargeFileColumn) {
                  const confirmationKey = `${selectedCsvIds.join(',')}:${pendingLargeFileColumn.column}`;
                  setLargeFileConfirmations(prev => new Set(prev).add(confirmationKey));
                  setPendingLargeFileColumn(null);
                  // Clear cache for this column to force reload
                  const cacheKey = `${selectedCsvIds.join(',')}:${pendingLargeFileColumn.column}`;
                  uniqueValuesCache.current.delete(cacheKey);
                  activeSearches.current.delete(cacheKey);
                  // Trigger reload by calling getUniqueValues again (will use DuckDB now)
                  setTimeout(() => {
                    getUniqueValues(pendingLargeFileColumn.column).catch(err => {
                      console.error('Error reloading unique values after confirmation:', err);
                    });
                  }, 100);
                }
              }}
              pendingLargeFile={pendingLargeFileColumn}
            />
          </div>
        )}
      </div>
      
      {/* Selected Data Banner - same as MatchSelector */}
      {selectedCsvIds.length > 0 && selectedFilterColumns.length > 0 && (() => {
        // Only show group columns that have values (exclude display columns)
        const groupColumnsWithValues = selectedFilterColumns
          .filter(col => (columnModes[col] === 'group' || !columnModes[col]) && selectedFilterValues[col] != null);
        return groupColumnsWithValues.length > 0;
      })() && (
        <div className="mt-2 flex items-center gap-2 p-2 bg-primary/20 rounded-lg border border-primary/30">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-primary">
              Active Dataset: {selectedFilterColumns
                .filter(col => {
                  const isGroup = columnModes[col] === 'group' || !columnModes[col];
                  const isNotDisplay = columnModes[col] !== 'display';
                  const hasValue = selectedFilterValues[col] != null;
                  return isGroup && isNotDisplay && hasValue;
                })
                .map(col => {
                const value = selectedFilterValues[col];
                const colLabel = availableColumns.find(c => c.value === col)?.label || col;
                if (value === '__SELECT_ALL__') {
                  return `${colLabel}=All`;
                }
                if (Array.isArray(value)) {
                  const maxDisplay = 2;
                  if (value.length > maxDisplay) {
                    const displayed = value.slice(0, maxDisplay).join(', ');
                    return `${colLabel}=${displayed}... (${value.length} total)`;
                  }
                  return `${colLabel}=${value.join(', ')}`;
                }
                return value ? `${colLabel}=${value}` : null;
              }).filter(Boolean).join(', ')}
              {(() => {
                const fileNames = selectedCsvIds
                  .map(id => csvFiles.find((f: any) => f.id === id)?.name)
                  .filter((name): name is string => name !== undefined);

                if (fileNames.length === 0) return '';
                if (fileNames.length === 1) return ` | CSV: ${fileNames[0]}`;
                if (fileNames.length === 2) return ` | CSV: ${fileNames.join(', ')}`;
                return ` | CSV: ${fileNames.slice(0, 2).join(', ')}... (${fileNames.length} total)`;
              })()}
            </div>
            <div className="text-xs text-muted-foreground">
              {isFinalizing ? finalizeProgress : (() => {
                const groupColumns = selectedFilterColumns.filter(col => (columnModes[col] === 'group' || !columnModes[col]) && selectedFilterValues[col] != null);
                // Check if any column has __SELECT_ALL__
                const hasSelectAll = groupColumns.some(col => selectedFilterValues[col] === '__SELECT_ALL__');
                if (hasSelectAll) {
                  return 'All values selected';
                }
                const totalValues = groupColumns.reduce((sum, col) => {
                  const val = selectedFilterValues[col];
                  return sum + (Array.isArray(val) ? val.length : (val ? 1 : 0));
                }, 0);
                return totalValues > 0 ? `${totalValues} value${totalValues > 1 ? 's' : ''} selected` : 'Ready';
              })()}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleFinalizeSelection}
            disabled={isFinalizing || disabled}
            title="Finalize selection"
          >
            <Check className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleClearSelection}
            disabled={isFinalizing || disabled}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
};

// Memoize component to prevent unnecessary re-renders
export default memo(CSVSelector);

