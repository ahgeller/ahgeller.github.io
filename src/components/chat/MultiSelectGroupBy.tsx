import { useState, useRef, useEffect } from "react";
import { X, Search, Eye, Group } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface MultiSelectGroupByProps {
  availableColumns: { value: string; label: string }[];
  selectedColumns: string[];
  onColumnsChange: (columns: string[]) => void;
  selectedValues: Record<string, string | null>;
  onValueSelect: (column: string, value: string | null) => void;
  columnModes?: Record<string, 'group' | 'display'>;
  onColumnModeChange?: (column: string, mode: 'group' | 'display') => void;
  getUniqueValues: (column: string) => string[] | Promise<string[]>;
  getFirstValue?: (column: string) => string | null | Promise<string | null>;
  getCombinedGroupValues?: (columns: string[]) => string[] | Promise<string[]>;
  placeholder?: string;
  groupedRowsWithDisplay?: Array<{groupValues: Record<string, string>, displayValues: Record<string, string>}>;
}

const VALUES_PER_PAGE = 15;

const MultiSelectGroupBy = ({
  availableColumns,
  selectedColumns,
  onColumnsChange,
  selectedValues,
  onValueSelect,
  columnModes,
  onColumnModeChange,
  getUniqueValues,
  getFirstValue,
  getCombinedGroupValues,
  placeholder = "Group by...",
  groupedRowsWithDisplay
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
  const listRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load searchable values based on group columns (async)
  // CRITICAL: Only use groupColumns, never display columns
  useEffect(() => {
    let cancelled = false;
    
    const loadValues = async () => {
      if (groupColumns.length === 0) {
        setAllValues([]);
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
          const result = getUniqueValues(groupColumns[0]);
          values = Array.isArray(result) ? result : await result;
        } else if (getCombinedGroupValues) {
          // Only pass group columns, not display columns
          const result = getCombinedGroupValues(groupColumns);
          values = Array.isArray(result) ? result : await result;
        }
        
        // Only update state if component is still mounted and not cancelled
        if (!cancelled) {
          setAllValues(values);
          // Don't auto-open dropdown - let user click the search input to open it
        }
      } catch (e) {
        if (!cancelled) {
          console.error('Error loading values:', e);
          setAllValues([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingValues(false);
        }
      }
    };
    
    loadValues();
    
    // Cleanup function to cancel if component unmounts or dependencies change
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupColumns.join(',')]); // CRITICAL: Use groupColumns, not selectedColumns
  // Filter values - search in both group column values AND display column values
  const filteredValues = searchQuery.trim()
    ? allValues.filter(val => {
        // First check if the group column value matches
        if (val.toLowerCase().includes(searchQuery.toLowerCase())) {
          return true;
        }
        
        // Also check if any display column value matches
        if (groupedRowsWithDisplay && availableColumns) {
          const displayColumns = selectedColumns.filter(col => columnModes?.[col] === 'display');
          const matchingRow = groupedRowsWithDisplay.find(row => {
            // Match by comparing group values
            const groupValueString = groupColumns.map(col => row.groupValues[col]).filter(Boolean).join(', ');
            return groupValueString === val;
          });
          
          if (matchingRow && displayColumns.length > 0) {
            // Check if search query matches any display column value
            const searchLower = searchQuery.toLowerCase();
            return displayColumns.some(col => {
              const displayValue = matchingRow.displayValues[col];
              if (displayValue) {
                const colLabel = availableColumns.find(c => c.value === col)?.label || col;
                // Search in both column label and value
                return colLabel.toLowerCase().includes(searchLower) || 
                       displayValue.toLowerCase().includes(searchLower);
              }
              return false;
            });
          }
        }
        
        return false;
      })
    : allValues;

  const totalPages = Math.ceil(filteredValues.length / VALUES_PER_PAGE);
  const startIdx = currentPage * VALUES_PER_PAGE;
  const endIdx = Math.min(startIdx + VALUES_PER_PAGE, filteredValues.length);
  const pageValues = filteredValues.slice(startIdx, endIdx);

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
        console.log('Clicking outside dropdown, closing it');
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
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    
    // Use a functional approach to ensure we're working with the latest state
    const isCurrentlySelected = selectedColumns.includes(colValue);
    
    if (isCurrentlySelected) {
      // Deselect: remove from selected columns
      const newCols = selectedColumns.filter(c => c !== colValue);
      console.log('MultiSelectGroupBy: Deselecting column', colValue, 'new columns:', newCols);
      onColumnsChange(newCols);
      // Clear the value for this column if it exists
      if (selectedValues[colValue] != null) {
        onValueSelect(colValue, null);
      }
    } else {
      // Select: add to selected columns
      const newCols = [...selectedColumns, colValue];
      console.log('MultiSelectGroupBy: Selecting column', colValue, 'new columns:', newCols);
      onColumnsChange(newCols);
    }
  };

  const handleRemove = (colValue: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.nativeEvent && e.nativeEvent.stopImmediatePropagation) {
      e.nativeEvent.stopImmediatePropagation();
    }
    console.log('handleRemove called for:', colValue);
    console.log('Current selectedColumns:', selectedColumns);
    const newCols = selectedColumns.filter(c => c !== colValue);
    console.log('New columns after filter:', newCols);
    console.log('Calling onColumnsChange with:', newCols);
    console.log('onColumnsChange function:', onColumnsChange);
    console.log('onColumnsChange type:', typeof onColumnsChange);
    
    // Close dropdown if open
    setShowList(false);
    
    // Call directly - if this doesn't work, the issue is in the parent
    try {
      console.log('About to call onColumnsChange with:', newCols);
      console.log('onColumnsChange is:', onColumnsChange);
      if (typeof onColumnsChange === 'function') {
        onColumnsChange(newCols);
        console.log('onColumnsChange called successfully');
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
    // Stop propagation to prevent click-outside handler from closing dropdown before selection
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    
    console.log('MultiSelectGroupBy: handleValueSelect called with value:', value, 'groupColumns:', groupColumns, 'allSelectedColumns:', selectedColumns);
    
    // CRITICAL: Only use groupColumns, never display columns
    if (groupColumns.length === 0) {
      console.warn('MultiSelectGroupBy: No group columns available, cannot select value');
      return;
    }
    
    // Check if this value is already selected
    const isCurrentlySelected = isValueSelected(value);
    
    if (isCurrentlySelected) {
      // Deselect: pass null to clear the selection
      // Use first group column, not first selected column (which might be display)
      onValueSelect(groupColumns[0], null);
    } else {
      // Select: For both single and multi-column, pass the value to the first GROUP column
      // The parent's handleValueSelect will parse it correctly based on groupColumns order
      // IMPORTANT: Never use selectedColumns[0] as it might be a display column
      onValueSelect(groupColumns[0], value);
    }
    
    setSearchQuery("");
    setIsSearchOpen(false);
  };
  
  // Check if a value is currently selected (for highlighting)
  const isValueSelected = (value: string): boolean => {
    // CRITICAL: Only check group columns, never display columns
    if (groupColumns.length === 0) return false;
    
    if (groupColumns.length === 1) {
      // Single column - check if this value matches
      return selectedValues[groupColumns[0]] === value;
    } else if (groupColumns.length > 1) {
      // Multi-column - check if all values match
      const values = value.split(',').map(v => v.trim());
      return groupColumns.every((col, idx) => {
        return selectedValues[col] === values[idx];
      });
    }
    return false;
  };

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
    <div className="w-full flex flex-col" ref={containerRef}>
      {/* Column selection button */}
      <button
        type="button"
        onClick={() => setShowList(!showList)}
        className="w-full px-3 h-9 text-left text-sm border rounded bg-secondary hover:bg-accent flex items-center justify-between"
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

      {/* Selected columns with mode toggles */}
      {selectedColumns.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {selectedColumns.map((colValue) => {
            const col = availableColumns.find(c => c.value === colValue);
            const colLabel = col ? col.label : colValue;
            const mode = columnModes?.[colValue] || 'group';
            
            return (
              <div
                key={colValue}
                className="flex items-center gap-1 px-2 py-1 bg-secondary border border-border rounded text-xs"
              >
                <span className="text-muted-foreground">{colLabel}</span>
                {onColumnModeChange && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const newMode = mode === 'group' ? 'display' : 'group';
                      onColumnModeChange(colValue, newMode);
                    }}
                    className="ml-1 p-0.5 hover:bg-accent rounded"
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
                  className="ml-1 p-0.5 hover:bg-destructive/20 rounded"
                  title="Remove column"
                >
                  <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Column dropdown list */}
      {showList && (
        <div
          ref={listRef}
          className="absolute z-50 w-full mt-2 top-full border rounded bg-secondary shadow-lg max-h-96 overflow-y-auto"
        >
          {availableColumns.map((col) => {
            const isSelected = selectedColumns.includes(col.value);
            return (
              <div
                key={col.value}
                className={`flex items-center px-3 py-2 cursor-pointer hover:bg-accent ${
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
            isLoadingValues ? (
              <div className="absolute z-50 w-full mt-1 bg-secondary border border-border rounded-lg shadow-lg p-4 text-center text-sm text-muted-foreground">
                Loading values...
              </div>
            ) : filteredValues.length > 0 ? (
              <div
                ref={searchDropdownRef}
                className="absolute z-50 w-full mt-1 bg-secondary border border-border rounded-lg shadow-lg max-h-96 overflow-hidden flex flex-col"
              >
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
                        
                        // Debug logging to help identify issues
                        if (displayColumns.length > displayParts.length) {
                          console.log('MultiSelectGroupBy: Some display columns missing values', {
                            displayColumns,
                            displayParts,
                            displayValues: matchingRow.displayValues,
                            value
                          });
                        }
                        
                        if (displayParts.length > 0) {
                          displayInfo = displayParts.join(' • ');
                        }
                      }
                    }
                    
                    return (
                      <div
                        key={idx}
                        className={`p-3 cursor-pointer transition-colors ${
                          isSelected 
                            ? 'bg-primary/30 border-l-4 border-primary font-medium' 
                            : 'hover:bg-chat-hover'
                        }`}
                        onClick={(e) => handleValueSelect(value, e)}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <div className={`text-sm ${isSelected ? 'text-primary-foreground' : ''}`}>
                          {value}
                          {isSelected && <span className="ml-2 text-primary">✓</span>}
                        </div>
                        {displayInfo && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {displayInfo}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                
                {totalPages > 1 && (
                  <div className="border-t border-border p-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Showing {startIdx + 1}-{endIdx} of {filteredValues.length}
                    </span>
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
                  </div>
                )}
              </div>
            ) : (
              <div className="absolute z-50 w-full mt-1 bg-secondary border border-border rounded-lg shadow-lg p-4 text-center text-sm text-muted-foreground">
                {searchQuery.trim() ? 'No values found' : 'No values available'}
              </div>
            )
          )}
        </div>
      )}

      {/* Selected tags */}
      {selectedColumns.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {selectedColumns.map((colValue) => {
            const col = availableColumns.find(c => c.value === colValue);
            if (!col) {
              console.warn('Column not found for value:', colValue);
              return null;
            }
                return (
                  <div
                    key={`tag-${colValue}`}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-primary/20 border border-primary/30 rounded text-xs"
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

export default MultiSelectGroupBy;
