import { useState, useRef, useEffect, useMemo, useCallback, memo } from "react";
import { X, Search, Eye, Group } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MultiSelectGroupByProps {
  availableColumns: { value: string; label: string }[];
  selectedColumns: string[];
  onColumnsChange: (columns: string[]) => void;
  selectedValues: Record<string, string | string[] | null>;
  onValueSelect: (column: string, value: string | null) => void;
  onBatchValueSelect?: (column: string, values: string[], select: boolean) => void;
  columnModes?: Record<string, 'group' | 'display'>;
  onColumnModeChange?: (column: string, mode: 'group' | 'display') => void;
  getUniqueValues: (column: string) => string[] | Promise<string[]>;
  getFirstValue?: (column: string) => string | null | Promise<string | null>;
  getCombinedGroupValues?: (columns: string[]) => string[] | Promise<string[]>;
  placeholder?: string;
  groupedRowsWithDisplay?: Array<{groupValues: Record<string, string>, displayValues: Record<string, string>}>;
  dataSourceKey?: string; // Key that changes when data source (CSVs) changes, to trigger reload
  disabled?: boolean; // Disable when another data source is selected
  uniqueValuesProgress?: { processedMB: number, uniqueCount: number, totalMB?: number }; // Progress info for loading unique values
  onConfirmLargeFile?: () => void; // Callback when user confirms loading large file
  pendingLargeFile?: { column: string, fileSizeGB: number } | null; // Info about pending large file confirmation
}

const VALUES_PER_PAGE = 15;

