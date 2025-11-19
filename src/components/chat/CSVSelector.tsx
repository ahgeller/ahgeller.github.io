import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { FileText, X, Upload, Check } from "lucide-react";
import { getCsvFileData, getValueInfo } from "@/lib/chatApi";
import { parseCsvText, stringifyCsv } from "@/lib/csvUtils";
import { migrateLegacyCsvFile, saveCsvDataText, getCsvDataRows, deleteCsvData } from "@/lib/csvStorage";
import MultiSelectGroupBy from "./MultiSelectGroupBy";

interface CSVSelectorProps {
  selectedCsvIds: string[]; // Changed to array for multiple CSV selection
  selectedFilterColumns: string[];
  selectedFilterValues: Record<string, string | null>;
  onSelectCsv: (csvIds: string[], filterColumns?: string[], filterValues?: Record<string, string | null>, displayColumns?: string[], displayValues?: Record<string, string | null>) => void;
  chatId?: string; // Chat ID for tracking Value Info associations
  showGroupBy?: boolean; // Whether to show the group by section separately
}

interface CSVFile {
  id: string;
  name: string;
  headers: string[];
  uploadedAt: number;
  rowCount?: number;
  data?: any[]; // Legacy support
}

type ColumnMode = 'group' | 'display';

const CSVSelector = ({ selectedCsvIds, selectedFilterColumns, selectedFilterValues, onSelectCsv, chatId, showGroupBy = false }: CSVSelectorProps) => {
  const [csvFiles, setCsvFiles] = useState<CSVFile[]>([]);
  const [filteredCsvFiles, setFilteredCsvFiles] = useState<CSVFile[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [columnModes, setColumnModes] = useState<Record<string, ColumnMode>>({});
  const [groupedRowsWithDisplay, setGroupedRowsWithDisplay] = useState<Array<{groupValues: Record<string, string>, displayValues: Record<string, string>}>>([]);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadCsvFiles = async () => {
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
          const cleanedFilesPromises = parsed.map(async (file: CSVFile | null) => {
            if (!file) return null;
            // Check if file has data but it's not in IndexedDB - try to save it
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
          
          const cleanedFiles = (await Promise.all(cleanedFilesPromises))
            .filter(Boolean) as CSVFile[];

          if (needsSave) {
            localStorage.setItem("db_csv_files", JSON.stringify(cleanedFiles));
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
    };

    loadCsvFiles();

    const handleStorageChange = () => {
      loadCsvFiles();
    };

    window.addEventListener("storage", handleStorageChange);
    const interval = setInterval(loadCsvFiles, 1000);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      const { headers, data } = parseCsvText(text);

      const csvFile: CSVFile = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: file.name,
        headers,
        rowCount: data.length,
        uploadedAt: Date.now()
      };

      const updatedFiles = [...csvFiles, csvFile];
      console.log("CSVSelector: Uploading file:", csvFile.name, "Rows:", data.length, "ID:", csvFile.id);
      
      // First, try to save the CSV data (the larger item) to check quota
      // This way we fail early before saving metadata
      console.log("CSVSelector: About to save CSV data, file ID:", csvFile.id, "text length:", text.length, "data rows:", data.length);
      try {
        await saveCsvDataText(csvFile.id, text, data);
        console.log("CSVSelector: saveCsvDataText returned successfully");
      } catch (saveError) {
        console.error("CSVSelector: Error saving CSV data:", saveError);
        const errorMessage = saveError instanceof Error ? saveError.message : String(saveError);
        alert(`Failed to save CSV data: ${errorMessage}. Please remove older files and try again.`);
        return; // Don't add file to list if data save failed
      }
      
      // Verify the data was saved by trying to retrieve it
      console.log("CSVSelector: Verifying save for file ID:", csvFile.id);
      try {
        const verifyData = await getCsvDataRows(csvFile);
        if (!verifyData || verifyData.length === 0) {
          console.error("CSVSelector: Verification failed - data not found after save!");
          alert("Warning: CSV data storage failed. Please try uploading again.");
          return; // Don't add file to list if verification failed
        }
        console.log("CSVSelector: CSV data saved and verified successfully:", csvFile.name, "Rows:", data.length, "Verified rows:", verifyData.length);
      } catch (verifyError) {
        console.error("CSVSelector: Error verifying save:", verifyError);
        alert("Warning: Could not verify CSV data was saved. Please try uploading again.");
        return;
      }
      
      // Now save the metadata (smaller, should succeed if data save succeeded)
      try {
        localStorage.setItem("db_csv_files", JSON.stringify(updatedFiles));
        console.log("CSVSelector: File metadata saved successfully");
      } catch (metadataError) {
        console.error("CSVSelector: Failed to save file metadata:", metadataError);
        // Clean up the data we just saved since metadata save failed
        try {
          await deleteCsvData(csvFile.id);
        } catch (deleteError) {
          console.error("CSVSelector: Error cleaning up data:", deleteError);
        }
        const errorMessage = metadataError instanceof Error ? metadataError.message : "Unknown error";
        alert(`Failed to save file metadata: ${errorMessage}. Please try again.`);
        return; // Don't add file to list if metadata save failed
      }
      
      // Only update state if everything succeeded
      setCsvFiles(updatedFiles);
      setFilteredCsvFiles(updatedFiles);
      // Add the new file to selected CSVs
      onSelectCsv([...selectedCsvIds, csvFile.id]);
    };

    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const selectedFiles = csvFiles.filter(f => selectedCsvIds.includes(f.id));
  
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
  // Use useCallback to ensure function updates when selectedCsvIds changes
  const getUniqueValues = useCallback(async (column: string): Promise<string[]> => {
    console.log('CSVSelector: getUniqueValues called for column:', column, 'selectedCsvIds:', selectedCsvIds);
    if (csvFiles.length === 0) {
      console.log('CSVSelector: No CSV files available');
      return [];
    }
    
    // If no CSVs are selected, we can't get values
    if (selectedCsvIds.length === 0) {
      console.log('CSVSelector: No CSVs selected, cannot get unique values. Please select CSV files first.');
      return [];
    }
    
    // Get combined data from selected CSV files
    console.log('CSVSelector: Getting CSV data for unique values, selectedCsvIds:', selectedCsvIds);
    let csvData = await getCsvFileData(selectedCsvIds, null, null);
    console.log('CSVSelector: Got CSV data for unique values, rows:', csvData?.length || 0);
    if (!csvData || csvData.length === 0) {
      console.warn('CSVSelector: No CSV data returned. The CSV file may need to be re-uploaded.');
      // Try to trigger migration by checking if files have data property
      const saved = localStorage.getItem("db_csv_files");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          const files = Array.isArray(parsed) ? parsed : [];
          for (const id of selectedCsvIds) {
            const file = files.find((f: any) => f.id === id);
            if (file && Array.isArray(file.data)) {
              console.log('CSVSelector: Found file with data property, attempting migration...');
              const { migrateLegacyCsvFile } = await import("@/lib/csvStorage");
              await migrateLegacyCsvFile(file);
              // Try again after migration
              const retryData = await getCsvFileData(selectedCsvIds, null, null);
              if (retryData && retryData.length > 0) {
                console.log('CSVSelector: Successfully recovered data after migration');
                csvData = retryData;
                break;
              }
            }
          }
        } catch (e) {
          console.error('CSVSelector: Error attempting migration:', e);
        }
      }
      if (!csvData || csvData.length === 0) {
        return [];
      }
    }
    
    // Find the actual column name (case-insensitive match)
    const firstRow = csvData[0];
    if (!firstRow) {
      console.warn('CSVSelector: First row is empty');
      return [];
    }
    
    console.log('CSVSelector: Available columns in data:', Object.keys(firstRow));
    
    // Try exact match first
    let actualColumnName: string | undefined = column;
    if (!(column in firstRow)) {
      // Try case-insensitive match
      actualColumnName = Object.keys(firstRow).find(
        key => key.toLowerCase() === column.toLowerCase()
      );
      
      if (!actualColumnName) {
        // Column doesn't exist at all
        console.warn(`CSVSelector: Column "${column}" not found in CSV data. Available columns:`, Object.keys(firstRow));
        return [];
      }
      console.log(`CSVSelector: Column "${column}" matched to "${actualColumnName}" (case-insensitive)`);
    } else {
      console.log(`CSVSelector: Column "${column}" found exactly in data`);
    }
    
    const values = new Set<string>();
    csvData.forEach((row: any) => {
      if (row && actualColumnName && row[actualColumnName] !== null && row[actualColumnName] !== undefined) {
        const value = String(row[actualColumnName]).trim();
        if (value !== '') {
          values.add(value);
        }
      }
    });
    
    const result = Array.from(values).sort();
    console.log(`CSVSelector: Found ${result.length} unique values for column "${column}":`, result.slice(0, 10));
    return result;
  }, [selectedCsvIds, csvFiles]); // Recreate when CSV selection or files change
  
  // Get first value for display indicator
  // Use useCallback to ensure function updates when getUniqueValues changes
  const getFirstValue = useCallback(async (column: string): Promise<string | null> => {
    const uniqueValues = await getUniqueValues(column);
    return uniqueValues.length > 0 ? uniqueValues[0] : null;
  }, [getUniqueValues]);

  // Get unique combinations of values from multiple columns (like pandas groupby)
  // Updated to support display columns like MatchSelector
  // Use useCallback to ensure function updates when selectedCsvIds changes
  const getCombinedGroupValues = useCallback(async (columns: string[], modesOverride?: Record<string, ColumnMode>): Promise<string[]> => {
    console.log('CSVSelector: getCombinedGroupValues called with columns:', columns, 'selectedCsvIds:', selectedCsvIds);
    if (columns.length === 0) {
      console.log('CSVSelector: No columns provided');
      return [];
    }
    if (csvFiles.length === 0) {
      console.log('CSVSelector: No CSV files available');
      return [];
    }
    
    // If no CSVs are selected, we can't get values - return empty
    if (selectedCsvIds.length === 0) {
      console.log('CSVSelector: No CSVs selected, cannot get group values. Please select CSV files first.');
      return [];
    }
    
    // Use modesOverride if provided (for immediate updates), otherwise use columnModes from state
    const currentModes = modesOverride || columnModes;
    
    // IMPORTANT: Filter columns to ONLY include group columns (exclude display columns)
    const groupOnlyColumns = columns.filter(col => currentModes[col] === 'group' || !currentModes[col]);
    
    if (groupOnlyColumns.length === 0) {
      console.warn('CSVSelector: No group columns to query');
      return [];
    }
    
    // Get display columns (columns with mode 'display') from all selected columns
    const displayColumns = selectedFilterColumns
      .filter(col => currentModes[col] === 'display')
      .filter(col => !groupOnlyColumns.includes(col));
    
    // Get combined data from selected CSV files
    console.log('CSVSelector: Getting CSV data for selected IDs:', selectedCsvIds);
    const csvData = await getCsvFileData(selectedCsvIds, null, null);
    console.log('CSVSelector: Got CSV data, rows:', csvData?.length || 0);
    if (!csvData || csvData.length === 0) {
      console.warn('CSVSelector: No CSV data available for combined grouping');
      return [];
    }
    
    const firstRow = csvData[0];
    if (!firstRow) {
      console.warn('First row is empty');
      return [];
    }
    
    // Find actual column names (case-insensitive match) for group columns
    const actualGroupColumnNames: string[] = [];
    for (const column of groupOnlyColumns) {
      let actualColumnName: string | undefined = column;
      if (!(column in firstRow)) {
        actualColumnName = Object.keys(firstRow).find(
          key => key.toLowerCase() === column.toLowerCase()
        );
        if (!actualColumnName) {
          console.warn(`Column "${column}" not found in CSV data. Available columns:`, Object.keys(firstRow));
          return [];
        }
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
        if (!actualColumnName) {
          console.warn(`Display column "${column}" not found in CSV data`);
          continue; // Skip this display column but continue
        }
      }
      actualDisplayColumnNames.push(actualColumnName);
    }
    
    console.log('CSVSelector: Getting combined group values for columns:', groupOnlyColumns, 'display columns:', displayColumns);
    
    // Group data by group columns and collect display values
    const groupedMap = new Map<string, { groupValues: Record<string, string>, displayValues: Record<string, string> }>();
    
    csvData.forEach((row: any) => {
      if (!row) return;
      
      // Get group values
      const groupValues: string[] = [];
      let hasAllGroupValues = true;
      
      for (const colName of actualGroupColumnNames) {
        const cellValue = row[colName];
        if (cellValue === null || cellValue === undefined) {
          hasAllGroupValues = false;
          break;
        }
        const value = String(cellValue).trim();
        if (value === '') {
          hasAllGroupValues = false;
          break;
        }
        groupValues.push(value);
      }
      
      if (!hasAllGroupValues) return;
      
      // Create a key from group values
      const groupKey = groupValues.join('|');
      
      // Get or create group entry
      if (!groupedMap.has(groupKey)) {
        const groupValuesObj: Record<string, string> = {};
        groupOnlyColumns.forEach((col, idx) => {
          groupValuesObj[col] = groupValues[idx];
        });
        groupedMap.set(groupKey, {
          groupValues: groupValuesObj,
          displayValues: {}
        });
      }
      
      // Add display values (use first value encountered for each display column)
      const entry = groupedMap.get(groupKey)!;
      displayColumns.forEach((col, idx) => {
        if (!entry.displayValues[col] && actualDisplayColumnNames[idx]) {
          const cellValue = row[actualDisplayColumnNames[idx]];
          if (cellValue != null && cellValue !== undefined) {
            entry.displayValues[col] = String(cellValue).trim();
          }
        }
      });
    });
    
    // Store grouped rows with display values
    const groupedData = Array.from(groupedMap.values());
    setGroupedRowsWithDisplay(groupedData);
    
    // Format as "val1, val2, ..." for display and selection (without column prefixes)
    const result = groupedData.map(entry => {
      return groupOnlyColumns.map(col => entry.groupValues[col]).filter(v => v !== '').join(', ');
    }).filter(v => v !== '').sort();
    
    console.log(`CSVSelector: Processed ${csvData.length} rows, found ${result.length} unique combinations:`, result.slice(0, 5));
    
    return result;
  }, [selectedCsvIds, csvFiles, selectedFilterColumns, columnModes]); // Recreate when dependencies change


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

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const handleColumnsChange = async (columns: string[]) => {
    console.log('CSVSelector handleColumnsChange called with:', columns);
    const newValues: Record<string, string | null> = { ...selectedFilterValues };
    const newModes: Record<string, ColumnMode> = { ...columnModes };
    
    // Remove values and modes for columns that are no longer selected
    Object.keys(newValues).forEach(col => {
      if (!columns.includes(col)) {
        delete newValues[col];
      }
    });
    Object.keys(newModes).forEach(col => {
      if (!columns.includes(col)) {
        delete newModes[col];
      }
    });
    
    // Set default mode to 'group' for newly added columns
    columns.forEach(col => {
      if (!newModes[col]) {
        newModes[col] = 'group';
      }
    });
    
    setColumnModes(newModes);
    
    // IMPORTANT: Remove values for columns that are in display mode
    const groupColumns = columns.filter(col => newModes[col] === 'group' || !newModes[col]);
    const filteredNewValues: Record<string, string | null> = {};
    groupColumns.forEach(col => {
      if (newValues[col] != null) {
        filteredNewValues[col] = newValues[col];
      }
    });
    
    // Get display columns and try to find their values from the currently selected row
    const displayColumns = columns.filter(col => newModes[col] === 'display');
    let displayValues: Record<string, string | null> = {};
    
    // Try to find display values from the currently selected row if we have a selection
    if (displayColumns.length > 0 && groupedRowsWithDisplay.length > 0 && Object.keys(filteredNewValues).length > 0) {
      const matchingRow = groupedRowsWithDisplay.find(row => {
        return groupColumns.every(col => {
          const rowValue = row.groupValues[col];
          const selectedValue = filteredNewValues[col];
          return rowValue === selectedValue || String(rowValue) === String(selectedValue);
        });
      });
      
      if (matchingRow && matchingRow.displayValues) {
        displayValues = { ...matchingRow.displayValues };
      }
    }
    
    // Re-query grouped values when columns change
    if (columns.length > 0) {
      getCombinedGroupValues(groupColumns, newModes);
    } else {
      setGroupedRowsWithDisplay([]);
    }
    
    onSelectCsv(selectedCsvIds, groupColumns, filteredNewValues, displayColumns, displayValues);
  };

  const handleValueSelect = async (column: string, value: string | null) => {
    console.log('CSVSelector: handleValueSelect called with column:', column, 'value:', value);
    
    // Get only group columns (not display columns)
    const groupColumns = selectedFilterColumns.filter(col => columnModes[col] === 'group' || !columnModes[col]);
    
    // If value is null, just remove from values
    if (!value) {
      const newValues: Record<string, string | null> = {};
      groupColumns.forEach(col => {
        if (col !== column && selectedFilterValues[col] != null) {
          newValues[col] = selectedFilterValues[col];
        }
      });
      const displayColumns = selectedFilterColumns.filter(col => columnModes[col] === 'display');
      onSelectCsv(selectedCsvIds, groupColumns, newValues, displayColumns, {});
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
    const newValues: Record<string, string | null> = {};
    groupColumns.forEach(col => {
      if (parsedValues[col] != null) {
        newValues[col] = parsedValues[col];
      } else if (selectedFilterValues[col] != null && (columnModes[col] === 'group' || !columnModes[col])) {
        newValues[col] = selectedFilterValues[col];
      }
    });
    
    // Find display columns and their values for the selected row
    const displayColumns = selectedFilterColumns.filter(col => columnModes[col] === 'display');
    let displayValues: Record<string, string | null> = {};
    
    if (displayColumns.length > 0 && groupedRowsWithDisplay.length > 0) {
      // Find the matching row in groupedRowsWithDisplay
      const matchingRow = groupedRowsWithDisplay.find(row => {
        return groupColumns.every(col => {
          const rowValue = row.groupValues[col];
          const selectedValue = newValues[col];
          return rowValue === selectedValue || String(rowValue) === String(selectedValue);
        });
      });
      
      if (matchingRow && matchingRow.displayValues) {
        displayValues = { ...matchingRow.displayValues };
      }
    }
    
    onSelectCsv(selectedCsvIds, groupColumns, newValues, displayColumns, displayValues);
    
    // Generate valueInfo for the selected grouped data (only when values are selected, not just columns)
    const hasGroupValues = Object.keys(newValues).some(col => newValues[col] != null && groupColumns.includes(col));
    if (hasGroupValues && groupColumns.length > 0 && selectedCsvIds.length > 0) {
      try {
        const { generateValueInfoFromData, saveValueInfo, deleteValueInfo } = await import("@/lib/chatApi");
        
        // Delete old current_selection for this chat to avoid stale data
        // Note: deleteValueInfo doesn't filter by chatId, but saveValueInfo will update it
        // We'll let saveValueInfo handle the update
        
        // Get filtered CSV data from selected CSVs
        const csvData = await getCsvFileData(selectedCsvIds, groupColumns, newValues);
        if (csvData && csvData.length > 0) {
          // Generate unique ID for this selection (similar to MatchSelector)
          const groupValuesForKey = Object.keys(newValues)
            .filter(k => newValues[k] != null && groupColumns.includes(k))
            .sort()
            .map(k => `${k}=${newValues[k]}`);
          const selectionKey = `${groupColumns.sort().join(',')}:${groupValuesForKey.join(',')}`;
          const selectionHash = selectionKey.split('').reduce((acc, char) => {
            acc = ((acc << 5) - acc) + char.charCodeAt(0);
            return acc & acc;
          }, 0);
          const uniqueValueInfoId = chatId ? `csv_selection_${chatId}_${Math.abs(selectionHash)}` : `csv_selection_${Math.abs(selectionHash)}`;
          const valueInfoId = 'current_selection'; // Use same ID as MatchSelector for consistency
          
          // Generate valueInfo name using only group columns and their values
          const nameParts = groupColumns
            .filter(col => newValues[col] != null)
            .map(col => `${col}=${newValues[col]}`);
          const valueInfoName = nameParts.length > 0 
            ? `Selected Group: ${nameParts.join(', ')}`
            : `Selected Group: ${groupColumns.join(', ')}`;
          
          const valueInfo = generateValueInfoFromData(
            csvData,
            uniqueValueInfoId,
            'csv',
            valueInfoName
          );
          
          if (!valueInfo) {
            console.error('CSVSelector: generateValueInfoFromData returned null - cannot save Value Info');
            return;
          }
          
          // Store filter information (only group columns, not display columns)
          valueInfo.filterColumns = groupColumns;
          valueInfo.filterValues = Object.keys(newValues)
            .filter(k => newValues[k] != null && groupColumns.includes(k))
            .reduce((acc, k) => {
              acc[k] = newValues[k];
              return acc;
            }, {} as Record<string, string | null>);
          valueInfo.rowCount = csvData.length;
          valueInfo.currentSelectionId = valueInfoId;
          
          // Generate a summary for display
          if (!valueInfo.summary || valueInfo.summary.trim() === '') {
            const columns = valueInfo.columns;
            const columnNames = columns.map((c: any) => c.name).join(', ');
            const totalRows = csvData.length;
            
            let summary = `This dataset contains ${totalRows} rows with ${columns.length} columns.\n\n`;
            summary += `Columns: ${columnNames}\n\n`;
            summary += `Filtered by: ${nameParts.join(', ')}`;
            valueInfo.summary = summary;
          }
          
          // Save Value Info WITHOUT data (to avoid quota issues)
          const valueInfoToSave = { 
            ...valueInfo,
            uniqueId: uniqueValueInfoId
          };
          delete valueInfoToSave.data;
          
          // Save the unique Value Info (without data)
          saveValueInfo(valueInfoToSave, chatId);
          
          // Also save/update current_selection directly (for active lookup - same as MatchSelector)
          const currentSelectionCopy = {
            ...valueInfoToSave,
            id: valueInfoId, // Use current_selection ID for active lookup
            uniqueId: uniqueValueInfoId, // Store reference to unique copy
          };
          saveValueInfo(currentSelectionCopy, chatId);
          
          console.log('CSVSelector: Saved valueInfo with', csvData.length, 'rows');
        }
      } catch (e) {
        console.error('Error creating Value Info for CSV:', e);
      }
    } else if (groupColumns.length > 0 && !hasGroupValues) {
      // If columns are selected but no values, we don't create Value Info
      // The existing current_selection will remain until a value is selected
    }
  };

  const handleColumnModeChange = async (column: string, mode: ColumnMode) => {
    const newModes = { ...columnModes, [column]: mode };
    setColumnModes(newModes);
    
    const groupColumns = selectedFilterColumns.filter(col => newModes[col] === 'group' || !newModes[col]);
    const displayColumns = selectedFilterColumns.filter(col => newModes[col] === 'display');
    
    // If switching to display mode, remove from filter values
    if (mode === 'display' && selectedFilterValues[column] != null) {
      const newValues: Record<string, string | null> = {};
      groupColumns.forEach(col => {
        if (selectedFilterValues[col] != null) {
          newValues[col] = selectedFilterValues[col];
        }
      });
      
      // Try to find display values from the currently selected row
      let displayValues: Record<string, string | null> = {};
      if (displayColumns.length > 0 && groupedRowsWithDisplay.length > 0 && Object.keys(newValues).length > 0) {
        const matchingRow = groupedRowsWithDisplay.find(row => {
          return groupColumns.every(col => {
            const rowValue = row.groupValues[col];
            const selectedValue = newValues[col];
            return rowValue === selectedValue || String(rowValue) === String(selectedValue);
          });
        });
        
        if (matchingRow && matchingRow.displayValues) {
          displayValues = { ...matchingRow.displayValues };
        }
      }
      
      onSelectCsv(selectedCsvIds, groupColumns, newValues, displayColumns, displayValues);
    }
    
    // Re-query grouped values when mode changes
    if (selectedFilterColumns.length > 0) {
      getCombinedGroupValues(groupColumns, newModes);
    }
  };
  
  // Handle CSV selection toggle
  const handleCsvToggle = (csvId: string) => {
    if (selectedCsvIds.includes(csvId)) {
      // Remove from selection
      const newIds = selectedCsvIds.filter(id => id !== csvId);
      onSelectCsv(newIds, selectedFilterColumns, selectedFilterValues);
    } else {
      // Add to selection
      const newIds = [...selectedCsvIds, csvId];
      onSelectCsv(newIds, selectedFilterColumns, selectedFilterValues);
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
        />
      </div>
    );
  }

  // Otherwise, render the file upload/selection UI with group by on the right
  return (
    <div className="relative w-full">
      <div className="flex gap-2 items-end">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileUpload}
          className="hidden"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          className="flex-shrink-0"
          title="Upload CSV file"
        >
          <Upload className="h-4 w-4" />
        </Button>
        
        <div className="relative flex-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsOpen(!isOpen)}
            className="w-full justify-start"
            disabled={csvFiles.length === 0}
          >
            <FileText className="h-4 w-4 mr-2" />
            {selectedCsvIds.length > 0 
              ? `${selectedCsvIds.length} CSV${selectedCsvIds.length > 1 ? 's' : ''} selected`
              : csvFiles.length === 0 
              ? "No CSV files" 
              : "Select CSVs to combine"}
          </Button>

          {isOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setIsOpen(false)}
                onMouseDown={(e) => e.preventDefault()}
              />
              <div 
                ref={dropdownRef}
                className="absolute top-full left-0 mt-1 w-full bg-chat-bg border border-border rounded-md shadow-lg z-20 max-h-96 overflow-hidden flex flex-col"
              >
                {selectedCsvIds.length > 0 && (
                  <div className="p-2 border-b border-border flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {selectedCsvIds.length} CSV{selectedCsvIds.length > 1 ? 's' : ''} selected
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        onSelectCsv([], selectedFilterColumns, selectedFilterValues);
                        setIsOpen(false);
                      }}
                    >
                      <X className="h-4 w-4" />
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
                          }}
                          className={`w-full text-left px-3 py-2 hover:bg-accent transition-colors ${
                            isSelected ? "bg-accent" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center flex-1 min-w-0">
                              <div className={`w-4 h-4 border-2 rounded mr-3 flex items-center justify-center flex-shrink-0 ${
                                isSelected ? 'bg-primary border-primary' : 'border-gray-400'
                              }`}>
                                {isSelected && <Check className="h-3 w-3 text-white" />}
                              </div>
                              <FileText className="h-4 w-4 mr-2 flex-shrink-0" />
                              <span className="text-sm truncate">{file.name}</span>
                            </div>
                            <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
                              ({(file.rowCount ?? file.data?.length ?? 0)} rows, {file.headers.length} cols)
                            </span>
                          </div>
                        </button>
                      );
                    })
                )}
                </div>
              </div>
            </>
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
              columnModes={columnModes}
              onColumnModeChange={handleColumnModeChange}
              getUniqueValues={getUniqueValues}
              getFirstValue={getFirstValue}
              getCombinedGroupValues={getCombinedGroupValues}
              groupedRowsWithDisplay={groupedRowsWithDisplay}
              placeholder="Group by..."
              dataSourceKey={selectedCsvIds.join(',')} // Key that changes when CSV selection changes
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default CSVSelector;

