import { useState, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Match } from "@/types/chat";
import { getAvailableMatches, isDatabaseConnected, getDbConnection } from "@/lib/database";
// deleteValueInfo is imported dynamically when needed
import MultiSelectGroupBy from "./MultiSelectGroupBy";

interface MatchSelectorProps {
  selectedMatch: string | null;
  selectedFilterColumns: string[];
  selectedFilterValues: Record<string, string | null>;
  onSelectMatch: (matchId: string | null, filterColumns?: string[], filterValues?: Record<string, string | null>, displayColumns?: string[], displayValues?: Record<string, string | null>) => void;
  chatId?: string; // Chat ID for tracking Value Info associations
}

const MatchSelector = ({ selectedMatch, selectedFilterColumns, selectedFilterValues, onSelectMatch, chatId }: MatchSelectorProps) => {
  const [matches, setMatches] = useState<Match[]>([]);
  const [availableColumns, setAvailableColumns] = useState<{ value: string; label: string }[]>([]);
  const [columnModes, setColumnModes] = useState<Record<string, 'group' | 'display'>>({});
  const [groupedRowsWithDisplay, setGroupedRowsWithDisplay] = useState<Array<{groupValues: Record<string, string>, displayValues: Record<string, string>}>>([]);
  
  // Get table name from settings
  const getTableName = (): string => {
    const tableName = localStorage.getItem("db_table_name");
    return tableName || "combined_dvw"; // Default fallback
  };

  // Get columns directly from SQL database - universal, works with any table
  useEffect(() => {
    const fetchColumns = async () => {
      if (!isDatabaseConnected()) return;
      
      try {
        const db = getDbConnection();
        if (!db) return;
        
        const tableName = getTableName();
        
        // Query to get column names from the configured table - universal approach
        // Use information_schema to get all columns
        const query = `SELECT column_name FROM information_schema.columns WHERE table_name = '${tableName.replace(/'/g, "''")}' ORDER BY ordinal_position`;
        
        // Execute dynamic SQL
        const sql = db as any;
        let result;
        try {
          const executeQuery = new Function('sql', `return sql\`${query.replace(/`/g, '\\`')}\``);
          result = await executeQuery(sql);
        } catch (err) {
          if (typeof sql.raw === 'function') {
            result = await sql.raw(query);
          } else {
            throw err;
          }
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
    
    // Listen for database connection and table name changes
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'db_table_name' || e.key === 'neon_connection_string' || e.key === 'db_connection_string') {
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
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('databaseUpdated', handleDatabaseUpdate);
    };
  }, []);
  
  // Get grouped rows (distinct combinations) from SQL - these are the selectable units
  const getCombinedGroupValues = useCallback(async (columns: string[], modesOverride?: Record<string, 'group' | 'display'>): Promise<string[]> => {
    if (columns.length === 0 || !isDatabaseConnected()) return [];
    
    try {
      const db = getDbConnection();
      if (!db) return [];
      
      const tableName = getTableName();
      
      // Use modesOverride if provided (for immediate updates), otherwise use columnModes from state
      const currentModes = modesOverride || columnModes;
      
      // IMPORTANT: Filter columns to ONLY include group columns (exclude display columns)
      // The columns parameter might include display columns if called from MultiSelectGroupBy
      const groupOnlyColumns = columns.filter(col => currentModes[col] === 'group' || !currentModes[col]);
      
      if (groupOnlyColumns.length === 0) {
        console.warn('MatchSelector: No group columns to query');
        return [];
      }
      
      // Get display columns (columns with mode 'display') from all selected columns
      // These are ONLY for display in the UI, not for grouping or filtering
      const displayColumns = selectedFilterColumns
        .filter(col => currentModes[col] === 'display')
        .filter(col => !groupOnlyColumns.includes(col)); // Don't include columns that are already in the group by
      
      // Build GROUP BY query to get distinct combinations - universal, works with any table
      // IMPORTANT: Only use groupOnlyColumns for grouping, NOT display columns
      // Quote column names to handle special characters
      const quotedColumns = groupOnlyColumns.map(col => `"${col.replace(/"/g, '""')}"`);
      const columnList = quotedColumns.join(', ');
      const whereClause = quotedColumns.map(col => `${col} IS NOT NULL`).join(' AND ');
      
      // If we have display columns, also select the first value of each display column
      // These are ONLY for display in the UI dropdown, NOT for grouping or filtering
      let selectClause = columnList;
      if (displayColumns.length > 0) {
        // Use MIN() to get a representative value (first value for each group)
        // IMPORTANT: Use the quoted column name in both MIN() and the alias
        const displaySelects = displayColumns.map(col => {
          const quotedCol = `"${col.replace(/"/g, '""')}"`;
          return `MIN(${quotedCol}) as ${quotedCol}`;
        }).join(', ');
        selectClause = `${columnList}, ${displaySelects}`;
      }
      
      // Query for distinct combinations with display column values
      // Universal: works with any table name from settings
      // IMPORTANT: GROUP BY only uses groupOnlyColumns, display columns are just for UI display
      const query = `SELECT ${selectClause} FROM "${tableName.replace(/"/g, '""')}" WHERE ${whereClause} GROUP BY ${columnList} ORDER BY ${columnList} LIMIT 1000`;
      
      // Execute dynamic SQL - neon uses template literals, so we need to construct it dynamically
      // Since column names are safe (from information_schema), we can safely interpolate them
      const sql = db as any;
      let result;
      
      // Neon library uses template literals: sql`SELECT ...`
      // For dynamic SQL, we need to use Function constructor or eval (not ideal but necessary)
      // Alternative: use sql.raw() if available, or construct template literal dynamically
      try {
        // Try using Function to create a template literal call
        // This allows us to execute dynamic SQL safely
        const executeQuery = new Function('sql', `return sql\`${query.replace(/`/g, '\\`')}\``);
        result = await executeQuery(sql);
      } catch (err) {
        console.error('Error executing dynamic query with Function, trying alternative:', err);
        // Fallback: if Function doesn't work, try sql.raw() or direct call
        if (typeof sql.raw === 'function') {
          result = await sql.raw(query);
        } else {
          throw new Error('Cannot execute dynamic SQL query - neon library method not available');
        }
      }
      
      // Handle both array and object with rows property
      const rows = Array.isArray(result) ? result : (result?.rows || []);
      
      // Debug: Log first row to see what column names the database returns
      if (rows.length > 0 && displayColumns.length > 0) {
        console.log('MatchSelector: First row keys for display column debugging:', {
          rowKeys: Object.keys(rows[0]),
          displayColumns,
          firstRow: rows[0]
        });
      }
      
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
        // IMPORTANT: SQL alias uses quoted column names, but database might return them differently
        displayColumns.forEach(col => {
          const quotedCol = `"${col.replace(/"/g, '""')}"`;
          const simpleQuotedCol = `"${col}"`;
          
          // Try multiple column name formats to match what the database returns
          let val: any = undefined;
          
          // 1. Try quoted column name (matches SQL alias exactly)
          val = row[quotedCol];
          
          // 2. Try unquoted column name
          if (val == null || val === undefined) {
            val = row[col];
          }
          
          // 3. Try simple quoted (without escaping)
          if (val == null || val === undefined) {
            val = row[simpleQuotedCol];
          }
          
          // 4. Try lowercase
          if (val == null || val === undefined) {
            val = row[col.toLowerCase()];
          }
          
          // 5. Try uppercase
          if (val == null || val === undefined) {
            val = row[col.toUpperCase()];
          }
          
          // 6. Try finding by case-insensitive match in row keys
          if (val == null || val === undefined) {
            const rowKeys = Object.keys(row);
            const matchingKey = rowKeys.find(key => key.toLowerCase() === col.toLowerCase());
            if (matchingKey) {
              val = row[matchingKey];
            }
          }
          
          // 7. Try finding quoted version in row keys (case-insensitive)
          if (val == null || val === undefined) {
            const rowKeys = Object.keys(row);
            const matchingKey = rowKeys.find(key => {
              const keyWithoutQuotes = key.replace(/^"|"$/g, '');
              return keyWithoutQuotes.toLowerCase() === col.toLowerCase();
            });
            if (matchingKey) {
              val = row[matchingKey];
            }
          }
          
          // Debug logging for missing values (only log once per column to avoid spam)
          if ((val == null || val === undefined)) {
            const rowKeys = Object.keys(row);
            console.warn(`MatchSelector: Display column "${col}" value not found. Available keys:`, rowKeys.slice(0, 10));
          }
          
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
      return rows.map((row: any) => {
        return groupOnlyColumns.map(col => {
          const val = row[col];
          return val != null ? String(val) : '';
        }).filter((v: string) => v !== '').join(', ');
      }).filter((v: string) => v !== '');
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
      // Quote column name to handle special characters
      const quotedColumn = `"${column.replace(/"/g, '""')}"`;
      const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
      const query = `SELECT DISTINCT ${quotedColumn} FROM ${quotedTable} WHERE ${quotedColumn} IS NOT NULL ORDER BY ${quotedColumn} LIMIT 1000`;
      
      // Execute dynamic SQL using Function constructor to create template literal
      const sql = db as any;
      let result;
      try {
        const executeQuery = new Function('sql', `return sql\`${query.replace(/`/g, '\\`')}\``);
        result = await executeQuery(sql);
      } catch (err) {
        console.error('Error executing query:', err);
        if (typeof sql.raw === 'function') {
          result = await sql.raw(query);
        } else {
          throw err;
        }
      }
      
      // Handle both array and object with rows property
      const rows = Array.isArray(result) ? result : (result?.rows || []);
      
      // Return just the values without column prefix
      const values = rows
        .map((row: any) => {
          const val = row[column];
          return val != null ? String(val) : '';
        })
        .filter((v: string) => v !== '');
      
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
    const newValues: Record<string, string | null> = { ...selectedFilterValues };
    const newModes: Record<string, 'group' | 'display'> = { ...columnModes };
    
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
    // IMPORTANT: Also reset mode for columns that were previously deselected and are now re-selected
    // This ensures clean state when toggling columns
    columns.forEach(col => {
      // If column is not in newModes, it's either new or was previously deselected
      // In either case, set it to 'group' mode
      if (!newModes[col]) {
        newModes[col] = 'group';
      }
    });
    
    setColumnModes(newModes);
    
    // IMPORTANT: Remove values for columns that are in display mode
    // Display columns should NEVER have values in newValues
    const groupColumns = columns.filter(col => newModes[col] === 'group' || !newModes[col]);
    const filteredNewValues: Record<string, string | null> = {};
    groupColumns.forEach(col => {
      if (newValues[col] != null) {
        filteredNewValues[col] = newValues[col];
      }
    });
    
    // Don't delete valueInfo when columns change - it's okay to have multiple
    
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
    
    // Only pass group columns and filtered values (no display columns in filter values)
    // But pass display columns and their values separately
    onSelectMatch(selectedMatch, groupColumns, filteredNewValues, displayColumns, displayValues);
    
    // Re-query grouped values when columns change to ensure display columns are included
    // This is especially important when columns are re-selected after being deselected
    if (columns.length > 0) {
      // Use newModes to ensure we have the latest mode information
      getCombinedGroupValues(groupColumns, newModes);
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
      // Pass newModes as override to ensure display columns are included
      getCombinedGroupValues(groupColumns, newModes);
    }
  };
  
  // Helper function to recreate Value Info when selection criteria change
  const recreateValueInfoForSelection = async (groupColumns: string[], filterValues: Record<string, string | null>) => {
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
            const escapedValue = filterValue.replace(/'/g, "''");
            whereConditions.push(`${quotedCol} = '${escapedValue}'`);
          }
        });
        
        if (whereConditions.length > 0) {
          const tableName = getTableName();
          const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
          const query = `SELECT * FROM ${quotedTable} WHERE ${whereConditions.join(' AND ')}`;
          
          console.log('MatchSelector: Recreating Value Info with query:', query);
          
          const sql = db as any;
          let result;
          try {
            const executeQuery = new Function('sql', `return sql\`${query.replace(/`/g, '\\`')}\``);
            result = await executeQuery(sql);
          } catch (err) {
            console.error('Error fetching raw rows for Value Info recreation:', err);
            if (typeof sql.raw === 'function') {
              result = await sql.raw(query);
            } else {
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
              .map(col => `${col}=${filterValues[col]}`);
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

  const handleValueSelect = async (column: string, value: string | null) => {
    console.log('MatchSelector: handleValueSelect called with column:', column, 'value:', value, 'selectedColumns:', selectedFilterColumns);
    
    // Get only group columns (not display columns) - this is critical for all operations
    const groupColumns = selectedFilterColumns.filter(col => columnModes[col] === 'group' || !columnModes[col]);
    
    // If value is null, just remove from values (don't delete valueInfo - it's okay to have multiple)
    if (!value) {
      // IMPORTANT: Only include group columns in newValues, exclude display columns
      const newValues: Record<string, string | null> = {};
      groupColumns.forEach(col => {
        if (col !== column && selectedFilterValues[col] != null) {
          newValues[col] = selectedFilterValues[col];
        }
      });
      // Get display columns (if any)
      const displayColumns = selectedFilterColumns.filter(col => columnModes[col] === 'display');
      // When deselecting, clear display values too
      onSelectMatch(selectedMatch, groupColumns, newValues, displayColumns, {});
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
    // Start with existing values, but only keep those that are in groupColumns
    const newValues: Record<string, string | null> = {};
    groupColumns.forEach(col => {
      // Use the new parsed value if available, otherwise keep existing value if it's a group column
      if (filteredParsedValues[col] != null) {
        newValues[col] = filteredParsedValues[col];
      } else if (selectedFilterValues[col] != null && (columnModes[col] === 'group' || !columnModes[col])) {
        newValues[col] = selectedFilterValues[col];
      }
    });
    
    console.log('MatchSelector: parsedValues:', parsedValues, 'filteredParsedValues:', filteredParsedValues, 'newValues (group only):', newValues);
    
    // Find display columns and their values for the selected row
    const displayColumns = selectedFilterColumns.filter(col => columnModes[col] === 'display');
    let displayValues: Record<string, string | null> = {};
    
    if (displayColumns.length > 0 && groupedRowsWithDisplay.length > 0) {
      // Find the matching row in groupedRowsWithDisplay
      const matchingRow = groupedRowsWithDisplay.find(row => {
        // Check if this row matches the selected group values
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
    
    // When selecting a grouped value, clear the match selection (grouped data is independent)
    // Pass null for matchId so the grouped selection takes precedence
    // Pass group columns, newValues, display columns, and display values
    onSelectMatch(null, groupColumns, newValues, displayColumns, displayValues);
    
    // Generate valueInfo for the selected grouped data so it's available for chat
    // IMPORTANT: Display columns don't affect Value Info creation - they're purely visual
    // Only create Value Info if we have group columns with values (display columns are excluded)
    const hasGroupValues = Object.keys(newValues).some(col => newValues[col] != null && groupColumns.includes(col));
    console.log('MatchSelector: Value Info creation check:', {
      hasGroupValues,
      groupColumnsLength: groupColumns.length,
      newValuesKeys: Object.keys(newValues),
      newValues,
      groupColumns,
      filteredParsedValuesKeys: Object.keys(filteredParsedValues),
      filteredParsedValues,
      displayColumns: selectedFilterColumns.filter(col => columnModes[col] === 'display')
    });
    
    // Create Value Info if we have at least one group column with a value
    // Display columns are completely ignored - they don't affect this condition
    if (hasGroupValues && groupColumns.length > 0) {
      try {
        console.log('MatchSelector: Fetching raw rows for selected group...');
        const { generateValueInfoFromData, saveValueInfo } = await import("@/lib/chatApi");
        
        // Note: We don't delete old current_selection here because saveValueInfo will update it
        // Deleting it might cause a race condition where the Value Info is deleted but not yet recreated
        
        const db = getDbConnection();
        if (db) {
          // Build WHERE clause to match the selected grouped row
          // Only use group columns, NOT display columns
          // Use newValues which only contains group columns (display columns are filtered out)
          const whereConditions: string[] = [];
          
          groupColumns.forEach(col => {
            const filterValue = newValues[col];
            if (filterValue) {
              const quotedCol = `"${col.replace(/"/g, '""')}"`;
              // Escape single quotes in value
              const escapedValue = filterValue.replace(/'/g, "''");
              whereConditions.push(`${quotedCol} = '${escapedValue}'`);
            }
          });
          
          if (whereConditions.length > 0) {
            const tableName = getTableName();
            // Fetch ALL matching raw rows - universal, works with any table
            const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
            const query = `SELECT * FROM ${quotedTable} WHERE ${whereConditions.join(' AND ')}`;
            
            console.log('MatchSelector: Executing query:', query);
            
            // Execute dynamic SQL using Function constructor
            const sql = db as any;
            let result;
            try {
              const executeQuery = new Function('sql', `return sql\`${query.replace(/`/g, '\\`')}\``);
              result = await executeQuery(sql);
            } catch (err) {
              console.error('Error fetching raw rows:', err);
              if (typeof sql.raw === 'function') {
                result = await sql.raw(query);
              } else {
                throw err;
              }
            }
            const rawRows = Array.isArray(result) ? result : (result?.rows || []);
            
            console.log('MatchSelector: Fetched', rawRows.length, 'raw rows');
            
            if (!rawRows || rawRows.length === 0) {
              console.warn('MatchSelector: No rows returned from query, cannot create Value Info');
              return;
            }
            
            if (rawRows && rawRows.length > 0) {
              // Generate unique ID for this selection based on criteria
              // Use newValues (only group columns) for the selection key
              const groupValuesForKey = Object.keys(newValues)
                .filter(k => newValues[k] != null && groupColumns.includes(k))
                .sort()
                .map(k => `${k}=${newValues[k]}`);
              const selectionKey = `${groupColumns.sort().join(',')}:${groupValuesForKey.join(',')}`;
              const selectionHash = selectionKey.split('').reduce((acc, char) => {
                acc = ((acc << 5) - acc) + char.charCodeAt(0);
                return acc & acc;
              }, 0);
              // Use current_selection for the active selection, but also create a unique ID for persistence
              const uniqueValueInfoId = chatId ? `selection_${chatId}_${Math.abs(selectionHash)}` : `selection_${Math.abs(selectionHash)}`;
              const valueInfoId = 'current_selection'; // Keep this for active selection lookup
              
              // Build name using only group columns and their values from newValues (excludes display columns)
              const nameParts = groupColumns
                .filter(col => newValues[col] != null)
                .map(col => `${col}=${newValues[col]}`);
              const valueInfoName = nameParts.length > 0 
                ? `Selected Group: ${nameParts.join(', ')}`
                : `Selected Group: ${groupColumns.join(', ')}`;
              
              const valueInfo = generateValueInfoFromData(
                rawRows,
                uniqueValueInfoId, // Use unique ID for storage
                'match',
                valueInfoName
              );
              
              if (!valueInfo) {
                console.error('MatchSelector: generateValueInfoFromData returned null - cannot save Value Info');
                return;
              }
              
              console.log('MatchSelector: Generated Value Info:', {
                id: valueInfo.id,
                type: valueInfo.type,
                name: valueInfo.name,
                columnsCount: valueInfo.columns?.length || 0
              });
              
              // Store the actual data in valueInfo so CodeExecutor can use it
              if (valueInfo) {
                // DO NOT store data in Value Info - it causes localStorage quota issues
                // Instead, store filter criteria so we can re-query when needed
                // Only store group columns, not display columns
                // Use newValues which only contains group columns (display columns are filtered out)
                valueInfo.filterColumns = groupColumns;
                valueInfo.filterValues = Object.keys(newValues)
                  .filter(k => newValues[k] != null && groupColumns.includes(k))
                  .reduce((acc, k) => {
                    acc[k] = newValues[k];
                    return acc;
                  }, {} as Record<string, string | null>);
                valueInfo.rowCount = rawRows.length;
                // Also store the current_selection reference for active lookup
                valueInfo.currentSelectionId = valueInfoId;
                
                // Generate a summary for display in Value Info section
                if (!valueInfo.summary || valueInfo.summary.trim() === '') {
                  const columns = valueInfo.columns;
                  const columnNames = columns.map((c: any) => c.name).join(', ');
                  const totalRows = rawRows.length;
                  
                  let summary = `This dataset contains ${totalRows} rows with ${columns.length} columns.\n\n`;
                  summary += `Columns: ${columnNames}\n\n`;
                  summary += `Column Details:\n`;
                  
                  columns.forEach((col: any) => {
                    summary += `- ${col.name} (${col.type}): `;
                    if (col.uniqueValues.length > 0) {
                      const sampleValues = col.uniqueValues.slice(0, 10).map((v: any) => {
                        if (typeof v === 'string' && v.length > 20) {
                          return v.substring(0, 20) + '...';
                        }
                        return String(v);
                      }).join(', ');
                      summary += `${col.uniqueValues.length} unique values`;
                      if (col.uniqueValues.length <= 10) {
                        summary += ` (${sampleValues})`;
                      } else {
                        summary += ` (sample: ${sampleValues}...)`;
                      }
                    } else {
                      summary += `no values`;
                    }
                    if (col.nullCount > 0) {
                      summary += `, ${col.nullCount} null values`;
                    }
                    summary += `\n`;
                  });
                  
                  valueInfo.summary = summary;
                }
                
                // Save Value Info WITHOUT data (to avoid quota issues)
                const valueInfoToSave = { 
                  ...valueInfo,
                  uniqueId: uniqueValueInfoId // Set uniqueId for duplicate detection
                };
                delete valueInfoToSave.data; // Remove data before saving
                
                // Save the unique Value Info (without data)
                saveValueInfo(valueInfoToSave, chatId);
                
                // Also save/update current_selection directly (for active lookup - existing code expects this)
                // This allows existing code to work while we also keep the unique copy
                // IMPORTANT: Remove data before saving to avoid quota issues
                const currentSelectionCopy = {
                  ...valueInfoToSave,
                  id: valueInfoId, // Use current_selection ID for active lookup
                  uniqueId: uniqueValueInfoId, // Store reference to unique copy
                };
                // Don't include data when saving - it will be re-queried when needed
                saveValueInfo(currentSelectionCopy, chatId);
                
                console.log('MatchSelector: Saved valueInfo with', rawRows.length, 'rows');
                console.log('MatchSelector: valueInfo saved:', {
                  id: valueInfo.id,
                  uniqueId: uniqueValueInfoId,
                  type: valueInfo.type,
                  name: valueInfo.name,
                  dataLength: rawRows.length,
                  hasSummary: !!valueInfo.summary,
                  summaryLength: valueInfo.summary?.length || 0,
                  chatId: chatId,
                  filterColumns: groupColumns,
                  filterValues: Object.keys(newValues)
                    .filter(k => newValues[k] != null && groupColumns.includes(k))
                    .reduce((acc, k) => {
                      acc[k] = newValues[k];
                      return acc;
                    }, {} as Record<string, string | null>)
                });
              }
            } else {
              // No matching rows found - don't create valueInfo, but don't delete existing ones
              console.log('MatchSelector: No matching rows found');
            }
          }
        }
      } catch (e) {
        console.error('Error fetching raw rows for selected group:', e);
      }
    }
  };

  const handleClearSelection = async () => {
    // Clear valueInfo when clearing selection
    const { deleteValueInfo } = await import("@/lib/chatApi");
    deleteValueInfo('current_selection', 'match');
    onSelectMatch(null, [], {}, [], {});
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
              columnModes={columnModes}
              onColumnModeChange={handleColumnModeChange}
              getUniqueValues={getUniqueValues}
              getFirstValue={getFirstValue}
              getCombinedGroupValues={getCombinedGroupValues}
              placeholder="Group by..."
              groupedRowsWithDisplay={groupedRowsWithDisplay}
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
                return value ? `${colLabel}=${value}` : null;
              }).filter(Boolean).join(', ')}
            </div>
            <div className="text-xs text-muted-foreground">
              Data loaded and ready for analysis
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
      
      {!selectedMatchData && groupedRowsWithDisplay.length > 0 && selectedFilterColumns.length > 0 && Object.keys(selectedFilterValues).some(col => selectedFilterValues[col] !== null) && (
        <div className="mt-2 space-y-2">
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {groupedRowsWithDisplay.slice(0, 20).map((row, idx) => {
              const groupCols = selectedFilterColumns.filter(col => columnModes[col] === 'group' || !columnModes[col]);
              const displayCols = selectedFilterColumns.filter(col => columnModes[col] === 'display');
              
              return (
                <div
                  key={idx}
                  className="p-2 rounded border border-border"
              >
                <div className="font-medium text-sm">
                    {groupCols.map((col, i) => {
                      const colLabel = availableColumns.find(c => c.value === col)?.label || col;
                      const val = row.groupValues[col];
                      return (
                        <span key={col}>
                          {i > 0 && ', '}
                          <span className="text-muted-foreground">{colLabel}:</span> {val}
                        </span>
                      );
                    })}
                  </div>
                  {displayCols.length > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {displayCols.map((col, i) => {
                        const colLabel = availableColumns.find(c => c.value === col)?.label || col;
                        const val = row.displayValues[col];
                        return (
                          <span key={col}>
                            {i > 0 && ' • '}
                            <span className="font-medium">{colLabel}:</span> {val || 'N/A'}
                          </span>
                        );
                      })}
                </div>
                  )}
                </div>
              );
            })}
            {groupedRowsWithDisplay.length > 20 && (
              <div className="text-xs text-muted-foreground p-2 text-center">
                ... and {groupedRowsWithDisplay.length - 20} more. Select a column value to narrow results.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MatchSelector;