const MultiSelectGroupBy = ({
  availableColumns,
  selectedColumns,
  onColumnsChange,
  selectedValues,
  onValueSelect,
  onBatchValueSelect,
  columnModes,
  onColumnModeChange,
  getUniqueValues,
  getFirstValue,
  getCombinedGroupValues,
  placeholder = "Group by...",
  groupedRowsWithDisplay,
  dataSourceKey,
  disabled = false,
  uniqueValuesProgress,
  onConfirmLargeFile,
  pendingLargeFile
}: MultiSelectGroupByProps) => {
  const [showList, setShowList] = useState(false);
  
  // CRITICAL: Filter to only group columns (exclude display columns)
  // Display columns should NEVER be used for grouping, filtering, or value selection
  const groupColumns = selectedColumns.filter(col => 
    columnModes?.[col] === 'group' || !columnModes?.[col]
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [allValues, setAllValues] = useState<string[]>([]);
  const [isLoadingValues, setIsLoadingValues] = useState(false);
  const [isSelectingAll, setIsSelectingAll] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Ensure only one dropdown is open at a time
  useEffect(() => {
    if (showList) {
      setIsSearchOpen(false);
    }
  }, [showList]);

  useEffect(() => {
    if (isSearchOpen) {
      setShowList(false);
    }
  }, [isSearchOpen]);

  // Load searchable values based on group columns (async)
  // CRITICAL: Only use groupColumns, never display columns
  // Add debouncing to prevent rapid repeated calls
  useEffect(() => {
    let cancelled = false;
    let timeoutId: NodeJS.Timeout | null = null;
    
    const loadValues = async () => {
      if (groupColumns.length === 0) {
        setAllValues([]);
        setIsLoadingValues(false);
        return;
      }
      
      // Don't load if there's a pending large file confirmation
      if (pendingLargeFile && pendingLargeFile.column && groupColumns.includes(pendingLargeFile.column)) {
        setIsLoadingValues(false);
        return;
      }

      setIsLoadingValues(true);
      try {
        let values: string[] = [];

        // IMPORTANT: Only use groupColumns, never display columns
        if (groupColumns.length === 0) {
          values = [];
        } else if (groupColumns.length === 1) {
          try {
            const result = getUniqueValues(groupColumns[0]);
            values = Array.isArray(result) ? result : await result;
            if (cancelled) return; // Check if cancelled after async operation
          } catch (error) {
            console.error('MultiSelectGroupBy: Error getting unique values:', error);
            values = [];
            if (cancelled) return;
          }
        } else if (getCombinedGroupValues) {
          // Only pass group columns, not display columns
          try {
            const result = getCombinedGroupValues(groupColumns);
            values = Array.isArray(result) ? result : await result;
            if (cancelled) return; // Check if cancelled after async operation
          } catch (error) {
            console.error('MultiSelectGroupBy: Error getting combined group values:', error);
            values = [];
            if (cancelled) return;
          }
        }

        // Only update state if component is still mounted and not cancelled
        if (!cancelled) {
          setAllValues(values);
          // Don't auto-open dropdown - let user click the search input to open it
        }
      } catch (e) {
        if (!cancelled) {
          console.error('MultiSelectGroupBy: Error loading values:', e);
          setAllValues([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingValues(false);
        }
      }
    };
    
    // Debounce: wait 150ms before loading to prevent rapid repeated calls
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
    loadValues();
    }, 150);
    
    // Cleanup function to cancel if component unmounts or dependencies change
    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
    // Only depend on groupColumns and dataSourceKey - the functions are stable useCallback hooks
    // and including them causes infinite loops when they're recreated
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupColumns.join(','), dataSourceKey, pendingLargeFile?.column]); // Re-run when columns, data source, or pending confirmation column changes
  // Create a Map lookup for groupedRowsWithDisplay to avoid O(n²) complexity
  // This is much faster than using .find() for every value
  const rowMap = useMemo(() => {
    if (!groupedRowsWithDisplay) return null;

    const map = new Map<string, {groupValues: Record<string, string>, displayValues: Record<string, string>}>();
    groupedRowsWithDisplay.forEach(row => {
      const key = groupColumns.map(col => row.groupValues[col]).filter(Boolean).join(', ');
      map.set(key, row);
    });
    return map;
  }, [groupedRowsWithDisplay, groupColumns]);

  // Memoize filtered values to avoid recalculating on every render
  // Limit results to 1000 for performance with large datasets
  const filteredValues = useMemo(() => {
    if (!searchQuery.trim()) {
      // No search - return first 1000 values for performance
      return allValues.slice(0, 1000);
    }

    const query = searchQuery.toLowerCase();
    const MAX_RESULTS = 1000; // Limit search results for performance
    const results: string[] = [];

    for (const val of allValues) {
      if (results.length >= MAX_RESULTS) break;

      // First check if the group column value matches
      if (val.toLowerCase().includes(query)) {
        results.push(val);
        continue;
      }

      // Also check if any display column value matches
      if (rowMap && availableColumns) {
        const displayColumns = selectedColumns.filter(col => columnModes?.[col] === 'display');
        // Use Map lookup instead of .find() - O(1) instead of O(n)
        const matchingRow = rowMap.get(val);

        if (matchingRow && displayColumns.length > 0) {
          // Check if search query matches any display column value
          const matches = displayColumns.some(col => {
            const displayValue = matchingRow.displayValues[col];
            if (displayValue) {
              const colLabel = availableColumns.find(c => c.value === col)?.label || col;
              // Search in both column label and value
              return colLabel.toLowerCase().includes(query) ||
                     displayValue.toLowerCase().includes(query);
            }
            return false;
          });

          if (matches) {
            results.push(val);
          }
        }
      }
    }

    return results;
  }, [allValues, searchQuery, rowMap, availableColumns, selectedColumns, columnModes]);

  // Track if there are more results than shown
  const hasMoreResults = useMemo(() => {
    if (!searchQuery.trim()) {
      return allValues.length > 1000;
    }
    return false; // For search, we already limited to 1000
  }, [allValues.length, searchQuery]);

  const totalPages = Math.ceil(filteredValues.length / VALUES_PER_PAGE);
  const startIdx = currentPage * VALUES_PER_PAGE;
  const endIdx = Math.min(startIdx + VALUES_PER_PAGE, filteredValues.length);
  const pageValues = filteredValues.slice(startIdx, endIdx);

  // Reset to page 0 if current page is out of bounds
  useEffect(() => {
    if (currentPage >= totalPages && totalPages > 0) {
      setCurrentPage(0);
    }
  }, [currentPage, totalPages]);

  // Close list when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // Don't close if clicking on a button (like remove buttons)
      if (target.closest('button')) {
        return;
      }
      
      if (listRef.current && !listRef.current.contains(target)) {
        setShowList(false);
      }
    };
    if (showList) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showList]);

  // Close search dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      
      // Don't close if clicking on any button (like remove buttons)
      const targetElement = target as HTMLElement;
      if (targetElement.closest && targetElement.closest('button')) {
        return;
      }
      
      const isClickInsideDropdown = searchDropdownRef.current?.contains(target);
      const isClickInsideInput = searchInputRef.current?.contains(target);
      const isClickInsideContainer = containerRef.current?.contains(target);
      
      // Close if clicking outside the dropdown, input, or container
      if (!isClickInsideDropdown && !isClickInsideInput && !isClickInsideContainer) {
        setIsSearchOpen(false);
      }
    };

    // Always listen for clicks when dropdown is open
    if (isSearchOpen) {
      // Use capture phase to catch clicks early
      document.addEventListener("mousedown", handleClickOutside, true);
      
      return () => {
        document.removeEventListener("mousedown", handleClickOutside, true);
      };
    }
  }, [isSearchOpen]);

  useEffect(() => {
    if (searchQuery.trim()) {
      setCurrentPage(0);
    }
  }, [searchQuery]);

  const handleToggle = (colValue: string, e?: React.MouseEvent) => {
    if (disabled) return; // Don't allow changes when disabled
    
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    
    // Use a functional approach to ensure we're working with the latest state
    const isCurrentlySelected = selectedColumns.includes(colValue);
    
    if (isCurrentlySelected) {
      // Deselect: remove from selected columns
      const newCols = selectedColumns.filter(c => c !== colValue);
      onColumnsChange(newCols);
      // Clear the value for this column if it exists
      if (selectedValues[colValue] != null) {
        onValueSelect(colValue, null);
      }
    } else {
      // Select: add to selected columns
      const newCols = [...selectedColumns, colValue];
      onColumnsChange(newCols);
    }
  };

  const handleRemove = (colValue: string, e: React.MouseEvent) => {
    if (disabled) return; // Don't allow changes when disabled
    
    e.preventDefault();
    e.stopPropagation();
    if (e.nativeEvent && e.nativeEvent.stopImmediatePropagation) {
      e.nativeEvent.stopImmediatePropagation();
    }
    const newCols = selectedColumns.filter(c => c !== colValue);

    // Close dropdown if open
    setShowList(false);

    // Call directly - if this doesn't work, the issue is in the parent
    try {
      if (typeof onColumnsChange === 'function') {
        onColumnsChange(newCols);
      } else {
        console.error('onColumnsChange is not a function!', typeof onColumnsChange);
      }
    } catch (error) {
      console.error('Error calling onColumnsChange:', error);
    }
    
    // Don't call onValueSelect when removing - the parent's handleColumnsChange
    // already handles cleaning up the values. Calling onValueSelect here causes
    // a second state update with stale column data.
    // onValueSelect(colValue, null);
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setIsSearchOpen(true);
    setCurrentPage(0);
  };

  const handleValueSelect = (value: string, e?: React.MouseEvent) => {
    if (disabled) return; // Don't allow changes when disabled
    
    // Stop propagation to prevent click-outside handler from closing dropdown before selection
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }

    // CRITICAL: Only use groupColumns, never display columns
    if (groupColumns.length === 0) {
      console.warn('MultiSelectGroupBy: No group columns available, cannot select value');
      return;
    }
    
    // For multiple selection, always toggle (parent handles array logic)
    // Pass the value to the first GROUP column
    // The parent's handleValueSelect will parse it correctly and toggle in/out of array
    onValueSelect(groupColumns[0], value);
    
    // Keep dropdown open for multiple selection (don't close it)
    // Only clear search query if we're not doing multiple selection
    // For now, keep it open to allow multiple selections
    // setSearchQuery("");
    // setIsSearchOpen(false);
  };
  
  // Memoize selected values as Set for O(1) lookups - much faster for large arrays
  const selectedValuesSet = useMemo(() => {
    if (groupColumns.length === 0) return new Set<string>();
    
    if (groupColumns.length === 1) {
      const selectedValue = selectedValues[groupColumns[0]];
      if (Array.isArray(selectedValue)) {
        return new Set(selectedValue);
      }
      return selectedValue ? new Set([selectedValue]) : new Set();
    } else {
      // For multi-column, this is more complex, so we'll handle it in the function
      return null; // Signal to use the function
    }
  }, [selectedValues, groupColumns]);

  // Optimized check if a value is currently selected (for highlighting)
  const isValueSelected = useCallback((value: string): boolean => {
    // CRITICAL: Only check group columns, never display columns
    if (groupColumns.length === 0) return false;
    
    if (groupColumns.length === 1) {
      const selectedValue = selectedValues[groupColumns[0]];
      
      // Check for special "SELECT_ALL" marker
      if (selectedValue === '__SELECT_ALL__') {
        return true; // All values are selected
      }
      
      // Fast path: use Set for O(1) lookup
      if (selectedValuesSet) {
        return selectedValuesSet.has(value);
      }
      // Fallback
      if (Array.isArray(selectedValue)) {
        return selectedValue.includes(value);
      }
      return selectedValue === value;
    } else if (groupColumns.length > 1) {
      // Multi-column - check if all values match
      const values = value.split(',').map(v => v.trim());
      return groupColumns.every((col, idx) => {
        const selectedValue = selectedValues[col];
        if (selectedValue === '__SELECT_ALL__') {
          return true; // All values selected for this column
        }
        if (Array.isArray(selectedValue)) {
          return selectedValue.includes(values[idx]);
        }
        return selectedValue === values[idx];
      });
    }
    return false;
  }, [selectedValues, groupColumns, selectedValuesSet]);

      const [placeholderText, setPlaceholderText] = useState("Search...");
      
      useEffect(() => {
        const updatePlaceholder = async () => {
          // CRITICAL: Only use group columns for placeholder
          if (groupColumns.length > 0 && getFirstValue) {
            try {
              const result = getFirstValue(groupColumns[0]);
              const firstValue = typeof result === 'string' || result === null ? result : await result;
              setPlaceholderText(firstValue ? `Search... (e.g., ${firstValue})` : "Search...");
            } catch (e) {
              setPlaceholderText("Search...");
            }
          } else {
            setPlaceholderText("Search...");
          }
        };
        updatePlaceholder();
      }, [groupColumns, getFirstValue]);

  return (
    <div className="w-full flex flex-col relative" ref={containerRef}>
      {/* Column selection button */}
      <button
        type="button"
        onClick={() => !disabled && setShowList(!showList)}
        disabled={disabled}
        className={cn(
          "w-full px-3 h-9 text-left text-sm border rounded bg-secondary flex items-center justify-between",
          disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-accent"
        )}
      >
        <span>
          {groupColumns.length === 0 
            ? placeholder 
            : `Group by: ${groupColumns.map(v => {
                const col = availableColumns.find(c => c.value === v);
                return col ? col.label : v;
              }).join(', ')}`}
        </span>
        <span>{showList ? '▲' : '▼'}</span>
      </button>

      {/* Selected columns with mode toggles - compact scrollable layout */}
      {selectedColumns.length > 0 && (
        <div className="mt-1.5 max-h-20 overflow-y-auto">
          <div className="flex flex-wrap gap-1">
            {selectedColumns.map((colValue) => {
              const col = availableColumns.find(c => c.value === colValue);
              const colLabel = col ? col.label : colValue;
              const mode = columnModes?.[colValue] || 'group';

              return (
                <div
                  key={colValue}
                  className="flex items-center gap-0.5 px-1 py-0.5 bg-secondary border border-border rounded text-xs flex-shrink-0"
                >
                  <span className="text-muted-foreground truncate max-w-[120px]">{colLabel}</span>
                  {onColumnModeChange && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const newMode = mode === 'group' ? 'display' : 'group';
                        onColumnModeChange(colValue, newMode);
                      }}
                      className="ml-0.5 p-0.5 hover:bg-accent rounded flex-shrink-0"
                      title={`Switch to ${mode === 'group' ? 'display' : 'group'} mode`}
                    >
                      {mode === 'group' ? (
                        <Group className="h-3 w-3 text-primary" />
                      ) : (
                        <Eye className="h-3 w-3 text-blue-500" />
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(colValue, e);
                    }}
                    className="ml-0.5 p-0.5 hover:bg-destructive/20 rounded flex-shrink-0"
                    title="Remove column"
                  >
                    <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Column dropdown list */}
      {showList && availableColumns.length > 0 && (
        <div
          ref={listRef}
          style={{ top: '2.75rem' }}
          className="absolute z-50 w-full left-0 border rounded bg-secondary shadow-lg max-h-96 overflow-y-auto"
        >
          {availableColumns.map((col) => {
            const isSelected = selectedColumns.includes(col.value);
            return (
              <div
                key={col.value}
                className={`flex items-center px-2 py-1.5 cursor-pointer hover:bg-accent ${
                  isSelected ? 'bg-accent' : ''
                }`}
                onClick={(e) => {
                  handleToggle(col.value, e);
                }}
              >
                <div className={`w-4 h-4 border-2 rounded mr-3 flex items-center justify-center ${
                  isSelected ? 'bg-primary border-primary' : 'border-gray-400'
                }`}>
                  {isSelected && <span className="text-white text-xs">✓</span>}
                </div>
                <span className="text-sm flex-1">{col.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Search input - only show when columns are selected */}
      {selectedColumns.length > 0 && (
        <div className="relative mt-2">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            onFocus={() => setIsSearchOpen(true)}
            placeholder={placeholderText}
            className="pl-9 bg-secondary border-border/50 h-9 text-xs"
          />
          
          {isSearchOpen && (
            pendingLargeFile && pendingLargeFile.column && groupColumns.includes(pendingLargeFile.column) ? (
              <div className="absolute z-50 w-full mt-1 bg-secondary border border-border rounded-lg shadow-lg p-4 text-center">
                <div className="text-sm font-medium mb-2">Large File Detected</div>
                <div className="text-xs text-muted-foreground mb-4">
                  This file is {pendingLargeFile.fileSizeGB.toFixed(2)}GB. Loading unique values may take a while and could cause lag.
                </div>
                <div className="flex gap-2 justify-center">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => {
                      if (onConfirmLargeFile) {
                        onConfirmLargeFile();
                      }
                    }}
                  >
                    Load Column Values
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsSearchOpen(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : isLoadingValues ? (
              <div className="absolute z-50 w-full mt-1 bg-secondary border border-border rounded-lg shadow-lg p-4 text-center text-sm">
                <div className="text-muted-foreground mb-2">Loading column values...</div>
                {uniqueValuesProgress && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Processing: {uniqueValuesProgress.processedMB.toFixed(1)}MB</span>
                      {uniqueValuesProgress.totalMB && (
                        <span>/ {uniqueValuesProgress.totalMB.toFixed(1)}MB</span>
                      )}
                    </div>
                    {uniqueValuesProgress.totalMB && (
                      <div className="w-full bg-muted rounded-full h-1.5">
                        <div 
                          className="bg-primary h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, (uniqueValuesProgress.processedMB / uniqueValuesProgress.totalMB) * 100)}%` }}
                        />
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      Found {uniqueValuesProgress.uniqueCount.toLocaleString()} unique values
                    </div>
                  </div>
                )}
              </div>
            ) : filteredValues.length > 0 ? (
              <div
                ref={searchDropdownRef}
                style={{ marginTop: '4px' }}
                className="absolute z-50 w-full bg-secondary border border-border rounded-lg shadow-lg max-h-96 overflow-hidden flex flex-col"
              >
                {/* Select All / Deselect All button */}
                {groupColumns.length > 0 && (() => {
                  // Check if "SELECT_ALL" marker is set
                  const hasSelectAllMarker = groupColumns.length > 0 && 
                    selectedValues[groupColumns[0]] === '__SELECT_ALL__';
                  
                  // Calculate button state once
                  let selectedCount = 0;
                  if (hasSelectAllMarker) {
                    // If SELECT_ALL marker is set, all values are considered selected
                    selectedCount = filteredValues.length;
                  } else if (filteredValues.length > 0) {
                    // Fast path: use Set for single column
                    if (groupColumns.length === 1 && selectedValuesSet) {
                      selectedCount = filteredValues.filter(val => selectedValuesSet.has(val)).length;
                    } else {
                      // Fallback for multi-column
                      selectedCount = filteredValues.filter(val => isValueSelected(val)).length;
                    }
                  }
                  const allSelected = selectedCount === filteredValues.length && filteredValues.length > 0;
                  const buttonText = allSelected 
                    ? `Deselect All (${filteredValues.length.toLocaleString()})`
                    : `Select All (${(filteredValues.length - selectedCount).toLocaleString()} remaining)`;

                  return (
                  <div className="border-b border-border p-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full h-7 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        
                          // Prevent double-click and show loading state
                          if (isSelectingAll) return;
                          setIsSelectingAll(true);
                          
                          // Use requestAnimationFrame to batch the update and prevent blocking
                          requestAnimationFrame(() => {
                        if (onBatchValueSelect && groupColumns.length > 0) {
                              // Use batch selection (most efficient)
                          if (allSelected) {
                                // Deselect all - pass all filtered values
                            onBatchValueSelect(groupColumns[0], filteredValues, false);
                          } else {
                                // Select all unselected values - calculate efficiently
                                let unselectedValues: string[];
                                if (groupColumns.length === 1 && selectedValuesSet) {
                                  // Fast path: use Set difference
                                  unselectedValues = filteredValues.filter(val => !selectedValuesSet.has(val));
                                } else {
                                  // Fallback
                                  unselectedValues = filteredValues.filter(val => !isValueSelected(val));
                                }
                            onBatchValueSelect(groupColumns[0], unselectedValues, true);
                          }
                          // Reset loading state after a delay
                          setTimeout(() => setIsSelectingAll(false), 200);
                        } else {
                              // Fallback: warn user that batch selection is not available
                              console.warn('Batch selection not available - this may be slow for large selections');
                              // Still try to do it, but warn
                          if (allSelected) {
                                // For deselect, just clear the selection
                                onValueSelect(groupColumns[0], null);
                          } else {
                                // For select, this will be slow - but at least warn
                            const unselectedValues = filteredValues.filter(val => !isValueSelected(val));
                                // Use batch if available, otherwise warn
                                if (unselectedValues.length > 100) {
                                  alert(`Selecting ${unselectedValues.length} values without batch selection may be slow. Please use batch selection if available.`);
                                }
                                // Process in smaller batches to avoid freezing
                                const BATCH_SIZE = 50;
                                for (let i = 0; i < unselectedValues.length; i += BATCH_SIZE) {
                                  const batch = unselectedValues.slice(i, i + BATCH_SIZE);
                              setTimeout(() => {
                                    batch.forEach(val => onValueSelect(groupColumns[0], val));
                                  }, (i / BATCH_SIZE) * 10); // 10ms between batches
                                }
                          }
                        }
                          });
                        }}
                      >
                        {buttonText}
                    </Button>
                  </div>
                  );
                })()}
                <div className="overflow-y-auto flex-1">
                  {pageValues.map((value, idx) => {
                    const isSelected = isValueSelected(value);
                    
                    // Find display info for this value from groupedRowsWithDisplay
                    let displayInfo: string | null = null;
                    if (groupedRowsWithDisplay && availableColumns) {
                      // Get ALL display columns (columns set to display mode)
                      const displayColumns = selectedColumns.filter(col => columnModes?.[col] === 'display');

                      // Find the matching row by comparing group values
                      const matchingRow = groupedRowsWithDisplay.find(row => {
                        // Match by comparing group values
                        const groupValueString = groupColumns.map(col => row.groupValues[col]).filter(Boolean).join(', ');
                        return groupValueString === value;
                      });
                      
                      if (matchingRow && displayColumns.length > 0) {
                        // Build display parts for ALL display columns
                        // IMPORTANT: Iterate over ALL displayColumns to ensure all are shown
                        const displayParts: string[] = [];
                        displayColumns.forEach(col => {
                          const colLabel = availableColumns.find(c => c.value === col)?.label || col;
                          // Check if this column has a value in displayValues
                          const val = matchingRow.displayValues?.[col];
                          if (val) {
                            displayParts.push(`${colLabel}: ${val}`);
                          }
                          // Note: We skip columns that don't have values rather than showing "N/A"
                          // This keeps the display cleaner
                        });

                        if (displayParts.length > 0) {
                          displayInfo = displayParts.join(' • ');
                        }
                      }
                    }
                    
                    return (
                      <div
                        key={idx}
                        className={`p-2 cursor-pointer transition-colors flex items-start gap-2 ${
                          isSelected
                            ? 'bg-primary/30 border-l-4 border-primary font-medium'
                            : 'hover:bg-chat-hover'
                        }`}
                        onClick={(e) => handleValueSelect(value, e)}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <div className={`w-4 h-4 border-2 rounded mt-0.5 flex items-center justify-center flex-shrink-0 ${
                          isSelected ? 'bg-primary border-primary' : 'border-gray-400'
                        }`}>
                          {isSelected && <span className="text-white text-xs">✓</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm ${isSelected ? 'text-primary-foreground' : ''}`}>
                            {value}
                          </div>
                          {displayInfo && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {displayInfo}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Show info about results */}
                <div className="border-t border-border p-1.5 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Showing {startIdx + 1}-{endIdx} of {filteredValues.length}
                    {hasMoreResults && (
                      <span className="ml-2 text-yellow-600 font-medium">
                        (Limited to 1000 - use search to find specific values)
                      </span>
                    )}
                  </span>
                  {totalPages > 1 && (
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2"
                        onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
                        disabled={currentPage === 0}
                      >
                        Previous
                      </Button>
                      <span className="flex items-center">
                        Page {currentPage + 1}/{totalPages}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2"
                        onClick={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
                        disabled={currentPage >= totalPages - 1}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="absolute z-50 w-full mt-1 bg-secondary border border-border rounded-lg shadow-lg p-4 text-center text-sm text-muted-foreground">
                {searchQuery.trim() ? 'No values found' : (isLoadingValues ? 'Loading values...' : (pendingLargeFile && pendingLargeFile.column && groupColumns.includes(pendingLargeFile.column) ? 'Click "Load Column Values" to load unique values' : 'No values available. Make sure CSV files are selected and the column exists in the data.'))}
              </div>
            )
          )}
        </div>
      )}

      {/* Selected tags */}
      {selectedColumns.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {selectedColumns.map((colValue) => {
            const col = availableColumns.find(c => c.value === colValue);
            if (!col) {
              console.warn('Column not found for value:', colValue);
              return null;
            }
                return (
                  <div
                    key={`tag-${colValue}`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-primary/20 border border-primary/30 rounded text-xs"
                  >
                    <span>{col.label}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-4 w-4 ml-1 hover:bg-destructive/30 rounded p-0"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (e.nativeEvent && e.nativeEvent.stopImmediatePropagation) {
                          e.nativeEvent.stopImmediatePropagation();
                        }
                        handleRemove(colValue, e);
                      }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// Memoize component to prevent unnecessary re-renders
export default memo(MultiSelectGroupBy);
