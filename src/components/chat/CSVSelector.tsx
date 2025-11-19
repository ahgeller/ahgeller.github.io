import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { FileText, X, Upload } from "lucide-react";
import { getCsvFileData, getValueInfo } from "@/lib/chatApi";
import { parseCsvText } from "@/lib/csvUtils";
import { migrateLegacyCsvFile, saveCsvDataText } from "@/lib/csvStorage";
import MultiSelectGroupBy from "./MultiSelectGroupBy";

interface CSVSelectorProps {
  selectedCsvId: string | null;
  selectedFilterColumns: string[];
  selectedFilterValues: Record<string, string | null>;
  onSelectCsv: (csvId: string | null, filterColumns?: string[], filterValues?: Record<string, string | null>, displayColumns?: string[], displayValues?: Record<string, string | null>) => void;
  chatId?: string; // Chat ID for tracking Value Info associations
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

const CSVSelector = ({ selectedCsvId, selectedFilterColumns, selectedFilterValues, onSelectCsv, chatId }: CSVSelectorProps) => {
  const [csvFiles, setCsvFiles] = useState<CSVFile[]>([]);
  const [filteredCsvFiles, setFilteredCsvFiles] = useState<CSVFile[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [columnModes, setColumnModes] = useState<Record<string, ColumnMode>>({});
  const [groupedRowsWithDisplay, setGroupedRowsWithDisplay] = useState<Array<{groupValues: Record<string, string>, displayValues: Record<string, string>}>>([]);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadCsvFiles = () => {
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
          const cleanedFiles = parsed
            .map((file: CSVFile | null) => {
              if (!file) return null;
              const { updatedFile, migrated } = migrateLegacyCsvFile(file);
              if (migrated) {
                needsSave = true;
              }
              if (!updatedFile.rowCount && Array.isArray(file.data)) {
                updatedFile.rowCount = file.data.length;
              }
              return updatedFile;
            })
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
    reader.onload = (e) => {
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
      try {
        localStorage.setItem("db_csv_files", JSON.stringify(updatedFiles));
        saveCsvDataText(csvFile.id, text, data);
        setCsvFiles(updatedFiles);
        setFilteredCsvFiles(updatedFiles);
        onSelectCsv(csvFile.id);
      } catch (error) {
        console.error("Failed to save CSV file:", error);
        alert("Unable to save CSV file. Storage limit may have been reached. Please remove older files and try again.");
      }
    };

    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const selectedFile = csvFiles.find(f => f.id === selectedCsvId);
  
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
  
  // Get available columns from all CSV files combined
  const availableColumns = (() => {
    if (csvFiles.length === 0) return [];
    
    // Combine headers from all CSV files
    const allHeaders = new Set<string>();
    csvFiles.forEach(file => {
      if (file.headers && Array.isArray(file.headers)) {
        file.headers.forEach(header => allHeaders.add(header));
      }
    });
    
    // Try to get from Value Info if available (for selected file)
    if (selectedCsvId) {
      try {
        const valueInfo = getValueInfo(selectedCsvId, 'csv');
        if (valueInfo && valueInfo.columns) {
          valueInfo.columns.forEach((col: any) => {
            if (col.name) allHeaders.add(col.name);
          });
        }
      } catch (e) {
        // Fallback to headers
      }
    }
    
    return Array.from(allHeaders).map(col => ({ value: col, label: col })).sort((a, b) => a.label.localeCompare(b.label));
  })();
  
  // Get unique values from a column (from all CSV files combined)
  const getUniqueValues = (column: string): string[] => {
    if (csvFiles.length === 0) return [];
    
    // Get combined data from all CSV files
    const csvData = getCsvFileData(null, null, null);
    if (!csvData || csvData.length === 0) return [];
    
    // Find the actual column name (case-insensitive match)
    const firstRow = csvData[0];
    if (!firstRow) return [];
    
    // Try exact match first
    let actualColumnName: string | undefined = column;
    if (!(column in firstRow)) {
      // Try case-insensitive match
      actualColumnName = Object.keys(firstRow).find(
        key => key.toLowerCase() === column.toLowerCase()
      );
      
      if (!actualColumnName) {
        // Column doesn't exist at all
        console.warn(`Column "${column}" not found in CSV data`);
        return [];
      }
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
    
    return Array.from(values).sort();
  };
  
  // Get first value for display indicator
  const getFirstValue = (column: string): string | null => {
    const uniqueValues = getUniqueValues(column);
    return uniqueValues.length > 0 ? uniqueValues[0] : null;
  };

  // Get unique combinations of values from multiple columns (like pandas groupby)
  // Updated to support display columns like MatchSelector
  const getCombinedGroupValues = (columns: string[], modesOverride?: Record<string, ColumnMode>): string[] => {
    if (columns.length === 0) return [];
    if (csvFiles.length === 0) return [];
    
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
    
    // Get combined data from all CSV files
    const csvData = getCsvFileData(null, null, null);
    if (!csvData || csvData.length === 0) {
      console.warn('No CSV data available for combined grouping');
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
    
    console.log(`CSVSelector: Processed ${csvData.length} rows, found ${result.length} unique combinations`);
    
    return result;
  };


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
    
    onSelectCsv(selectedCsvId, groupColumns, filteredNewValues, displayColumns, displayValues);
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
      onSelectCsv(selectedCsvId, groupColumns, newValues, displayColumns, {});
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
    
    onSelectCsv(selectedCsvId, groupColumns, newValues, displayColumns, displayValues);
    
    // Generate valueInfo for the selected grouped data
    const hasGroupValues = Object.keys(newValues).some(col => newValues[col] != null && groupColumns.includes(col));
    if (hasGroupValues && groupColumns.length > 0) {
      try {
        const { generateValueInfoFromData, saveValueInfo } = await import("@/lib/chatApi");
        
        // Get filtered CSV data
        const csvData = getCsvFileData(null, groupColumns, newValues);
        if (csvData && csvData.length > 0) {
          // Generate unique ID for this selection
          const selectionKey = `${groupColumns.sort().join(',')}:${Object.keys(newValues).sort().map(k => `${k}=${newValues[k]}`).join(',')}`;
          const hash = selectionKey.split('').reduce((acc, char) => {
            const hash = ((acc << 5) - acc) + char.charCodeAt(0);
            return hash & hash;
          }, 0);
          const uniqueValueInfoId = `csv_selection_${chatId || 'global'}_${Math.abs(hash)}`;
          const valueInfoId = `current_selection_${chatId || 'global'}`;
          
          // Generate valueInfo name
          const nameParts = Object.keys(newValues)
            .filter(k => newValues[k] != null)
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
          
          if (valueInfo) {
            valueInfo.filterColumns = groupColumns;
            valueInfo.filterValues = Object.keys(newValues)
              .filter(k => newValues[k] != null && groupColumns.includes(k))
              .reduce((acc, k) => {
                acc[k] = newValues[k];
                return acc;
              }, {} as Record<string, string | null>);
            valueInfo.rowCount = csvData.length;
            
            const valueInfoToSave = { 
              ...valueInfo,
              uniqueId: uniqueValueInfoId
            };
            delete valueInfoToSave.data;
            
            saveValueInfo(valueInfoToSave, chatId);
            
            const currentSelectionCopy = {
              ...valueInfoToSave,
              id: valueInfoId,
              uniqueId: uniqueValueInfoId,
            };
            saveValueInfo(currentSelectionCopy, chatId);
            
            console.log('CSVSelector: Saved valueInfo with', csvData.length, 'rows');
          }
        }
      } catch (e) {
        console.error('Error creating Value Info for CSV:', e);
      }
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
      
      onSelectCsv(selectedCsvId, groupColumns, newValues, displayColumns, displayValues);
    }
    
    // Re-query grouped values when mode changes
    if (selectedFilterColumns.length > 0) {
      getCombinedGroupValues(groupColumns, newModes);
    }
  };

  return (
    <div className="relative">
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
        
        {csvFiles.length > 0 && availableColumns.length > 0 && (
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
        )}
        
        <div className="relative flex-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsOpen(!isOpen)}
            className="w-full justify-start"
            disabled={csvFiles.length === 0}
          >
            <FileText className="h-4 w-4 mr-2" />
            {selectedFile ? selectedFile.name : csvFiles.length === 0 ? "No CSV files" : "Select CSV"}
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
                {selectedCsvId && (
                  <div className="p-2 border-b border-border flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Selected: {selectedFile?.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        onSelectCsv(null);
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
                    filteredCsvFiles.map((file) => (
                  <button
                    key={file.id}
                    onClick={() => {
                      onSelectCsv(file.id);
                      setIsOpen(false);
                          setFileSearchQuery("");
                    }}
                        className={`w-full text-left px-3 py-2 hover:bg-accent transition-colors ${
                      selectedCsvId === file.id ? "bg-accent" : ""
                    }`}
                  >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center flex-1 min-w-0">
                            <FileText className="h-4 w-4 mr-2 flex-shrink-0" />
                            <span className="text-sm truncate">{file.name}</span>
                          </div>
                          <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
                            ({(file.rowCount ?? file.data?.length ?? 0)} rows, {file.headers.length} cols)
                      </span>
                    </div>
                  </button>
                  ))
                )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CSVSelector;

