import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { X, ChevronDown, ChevronUp, Search, Download, TrendingUp, Hash, Calendar, Type, ArrowUpDown, Loader2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface DataPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  data: any[];
  fileName: string;
  headers: string[];
  csvId?: string; // For loading more data via DuckDB
  totalRowCount?: number; // Total rows in the full dataset
}

type SortDirection = 'asc' | 'desc' | null;

const ROWS_PER_PAGE_OPTIONS = [25, 50, 100, 250];
const INITIAL_LOAD = 500;

export function DataPreview({ isOpen, onClose, data: initialData, fileName, headers, csvId, totalRowCount }: DataPreviewProps) {
  const [data, setData] = useState<any[]>(initialData);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  const [searchColumn, setSearchColumn] = useState<string>("__all__"); // New: column to search in
  const [rowsPerPage, setRowsPerPage] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [jumpToRow, setJumpToRow] = useState<string>("");
  const [isAnimating, setIsAnimating] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [hasLoadedAll, setHasLoadedAll] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const actualTotalRows = totalRowCount || data.length;
  const hasMoreData = !hasLoadedAll && data.length < actualTotalRows;

  // Reset state when data changes (new file opened)
  useEffect(() => {
    setData(initialData);
    setSearchResults(null);
    setSearchTerm("");
    setCurrentPage(1);
    setSortColumn(null);
    setSortDirection(null);
    setHasLoadedAll(initialData.length >= (totalRowCount || initialData.length));
  }, [initialData, totalRowCount]);
  
  // Handle modal open animation
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setIsAnimating(true));
      setCurrentPage(1);
    } else {
      setIsAnimating(false);
    }
  }, [isOpen]);
  
  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Filter out __index column from headers
  const visibleHeaders = useMemo(() => {
    return headers.filter(h => h !== '__index');
  }, [headers]);
  
  // Calculate column statistics
  const columnStats = useMemo(() => {
    const sourceData = searchResults || data;
    if (!sourceData || sourceData.length === 0) return {};
    
    const stats: Record<string, any> = {};
    const sampleSize = Math.min(1000, sourceData.length);
    const sampleData = sourceData.slice(0, sampleSize);
    
    visibleHeaders.forEach(header => {
      const values = sampleData.map(row => row[header]).filter(v => v !== null && v !== undefined && v !== '');
      const numericValues = values.map(v => Number(v)).filter(v => !isNaN(v));
      
      const isNumeric = numericValues.length > values.length * 0.8;
      const isDate = !isNumeric && values.slice(0, 10).some(v => {
        const str = String(v);
        return str.match(/^\d{4}-\d{2}-\d{2}/) || str.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}/);
      });
      
      stats[header] = {
        type: isNumeric ? 'number' : isDate ? 'date' : 'text',
        count: values.length,
        unique: new Set(values).size,
        nullCount: sampleData.length - values.length,
        ...(isNumeric && numericValues.length > 0 && {
          min: Math.min(...numericValues),
          max: Math.max(...numericValues),
          avg: numericValues.reduce((a, b) => a + b, 0) / numericValues.length,
        })
      };
    });
    
    return stats;
  }, [data, searchResults, visibleHeaders]);

  // Debounced search - searches ALL data via DuckDB using FAST Parquet query
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!searchTerm.trim()) {
      setSearchResults(null);
      setIsSearching(false);
      setCurrentPage(1);
      return;
    }

    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        if (csvId) {
          // FAST: Use queryParquetDirect to search entire dataset
          const { queryParquetDirect } = await import('@/lib/duckdb');

          // Escape search term properly for SQL
          const searchLower = searchTerm.toLowerCase().replace(/'/g, "''").replace(/\\/g, '\\\\');

          // Build WHERE clause - search specific column or all columns
          let whereConditions: string;
          if (searchColumn === "__all__") {
            // Search all columns
            whereConditions = visibleHeaders.map(h =>
              `LOWER(CAST("${h.replace(/"/g, '""')}" AS VARCHAR)) LIKE '%${searchLower}%'`
            ).join(' OR ');
          } else {
            // Search specific column only
            whereConditions = `LOWER(CAST("${searchColumn.replace(/"/g, '""')}" AS VARCHAR)) LIKE '%${searchLower}%'`;
          }

          const results = await queryParquetDirect(csvId, 5000, whereConditions);
          setSearchResults(results || []);
        } else {
          // Fallback: search loaded data only
          const searchLower = searchTerm.toLowerCase();
          const filtered = data.filter(row => {
            if (searchColumn === "__all__") {
              return visibleHeaders.some(header =>
                String(row[header] ?? '').toLowerCase().includes(searchLower)
              );
            } else {
              return String(row[searchColumn] ?? '').toLowerCase().includes(searchLower);
            }
          });
          setSearchResults(filtered);
        }
        setCurrentPage(1);
      } catch (error: any) {
        // Fallback to local search
        const searchLower = searchTerm.toLowerCase();
        const filtered = data.filter(row => {
          if (searchColumn === "__all__") {
            return visibleHeaders.some(header =>
              String(row[header] ?? '').toLowerCase().includes(searchLower)
            );
          } else {
            return String(row[searchColumn] ?? '').toLowerCase().includes(searchLower);
          }
        });
        setSearchResults(filtered);
        setCurrentPage(1);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchTerm, searchColumn, csvId, visibleHeaders, data]);

  // Load more data for pagination - FAST query from Parquet
  const loadMoreData = useCallback(async (targetPage: number) => {
    if (!csvId || isLoadingMore || hasLoadedAll) return;

    const neededRows = targetPage * rowsPerPage;
    if (data.length >= neededRows) return;

    setIsLoadingMore(true);
    try {
      const { queryParquetDirect } = await import('@/lib/duckdb');

      // Load next chunk - but queryParquetDirect doesn't support OFFSET yet
      // So we'll load more rows and slice client-side (still faster than IndexedDB)
      const limit = Math.max(INITIAL_LOAD, neededRows + rowsPerPage);

      const orderBy = sortColumn && sortDirection
        ? `"${sortColumn.replace(/"/g, '""')}" ${sortDirection.toUpperCase()}`
        : undefined;

      const allRows = await queryParquetDirect(csvId, limit, undefined, orderBy);

      if (allRows && allRows.length > 0) {
        setData(allRows);
        if (allRows.length >= actualTotalRows || allRows.length < limit) {
          setHasLoadedAll(true);
        }
      } else {
        setHasLoadedAll(true);
      }
    } catch (error) {
      console.error('Failed to load more data:', error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [csvId, isLoadingMore, hasLoadedAll, rowsPerPage, sortColumn, sortDirection, actualTotalRows]);

  // Load all data for export - FAST query from Parquet
  const loadAllData = useCallback(async (): Promise<any[]> => {
    if (!csvId || hasLoadedAll) return searchResults || data;

    try {
      const { queryParquetDirect } = await import('@/lib/duckdb');
      const orderBy = sortColumn && sortDirection
        ? `"${sortColumn.replace(/"/g, '""')}" ${sortDirection.toUpperCase()}`
        : undefined;

      const allRows = await queryParquetDirect(csvId, actualTotalRows, undefined, orderBy);
      return allRows || data;
    } catch (error) {
      console.error('Failed to load all data:', error);
      return data;
    }
  }, [csvId, data, hasLoadedAll, searchResults, sortColumn, sortDirection, actualTotalRows]);

  // Active data source (search results or loaded data)
  const activeData = searchResults || data;
  
  // Sort locally (only for loaded data, search results come pre-filtered)
  const processedData = useMemo(() => {
    if (searchResults) return searchResults; // Search results from DuckDB
    
    let sorted = [...data];
    if (sortColumn && sortDirection) {
      sorted = sorted.sort((a, b) => {
        const aVal = a[sortColumn];
        const bVal = b[sortColumn];
        
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return sortDirection === 'asc' ? 1 : -1;
        if (bVal == null) return sortDirection === 'asc' ? -1 : 1;
        
        const aNum = Number(aVal);
        const bNum = Number(bVal);
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
        }
        
        return sortDirection === 'asc' 
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      });
    }
    return sorted;
  }, [data, searchResults, sortColumn, sortDirection]);

  // Pagination
  const displayTotal = searchResults ? searchResults.length : (hasLoadedAll ? data.length : actualTotalRows);
  const totalPages = Math.ceil(displayTotal / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = Math.min(startIndex + rowsPerPage, processedData.length);
  const displayedData = processedData.slice(startIndex, endIndex);

  // Check if we need to load more when changing pages
  const goToPage = useCallback(async (page: number) => {
    const targetPage = Math.max(1, Math.min(page, totalPages || 1));
    
    // If going to a page beyond loaded data and not searching, load more
    if (!searchResults && targetPage * rowsPerPage > data.length && !hasLoadedAll && csvId) {
      await loadMoreData(targetPage);
    }
    
    setCurrentPage(targetPage);
  }, [totalPages, searchResults, rowsPerPage, data.length, hasLoadedAll, csvId, loadMoreData]);
  
  const handleSort = async (column: string) => {
    if (sortColumn === column) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortDirection(null);
        setSortColumn(null);
      }
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
    setCurrentPage(1);
    
    // If we have more data to load and sorting, reload from start with new sort - FAST
    if (csvId && !hasLoadedAll && !searchResults) {
      setIsLoadingMore(true);
      try {
        const { queryParquetDirect } = await import('@/lib/duckdb');
        const newSort = sortColumn === column
          ? (sortDirection === 'asc' ? 'desc' : null)
          : 'asc';
        const newCol = sortColumn === column && sortDirection === 'desc' ? null : column;

        const orderBy = newCol && newSort
          ? `"${newCol.replace(/"/g, '""')}" ${newSort.toUpperCase()}`
          : undefined;

        const rows = await queryParquetDirect(csvId, INITIAL_LOAD, undefined, orderBy);
        if (rows) {
          setData(rows);
          setHasLoadedAll(rows.length >= actualTotalRows);
        }
      } catch (error) {
        console.error('Failed to reload sorted data:', error);
      } finally {
        setIsLoadingMore(false);
      }
    }
  };
  
  const getColumnIcon = (type: string) => {
    switch (type) {
      case 'number': return <Hash className="w-3 h-3" />;
      case 'date': return <Calendar className="w-3 h-3" />;
      default: return <Type className="w-3 h-3" />;
    }
  };
  
  const formatValue = (value: any) => {
    if (value === null || value === undefined || value === '') return <span className="text-muted-foreground">-</span>;
    if (typeof value === 'number') return value.toLocaleString();
    const str = String(value);
    if (str.length > 100) return str.slice(0, 100) + '...';
    return str;
  };

  const handleExportCSV = async () => {
    const exportData = await loadAllData();
    const csvContent = [
      visibleHeaders.join(','),
      ...exportData.map(row => 
        visibleHeaders.map(h => {
          const val = row[h];
          if (val == null) return '';
          const str = String(val);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        }).join(',')
      )
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName.replace('.csv', '')}_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleJumpToRow = useCallback(async () => {
    const rowNum = parseInt(jumpToRow, 10);
    if (!isNaN(rowNum) && rowNum >= 1) {
      const targetPage = Math.ceil(rowNum / rowsPerPage);
      await goToPage(targetPage);
      setJumpToRow("");
    }
  }, [jumpToRow, rowsPerPage, goToPage]);
  
  if (!isOpen) return null;
  
  return (
    <div 
      className="fixed top-0 left-0 right-0 bottom-0 flex items-center justify-center p-4"
      style={{ 
        zIndex: 9999,
        backgroundColor: isAnimating ? 'hsl(var(--background) / 0.8)' : 'transparent',
        transition: 'background-color 0.2s ease-out'
      }}
      onClick={onClose}
    >
      <div 
        className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-7xl overflow-hidden flex flex-col"
        style={{
          maxHeight: '90vh',
          transform: isAnimating ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.98)',
          opacity: isAnimating ? 1 : 0,
          transition: 'transform 0.25s ease-out, opacity 0.2s ease-out'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border bg-primary/10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/20 rounded-lg">
              <TrendingUp className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">
                Data Preview
              </h2>
              <p className="text-sm text-muted-foreground">
                {fileName} • {actualTotalRows.toLocaleString()} total rows × {visibleHeaders.length} columns
                {!hasLoadedAll && !searchResults && (
                  <span className="ml-1 text-primary">({data.length} loaded)</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              title="Export all data as CSV"
            >
              <Download className="w-4 h-4 mr-1" />
              Export
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>
        
        {/* Controls Bar */}
        <div className="p-4 bg-secondary/30 border-b border-border">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Column selector for search */}
            <select
              value={searchColumn}
              onChange={(e) => setSearchColumn(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground cursor-pointer min-w-[120px]"
              title="Select column to search"
            >
              <option value="__all__">All Columns</option>
              {visibleHeaders.map(header => (
                <option key={header} value={header}>{header}</option>
              ))}
            </select>

            <div className="flex-1 min-w-[200px] relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={
                  searchColumn === "__all__"
                    ? (csvId ? "Search ALL columns in entire dataset..." : "Search all columns...")
                    : (csvId ? `Search "${searchColumn}" in entire dataset...` : `Search "${searchColumn}"...`)
                }
                className="pl-10 bg-background"
              />
              {isSearching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
              )}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground whitespace-nowrap">Rows/page:</label>
              <select
                value={rowsPerPage}
                onChange={(e) => {
                  setRowsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground cursor-pointer"
              >
                {ROWS_PER_PAGE_OPTIONS.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            {sortColumn && (
              <div className="flex items-center gap-1 bg-primary/20 text-primary px-2 py-1 rounded text-sm">
                <ArrowUpDown className="w-3 h-3" />
                <span>{sortColumn}</span>
                <span className="opacity-70">({sortDirection})</span>
                <button 
                  onClick={() => { setSortColumn(null); setSortDirection(null); }}
                  className="ml-1 hover:bg-primary/30 rounded p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            {searchResults && (
              <div className="flex items-center gap-1 bg-blue-500/20 text-blue-400 px-2 py-1 rounded text-sm">
                <Search className="w-3 h-3" />
                <span>
                  {searchResults.length.toLocaleString()} result{searchResults.length !== 1 ? 's' : ''}
                  {csvId && searchResults.length >= 5000 && <span className="ml-1">(showing first 5k)</span>}
                  {!csvId && <span className="ml-1 text-yellow-400">(loaded data only)</span>}
                </span>
                <button
                  onClick={() => { setSearchTerm(""); setSearchResults(null); setSearchColumn("__all__"); }}
                  className="ml-1 hover:bg-blue-500/30 rounded p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
          
          {/* Column Stats Panel */}
          {selectedColumn && columnStats[selectedColumn] && (
            <div className="mt-3 p-3 bg-background rounded-lg border border-border">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-primary/20 rounded">
                  {getColumnIcon(columnStats[selectedColumn].type)}
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-foreground mb-1">
                    {selectedColumn}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div>
                      <div className="text-muted-foreground">Type</div>
                      <div className="font-medium text-foreground capitalize">
                        {columnStats[selectedColumn].type}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Non-null</div>
                      <div className="font-medium text-foreground">
                        {columnStats[selectedColumn].count.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Unique</div>
                      <div className="font-medium text-foreground">
                        {columnStats[selectedColumn].unique.toLocaleString()}
                      </div>
                    </div>
                    {columnStats[selectedColumn].type === 'number' && columnStats[selectedColumn].min != null && (
                      <div>
                        <div className="text-muted-foreground">Range</div>
                        <div className="font-medium text-foreground">
                          {columnStats[selectedColumn].min.toLocaleString(undefined, {maximumFractionDigits: 2})} - {columnStats[selectedColumn].max.toLocaleString(undefined, {maximumFractionDigits: 2})}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedColumn(null)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
        
        {/* Table */}
        <div className="flex-1 overflow-auto relative">
          {isLoadingMore && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-3 py-1 rounded-full text-sm flex items-center gap-2 z-20 shadow-lg">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading more data...
            </div>
          )}
          
          {activeData.length === 0 && !isSearching ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              <div className="text-center">
                {searchTerm ? (
                  <>
                    <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No rows match "{searchTerm}"</p>
                  </>
                ) : (
                  <>
                    <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin" />
                    <p>Loading data...</p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <table className="w-full border-collapse min-w-max">
              <thead className="sticky top-0 z-10">
                <tr className="border-b-2 border-border">
                  <th className="text-left p-2 font-medium text-muted-foreground bg-secondary text-xs w-16">
                    Row #
                  </th>
                  {visibleHeaders.map((header, idx) => (
                    <th
                      key={idx}
                      className="text-left p-3 font-semibold text-foreground bg-secondary cursor-pointer hover:bg-secondary/80 transition-colors select-none"
                      onClick={() => handleSort(header)}
                    >
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedColumn(selectedColumn === header ? null : header);
                          }}
                          className="p-1 rounded hover:bg-muted transition-colors"
                          title="View column stats"
                        >
                          {getColumnIcon(columnStats[header]?.type || 'text')}
                        </button>
                        <span className="flex-1 truncate max-w-[200px]" title={header}>{header}</span>
                        <div className="w-4">
                          {sortColumn === header ? (
                            sortDirection === 'asc' ? (
                              <ChevronUp className="w-4 h-4 text-primary" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-primary" />
                            )
                          ) : (
                            <ChevronDown className="w-4 h-4 text-muted-foreground/30" />
                          )}
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedData.map((row, rowIdx) => (
                  <tr
                    key={rowIdx}
                    className="border-b border-border hover:bg-muted/50 transition-colors"
                  >
                    <td className="p-2 text-xs text-muted-foreground font-mono">
                      {startIndex + rowIdx + 1}
                    </td>
                    {visibleHeaders.map((header, colIdx) => (
                      <td
                        key={colIdx}
                        className="p-3 text-foreground max-w-[300px] truncate"
                        title={String(row[header] ?? '')}
                      >
                        {formatValue(row[header])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        
        {/* Pagination Footer */}
        <div className="p-4 border-t border-border bg-secondary/30 flex flex-wrap justify-between items-center gap-3">
          <div className="text-sm text-muted-foreground">
            {displayedData.length > 0 ? (
              <>
                Rows <span className="font-semibold text-foreground">{startIndex + 1}</span> - <span className="font-semibold text-foreground">{startIndex + displayedData.length}</span> of{' '}
                <span className="font-semibold text-foreground">{displayTotal.toLocaleString()}</span>
                {hasMoreData && !searchResults && (
                  <span className="ml-1 text-primary">(more available)</span>
                )}
              </>
            ) : (
              <span>No data to display</span>
            )}
          </div>
          
          {/* Pagination Controls */}
          <div className="flex items-center gap-2">
            {/* Jump to row */}
            <div className="flex items-center gap-1">
              <Input
                value={jumpToRow}
                onChange={(e) => setJumpToRow(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJumpToRow()}
                placeholder="Go to row"
                className="w-24 h-8 text-xs bg-background"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                onClick={handleJumpToRow}
                disabled={!jumpToRow || isLoadingMore}
              >
                Go
              </Button>
            </div>
            
            <div className="h-6 w-px bg-border mx-2" />
            
            {/* Page navigation */}
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => goToPage(1)}
              disabled={currentPage === 1 || isLoadingMore}
              title="First page"
            >
              <ChevronsLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1 || isLoadingMore}
              title="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            
            <span className="text-sm px-2 text-foreground">
              Page <span className="font-semibold">{currentPage}</span> of <span className="font-semibold">{totalPages || 1}</span>
            </span>
            
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => goToPage(currentPage + 1)}
              disabled={(currentPage >= totalPages && !hasMoreData) || isLoadingMore}
              title="Next page"
            >
              {isLoadingMore ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => goToPage(totalPages)}
              disabled={(currentPage >= totalPages && !hasMoreData) || isLoadingMore}
              title="Last page"
            >
              <ChevronsRight className="w-4 h-4" />
            </Button>
          </div>
          
          <Button onClick={onClose} variant="default">
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
