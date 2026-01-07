import { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { X, Plus, Trash2, Upload, FileText, RotateCcw } from "lucide-react";
import { initVolleyballDB, listDatabaseTables } from "@/lib/database";
import { parseCsvText } from "@/lib/csvUtils";
import { migrateLegacyCsvFile, saveCsvDataText, saveCsvFileMetadata, deleteCsvData, getStorageInfo, migrateAllToIndexedDB, analyzeStorage, cleanupSelectedItems, getAllCsvFileMetadata, deleteCsvFileMetadata } from "@/lib/csvStorage";
import { deleteValueInfo, clearAllValueInfos, removeDuplicateValueInfos, getDefaultCodingRules } from "@/lib/chatApi";
import { generatePrefixedId } from "@/lib/idGenerator";

interface DatabaseSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  contentOnly?: boolean;
}

interface ContextSection {
  id: string;
  title: string;
  content: string;
}

interface CodingRules {
  id: string;
  content: string;
}

interface CSVFile {
  id: string;
  name: string;
  headers: string[];
  uploadedAt: number;
  rowCount?: number;
  data?: any[]; // Legacy support
}

interface ValueInfo {
  id: string; // matchId or csvId
  type: 'match' | 'csv';
  name: string; // e.g., "Team A vs Team B" or "filename.csv"
  columns: Array<{
    name: string;
    type: string;
    uniqueValues: any[];
    nullCount: number;
    description?: string; // AI-generated description
  }>;
  summary: string; // AI-generated summary explaining the data structure
  generatedAt: number;
}

