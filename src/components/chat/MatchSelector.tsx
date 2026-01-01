import { useState, useEffect, useCallback, memo } from "react";
import { X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Match } from "@/types/chat";
import { getAvailableMatches, isDatabaseConnected, getDbConnection } from "@/lib/database";
// deleteValueInfo is imported dynamically when needed
import MultiSelectGroupBy from "./MultiSelectGroupBy";

interface MatchSelectorProps {
  selectedMatch: string | null;
  selectedFilterColumns: string[];
  selectedFilterValues: Record<string, string | string[] | null>;
  onSelectMatch: (matchId: string | null, filterColumns?: string[], filterValues?: Record<string, string | string[] | null>, displayColumns?: string[], displayValues?: Record<string, string | null>) => void;
  chatId?: string; // Chat ID for tracking Value Info associations
  disabled?: boolean; // Disable when CSV selection is active
}

const MatchSelector = ({ selectedMatch, selectedFilterColumns, selectedFilterValues, onSelectMatch, chatId, disabled = false }: MatchSelectorProps) => {
  const [matches, setMatches] = useState<Match[]>([]);
  const [availableColumns, setAvailableColumns] = useState<{ value: string; label: string }[]>([]);
  const [columnModes, setColumnModes] = useState<Record<string, 'group' | 'display'>>({});
  const [groupedRowsWithDisplay, setGroupedRowsWithDisplay] = useState<Array<{groupValues: Record<string, string>, displayValues: Record<string, string>}>>([]);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [finalizeProgress, setFinalizeProgress] = useState<string>("");
  const [displayValuesState, setDisplayValuesState] = useState<Record<string, string | null>>({});
  
  // Get table name from settings
  const getTableName = (): string => {
    const tableName = localStorage.getItem("db_table_name");
    return tableName || "combined_dvw"; // Default fallback
  };

  // Get columns directly from SQL database - universal, works with any table
  // CRITICAL: Track table name to refetch columns when it changes
  const [currentTableName, setCurrentTableName] = useState<string>(getTableName());
  
  useEffect(() => {
    const fetchColumns = async () => {
      if (!isDatabaseConnected()) return;
      
      try {
        const db = getDbConnection();
        if (!db) return;
        
        const tableName = getTableName();
        
        // Update tracked table name
        if (tableName !== currentTableName) {
          console.log('Table name changed, clearing columns and refetching:', currentTableName, '->', tableName);
          setAvailableColumns([]); // Clear old columns immediately
          setCurrentTableName(tableName);
        }
        
        // Query to get column names from the configured table - universal approach
        // Use information_schema to get all columns
        const query = `SELECT column_name FROM information_schema.columns WHERE table_name = '${tableName.replace(/'/g, "''")}' ORDER BY ordinal_position`;
        
        // Execute dynamic SQL - use raw query method for security
        const sql = db as any;
        let result;
        if (typeof sql.raw === 'function') {
          result = await sql.raw(query);
        } else {
          // Fallback: properly escape query for template literal injection prevention
          const safeQuery = query.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/`/g, '\\`');
          const executeQuery = new Function('sql', `return sql\`${safeQuery}\``);
          result = await executeQuery(sql);
        }
        
        const columnsResult = Array.isArray(result) ? result : (result?.rows || []);
        
        // Universal: include ALL columns, no filtering - works with any table structure
        const cols = columnsResult
          .map((row: any) => row.column_name)
          .map((col: string) => ({
            value: col,
            label: col.split('_').map(word => 
              word.charAt(0).toUpperCase() + word.slice(1)
            ).join(' ')
          }))
          .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label));
        
        console.log('Fetched columns for table:', tableName, 'Columns:', cols.length);
        setAvailableColumns(cols);
      } catch (e) {
        console.error('Error fetching columns from database:', e);
        // Fallback to empty array
        setAvailableColumns([]);
      }
    };
    
    fetchColumns();
    
    // Poll for database connection changes (only if not connected, stops once connected)
    let checkInterval: NodeJS.Timeout | null = null;
    if (!isDatabaseConnected()) {
      checkInterval = setInterval(() => {
        if (isDatabaseConnected()) {
          fetchColumns();
          if (checkInterval) clearInterval(checkInterval);
        }
      }, 1000); // Check every second until connected
    }
    
    // Poll for table name changes (check every 2 seconds)
    const tableNameCheckInterval = setInterval(() => {
      const newTableName = getTableName();
      if (newTableName !== currentTableName) {
        console.log('Table name changed detected via polling:', currentTableName, '->', newTableName);
        fetchColumns();
      }
    }, 2000);
    
    // Listen for database connection and table name changes
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'db_table_name') {
        // Re-fetch columns when table name or connection string changes
        setTimeout(() => fetchColumns(), 100); // Small delay to ensure localStorage is updated
      }
    };
    
    // Listen for custom events when settings are saved (same window)
    const handleDatabaseUpdate = () => {
      setTimeout(() => fetchColumns(), 100); // Small delay to ensure database is initialized
    };
    
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('databaseUpdated', handleDatabaseUpdate);
    
    return () => {
      if (checkInterval) clearInterval(checkInterval);
      if (tableNameCheckInterval) clearInterval(tableNameCheckInterval);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('databaseUpdated', handleDatabaseUpdate);
    };
  }, [currentTableName]);
  
  // Get grouped rows (distinct combinations) from SQL - these are the selectable units
  // Now supports optional search query for server-side filtering
  const getCombinedGroupValues = useCallback(async (columns: string[], modesOverride?: Record<string, 'group' | 'display'>, searchQuery?: string): Promise<string[]> => {
    if (columns.length === 0 || !isDatabaseConnected()) {
      return [];
    }

    try {
      const db = getDbConnection();
      if (!db) {
        return [];
      }

      const tableName = getTableName();

      // Use modesOverride if provided (for immediate updates), otherwise use columnModes from state
      const currentModes = modesOverride || columnModes;

      // IMPORTANT: Filter columns to ONLY include group columns (exclude display columns)
      // The columns parameter might include display columns if called from MultiSelectGroupBy
      const groupOnlyColumns = columns.filter(col => currentModes[col] === 'group' || !currentModes[col]);

      if (groupOnlyColumns.length === 0) {
        return [];
      }
      
      // Get display columns (columns with mode 'display') from all selected columns
      // These are ONLY for display in the UI, not for grouping or filtering
      const displayColumns = selectedFilterColumns
        .filter(col => currentModes[col] === 'display')
        .filter(col => !groupOnlyColumns.includes(col)); // Don't include columns that are already in the group by
      
      // Build GROUP BY query to get distinct combinations - universal, works with any table
      // IMPORTANT: Only use groupOnlyColumns for grouping, NOT display columns
      // SQLite uses backticks for identifiers
      const quotedColumns = groupOnlyColumns.map(col => `\`${col.replace(/`/g, '``')}\``);
      const columnList = quotedColumns.join(', ');
      const whereClause = quotedColumns.map(col => `${col} IS NOT NULL`).join(' AND ');
      
      // If we have display columns, also select the first value of each display column
      // These are ONLY for display in the UI dropdown, NOT for grouping or filtering
      let selectClause = columnList;
      if (displayColumns.length > 0) {
        // Use MIN() to get a representative value (first value for each group)
        // IMPORTANT: Use the quoted column name in both MIN() and the alias
        const displaySelects = displayColumns.map(col => {
          const quotedCol = `\`${col.replace(/`/g, '``')}\``;
          return `MIN(${quotedCol}) as ${quotedCol}`;
        }).join(', ');
        selectClause = `${columnList}, ${displaySelects}`;
      }
      
      // Query for distinct combinations with display column values
      // Universal: works with any table name from settings
      // IMPORTANT: GROUP BY only uses groupOnlyColumns, display columns are just for UI display
      // SQLite uses backticks for identifiers
      // LIMIT to 10,000 for performance - more than enough for UI selection
      const quotedTable = `\`${tableName.replace(/`/g, '``')}\``;
      const query = `SELECT ${selectClause} FROM ${quotedTable} WHERE ${whereClause} GROUP BY ${columnList} ORDER BY ${columnList} LIMIT 100000`;

      // Execute query via API
      const { executeDbQuery } = await import("@/lib/database");
      const rows = await executeDbQuery(query);
      
      // Store grouped rows with display values for later use
      const groupedData = rows.map((row: any) => {
        const groupValues: Record<string, string> = {};
        const displayValues: Record<string, string> = {};
        
        // ONLY store group columns in groupValues (for filtering/selection)
        groupOnlyColumns.forEach(col => {
          const val = row[col];
          if (val != null) groupValues[col] = String(val);
        });
        
        // Store display columns separately (ONLY for UI display, never for filtering)
        displayColumns.forEach(col => {
          // Try the column name directly first, then with backticks (SQL alias format)
          const quotedCol = `\`${col.replace(/`/g, '``')}\``;
          let val: any = row[col] ?? row[quotedCol];

          if (val != null && val !== undefined) {
            displayValues[col] = String(val);
          }
        });
        
        return { groupValues, displayValues };
      });
      
      setGroupedRowsWithDisplay(groupedData);

      // Format as "val1, val2, ..." for display and selection (without column prefixes)
      // IMPORTANT: Only include groupOnlyColumns in the returned values, NOT display columns
      // Display columns are shown separately in the UI but never included in the value string
      // Filter out placeholder entries like "Custom Code:" and empty values
      return rows.map((row: any) => {
        return groupOnlyColumns.map(col => {
          const val = row[col];
          return val != null ? String(val) : '';
        }).filter((v: string) => v !== '').join(', ');
      }).filter((v: string) => {
        // Filter out empty strings and placeholder entries
        if (!v || v.trim() === '') return false;
        // Filter out "Custom Code:" entries
        if (v.toLowerCase().includes('custom code:') && v.trim().length <= 20) return false;
        return true;
      });
    } catch (e) {
      console.error('Error querying grouped rows from database:', e);
      return [];
    }
  }, [availableColumns, columnModes, selectedFilterColumns]);
  
  // Get unique values for a single column - query SQL directly
  const getUniqueValues = useCallback(async (column: string): Promise<string[]> => {
    if (!isDatabaseConnected()) {
      console.warn('Database not connected');
      return [];
    }
    
    try {
      const db = getDbConnection();
      if (!db) {
        console.warn('No database connection available');
        return [];
      }
      
      const tableName = getTableName();
      
      // Query for distinct values - these represent grouped rows for single column grouping
      // Universal: works with any table name from settings
      // SQLite uses backticks for identifiers
      const quotedColumn = `\`${column.replace(/`/g, '``')}\``;
      const quotedTable = `\`${tableName.replace(/`/g, '``')}\``;
      const query = `SELECT DISTINCT ${quotedColumn} FROM ${quotedTable} WHERE ${quotedColumn} IS NOT NULL ORDER BY ${quotedColumn}`;
      
      // Execute query via API (D1 uses API, not direct SQL)
      const { executeDbQuery } = await import("@/lib/database");
      const rows = await executeDbQuery(query);
      
      // Return just the values without column prefix
      // Filter out placeholder entries like "Custom Code:" and empty values
      const values = rows
        .map((row: any) => {
          const val = row[column];
          return val != null ? String(val) : '';
        })
        .filter((v: string) => {
          // Filter out empty strings, null values, and placeholder text
          if (!v || v.trim() === '') return false;
          // Filter out "Custom Code:" entries
          if (v.toLowerCase().includes('custom code:') && v.trim().length <= 20) return false;
          return true;
        });
      
      return values;
    } catch (e) {
      console.error('Error querying unique values from database for column:', column, e);
      return [];
    }
  }, []);
  
  // Get first value for display indicator (async)
  const getFirstValue = useCallback(async (column: string): Promise<string | null> => {
    const uniqueValues = await getUniqueValues(column);
    return uniqueValues.length > 0 ? uniqueValues[0] : null;
  }, [getUniqueValues]);

  useEffect(() => {
    if (isDatabaseConnected()) {
      const availableMatches = getAvailableMatches();
      // Map database Match to chat Match type (ensure required fields have defaults)
      const mappedMatches: Match[] = availableMatches.map(m => ({
        match_id: m.match_id,
        home_team: m.home_team,
        visiting_team: m.visiting_team,
        total_actions: m.total_actions ?? 0,
        sets_played: m.sets_played ?? 0
      }));
      setMatches(mappedMatches);
      
      // Don't auto-generate valueInfo for all matches - it causes infinite loops
      // ValueInfo will be generated when matches are actually selected/used
      // Apply filters if any are set
      // Note: filteredMatches is no longer used - we use groupedRowsWithDisplay instead
    }
  }, [selectedFilterColumns, selectedFilterValues]);

  // Note: filteredMatches logic removed - we now use groupedRowsWithDisplay from getCombinedGroupValues

  const handleColumnsChange = async (columns: string[]) => {
    const newValues: Record<string, string | string[] | null> = { ...selectedFilterValues };
    const newModes: Record<string, 'group' | 'display'> = { ...columnModes };
    
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
    // IMPORTANT: Don't reset mode for existing display columns that are still selected
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
    // Display columns should NEVER have values in newValues
    const groupColumns = allColumns.filter(col => newModes[col] === 'group' || !newModes[col]);
    const filteredNewValues: Record<string, string | string[] | null> = {};
    groupColumns.forEach(col => {
      if (newValues[col] != null) {
        filteredNewValues[col] = newValues[col];
      }
    });
    
    // Don't delete valueInfo when columns change - it's okay to have multiple
    
    // Get display columns - preserve existing ones if they're still in the selected columns
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
    
    // Only pass group columns and filtered values (no display columns in filter values)
    // But pass display columns and their values separately
    onSelectMatch(selectedMatch, groupColumns, filteredNewValues, displayColumns, displayValues);
    
    // Re-query grouped values when columns change to ensure display columns are included
    // This is especially important when columns are re-selected after being deselected
    if (groupColumns.length > 0) {
      getCombinedGroupValues(groupColumns);
    } else {
      // Clear grouped rows if no columns selected
      setGroupedRowsWithDisplay([]);
    }
  };

  const handleColumnModeChange = async (column: string, mode: 'group' | 'display') => {
    const newModes = { ...columnModes, [column]: mode };
    setColumnModes(newModes);
    
    // If switching to display mode, remove from filter values (it shouldn't be used for filtering)
    if (mode === 'display' && selectedFilterValues[column] != null) {
      const groupColumns = selectedFilterColumns.filter(col => newModes[col] === 'group' || !newModes[col]);
      const displayColumns = selectedFilterColumns.filter(col => newModes[col] === 'display');
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
      
      // Try to find display values from the currently selected row
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
      
      onSelectMatch(selectedMatch, groupColumns, newValues, displayColumns, displayValues);
      
      // Recreate Value Info with updated filter criteria (only group columns)
      if (groupColumns.length > 0 && Object.keys(newValues).some(col => newValues[col] != null && groupColumns.includes(col))) {
        // Trigger Value Info recreation by calling handleValueSelect with the remaining values
        // Find the first group column with a value to trigger recreation
        const firstGroupColumnWithValue = groupColumns.find(col => newValues[col] != null);
        if (firstGroupColumnWithValue) {
          // Recreate Value Info with updated criteria
          await recreateValueInfoForSelection(groupColumns, newValues);
        }
      }
    }
    
    // Re-query grouped values when mode changes to update display columns
    // IMPORTANT: Pass newModes to getCombinedGroupValues to ensure it uses updated modes immediately
    // This ensures display columns are included in the query right away
    if (selectedFilterColumns.length > 0) {
      const groupColumns = selectedFilterColumns.filter(col => newModes[col] === 'group' || !newModes[col]);
      // Re-query grouped values to ensure display columns are included
      getCombinedGroupValues(groupColumns);
    }
  };
  
  // Helper function to recreate Value Info when selection criteria change
  const recreateValueInfoForSelection = async (groupColumns: string[], filterValues: Record<string, string | string[] | null>) => {
    try {
      console.log('MatchSelector: Recreating Value Info for updated selection...');
      const { generateValueInfoFromData, saveValueInfo, deleteValueInfo } = await import("@/lib/chatApi");
      
      // Delete old current_selection for this chat to avoid stale data
      if (chatId) {
        deleteValueInfo('current_selection', 'match');
      }
      
      const db = getDbConnection();
      if (db) {
        // Build WHERE clause using only group columns
        const whereConditions: string[] = [];
          groupColumns.forEach(col => {
            const filterValue = filterValues[col];
            if (filterValue) {
              const quotedCol = `"${col.replace(/"/g, '""')}"`;
              if (Array.isArray(filterValue)) {
                // Multiple values: use IN clause
                const escapedValues = filterValue.map(v => `'${String(v).replace(/'/g, "''")}'`).join(', ');
                whereConditions.push(`${quotedCol} IN (${escapedValues})`);
              } else {
                // Single value: use = clause
                const escapedValue = String(filterValue).replace(/'/g, "''");
                whereConditions.push(`${quotedCol} = '${escapedValue}'`);
              }
            }
          });
        
        if (whereConditions.length > 0) {
          const tableName = getTableName();
          const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
          const query = `SELECT * FROM ${quotedTable} WHERE ${whereConditions.join(' AND ')}`;
          
          console.log('MatchSelector: Recreating Value Info with query:', query);
          
          const sql = db as any;
          let result;
          if (typeof sql.raw === 'function') {
            result = await sql.raw(query);
          } else {
            // Fallback: properly escape query for template literal injection prevention
            const safeQuery = query.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/`/g, '\\`');
            try {
              const executeQuery = new Function('sql', `return sql\`${safeQuery}\``);
              result = await executeQuery(sql);
            } catch (err) {
              console.error('Error fetching raw rows for Value Info recreation:', err);
              throw err;
            }
          }
          const rawRows = Array.isArray(result) ? result : (result?.rows || []);
          
          if (rawRows && rawRows.length > 0) {
            const selectionKey = `${groupColumns.sort().join(',')}:${Object.keys(filterValues).filter(k => filterValues[k] != null).sort().map(k => `${k}=${filterValues[k]}`).join(',')}`;
            const selectionHash = selectionKey.split('').reduce((acc, char) => {
              acc = ((acc << 5) - acc) + char.charCodeAt(0);
              return acc & acc;
            }, 0);
            const uniqueValueInfoId = chatId ? `selection_${chatId}_${Math.abs(selectionHash)}` : `selection_${Math.abs(selectionHash)}`;
            const valueInfoId = 'current_selection';
            
            // Build name using only group columns and their values (excludes display columns)
            const nameParts = groupColumns
              .filter(col => filterValues[col] != null)
              .map(col => {
                const val = filterValues[col];
                if (Array.isArray(val)) {
                  const maxDisplay = 2;
                  if (val.length > maxDisplay) {
                    return `${col}=${val.slice(0, maxDisplay).join(',')}... (${val.length} total)`;
                  }
                  return `${col}=${val.join(',')}`;
                }
                return `${col}=${val}`;
              });
            const valueInfoName = nameParts.length > 0 
              ? `Selected Group: ${nameParts.join(', ')}`
              : `Selected Group: ${groupColumns.join(', ')}`;
            
            const valueInfo = generateValueInfoFromData(
              rawRows,
              uniqueValueInfoId,
              'match',
              valueInfoName
            );
            
            if (valueInfo) {
              valueInfo.filterColumns = groupColumns;
              valueInfo.filterValues = filterValues;
              valueInfo.rowCount = rawRows.length;
              
              const valueInfoToSave = { 
                ...valueInfo,
                uniqueId: uniqueValueInfoId // Set uniqueId for duplicate detection
              };
              delete valueInfoToSave.data;
              
              saveValueInfo(valueInfoToSave, chatId);
              
              const currentSelectionCopy = {
                ...valueInfoToSave,
                id: valueInfoId,
                uniqueId: uniqueValueInfoId,
                chatId: chatId, // CRITICAL: Store chatId to isolate current_selection per chat
              };
              saveValueInfo(currentSelectionCopy, chatId);
              
              console.log('MatchSelector: Recreated Value Info with', rawRows.length, 'rows');
            }
          }
        }
      }
    } catch (e) {
      console.error('Error recreating Value Info:', e);
    }
  };

  const handleBatchValueSelect = async (column: string, values: string[], select: boolean) => {
    console.log('MatchSelector: handleBatchValueSelect called with column:', column, 'values:', values, 'select:', select);
    
    // Get only group columns (not display columns)
    const groupColumns = selectedFilterColumns.filter(col => columnModes[col] === 'group' || !columnModes[col]);
    
    // Start with all existing values
    const newValues: Record<string, string | string[] | null> = {};
    groupColumns.forEach(col => {
      if (selectedFilterValues[col] != null) {
        newValues[col] = selectedFilterValues[col];
      }
    });
    
    // Process all values at once
    const existingValue = newValues[column];
    const stringValues = values.map(v => String(v));
    
    if (select) {
      // Add all values
      if (Array.isArray(existingValue)) {
        // Merge with existing array, avoiding duplicates
        const existingStrings = existingValue.map(v => String(v));
        const newValuesToAdd = stringValues.filter(v => !existingStrings.includes(v));
        if (newValuesToAdd.length > 0) {
          newValues[column] = [...existingValue, ...newValuesToAdd];
        }
      } else if (existingValue != null) {
        // Convert to array and add new values
        const existingString = String(existingValue);
        const newValuesToAdd = stringValues.filter(v => v !== existingString);
        if (newValuesToAdd.length > 0) {
          newValues[column] = [existingValue, ...newValuesToAdd];
        }
      } else {
        // No existing value: set as array if multiple, single if one
        newValues[column] = stringValues.length === 1 ? stringValues[0] : stringValues;
      }
    } else {
      // Remove all values
      if (Array.isArray(existingValue)) {
        const existingStrings = existingValue.map(val => String(val));
        const filtered = existingValue.filter((_, idx) => !stringValues.includes(existingStrings[idx]));
        newValues[column] = filtered.length > 0 ? filtered : null;
      } else if (existingValue != null && stringValues.includes(String(existingValue))) {
        newValues[column] = null;
      }
    }
    
    // Get display columns and preserve their values
    const displayColumns = selectedFilterColumns.filter(col => columnModes[col] === 'display');
    const newDisplayValues: Record<string, string | null> = {};
    displayColumns.forEach(col => {
      if (displayValuesState[col] != null) {
        newDisplayValues[col] = displayValuesState[col];
      }
    });
    
    // Update display values in state
    setDisplayValuesState(newDisplayValues);
    
    // Update selection
    onSelectMatch(null, groupColumns, newValues, displayColumns, newDisplayValues);
  };

  const handleValueSelect = async (column: string, value: string | null) => {
    console.log('MatchSelector: handleValueSelect called with column:', column, 'value:', value, 'selectedColumns:', selectedFilterColumns);
    
    // Get only group columns (not display columns) - this is critical for all operations
    const groupColumns = selectedFilterColumns.filter(col => columnModes[col] === 'group' || !columnModes[col]);
    
    // If value is null, just remove from values (don't delete valueInfo - it's okay to have multiple)
    if (!value) {
      // IMPORTANT: Only include group columns in newValues, exclude display columns
      const newValues: Record<string, string | string[] | null> = {};
      groupColumns.forEach(col => {
        if (col !== column && selectedFilterValues[col] != null) {
          newValues[col] = selectedFilterValues[col];
        }
      });
      // Get display columns (if any) - preserve them, don't clear
      const displayColumns = selectedFilterColumns.filter(col => columnModes[col] === 'display');
      // Preserve display values - don't clear them on value selection
      onSelectMatch(selectedMatch, groupColumns, newValues, displayColumns, displayValuesState);
      return;
    }
    
    // Parse the selected grouped row - format is now just values without column prefixes
    // Single column: just the value
    // Multi-column: comma-separated values in the same order as groupColumns (NOT all selectedFilterColumns)
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
      // Find which group column this value belongs to
      const targetCol = groupColumns.find(col => col === column) || groupColumns[0];
      if (targetCol) {
        parsedValues[targetCol] = value;
      }
    }
    
    // parsedValues now only contains group columns, no need to filter
    const filteredParsedValues = parsedValues;
    
    // Create newValues that ONLY includes group columns (filter out display columns)
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
              const parsedValue = filteredParsedValues[col];
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
        Object.keys(filteredParsedValues).forEach(col => {
          const existingValue = newValues[col];
          if (Array.isArray(existingValue)) {
            const filtered = existingValue.filter((_, idx) => idx !== combinationIndex);
            newValues[col] = filtered.length > 0 ? filtered : null;
          }
        });
      } else {
        // Combination doesn't exist: add all values at the same position (end of arrays)
        Object.keys(filteredParsedValues).forEach(col => {
          const parsedValue = String(filteredParsedValues[col]);
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
      Object.keys(filteredParsedValues).forEach(col => {
        const parsedValue = String(filteredParsedValues[col]);
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
    
    console.log('MatchSelector: parsedValues:', parsedValues, 'filteredParsedValues:', filteredParsedValues, 'newValues (group only):', newValues);
    
    // Find display columns and their values for the selected row
    // IMPORTANT: Always get display columns from selectedFilterColumns to ensure they're preserved
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
    if (displayColumns.length > 0 && groupedRowsWithDisplay.length > 0) {
      // Find the matching row in groupedRowsWithDisplay for the first selected value
      const matchingRow = groupedRowsWithDisplay.find(row => {
        // Check if this row matches the selected group values
        return groupColumns.every(col => {
          const rowValue = row.groupValues[col];
          const selectedValue = Array.isArray(newValues[col]) ? newValues[col][0] : newValues[col];
          return rowValue === selectedValue || String(rowValue) === String(selectedValue);
        });
      });
      
      if (matchingRow && matchingRow.displayValues) {
        // Only add display values for columns that don't already have values
        // Preserve existing display values - don't overwrite user selections
        displayColumns.forEach(col => {
          if (!newDisplayValues[col] && matchingRow.displayValues[col]) {
            newDisplayValues[col] = matchingRow.displayValues[col];
          }
        });
      }
    }
    
    // Update display values in state (preserve them)
    setDisplayValuesState(newDisplayValues);
    
    // When selecting a grouped value, clear the match selection (grouped data is independent)
    // Pass null for matchId so the grouped selection takes precedence
    // Pass group columns, newValues, display columns, and display values
    // IMPORTANT: Keep display columns and values visible - they'll be removed only on finalization
    // IMPORTANT: Do NOT generate Value Info here - only generate it when checkmark is clicked
    onSelectMatch(null, groupColumns, newValues, displayColumns, newDisplayValues);
  };

  const handleClearSelection = async () => {
    // Clear valueInfo when clearing selection
    const { deleteValueInfo } = await import("@/lib/chatApi");
    deleteValueInfo('current_selection', 'match');
    setDisplayValuesState({});
    // Clear all filter values but keep columns and modes
    const emptyValues: Record<string, string | string[] | null> = {};
    const groupColumns = selectedFilterColumns.filter(col => columnModes[col] === 'group' || !columnModes[col]);
    const displayColumns = selectedFilterColumns.filter(col => columnModes[col] === 'display');
    onSelectMatch(null, groupColumns, emptyValues, displayColumns, {});
  };

  const handleFinalizeSelection = async () => {
    if (isFinalizing) return;
    
    setIsFinalizing(true);
    setFinalizeProgress("Processing...");
    
    try {
      // Get only group columns (not display columns)
      const groupColumns = selectedFilterColumns.filter(col => columnModes[col] === 'group' || !columnModes[col]);
      
      // Remove display columns - this is the key change: only remove on finalization
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
      
      // Query database with final filter values
      const db = getDbConnection();
      if (db) {
        const whereConditions: string[] = [];
        
        groupColumns.forEach(col => {
          const filterValue = finalFilterValues[col];
          if (filterValue) {
            const quotedCol = `"${col.replace(/"/g, '""')}"`;
            if (Array.isArray(filterValue)) {
              // Multiple values: use IN clause
              const escapedValues = filterValue.map(v => `'${String(v).replace(/'/g, "''")}'`).join(', ');
              whereConditions.push(`${quotedCol} IN (${escapedValues})`);
            } else {
              // Single value: use = clause
              const escapedValue = String(filterValue).replace(/'/g, "''");
              whereConditions.push(`${quotedCol} = '${escapedValue}'`);
            }
          }
        });
        
        if (whereConditions.length > 0) {
          const tableName = getTableName();
          const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
          
          // First, get row count to estimate size
          const countQuery = `SELECT COUNT(*) as count FROM ${quotedTable} WHERE ${whereConditions.join(' AND ')}`;
          const sql = db as any;
          let countResult;
          if (typeof sql.raw === 'function') {
            countResult = await sql.raw(countQuery);
          } else {
            // Fallback: properly escape query for template literal injection prevention
            const safeCountQuery = countQuery.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/`/g, '\\`');
            try {
              const executeCountQuery = new Function('sql', `return sql\`${safeCountQuery}\``);
              countResult = await executeCountQuery(sql);
            } catch (err) {
              console.error('Error fetching row count:', err);
              throw err;
            }
          }
          const countRows = Array.isArray(countResult) ? countResult : (countResult?.rows || []);
          const rowCount = countRows[0]?.count || 0;
          
          // NO LIMIT - DuckDB can handle millions of rows efficiently
          // Remove artificial row limits for maximum data access
          const query = `SELECT * FROM ${quotedTable} WHERE ${whereConditions.join(' AND ')}`;
          
          let result;
          if (typeof sql.raw === 'function') {
            try {
              result = await sql.raw(query);
            } catch (err: any) {
              // Check for size limit error
              if (err?.message?.includes('response is too large') || err?.message?.includes('507')) {
                throw new Error('Selection too large - please select fewer items (database response limit: ~64MB)');
              }
              console.error('Error fetching raw rows:', err);
              throw err;
            }
          } else {
            // Fallback: properly escape query for template literal injection prevention
            const safeQuery = query.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/`/g, '\\`');
            try {
              const executeQuery = new Function('sql', `return sql\`${safeQuery}\``);
              result = await executeQuery(sql);
            } catch (err: any) {
              // Check for size limit error
              if (err?.message?.includes('response is too large') || err?.message?.includes('507')) {
                throw new Error('Selection too large - please select fewer items (database response limit: ~64MB)');
              }
              console.error('Error fetching raw rows:', err);
              throw err;
            }
          }
          const rawRows = Array.isArray(result) ? result : (result?.rows || []);
          
          if (rawRows && rawRows.length > 0) {
            // Warn if we hit the limit
            if (rowCount > 0) { // No longer a limit, so always warn if rows are returned
              console.warn(`Query returned ${rawRows.length} rows (from ${rowCount} total)`);
            }
            const { generateValueInfoFromData, saveValueInfo, deleteValueInfo } = await import("@/lib/chatApi");
            
            // Delete old current_selection
            if (chatId) {
              deleteValueInfo('current_selection', 'match');
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
            const uniqueValueInfoId = chatId ? `selection_${chatId}_${Math.abs(selectionHash)}` : `selection_${Math.abs(selectionHash)}`;
            const valueInfoId = 'current_selection';
            
            // Build name using only group columns and their values
            const nameParts = groupColumns
              .filter(col => finalFilterValues[col] != null)
              .map(col => {
                const val = finalFilterValues[col];
                if (Array.isArray(val)) {
                  const maxDisplay = 2;
                  if (val.length > maxDisplay) {
                    return `${col}=${val.slice(0, maxDisplay).join(',')}... (${val.length} total)`;
                  }
                  return `${col}=${val.join(',')}`;
                }
                return `${col}=${val}`;
              });
            const valueInfoName = nameParts.length > 0 
              ? `Selected Group: ${nameParts.join(', ')}`
              : `Selected Group: ${groupColumns.join(', ')}`;
            
            const valueInfo = generateValueInfoFromData(
              rawRows,
              uniqueValueInfoId,
              'match',
              valueInfoName
            );
            
            if (valueInfo) {
              valueInfo.filterColumns = groupColumns;
              valueInfo.filterValues = finalFilterValues;
              // Store both the actual row count from database and whether it was limited
              valueInfo.rowCount = rawRows.length; // Actual rows in data array
              valueInfo.totalRowCount = rowCount; // Total rows available in database
              valueInfo.isLimited = rowCount > 0; // Flag indicating if data was limited
              
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
                chatId: chatId, // CRITICAL: Store chatId to isolate current_selection per chat
              };
              saveValueInfo(currentSelectionCopy, chatId);
            }
          }
        }
      }
      
      // Update selection: remove display columns, keep only group columns
      onSelectMatch(null, finalFilterColumns, finalFilterValues, finalDisplayColumns, finalDisplayValues);
      
      // Clear display values from state
      setDisplayValuesState({});
      
      setFinalizeProgress("Done");
      
      // Clear progress message after a short delay and reset state
      setTimeout(() => {
        setFinalizeProgress("");
        setIsFinalizing(false);
      }, 1000);
    } catch (e: any) {
      console.error('Error finalizing selection:', e);
      
      // Check for specific error types
      let errorMessage = "Error finalizing selection";
      
      if (e?.message?.includes('response is too large') || e?.message?.includes('507')) {
        errorMessage = "Selection too large - please select fewer items (max ~64MB)";
      } else if (e?.message) {
        errorMessage = `Error: ${e.message}`;
      }
      
      setFinalizeProgress(errorMessage);
      setIsFinalizing(false);
      setTimeout(() => {
        setFinalizeProgress("");
      }, 5000); // Show error longer so user can read it
    }
  };

  const selectedMatchData = matches.find(m => m.match_id === selectedMatch);

  if (!isDatabaseConnected()) {
    return null;
  }

  return (
    <div className="relative">
      <div className="flex gap-2 items-end">
        {availableColumns.length > 0 && (
          <div className="flex-1">
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
              placeholder="Group by..."
              groupedRowsWithDisplay={groupedRowsWithDisplay}
              disabled={disabled}
            />
          </div>
        )}
      </div>
      
      {selectedMatchData && (
        <div className="mt-2 flex items-center gap-2 p-2 bg-secondary rounded-lg border border-border">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">
              {selectedMatchData.home_team} vs {selectedMatchData.visiting_team}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {selectedMatchData.match_id}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleClearSelection}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
      
      {/* Show selected grouped data indicator - only show when no match is selected */}
      {!selectedMatch && (() => {
        // Only show group columns that have values (exclude display columns)
        const groupColumnsWithValues = selectedFilterColumns
          .filter(col => (columnModes[col] === 'group' || !columnModes[col]) && selectedFilterValues[col] != null);
        return groupColumnsWithValues.length > 0;
      })() && (
        <div className="mt-2 flex items-center gap-2 p-2 bg-primary/20 rounded-lg border border-primary/30">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-primary">
              Selected Data: {selectedFilterColumns
                .filter(col => {
                  // CRITICAL: Only show columns that are:
                  // 1. In group mode (or undefined, which defaults to group)
                  // 2. Have a non-null value
                  // 3. Are NOT in display mode (double-check)
                  const isGroup = columnModes[col] === 'group' || !columnModes[col];
                  const isNotDisplay = columnModes[col] !== 'display';
                  const hasValue = selectedFilterValues[col] != null;
                  return isGroup && isNotDisplay && hasValue;
                })
                .map(col => {
                const value = selectedFilterValues[col];
                const colLabel = availableColumns.find(c => c.value === col)?.label || col;
                if (Array.isArray(value)) {
                  const maxDisplay = 2; // Show first 2 values in green banner
                  if (value.length > maxDisplay) {
                    const displayed = value.slice(0, maxDisplay).join(', ');
                    return `${colLabel}=${displayed}... (${value.length} total)`;
                  }
                  return `${colLabel}=${value.join(', ')}`;
                }
                return value ? `${colLabel}=${value}` : null;
              }).filter(Boolean).join(', ')}
            </div>
            <div className="text-xs text-muted-foreground">
              {isFinalizing ? finalizeProgress : (() => {
                const groupColumns = selectedFilterColumns.filter(col => (columnModes[col] === 'group' || !columnModes[col]) && selectedFilterValues[col] != null);
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
export default memo(MatchSelector);

