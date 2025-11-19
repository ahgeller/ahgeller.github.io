import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import { getCsvFileData } from "@/lib/chatApi";

interface CSVValueSearchProps {
  csvId?: string | null; // Optional: null means combine all CSV files
  filterColumn: string;
  onSelectValue: (value: string) => void;
}

const VALUES_PER_PAGE = 15;

const CSVValueSearch = ({ csvId = null, filterColumn, onSelectValue }: CSVValueSearchProps) => {
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [uniqueValues, setUniqueValues] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Get unique values from the selected column (combines all CSV files if csvId is null)
  useEffect(() => {
    const loadValues = async () => {
      setIsLoading(true);
      try {
        const csvData = await getCsvFileData(csvId, null, null); // Combines all files if csvId is null
        if (!csvData || csvData.length === 0) {
          setUniqueValues([]);
          setIsLoading(false);
          return;
        }
        
        const values = new Set<string>();
        csvData.forEach((row: any) => {
          if (row && row[filterColumn] !== null && row[filterColumn] !== undefined && row[filterColumn] !== '') {
            values.add(String(row[filterColumn]));
          }
        });
        setUniqueValues(Array.from(values).sort());
      } catch (error) {
        console.error('Error loading CSV values:', error);
        setUniqueValues([]);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadValues();
  }, [csvId, filterColumn]);

  // Get first value for display indicator
  const getFirstValue = (): string | null => {
    return uniqueValues.length > 0 ? uniqueValues[0] : null;
  };
  
  // Filter unique values based on search query
  const filteredValues = searchQuery.trim()
    ? uniqueValues.filter(val => val.toLowerCase().includes(searchQuery.toLowerCase()))
    : uniqueValues;

  const totalPages = Math.ceil(filteredValues.length / VALUES_PER_PAGE);
  const startIdx = currentPage * VALUES_PER_PAGE;
  const endIdx = Math.min(startIdx + VALUES_PER_PAGE, filteredValues.length);
  const pageValues = filteredValues.slice(startIdx, endIdx);

  useEffect(() => {
    if (searchQuery.trim()) {
      setCurrentPage(0);
    }
  }, [searchQuery]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      
      // Check if click is outside both the dropdown and the input
      const isClickInsideDropdown = dropdownRef.current?.contains(target);
      const isClickInsideInput = searchInputRef.current?.contains(target);
      const isClickInsideContainer = containerRef.current?.contains(target);
      
      if (!isClickInsideDropdown && !isClickInsideInput && !isClickInsideContainer) {
        setIsSearchOpen(false);
      }
    };

    if (isSearchOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isSearchOpen]);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setIsSearchOpen(true);
    setCurrentPage(0);
  };

  const handleValueSelect = (value: string) => {
    onSelectValue(value);
    setSearchQuery("");
    setIsSearchOpen(false);
  };

  const firstValue = getFirstValue();
  const placeholderText = firstValue 
    ? `Search ${filterColumn}... (e.g., ${firstValue})` 
    : `Search ${filterColumn}...`;

  return (
    <div className="relative" ref={containerRef}>
      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        ref={searchInputRef}
        value={searchQuery}
        onChange={(e) => handleSearchChange(e.target.value)}
        onFocus={() => setIsSearchOpen(true)}
        placeholder={placeholderText}
        className="pl-9 bg-secondary border-border/50 h-8 text-xs"
      />
      
      {isSearchOpen && filteredValues.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 bg-secondary border border-border rounded-lg shadow-lg max-h-96 overflow-hidden flex flex-col"
        >
          <div className="overflow-y-auto flex-1">
            {pageValues.map((value, idx) => (
              <div
                key={idx}
                className="p-3 cursor-pointer hover:bg-chat-hover transition-colors"
                onClick={() => handleValueSelect(value)}
              >
                <div className="text-sm">{value}</div>
              </div>
            ))}
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
          
          {totalPages === 1 && filteredValues.length > 0 && (
            <div className="border-t border-border p-2 text-xs text-muted-foreground text-center">
              {filteredValues.length} value{filteredValues.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
      
      {isSearchOpen && filteredValues.length === 0 && searchQuery.trim() && (
        <div className="absolute z-50 w-full mt-1 bg-secondary border border-border rounded-lg shadow-lg p-4 text-center text-sm text-muted-foreground">
          No values found
        </div>
      )}
    </div>
  );
};

export default CSVValueSearch;