const ValueInfoItem = ({ valueInfo, onDelete }: { valueInfo: ValueInfo; onDelete: () => void }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Delete value info for "${valueInfo.name}"?`)) {
      deleteValueInfo(valueInfo.id, valueInfo.type);
      onDelete();
    }
  };
  
  return (
    <div className="border border-border rounded-md p-3 bg-secondary/30">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="font-medium">{valueInfo.name} ({valueInfo.type})</div>
          <div className="text-sm text-muted-foreground mt-1">
            {valueInfo.columns.length} columns, generated {new Date(valueInfo.generatedAt).toLocaleString()}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {isExpanded && (
        <div className="mt-3 space-y-3">
          {valueInfo.summary && (
            <div className="text-sm whitespace-pre-wrap bg-background p-3 rounded border border-border max-h-48 overflow-y-auto">
              {valueInfo.summary}
            </div>
          )}
          <div className="space-y-2">
            <div className="text-sm font-medium">Column Details:</div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {valueInfo.columns.map((col, idx) => (
                <div key={idx} className="text-xs bg-background p-2 rounded border border-border">
                  <div className="font-medium">{col.name} ({col.type})</div>
                  <div className="text-muted-foreground mt-1">
                    {col.uniqueValues.length} unique values
                    {col.nullCount > 0 && `, ${col.nullCount} null values`}
                  </div>
                  {col.uniqueValues.length > 0 && col.uniqueValues.length <= 20 && (
                    <div className="text-muted-foreground mt-1 break-words">
                      Values: {col.uniqueValues.map((v: any) => String(v)).join(', ')}
                    </div>
                  )}
                  {col.uniqueValues.length > 20 && (
                    <div className="text-muted-foreground mt-1 break-words">
                      Sample values: {col.uniqueValues.slice(0, 10).map((v: any) => String(v)).join(', ')}...
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const DatabaseSettings = ({ isOpen, onClose, contentOnly = false }: DatabaseSettingsProps) => {
  const [connectionString, setConnectionString] = useState("");
  const [tableName, setTableName] = useState("");
  const [connectedTables, setConnectedTables] = useState<string[]>([]);
  const [availableTables, setAvailableTables] = useState<string[]>([]);
  const [isLoadingTables, setIsLoadingTables] = useState(false);
  const [contextSections, setContextSections] = useState<ContextSection[]>([]);
  // Initialize coding rules from localStorage if available
  const [codingRules, setCodingRules] = useState<CodingRules>(() => {
    try {
      const saved = localStorage.getItem("db_coding_rules");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && parsed.id && typeof parsed.content === 'string') {
          return { id: parsed.id || "coding-rules", content: parsed.content };
        } else if (typeof parsed === 'string') {
          return { id: "coding-rules", content: parsed };
        } else if (parsed && typeof parsed === 'object' && typeof parsed.content === 'string') {
          return { id: "coding-rules", content: parsed.content };
        }
      }
    } catch (e) {
      console.error('Error initializing coding rules from localStorage:', e);
    }
    return { id: "coding-rules", content: "" };
  });
  const [csvFiles, setCsvFiles] = useState<CSVFile[]>([]);
  const [valueInfos, setValueInfos] = useState<ValueInfo[]>([]);
  const [isSavingContextSections, setIsSavingContextSections] = useState(false);
  const [showSetupInstructions, setShowSetupInstructions] = useState(false);
  const [storageInfo, setStorageInfo] = useState<{ used: number; quota: number; percentage: number } | null>(null);
  const [isCleaning, setIsCleaning] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [storageAnalysis, setStorageAnalysis] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedCsvFilesToRemove, setSelectedCsvFilesToRemove] = useState<Set<string>>(new Set());
  const [selectedOrphansToRemove, setSelectedOrphansToRemove] = useState<Set<string>>(new Set());
  const [showStorageManagement, setShowStorageManagement] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Load settings from localStorage
      // Note: D1 doesn't use connection strings - database is configured via wrangler.toml
      const savedTableName = localStorage.getItem("db_table_name") || "";
      const savedContextSections = localStorage.getItem("db_context_sections");
      const savedCodingRules = localStorage.getItem("db_coding_rules");
      const savedCsvFiles = localStorage.getItem("db_csv_files");

      setTableName(savedTableName);
      // Load connected tables (support multiple tables)
      const savedConnectedTables = localStorage.getItem("db_connected_tables");
      if (savedConnectedTables) {
        try {
          const parsed = JSON.parse(savedConnectedTables);
          setConnectedTables(Array.isArray(parsed) ? parsed : (savedTableName ? [savedTableName] : []));
        } catch (e) {
          setConnectedTables(savedTableName ? [savedTableName] : []);
        }
      } else {
        // Migrate from single table name to multiple tables
        setConnectedTables(savedTableName ? [savedTableName] : []);
      }
      // D1 doesn't use connection strings - clear any old connection string settings
      setConnectionString("");

      // Load context sections
      const defaultContext = `You are an expert volleyball analyst helping the University of California, San Diego (UCSD) volleyball team. Always consider UCSD's perspective.

Instructions:

- Answer directly and concisely

- Use ONLY actual data from context - never invent or use placeholders

- Format responses professionally: Use clear paragraphs with natural flow, supplement with structured lists when helpful, use tables for statistics, bold key metrics, and organize with headers for major sections

You are a volleyball expert. Use your knowledge of volleyball statistics, evaluation codes, and match analysis to provide comprehensive insights.

VOLLEYBALL DATA UNDERSTANDING:

- Evaluation codes: "#" = Perfect (really good action, 4 grade) - meaning depends on skill type (kill for attacks, ace for serves, perfect for other skills), "+" = Positive/Good, "!" = Medium/OK, "-" = Poor, "=" = Error

- Skill types include: Attack, Serve, Reception, Set, Block, Dig, Freeball

- Phase matters: "Reception" phase attacks are different from "Transition" phase attacks

- Reception quality affects attack options: "3-zone" enables all attacks including quick sets, "2-zone" enables most attacks, "1-zone" mainly high balls

- Attack codes: K1-K9 = Quick attacks, X1-X9 = Tempo attacks, V1-V9 = High ball attacks

- Zones 1-9 represent court positions (1=right back, 2=right front, 3=middle front , 4=left front, 5=back left , 6=back middle, 7 = left middle, 8 = middle middle, 9 = right middle) (first word refers to x-position, second word refers to y-position)`;

      if (savedContextSections) {
        try {
          const parsed = JSON.parse(savedContextSections);
          const sections = Array.isArray(parsed) ? parsed : [];
          if (sections.length > 0) {
            setContextSections(sections);
          } else {
            setContextSections([{ 
              id: Date.now().toString(), 
              title: "Volleyball Context", 
              content: defaultContext 
            }]);
          }
        } catch (e) {
          setContextSections([{ 
            id: Date.now().toString(), 
            title: "Volleyball Context", 
            content: defaultContext 
          }]);
        }
      } else {
        setContextSections([{ 
          id: Date.now().toString(), 
          title: "Volleyball Context", 
          content: defaultContext 
        }]);
      }

      // Load coding rules - Use the same default from chatApi.ts
      const defaultCodingRulesText = getDefaultCodingRules();

      if (savedCodingRules) {
        try {
          const parsed = JSON.parse(savedCodingRules);
          console.log('Loading coding rules from localStorage:', parsed);
          
          // Handle different formats: object with id/content, or just content string
          if (parsed && typeof parsed === 'object' && parsed.id && typeof parsed.content === 'string') {
            // Modern format: { id: "coding-rules", content: "..." }
            // Accept even if content is empty string (user might have cleared it)
            console.log('Using modern format with id and content');
            setCodingRules({ id: parsed.id || "coding-rules", content: parsed.content });
          } else if (typeof parsed === 'string') {
            // Legacy format: just a string
            console.log('Using legacy string format');
            setCodingRules({ id: "coding-rules", content: parsed });
          } else if (parsed && typeof parsed === 'object' && typeof parsed.content === 'string') {
            // Object with content but no id
            console.log('Using object format with content but no id');
            setCodingRules({ id: "coding-rules", content: parsed.content });
          } else {
            // Invalid format, use defaults
            console.log('Invalid format, using defaults. Parsed:', parsed);
            setCodingRules({ id: "coding-rules", content: defaultCodingRulesText });
          }
        } catch (e) {
          console.error('Error parsing coding rules:', e, 'Raw value:', savedCodingRules);
          setCodingRules({ id: "coding-rules", content: defaultCodingRulesText });
        }
      } else {
        console.log('No saved coding rules found, using defaults');
        setCodingRules({ id: "coding-rules", content: defaultCodingRulesText });
      }

      // Load CSV files from IndexedDB (new approach)
      const loadCsvFiles = async () => {
        try {
          // Try IndexedDB first
          const metadataFiles = await getAllCsvFileMetadata();
          
          if (metadataFiles.length > 0) {
            // Convert metadata to CSVFile format
            const files: CSVFile[] = metadataFiles.map((meta: any) => ({
              id: meta.id,
              name: meta.name,
              headers: meta.headers || [],
              rowCount: meta.rowCount || 0,
              uploadedAt: meta.uploadedAt || Date.now(),
              // Data is stored separately in IndexedDB, not in metadata
            }));
            setCsvFiles(files);
          } else {
            // Fallback to localStorage for migration
            if (savedCsvFiles) {
              try {
                const parsed = JSON.parse(savedCsvFiles);
                if (Array.isArray(parsed) && parsed.length > 0) {
                  const cleanedFilesPromises = parsed.map(async (file: CSVFile | null) => {
                    if (!file) return null;
                    const { updatedFile, migrated } = await migrateLegacyCsvFile(file);
                    return updatedFile;
                  });
                  const cleanedFiles = await Promise.all(cleanedFilesPromises);
                  const filtered = cleanedFiles.filter(Boolean) as CSVFile[];
                  if (filtered.length > 0) {
                    // Migrate to IndexedDB
                    await migrateAllToIndexedDB();
                    // Reload from IndexedDB after migration
                    const migratedFiles = await getAllCsvFileMetadata();
                    const files: CSVFile[] = migratedFiles.map((meta: any) => ({
                      id: meta.id,
                      name: meta.name,
                      headers: meta.headers || [],
                      rowCount: meta.rowCount || 0,
                      uploadedAt: meta.uploadedAt || Date.now(),
                    }));
                    setCsvFiles(files);
                  } else {
                    setCsvFiles([]);
                  }
                } else {
                  setCsvFiles([]);
                }
              } catch (e) {
                console.error("Error loading CSV files from localStorage:", e);
                setCsvFiles([]);
              }
            } else {
              setCsvFiles([]);
            }
          }
        } catch (e) {
          console.error("Error loading CSV files from IndexedDB:", e);
          // Fallback to localStorage
          if (savedCsvFiles) {
            try {
              const parsed = JSON.parse(savedCsvFiles);
              const filtered = Array.isArray(parsed) ? parsed.filter((f: any) => f !== null) as CSVFile[] : [];
              setCsvFiles(filtered);
            } catch (parseError) {
              console.error("Error parsing CSV files from localStorage:", parseError);
              setCsvFiles([]);
            }
          } else {
            setCsvFiles([]);
          }
        }
      };
      
      loadCsvFiles();

      // Load value infos
      loadValueInfos();
      
      // Load storage info
      loadStorageInfo();
    }
  }, [isOpen]);
  
  // Function to load storage info
  const loadStorageInfo = async () => {
    try {
      const info = await getStorageInfo();
      setStorageInfo(info);
    } catch (error) {
      console.error("Error loading storage info:", error);
    }
  };
  
  // Refresh storage info periodically when dialog is open
  useEffect(() => {
    if (!isOpen) return;

    // Load immediately
    loadStorageInfo();

    // Refresh every 10 seconds while dialog is open (reduced from 5s for better performance)
    // Keep running even when tab is hidden to allow background processing
    const interval = setInterval(() => {
      loadStorageInfo();
    }, 10000);

    return () => clearInterval(interval);
  }, [isOpen]);

  // Function to load value infos
  const loadValueInfos = () => {
    // Clean up duplicates before loading
    removeDuplicateValueInfos();
    
    const savedValueInfos = localStorage.getItem("db_value_infos");
    if (savedValueInfos) {
      try {
        const parsed = JSON.parse(savedValueInfos);
        setValueInfos(Array.isArray(parsed) ? parsed : []);
      } catch (e) {
        setValueInfos([]);
      }
    } else {
      setValueInfos([]);
    }
  };

  // Refresh value infos periodically when dialog is open (to catch new current_selection)
  useEffect(() => {
    if (!isOpen) return;
    
    // Load immediately
    loadValueInfos();
    
    // Refresh every 2 seconds while dialog is open
    const interval = setInterval(() => {
      loadValueInfos();
    }, 2000);
    
    return () => clearInterval(interval);
  }, [isOpen]);

  const handleSaveConnectionString = async () => {
    // D1 doesn't use connection strings - database is configured via wrangler.toml
    // This function is kept for UI compatibility but just initializes the database
    try {
      const success = await initVolleyballDB();
          // Dispatch event to notify components of database update
          window.dispatchEvent(new Event('databaseUpdated'));
      if (success) {
        // Success is handled silently - the connection status will update automatically
        console.log("Database connection initialized successfully");
        // Load available tables after successful connection
        loadAvailableTables();
      }
    } catch (error) {
      // Error is handled silently - connection status will show as disconnected
      console.error("Database connection failed:", error);
    }
  };

  const loadAvailableTables = async () => {
    setIsLoadingTables(true);
    try {
      const tables = await listDatabaseTables();
      setAvailableTables(tables);
    } catch (error) {
      console.error("Failed to load available tables:", error);
      setAvailableTables([]);
    } finally {
      setIsLoadingTables(false);
    }
  };

  const handleAddTable = (table: string) => {
    if (!connectedTables.includes(table)) {
      const updated = [...connectedTables, table];
      setConnectedTables(updated);
      localStorage.setItem("db_connected_tables", JSON.stringify(updated));
      window.dispatchEvent(new Event('databaseUpdated'));
    }
  };

  const handleRemoveTable = (table: string) => {
    const updated = connectedTables.filter(t => t !== table);
    setConnectedTables(updated);
    localStorage.setItem("db_connected_tables", JSON.stringify(updated));
    // Also update legacy single table name for backward compatibility
    if (updated.length > 0) {
      localStorage.setItem("db_table_name", updated[0]);
    } else {
      localStorage.removeItem("db_table_name");
    }
    window.dispatchEvent(new Event('databaseUpdated'));
  };

  const handleSaveTableName = () => {
    localStorage.setItem("db_table_name", tableName.trim());
    // Dispatch event to notify components of database update
    window.dispatchEvent(new Event('databaseUpdated'));
    alert("Table name saved successfully!");
  };

  const handleSaveContextSections = async () => {
    setIsSavingContextSections(true);
    try {
      // Simulate a brief delay for better UX feedback
      await new Promise(resolve => setTimeout(resolve, 300));
      localStorage.setItem("db_context_sections", JSON.stringify(contextSections));
      // Dispatch custom event to notify other components
      window.dispatchEvent(new Event('contextSectionsUpdated'));
      alert("Context sections saved successfully!");
    } catch (error) {
      console.error("Error saving context sections:", error);
      alert("Failed to save context sections. Please try again.");
    } finally {
      setIsSavingContextSections(false);
    }
  };

  const handleSaveCodingRules = () => {
    console.log('Saving coding rules:', codingRules);
    const saved = JSON.stringify(codingRules);
    console.log('Saving to localStorage as:', saved);
    localStorage.setItem("db_coding_rules", saved);
    // CRITICAL: Also save the version so chatApi.ts doesn't clear the rules
    localStorage.setItem("db_coding_rules_version", "2.1");
    
    // Verify it was saved
    const verify = localStorage.getItem("db_coding_rules");
    console.log('Verified saved value:', verify);
    
    alert("Coding rules saved successfully!");
  };

  const handleResetContextSections = () => {
    if (confirm("Reset 'Volleyball Context' section to default? This will only reset the Volleyball Context section and keep all your custom sections.")) {
      const defaultContext = `You are an expert volleyball analyst helping the University of California, San Diego (UCSD) volleyball team. Always consider UCSD's perspective.

Instructions:

- Answer directly and concisely

- Use ONLY actual data from context - never invent or use placeholders

- Format responses professionally: Use clear paragraphs with natural flow, supplement with structured lists when helpful, use tables for statistics, bold key metrics, and organize with headers for major sections

You are a volleyball expert. Use your knowledge of volleyball statistics, evaluation codes, and match analysis to provide comprehensive insights.

VOLLEYBALL DATA UNDERSTANDING:

- Evaluation codes: "#" = Perfect (really good action, 4 grade) - meaning depends on skill type (kill for attacks, ace for serves, perfect for other skills), "+" = Positive/Good, "!" = Medium/OK, "-" = Poor, "=" = Error

- Skill types include: Attack, Serve, Reception, Set, Block, Dig, Freeball

- Phase matters: "Reception" phase attacks are different from "Transition" phase attacks

- Reception quality affects attack options: "3-zone" enables all attacks including quick sets, "2-zone" enables most attacks, "1-zone" mainly high balls

- Attack codes: K1-K9 = Quick attacks, X1-X9 = Tempo attacks, V1-V9 = High ball attacks

- Zones 1-9 represent court positions (1=right back, 2=right front, 3=middle front , 4=left front, 5=back left , 6=back middle, 7 = left middle, 8 = middle middle, 9 = right middle) (first word refers to x-position, second word refers to y-position)`;

      // Find the "Volleyball Context" section if it exists, or create a new one
      const volleyballContextIndex = contextSections.findIndex(section => section.title === "Volleyball Context");
      
      let updatedSections: ContextSection[];
      
      if (volleyballContextIndex >= 0) {
        // Update existing "Volleyball Context" section
        updatedSections = [...contextSections];
        updatedSections[volleyballContextIndex] = {
          ...updatedSections[volleyballContextIndex],
          content: defaultContext
        };
      } else {
        // Add "Volleyball Context" section if it doesn't exist, keeping all other sections
        updatedSections = [
          { 
            id: Date.now().toString(), 
            title: "Volleyball Context", 
            content: defaultContext 
          },
          ...contextSections
        ];
      }

      setContextSections(updatedSections);
      localStorage.setItem("db_context_sections", JSON.stringify(updatedSections));
      window.dispatchEvent(new Event('contextSectionsUpdated'));
      alert("Section reset to default!");
    }
  };

  const handleResetCodingRules = () => {
    if (confirm("Reset coding rules to defaults? This will replace your current coding rules with the default universal code execution instructions.")) {
      const defaultCodingRulesText = getDefaultCodingRules();
      const defaultRules = { id: "coding-rules", content: defaultCodingRulesText };
      setCodingRules(defaultRules);
      localStorage.setItem("db_coding_rules", JSON.stringify(defaultRules));
      localStorage.setItem("db_coding_rules_version", "2.1");
      alert("Coding rules reset to defaults!");
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      const { headers, data } = parseCsvText(text);

      const csvFile: CSVFile = {
        id: generatePrefixedId('csv'),
        name: file.name,
        headers,
        rowCount: data.length,
        uploadedAt: Date.now()
      };

      // Save to IndexedDB
      try {
        await saveCsvDataText(csvFile.id, text, data);
        // Also save the metadata separately
        await saveCsvFileMetadata(csvFile);
        // Reload from IndexedDB to get updated metadata
        const metadataFiles = await getAllCsvFileMetadata();
        const files: CSVFile[] = metadataFiles.map((meta: any) => ({
          id: meta.id,
          name: meta.name,
          headers: meta.headers || [],
          rowCount: meta.rowCount || 0,
          uploadedAt: meta.uploadedAt || Date.now(),
        }));
        setCsvFiles(files);
        
        // Also update localStorage for backwards compatibility with other components
        try {
          localStorage.setItem("db_csv_files", JSON.stringify(files));
        } catch (e) {
          console.warn("Could not update localStorage csv files list:", e);
        }
        
        // Refresh storage info after upload
        await loadStorageInfo();
        alert(`CSV file "${file.name}" uploaded successfully! ${data.length} rows loaded.`);
      } catch (error) {
        console.error("Failed to save CSV file:", error);
        // Refresh storage info even on error to show current usage
        await loadStorageInfo();
        alert("Unable to save CSV file. Storage limit may have been reached. Please remove older files and try again.");
      }
    };

    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDeleteCsvFile = async (fileId: string) => {
    if (confirm("Delete this CSV file?")) {
      // Clear cached filtered data for this CSV
      const { clearCsvDataCache } = await import("@/lib/csvDataLoader");
      clearCsvDataCache(fileId);
      
      // Delete from IndexedDB
      await deleteCsvData(fileId);
      await deleteCsvFileMetadata(fileId);
      
      // Update UI - reload from IndexedDB
      let files: CSVFile[] = [];
      try {
        const metadataFiles = await getAllCsvFileMetadata();
        files = metadataFiles.map((meta: any) => ({
          id: meta.id,
          name: meta.name,
          headers: meta.headers || [],
          rowCount: meta.rowCount || 0,
          uploadedAt: meta.uploadedAt || Date.now(),
        }));
        setCsvFiles(files);
      } catch (e) {
        console.error("Error reloading CSV files after deletion:", e);
        // Fallback: update from current state
        files = csvFiles.filter(f => f.id !== fileId);
        setCsvFiles(files);
      }
      
      // Also update localStorage for backwards compatibility
      try {
        localStorage.setItem("db_csv_files", JSON.stringify(files));
      } catch (e) {
        console.warn("Could not update localStorage csv files list:", e);
      }
      
      // Refresh storage info after deletion
      await loadStorageInfo();
    }
  };
  
  // Format bytes to human-readable format
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    if (bytes === undefined || bytes === null || isNaN(bytes)) return "Unknown";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const handleAddContextSection = () => {
    const updated = [...contextSections, { id: Date.now().toString(), title: "", content: "" }];
    setContextSections(updated);
    // Auto-save when new section is added
    localStorage.setItem("db_context_sections", JSON.stringify(updated));
    window.dispatchEvent(new Event('contextSectionsUpdated'));
  };

  const handleRemoveContextSection = (id: string) => {
    const updated = contextSections.filter(s => s.id !== id);
    setContextSections(updated);
    // Auto-save when section is removed
    localStorage.setItem("db_context_sections", JSON.stringify(updated));
    window.dispatchEvent(new Event('contextSectionsUpdated'));
  };

  const handleUpdateContextSection = (id: string, field: 'title' | 'content', value: string) => {
    const updated = contextSections.map(s => s.id === id ? { ...s, [field]: value } : s);
    setContextSections(updated);
    // Auto-save context sections when updated
    localStorage.setItem("db_context_sections", JSON.stringify(updated));
    window.dispatchEvent(new Event('contextSectionsUpdated'));
  };

  const handleAnalyzeStorage = async () => {
    setIsAnalyzing(true);
    try {
      const analysis = await analyzeStorage();
      setStorageAnalysis(analysis);
      setShowStorageManagement(true);
      // Initialize selection sets
      setSelectedCsvFilesToRemove(new Set());
      setSelectedOrphansToRemove(new Set());
    } catch (error) {
      alert(`Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCleanupSelected = async () => {
    if (selectedCsvFilesToRemove.size === 0 && selectedOrphansToRemove.size === 0) {
      alert("Please select items to remove first.");
      return;
    }

    if (!confirm(`This will remove ${selectedCsvFilesToRemove.size} CSV file(s) and ${selectedOrphansToRemove.size} orphaned data entry(ies). Continue?`)) {
      return;
    }

    setIsCleaning(true);
    try {
      const result = await cleanupSelectedItems({
        removeCsvFileIds: Array.from(selectedCsvFilesToRemove),
        removeOrphanedKeys: Array.from(selectedOrphansToRemove),
        removeValueInfoDuplicates: false // User can do this separately
      });
      alert(`Cleanup complete!\n- Removed ${result.removedCsvFiles} CSV file(s)\n- Removed ${result.removedOrphans} orphaned entries\n- Freed ${formatBytes(result.freedSpace)}`);
      await loadStorageInfo();
      // Reload CSV files list from IndexedDB
      try {
        const metadataFiles = await getAllCsvFileMetadata();
        const files: CSVFile[] = metadataFiles.map((meta: any) => ({
          id: meta.id,
          name: meta.name,
          headers: meta.headers || [],
          rowCount: meta.rowCount || 0,
          uploadedAt: meta.uploadedAt || Date.now(),
        }));
        setCsvFiles(files);
      } catch (e) {
        console.error("Error reloading CSV files after cleanup:", e);
      }
      // Re-analyze to refresh
      await handleAnalyzeStorage();
    } catch (error) {
      alert(`Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsCleaning(false);
    }
  };

  const handleMigrateToIndexedDB = async () => {
    if (!confirm("This will migrate all CSV data from localStorage to IndexedDB for better storage capacity. Continue?")) {
      return;
    }
    setIsMigrating(true);
    try {
      const result = await migrateAllToIndexedDB();
      alert(`Migration complete!\n- Migrated ${result.migrated} files\n- ${result.errors} errors`);
      await loadStorageInfo();
    } catch (error) {
      alert(`Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsMigrating(false);
    }
  };

  if (!isOpen && !contentOnly) return null;

  const content = (
    <>
      {!contentOnly && (
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">Database Settings</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className={contentOnly ? "p-6 overflow-y-auto max-h-full" : ""}>
        {/* Database Connection Info */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">Database Connection</label>
            <div className="p-4 bg-accent/50 border border-border rounded-lg mb-2">
              <p className="text-sm text-foreground mb-2">
                <strong>Connect Your Own Database via Cloudflare R2 + Workers:</strong> This setup is for your <strong>hosted website on Cloudflare Pages</strong>, not for local development. It uses Cloudflare R2 (object storage) for caching and Workers as a query layer to your Neon Postgres database.
              </p>
              <p className="text-sm text-foreground mb-2">
                <strong>How Caching Reduces Database Queries:</strong> R2 stores cached query results. When the same query is made again (even in different sessions), it's served from R2 cache instead of querying Neon. This dramatically reduces database load - identical queries only hit Neon once, then are cached for hours.
              </p>
              <p className="text-sm text-foreground mb-2">
                <strong>💡 Alternative: Use CSV Files (Unlimited Queries):</strong> If you're worried about query limits, you can upload CSV files instead! CSV files are processed entirely in your browser using DuckDB WASM - this means <strong>unlimited queries with zero database costs</strong>. The data never leaves your browser, and you can query it as much as you want. Just use the "Upload CSV" button below.
              </p>
              <p className="text-sm text-foreground mb-2">
                <strong>Important:</strong> The Neon connection string is configured in your Cloudflare Dashboard (see Step 7 below), not in this app. The "Test Database Connection" button below just verifies your connection is working.
              </p>
            </div>
            <div className="flex gap-2 mb-2">
              <Button onClick={handleSaveConnectionString}>Test Database Connection</Button>
              <Button
                variant="outline"
                onClick={() => setShowSetupInstructions(!showSetupInstructions)}
                className="flex items-center gap-2"
              >
                {showSetupInstructions ? (
                  <>
                    <ChevronUp className="h-4 w-4" />
                    Hide Setup Instructions
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4" />
                    Show Setup Instructions
                  </>
                )}
              </Button>
            </div>
            
            {showSetupInstructions && (
              <div className="mt-4 p-4 bg-background border border-border rounded-lg max-h-[600px] overflow-y-auto">
                <h3 className="text-sm font-semibold mb-3">Cloudflare R2 + Workers Setup Instructions</h3>
                <p className="text-xs text-muted-foreground mb-4">
                  <strong>Important:</strong> This setup uses Cloudflare R2 (object storage) for caching and Workers to query your Neon Postgres database. You'll need both a Cloudflare account and a Neon account.
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  <strong>How it works:</strong> R2 stores cached JSON responses (10GB free tier), and Workers act as a query layer that checks R2 first, then queries Neon Postgres if the data isn't cached. This gives you fast queries with your existing Neon database!
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  <strong>Query Reduction:</strong> Identical queries are cached for 1-24 hours (depending on data type). This means if 100 users run the same query, only the first one hits Neon - the other 99 get cached results. This dramatically reduces database load and costs.
                </p>
                
                <div className="space-y-4 text-sm">
                  <div>
                    <h4 className="font-medium mb-2 text-primary">Quick Start: Connect to Existing Neon Database</h4>
                    <p className="text-muted-foreground mb-2 text-xs">
                      <strong>If you already have a Neon Postgres database:</strong>
                    </p>
                    <ol className="text-muted-foreground mb-2 text-xs list-decimal list-inside space-y-1">
                      <li>Get your Neon connection string from <a href="https://console.neon.tech" target="_blank" rel="noopener noreferrer" className="text-primary underline">console.neon.tech</a> (see Step 5)</li>
                      <li>Follow Steps 1-4 to set up Cloudflare account and tools</li>
                      <li>Create an R2 bucket (Step 6) for caching</li>
                      <li><strong>Configure the connection string in Cloudflare Dashboard</strong> (Step 7) - this is where you paste your connection string</li>
                      <li>Click "Test Database Connection" above to verify it works</li>
                      <li>Use "Load Available Tables" to see and select your existing tables</li>
                    </ol>
                    <p className="text-muted-foreground mb-2 text-xs mt-2">
                      <strong>Note:</strong> The connection string is stored securely in Cloudflare's environment variables (server-side), not in this app. You configure it once in Cloudflare Dashboard, and then the app uses it automatically.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2 text-primary">Step 1: Create a Free Cloudflare Account</h4>
                    <p className="text-muted-foreground mb-2 text-xs">
                      1. Go to <a href="https://dash.cloudflare.com/sign-up" target="_blank" rel="noopener noreferrer" className="text-primary underline">cloudflare.com</a> and click "Sign Up"
                    </p>
                    <p className="text-muted-foreground mb-2 text-xs">
                      2. Enter your email and create a password (it's completely free)
                    </p>
                    <p className="text-muted-foreground text-xs">
                      3. Verify your email address when prompted
                    </p>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2 text-primary">Step 2: Install Node.js (if you don't have it)</h4>
                    <p className="text-muted-foreground mb-2 text-xs">
                      <strong>First, check if you already have Node.js:</strong> Open a terminal/command prompt and type <code className="bg-secondary px-1 rounded text-foreground">node --version</code>. If you see a version number, skip this step!
                    </p>
                    <p className="text-muted-foreground mb-2 text-xs">
                      If you don't have Node.js:
                    </p>
                    <p className="text-muted-foreground mb-2 text-xs">
                      1. Go to <a href="https://nodejs.org" target="_blank" rel="noopener noreferrer" className="text-primary underline">nodejs.org</a>
                    </p>
                    <p className="text-muted-foreground mb-2 text-xs">
                      2. Download the "LTS" version (the green button)
                    </p>
                    <p className="text-muted-foreground text-xs">
                      3. Run the installer and follow the prompts (just click "Next" on everything)
                    </p>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2 text-primary">Step 3: Install Wrangler (the Cloudflare tool)</h4>
                    <p className="text-muted-foreground mb-2 text-xs">
                      <strong>Open a terminal/command prompt:</strong>
                    </p>
                    <ul className="text-muted-foreground mb-2 text-xs list-disc list-inside space-y-1">
                      <li>On Windows: Press Windows key, type "cmd", press Enter</li>
                      <li>On Mac: Press Cmd+Space, type "Terminal", press Enter</li>
                      <li>On Linux: Press Ctrl+Alt+T</li>
                    </ul>
                    <p className="text-muted-foreground mb-2 text-xs">
                      <strong>Then copy and paste this command and press Enter:</strong>
                    </p>
                    <div className="bg-secondary/50 p-3 rounded border border-border font-mono text-xs overflow-x-auto text-foreground">
                      npm install -g wrangler
                    </div>
                    <p className="text-muted-foreground mt-2 text-xs">
                      Wait for it to finish (it might take a minute). You'll see a bunch of text scrolling - that's normal!
                    </p>
                    <p className="text-muted-foreground mt-2 text-xs">
                      <strong>After it finishes, run these two commands one at a time:</strong>
                    </p>
                    <div className="bg-secondary/50 p-3 rounded border border-border font-mono text-xs overflow-x-auto text-foreground mt-1">
                      <div className="mb-1">npm config get prefix</div>
                      <div className="text-muted-foreground"># Copy the path that appears, then run:</div>
                      <div>cd [paste the path here]</div>
                    </div>
                    <p className="text-muted-foreground mt-2 text-xs">
                      <em>Note: Replace "[paste the path here]" with the actual path that appeared from the first command</em>
                    </p>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2 text-primary">Step 4: Connect Wrangler to Your Cloudflare Account</h4>
                    <p className="text-muted-foreground mb-2 text-xs">
                      In the same terminal/command prompt, type this command and press Enter:
                    </p>
                    <div className="bg-secondary/50 p-3 rounded border border-border font-mono text-xs overflow-x-auto text-foreground">
                      wrangler login
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      This will open your web browser. Log in with the Cloudflare account you created in Step 1. Once you're logged in, you can close the browser tab and go back to the terminal.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2 text-primary">Step 5: Get Your Neon Connection String</h4>
                    <p className="text-muted-foreground mb-2 text-xs">
                      <strong>If you already have a Neon database:</strong>
                    </p>
                    <ol className="text-muted-foreground mb-2 text-xs list-decimal list-inside space-y-1">
                      <li>Go to <a href="https://console.neon.tech" target="_blank" rel="noopener noreferrer" className="text-primary underline">console.neon.tech</a> and log in</li>
                      <li>Select your project (or create a new one if needed)</li>
                      <li>Click on your database</li>
                      <li>Go to "Connection Details" or "Connection String"</li>
                      <li>Copy the connection string (it starts with <code className="bg-secondary px-1 rounded text-foreground">postgresql://</code>)</li>
                      <li><strong>Save this connection string</strong> - you'll need it in Step 7</li>
                    </ol>
                    <p className="text-muted-foreground mb-2 text-xs mt-2">
                      <strong>If you need to create a new Neon database:</strong>
                    </p>
                    <ol className="text-muted-foreground mb-2 text-xs list-decimal list-inside space-y-1">
                      <li>Go to <a href="https://console.neon.tech" target="_blank" rel="noopener noreferrer" className="text-primary underline">console.neon.tech</a> and sign up (free tier available)</li>
                      <li>Create a new project</li>
                      <li>Create a new database (or use the default one)</li>
                      <li>Copy the connection string from the dashboard</li>
                    </ol>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2 text-primary">Step 6: Create R2 Bucket for Caching</h4>
                    <p className="text-muted-foreground mb-2 text-xs">
                      R2 is used to cache query results for faster performance. Create a bucket:
                    </p>
                    <ol className="text-muted-foreground mb-2 text-xs list-decimal list-inside space-y-1">
                      <li>Go to <a href="https://dash.cloudflare.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">dash.cloudflare.com</a></li>
                      <li>Click "R2" in the left menu</li>
                      <li>Click "Create bucket"</li>
                      <li>Name it something like <code className="bg-secondary px-1 rounded text-foreground">volleyball-cache</code></li>
                      <li>Click "Create bucket"</li>
                      <li><strong>Remember the bucket name</strong> - you'll need it in Step 7</li>
                    </ol>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2 text-primary">Step 7: Configure Your Connection in Cloudflare</h4>
                    <p className="text-muted-foreground mb-2 text-xs">
                      <strong>This is where you configure your Neon connection string.</strong> It's stored securely in Cloudflare (not in this app), and the app uses it automatically.
                    </p>
                    <p className="text-muted-foreground mb-2 text-xs">
                      <strong>Option A: Connect Through Cloudflare Dashboard (Recommended)</strong>
                    </p>
                    <ol className="text-muted-foreground mb-2 text-xs list-decimal list-inside space-y-1">
                      <li>Go to your <a href="https://dash.cloudflare.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">Cloudflare Dashboard</a></li>
                      <li>Click on "Workers & Pages" in the left menu</li>
                      <li>Find this website in your list (or create a new Pages project if you're deploying your own copy)</li>
                      <li>Click on your project → Go to "Settings" → "Functions"</li>
                      <li>Scroll down to "R2 Bucket Bindings"</li>
                      <li>Click "Add binding"</li>
                      <li>Set the "Variable name" to: <code className="bg-secondary px-1 rounded text-foreground">R2_BUCKET</code></li>
                      <li>Select your R2 bucket from the dropdown (the one you created in Step 6)</li>
                      <li>Click "Save"</li>
                      <li>Now scroll down to "Environment Variables" section</li>
                      <li>Click "Add variable"</li>
                      <li>Set the "Variable name" to: <code className="bg-secondary px-1 rounded text-foreground">NEON_CONNECTION_STRING</code></li>
                      <li><strong>Paste your Neon connection string here</strong> (the one you copied from Step 5 - it looks like <code className="bg-secondary px-1 rounded text-foreground">postgresql://user:password@host/database?sslmode=require</code>)</li>
                      <li>Click "Save" - Cloudflare will automatically redeploy your site</li>
                      <li><strong>That's it!</strong> The connection string is now configured. Come back to this app and click "Test Database Connection" to verify it works.</li>
                    </ol>
                    <p className="text-muted-foreground mb-2 text-xs">
                      <strong>Option B: Using Wrangler CLI (If you have project files)</strong>
                    </p>
                    <p className="text-muted-foreground mb-2 text-xs">
                      If you have access to the project files, you can set the secret using Wrangler:
                    </p>
                    <div className="bg-secondary/50 p-3 rounded border border-border font-mono text-xs overflow-x-auto text-foreground">
                      wrangler secret put NEON_CONNECTION_STRING
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      When prompted, paste your Neon connection string and press Enter.
                    </p>
                    <p className="text-muted-foreground mb-2 text-xs mt-2">
                      <strong>Important Note:</strong> The connection string is configured in Cloudflare Dashboard (server-side), not in this app's UI. This keeps your database credentials secure. Once configured in Cloudflare, the app will automatically use it when you click "Test Database Connection".
                    </p>
                    <p className="text-muted-foreground mb-2 text-xs">
                      <strong>Alternative:</strong> You can always use CSV files instead! Just upload your CSV files using the "Upload CSV" button below - no database setup needed.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2 text-primary">Step 8: Connect to Your Existing Tables</h4>
                    <p className="text-muted-foreground mb-2 text-xs">
                      <strong>After configuring the connection above:</strong>
                    </p>
                    <ol className="text-muted-foreground mb-2 text-xs list-decimal list-inside space-y-1">
                      <li>Click "Connect to Database" button above to test the connection</li>
                      <li>If successful, click "Load Available Tables" in the "Connected Database Tables" section</li>
                      <li>Select the tables you want to use from the list</li>
                      <li>Selected tables will appear in the "Select data sources" dropdown when chatting</li>
                    </ol>
                    <p className="text-muted-foreground mb-2 text-xs mt-2">
                      <strong>Your existing tables are now ready to use!</strong> They'll appear alongside your CSV files in the data selector.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2 text-primary">Optional: Import CSV Data to Neon</h4>
                    <p className="text-muted-foreground mb-2 text-xs">
                      <strong>If you want to import CSV data into your Neon database:</strong>
                    </p>
                    <p className="text-muted-foreground mb-2 text-xs">
                      <strong>Option A: Using Neon's SQL Editor (Easiest)</strong>
                    </p>
                    <ol className="text-muted-foreground mb-2 text-xs list-decimal list-inside space-y-1">
                      <li>Go to <a href="https://console.neon.tech" target="_blank" rel="noopener noreferrer" className="text-primary underline">console.neon.tech</a></li>
                      <li>Select your project and database</li>
                      <li>Click "SQL Editor" in the left menu</li>
                      <li>Use the "Import" feature or paste SQL commands to create tables</li>
                      <li>Or use a CSV import tool that supports PostgreSQL</li>
                    </ol>
                    <p className="text-muted-foreground mb-2 text-xs">
                      <strong>Option B: Using psql (Command Line)</strong>
                    </p>
                    <p className="text-muted-foreground mb-2 text-xs">
                      If you have <code className="bg-secondary px-1 rounded text-foreground">psql</code> installed, you can import CSV directly:
                    </p>
                    <div className="bg-secondary/50 p-3 rounded border border-border font-mono text-xs overflow-x-auto text-foreground">
                      psql "your-neon-connection-string" -c "\COPY table_name FROM 'file.csv' WITH CSV HEADER;"
                    </div>
                    <p className="text-muted-foreground mb-2 text-xs mt-2">
                      <strong>Option C: Use CSV Files Directly (No Import Needed)</strong>
                    </p>
                    <p className="text-muted-foreground mb-2 text-xs">
                      You can also just upload CSV files directly in this app - no database import needed! Use the "Upload CSV" button below.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2 text-primary">Step 9: Test Your Connection</h4>
                    <p className="text-muted-foreground mb-2 text-xs">
                      Click the <strong>"Connect to Database"</strong> button above to test the connection from this app. The app will query your Neon database through the R2 + Workers layer.
                    </p>
                    <p className="text-muted-foreground mb-2 text-xs">
                      <strong>How it works:</strong> When you click "Connect", the app sends a request to the Workers function, which:
                    </p>
                    <ol className="text-muted-foreground mb-2 text-xs list-decimal list-inside space-y-1">
                      <li>Checks R2 cache first (fast!)</li>
                      <li>If not cached, queries your Neon Postgres database</li>
                      <li>Stores the result in R2 for future requests</li>
                      <li>Returns the data to the app</li>
                    </ol>
                    <p className="text-muted-foreground mt-2 text-xs">
                      If the connection succeeds, you'll see your matches loaded. If it fails, check that your R2 bucket and Neon connection string are configured correctly.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2 text-primary">Step 10: Deploy Your App (Optional - for making it live online)</h4>
                    <p className="text-muted-foreground mb-2 text-xs">
                      If you want to put your app online so others can use it:
                    </p>
                    <ol className="text-muted-foreground mb-2 text-xs list-decimal list-inside space-y-1">
                      <li>Create a free account on <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">GitHub.com</a></li>
                      <li>Upload your code to GitHub (they have instructions on their website)</li>
                      <li>Go to your Cloudflare Dashboard → Click "Pages" → Click "Create a project"</li>
                      <li>Connect your GitHub account and select your project</li>
                      <li>Set "Build command" to: <code className="bg-secondary px-1 rounded text-foreground">npm run build</code></li>
                      <li>Set "Output directory" to: <code className="bg-secondary px-1 rounded text-foreground">dist</code></li>
                      <li>Click "Save and Deploy" - Cloudflare will automatically connect your database!</li>
                    </ol>
                  </div>

                  <div className="pt-2 border-t border-border">
                    <p className="text-xs text-muted-foreground">
                      <strong>Need Help?</strong> If you get stuck, search online for "Cloudflare R2 setup" or "Neon Postgres connection string". The free tiers are generous: R2 gives you 10GB storage, and Neon gives you a free Postgres database.
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      <strong>Benefits of this setup:</strong> Fast queries (R2 cache), scalable (Workers handle traffic), and you keep using your existing Neon Postgres database. R2 acts as a smart cache layer!
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Connected Tables */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">Connected Database Tables</label>
            <p className="text-sm text-muted-foreground mb-3">
              Select tables from your database to use in the app. These will appear alongside your CSV files.
            </p>
            
            {/* Connected tables list */}
            {connectedTables.length > 0 && (
              <div className="mb-3 space-y-2">
                {connectedTables.map((table) => (
                  <div key={table} className="flex items-center justify-between p-2 bg-accent/50 border border-border rounded">
                    <span className="text-sm font-mono">{table}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveTable(table)}
                      className="h-6 w-6 p-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Add table dropdown */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={loadAvailableTables}
                disabled={isLoadingTables}
              >
                {isLoadingTables ? "Loading..." : "Load Available Tables"}
              </Button>
            </div>

            {/* Available tables list */}
            {availableTables.length > 0 && (
              <div className="mt-3 p-3 bg-background border border-border rounded max-h-48 overflow-y-auto">
                <p className="text-xs text-muted-foreground mb-2">Click a table to add it:</p>
                <div className="space-y-1">
                  {availableTables
                    .filter(table => !connectedTables.includes(table))
                    .map((table) => (
                      <button
                        key={table}
                        onClick={() => handleAddTable(table)}
                        className="w-full text-left p-2 text-sm hover:bg-accent rounded border border-border"
                      >
                        <Plus className="h-3 w-3 inline mr-2" />
                        {table}
                      </button>
                    ))}
                </div>
                {availableTables.filter(table => !connectedTables.includes(table)).length === 0 && (
                  <p className="text-xs text-muted-foreground">All available tables are connected.</p>
                )}
              </div>
            )}

            {/* Legacy single table name input (for backward compatibility) */}
            <div className="mt-4 pt-4 border-t border-border">
              <label className="block text-sm font-medium mb-2">Legacy: Single Table Name</label>
              <div className="flex gap-2">
                <Input
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  placeholder="combined_dvw"
                />
                <Button onClick={handleSaveTableName}>Save</Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                This is for backward compatibility. Use "Connected Database Tables" above for multiple tables.
              </p>
            </div>
          </div>

          {/* CSV Files */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium">CSV Files</label>
              <div className="flex items-center gap-4">
                {storageInfo && (
                  <div className="text-xs text-muted-foreground">
                    <span className={storageInfo.percentage > 0.9 ? "text-destructive" : storageInfo.percentage > 0.7 ? "text-yellow-500" : ""}>
                      {formatBytes(storageInfo.used)} / {formatBytes(storageInfo.quota)} 
                      {storageInfo.quota > 0 && ` (${Math.round(storageInfo.percentage * 100)}%)`}
                    </span>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleMigrateToIndexedDB}
                    disabled={isMigrating}
                    title="Migrate all CSV data to IndexedDB for larger storage capacity"
                  >
                    {isMigrating ? "Migrating..." : "Migrate to IndexedDB"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAnalyzeStorage}
                    disabled={isAnalyzing}
                    title="Analyze storage and manage duplicates"
                  >
                    {isAnalyzing ? "Analyzing..." : "Manage Storage"}
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mb-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" />
                Upload CSV
              </Button>
            </div>
            <div className="space-y-2">
              {csvFiles.map((file) => (
                <div key={file.id} className="flex items-center justify-between p-2 bg-accent rounded">
                  <div className="flex items-center">
                    <FileText className="h-4 w-4 mr-2" />
                    <span>{file.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">({file.rowCount ?? file.data?.length ?? 0} rows)</span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleDeleteCsvFile(file.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Storage Management */}
          {showStorageManagement && storageAnalysis && (
            <div className="mb-6 border border-border rounded-lg p-4 bg-accent/30">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Storage Management</h3>
                <Button variant="ghost" size="sm" onClick={() => setShowStorageManagement(false)}>
                  Close
                </Button>
              </div>

              <div className="mb-4 p-3 bg-background rounded">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Potential Duplicates:</span>
                    <span className="ml-2 font-medium">{storageAnalysis.totalDuplicates}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Orphaned Data:</span>
                    <span className="ml-2 font-medium">{storageAnalysis.orphanedData.length}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Value Info Duplicates:</span>
                    <span className="ml-2 font-medium">{storageAnalysis.valueInfoDuplicates}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Estimated Space:</span>
                    <span className="ml-2 font-medium">{formatBytes(storageAnalysis.estimatedFreedSpace)}</span>
                  </div>
                </div>
              </div>

              {/* CSV Files with Duplicates */}
              {storageAnalysis.csvFiles.some((f: any) => f.isDuplicate) && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium mb-2">CSV Files with Potential Duplicates</h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto border border-border rounded p-2">
                    {storageAnalysis.csvFiles
                      .filter((f: any) => f.isDuplicate)
                      .map((item: any) => {
                        const group = item.duplicateGroup || [];
                        const isSelected = selectedCsvFilesToRemove.has(item.file.id);
                        return (
                          <div key={item.file.id} className="p-2 bg-background rounded">
                            <div className="flex items-center gap-2 mb-1">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  const newSet = new Set(selectedCsvFilesToRemove);
                                  if (e.target.checked) {
                                    // Select all duplicates except the first (newest)
                                    const sorted = [...group].sort((a: any, b: any) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
                                    sorted.slice(1).forEach((f: any) => newSet.add(f.id));
                                  } else {
                                    group.forEach((f: any) => newSet.delete(f.id));
                                  }
                                  setSelectedCsvFilesToRemove(newSet);
                                }}
                              />
                              <FileText className="h-4 w-4" />
                              <span className="font-medium">{item.file.name}</span>
                              <span className="text-xs text-muted-foreground">
                                ({group.length} copies, {item.file.rowCount || 0} rows)
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground ml-6">
                              {group.length > 1 && (
                                <div>
                                  Keeping: {group.sort((a: any, b: any) => (b.uploadedAt || 0) - (a.uploadedAt || 0))[0].name} (newest)
                                  {group.length > 1 && ` - ${group.length - 1} duplicate(s) can be removed`}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Orphaned Data */}
              {storageAnalysis.orphanedData.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium mb-2">Orphaned Data (No File Entry)</h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto border border-border rounded p-2">
                    {storageAnalysis.orphanedData.map((orphan: any) => {
                      const isSelected = selectedOrphansToRemove.has(orphan.key);
                      return (
                        <div key={orphan.key} className="flex items-center gap-2 p-2 bg-background rounded">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              const newSet = new Set(selectedOrphansToRemove);
                              if (e.target.checked) {
                                newSet.add(orphan.key);
                              } else {
                                newSet.delete(orphan.key);
                              }
                              setSelectedOrphansToRemove(newSet);
                            }}
                          />
                          <span className="text-sm">{orphan.fileId}</span>
                          <span className="text-xs text-muted-foreground ml-auto">{formatBytes(orphan.size)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Value Info Duplicates */}
              {storageAnalysis.valueInfoDuplicates > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium mb-2">Value Info Duplicates</h4>
                  <p className="text-sm text-muted-foreground mb-2">
                    Found {storageAnalysis.valueInfoDuplicates} duplicate value info entries.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      if (confirm("Remove duplicate value info entries? This will keep the first occurrence of each unique entry.")) {
                        try {
                          removeDuplicateValueInfos();
                          alert("Value info duplicates removed.");
                          // Reload value infos
                          const saved = localStorage.getItem("db_value_infos");
                          if (saved) {
                            try {
                              const parsed = JSON.parse(saved);
                              setValueInfos(Array.isArray(parsed) ? parsed : []);
                            } catch (e) {
                              setValueInfos([]);
                            }
                          }
                          await handleAnalyzeStorage();
                        } catch (error) {
                          alert(`Failed to remove duplicates: ${error instanceof Error ? error.message : 'Unknown error'}`);
                        }
                      }
                    }}
                  >
                    Remove Value Info Duplicates
                  </Button>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2 mt-4">
                <Button
                  onClick={handleCleanupSelected}
                  disabled={isCleaning || (selectedCsvFilesToRemove.size === 0 && selectedOrphansToRemove.size === 0)}
                  variant="destructive"
                >
                  {isCleaning ? "Removing..." : `Remove Selected (${selectedCsvFilesToRemove.size + selectedOrphansToRemove.size})`}
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    setSelectedCsvFilesToRemove(new Set());
                    setSelectedOrphansToRemove(new Set());
                    await handleAnalyzeStorage();
                  }}
                >
                  Refresh Analysis
                </Button>
              </div>
            </div>
          )}

          {/* Value Info */}
          <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium">Value Info</label>
              {valueInfos.length > 0 && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => {
                    if (confirm(`Delete all ${valueInfos.length} value info entries? This cannot be undone.`)) {
                      clearAllValueInfos();
                      setValueInfos([]);
                    }
                  }}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Remove All
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              Automatically generated data structure information for matches and CSV files.
            </p>
            <div className="space-y-3 max-h-96 overflow-y-auto border border-border rounded-md p-3">
              {valueInfos.length === 0 ? (
                <p className="text-sm text-muted-foreground">No value info generated yet. Value info is automatically created when you load match data or select a CSV file.</p>
              ) : (
                valueInfos.map((valueInfo) => (
                  <ValueInfoItem 
                    key={`${valueInfo.id}-${valueInfo.type}`} 
                    valueInfo={valueInfo}
                    onDelete={() => {
                      // Reload valueInfos from localStorage
                      const savedValueInfos = localStorage.getItem("db_value_infos");
                      if (savedValueInfos) {
                        try {
                          const parsed = JSON.parse(savedValueInfos);
                          setValueInfos(Array.isArray(parsed) ? parsed : []);
                        } catch (e) {
                          setValueInfos([]);
                        }
                      } else {
                        setValueInfos([]);
                      }
                    }}
                  />
                ))
              )}
            </div>
          </div>

          {/* Coding Rules */}
          <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium">Coding Rules</label>
              <Button variant="outline" size="sm" onClick={handleResetCodingRules}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset to Defaults
              </Button>
            </div>
            <Textarea
              value={codingRules.content}
              onChange={(e) => setCodingRules({ ...codingRules, content: e.target.value })}
              rows={20}
              className="font-mono text-sm"
            />
            <Button onClick={handleSaveCodingRules} className="mt-2">Save Coding Rules</Button>
          </div>

          {/* Context Sections */}
          <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium">Context Sections</label>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleResetContextSections}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reset to Defaults
                </Button>
                <Button variant="outline" size="sm" onClick={handleAddContextSection}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Section
                </Button>
              </div>
            </div>
            <div className="space-y-4">
              {contextSections.map((section) => (
                <div key={section.id} className="border rounded p-4">
                  <div className="flex justify-between items-center mb-2">
                    <Input
                      value={section.title}
                      onChange={(e) => handleUpdateContextSection(section.id, 'title', e.target.value)}
                      placeholder="Section Title"
                      className="max-w-xs"
                    />
                    <Button variant="ghost" size="sm" onClick={() => handleRemoveContextSection(section.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <Textarea
                    value={section.content}
                    onChange={(e) => handleUpdateContextSection(section.id, 'content', e.target.value)}
                    rows={10}
                    placeholder="Section content..."
                  />
                </div>
              ))}
            </div>
            <Button 
              onClick={handleSaveContextSections} 
              className="mt-2"
              disabled={isSavingContextSections}
            >
              {isSavingContextSections ? "Saving..." : "Save Context Sections"}
            </Button>
          </div>

          {!contentOnly && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Close</Button>
            </div>
          )}
        </div>
    </>
  );

  if (contentOnly) {
    return content;
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-chat-bg rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6">
          {content}
        </div>
      </div>
    </div>
  );
};

export default DatabaseSettings;

