import { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { X, Plus, Trash2, Upload, FileText, RotateCcw } from "lucide-react";
import { cleanConnectionString, initVolleyballDB } from "@/lib/database";
import { parseCsvText } from "@/lib/csvUtils";
import { migrateLegacyCsvFile, saveCsvDataText, deleteCsvData } from "@/lib/csvStorage";
import { deleteValueInfo, clearAllValueInfos, removeDuplicateValueInfos } from "@/lib/chatApi";

interface DatabaseSettingsProps {
  isOpen: boolean;
  onClose: () => void;
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

const DatabaseSettings = ({ isOpen, onClose }: DatabaseSettingsProps) => {
  const [connectionString, setConnectionString] = useState("");
  const [tableName, setTableName] = useState("");
  const [contextSections, setContextSections] = useState<ContextSection[]>([]);
  const [codingRules, setCodingRules] = useState<CodingRules>({ id: "coding-rules", content: "" });
  const [csvFiles, setCsvFiles] = useState<CSVFile[]>([]);
  const [valueInfos, setValueInfos] = useState<ValueInfo[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Load settings from localStorage
      const savedConnString = localStorage.getItem("db_connection_string") || localStorage.getItem("neon_connection_string") || "";
      const savedTableName = localStorage.getItem("db_table_name") || "";
      const savedContextSections = localStorage.getItem("db_context_sections");
      const savedCodingRules = localStorage.getItem("db_coding_rules");
      const savedCsvFiles = localStorage.getItem("db_csv_files");

      setConnectionString(savedConnString);
      setTableName(savedTableName);

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

      // Load coding rules
      const defaultCodingRulesText = `CODE EXECUTION (MANDATORY FOR ALL DATA ANALYSIS):

CRITICAL: If the user asks for analysis, statistics, insights, comparisons, or any examination of the data, you MUST use code execution. Do NOT provide direct answers without code - you must query the actual data first.

HOW CODE EXECUTION WORKS (IMPORTANT - UNDERSTAND THIS):
- You provide code in \`\`\`execute format
- The system runs your code and sends you the results in a follow-up message
- You CANNOT see execution results in the same response where you provide code
- After receiving execution results, you can:
  * Provide your analysis if you have enough information
  * OR provide ADDITIONAL code blocks if you need more information
  * You can iterate: Code → Results → More Code → More Results → Analysis

ITERATIVE CODE EXECUTION:
- You can run code MULTIPLE times across multiple responses to gather information iteratively
- Workflow: Provide code → Wait for results → Analyze results → If needed, provide more code → Wait for more results → Continue until complete
- Use iterative execution when you need to:
  * Get preliminary data, then calculate percentages or ratios based on that data
  * Explore data structure first, then query specific fields you discover
  * Get summary statistics, then drill down into specific subsets
  * Calculate intermediate values, then use those in further calculations
- Each code block executes sequentially, and you receive results before providing the next code block
- You can chain code blocks across responses: Run code → Get results → Run more code → Get more results → Provide analysis

WHEN CODE IS REQUIRED (use code for ALL of these):
- Analysis, comprehensive analysis, game analysis, match analysis
- Statistics, calculations, counts, filtering, aggregations
- Comparisons, trends, patterns, insights
- Any question that requires examining actual data values
- Questions about "what happened", "how many", "which", "compare", "analyze"

RESPONSE FORMAT (CRITICAL - FOLLOW EXACTLY):
1. Brief explanation (1-2 sentences MAX) of what you're calculating - NO analysis, NO insights, NO conclusions
2. Code block wrapped in \`\`\`execute format
3. STOP IMMEDIATELY after the code block ends - Do NOT write anything after the closing \`\`\`
4. Do NOT provide any analysis, summary, tables, insights, visualizations, or any other text after the code block
5. After code execution completes, you will receive execution results in a follow-up message
6. ONLY THEN provide your full analysis in natural language, including visualizations if plot data exists
7. If you need more information, you can provide ADDITIONAL code blocks in the follow-up response

FIRST RESPONSE MUST CONTAIN ONLY:
- 1-2 sentence brief explanation (WHAT you're calculating, not WHY or what it means)
- Code block(s) in \`\`\`execute format
- NOTHING ELSE - no analysis, no summary, no tables, no insights, no conclusions, no graphs, no text after the code block

CHART DATA FORMAT (when user requests charts/graphs):
- For PIE CHARTS: Return object with pie_data array: { pie_data: [{ label: "Label1", value: 10 }, { label: "Label2", value: 20 }] }
- For LINE PLOTS: Return object with plot_data array: { plot_data: [{ x: 1, y: 10 }, { x: 2, y: 20 }] } OR { x_series: [1, 2, 3], y_series: [10, 20, 30] }
- DO NOT create text-based visualizations - return data structures that the system will automatically render as interactive charts
- The system detects pie_data, plot_data, x_series, and y_series properties and renders charts automatically

CRITICAL: Your response must END with the closing \`\`\` of the code block. Do NOT add any text, analysis, summary, or explanation after the code block. Wait for execution results before providing any analysis.

SMART CODING PRACTICES (universal):
- Always check column names in COLUMN DETAILS - don't assume names
- Query ALL data - use data.filter().length, never estimate or sample
- Use optional chaining (?.) for safety: row?.columnName
- Combine filters properly: data.filter(row => condition1 && condition2 && condition3)
- Return proper chart data structures (pie_data, plot_data) - don't create text charts
- Inspect structure first: Object.keys(data[0]) to see available columns

AVAILABLE VARIABLES:
- data: array of all data rows (if match/table data loaded)
- csvData: array of all CSV rows (if CSV file selected)
- matchInfo: metadata object (if available)
- summary: pre-computed statistics (if available)

DATA STRUCTURE & FLEXIBILITY:
- Inspect data structure first: Object.keys(data[0]) or Object.keys(csvData[0]) to see available columns
- Check data[0] or csvData[0] to understand field names, types, and formats
- Adapt your queries to the actual column names in the data (column names vary by dataset)
- Use sample values to understand data types and write accurate filters
- Be flexible - column names and structures differ across datasets

CRITICAL REQUIREMENTS:
- Query ALL rows - never sample or estimate
- Always check for null/undefined: row && row.fieldName or row?.fieldName
- Write complete code blocks with return statements
- Return concise results: For simple questions, return just the number or a simple object
- Only return full data arrays when user explicitly asks for "all rows", "examples", or "details"

RETURN FORMAT EXAMPLES:
- "How many X?": return { total: 77 } or return 77
- "X by category?": return { categoryA: 37, categoryB: 40, total: 77 }
- DO NOT return full arrays unless user asks for details/examples

QUERY PATTERNS (these are just examples - you can adapt and use any JavaScript patterns):
- Filter: data.filter(row => row && row.fieldName === value)
- Text search: data.filter(row => row && row.field?.includes("text"))
- Extract: data.map(row => row ? row.fieldName : null)
- Aggregate: data.reduce((acc, row) => acc + (row?.numericField || 0), 0)
- Inspect: Object.keys(data[0]) // Get column names
- Group by: Use reduce or Map to group data by field values
- Sort: data.sort((a, b) => a.field - b.field)
- Find: data.find(row => row.field === value)
- Some/Every: data.some(row => condition) or data.every(row => condition)
- You can combine these, or use different coding - these are just starting points

NULL SAFETY:
- Always check: row && row.fieldName
- Use optional chaining: row?.fieldName
- Filter nulls first: data.filter(row => row !== null && row !== undefined)
- Default values: row?.fieldName || defaultValue

Always query ALL rows - never sample or estimate.`;

      if (savedCodingRules) {
        try {
          const parsed = JSON.parse(savedCodingRules);
          const rulesContent = parsed.id ? parsed.content : (typeof parsed === 'string' ? parsed : parsed);
          if (rulesContent && typeof rulesContent === 'string' && rulesContent.trim()) {
            setCodingRules(parsed.id ? parsed : { id: "coding-rules", content: rulesContent });
          } else {
            setCodingRules({ id: "coding-rules", content: defaultCodingRulesText });
          }
        } catch (e) {
          setCodingRules({ id: "coding-rules", content: defaultCodingRulesText });
        }
      } else {
        setCodingRules({ id: "coding-rules", content: defaultCodingRulesText });
      }

      // Load CSV files
      if (savedCsvFiles) {
        try {
          const parsed = JSON.parse(savedCsvFiles);
          if (Array.isArray(parsed)) {
            let needsSave = false;
            const cleanedFilesPromises = parsed.map(async (file: CSVFile | null) => {
              if (!file) return null;
              const { updatedFile, migrated } = await migrateLegacyCsvFile(file);
              if (migrated) needsSave = true;
              if (!updatedFile.rowCount && Array.isArray(file.data)) {
                updatedFile.rowCount = file.data.length;
              }
              return updatedFile;
            });
            Promise.all(cleanedFilesPromises).then(cleanedFiles => {
              const filtered = cleanedFiles.filter(Boolean) as CSVFile[];
              if (needsSave) {
                localStorage.setItem("db_csv_files", JSON.stringify(filtered));
              }
              setCsvFiles(filtered);
            }).catch(e => {
              console.error("Error migrating CSV files:", e);
              // Fallback to non-migrated files
              const filtered = parsed.filter((f: any) => f !== null) as CSVFile[];
              setCsvFiles(filtered);
            });
          } else {
            setCsvFiles([]);
          }
        } catch (e) {
          console.error("Error loading CSV files:", e);
          setCsvFiles([]);
        }
      } else {
        setCsvFiles([]);
      }

      // Load value infos
      loadValueInfos();
    }
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
    try {
      const cleaned = connectionString.trim() ? cleanConnectionString(connectionString) : "";
      localStorage.setItem("db_connection_string", cleaned);
      localStorage.setItem("neon_connection_string", cleaned); // Also save to old key
      setConnectionString(cleaned);
      
      // Initialize database connection if connection string is provided
      if (cleaned) {
        try {
          await initVolleyballDB();
          // Dispatch event to notify components of database update
          window.dispatchEvent(new Event('databaseUpdated'));
        } catch (dbError) {
          console.error('Error initializing database:', dbError);
          alert("Connection string saved, but database initialization failed. Please check your connection string.");
          return;
        }
      } else {
        // If connection string is cleared, dispatch event to notify components
        window.dispatchEvent(new Event('databaseUpdated'));
      }
      
      alert("Connection string saved successfully!");
    } catch (error) {
      alert(`Error saving connection string: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleSaveTableName = () => {
    localStorage.setItem("db_table_name", tableName.trim());
    // Dispatch event to notify components of database update
    window.dispatchEvent(new Event('databaseUpdated'));
    alert("Table name saved successfully!");
  };

  const handleSaveContextSections = () => {
    localStorage.setItem("db_context_sections", JSON.stringify(contextSections));
    // Dispatch custom event to notify other components
    window.dispatchEvent(new Event('contextSectionsUpdated'));
    alert("Context sections saved successfully!");
  };

  const handleSaveCodingRules = () => {
    localStorage.setItem("db_coding_rules", JSON.stringify(codingRules));
    alert("Coding rules saved successfully!");
  };

  const handleResetContextSections = () => {
    if (confirm("Reset context sections to defaults? This will replace your current context sections with the default volleyball context.")) {
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

      const defaultSections = [{ 
        id: Date.now().toString(), 
        title: "Volleyball Context", 
        content: defaultContext 
      }];

      setContextSections(defaultSections);
      localStorage.setItem("db_context_sections", JSON.stringify(defaultSections));
      alert("Context sections reset to defaults!");
    }
  };

  const handleResetCodingRules = () => {
    if (confirm("Reset coding rules to defaults? This will replace your current coding rules with the default universal code execution instructions.")) {
      const defaultCodingRulesText = `CODE EXECUTION (MANDATORY FOR ALL DATA ANALYSIS):

CRITICAL: If the user asks for analysis, statistics, insights, comparisons, or any examination of the data, you MUST use code execution. Do NOT provide direct answers without code - you must query the actual data first.

HOW CODE EXECUTION WORKS (IMPORTANT - UNDERSTAND THIS):
- You provide code in \`\`\`execute format
- The system runs your code and sends you the results in a follow-up message
- You CANNOT see execution results in the same response where you provide code
- After receiving execution results, you can:
  * Provide your analysis if you have enough information
  * OR provide ADDITIONAL code blocks if you need more information
  * You can iterate: Code → Results → More Code → More Results → Analysis

ITERATIVE CODE EXECUTION:
- You can run code MULTIPLE times across multiple responses to gather information iteratively
- Workflow: Provide code → Wait for results → Analyze results → If needed, provide more code → Wait for more results → Continue until complete
- Use iterative execution when you need to:
  * Get preliminary data, then calculate percentages or ratios based on that data
  * Explore data structure first, then query specific fields you discover
  * Get summary statistics, then drill down into specific subsets
  * Calculate intermediate values, then use those in further calculations
- Each code block executes sequentially, and you receive results before providing the next code block
- You can chain code blocks across responses: Run code → Get results → Run more code → Get more results → Provide analysis

WHEN CODE IS REQUIRED (use code for ALL of these):
- Analysis, comprehensive analysis, game analysis, match analysis
- Statistics, calculations, counts, filtering, aggregations
- Comparisons, trends, patterns, insights
- Any question that requires examining actual data values
- Questions about "what happened", "how many", "which", "compare", "analyze"

RESPONSE FORMAT (CRITICAL - FOLLOW EXACTLY):
1. Brief explanation (1-2 sentences MAX) of what you're calculating - NO analysis, NO insights, NO conclusions
2. Code block wrapped in \`\`\`execute format
3. STOP IMMEDIATELY after the code block ends - Do NOT write anything after the closing \`\`\`
4. Do NOT provide any analysis, summary, tables, insights, visualizations, or any other text after the code block
5. After code execution completes, you will receive execution results in a follow-up message
6. ONLY THEN provide your full analysis in natural language, including visualizations if plot data exists
7. If you need more information, you can provide ADDITIONAL code blocks in the follow-up response

FIRST RESPONSE MUST CONTAIN ONLY:
- 1-2 sentence brief explanation (WHAT you're calculating, not WHY or what it means)
- Code block(s) in \`\`\`execute format
- NOTHING ELSE - no analysis, no summary, no tables, no insights, no conclusions, no graphs, no text after the code block

CHART DATA FORMAT (when user requests charts/graphs):
- For PIE CHARTS: Return object with pie_data array: { pie_data: [{ label: "Label1", value: 10 }, { label: "Label2", value: 20 }] }
- For LINE PLOTS: Return object with plot_data array: { plot_data: [{ x: 1, y: 10 }, { x: 2, y: 20 }] } OR { x_series: [1, 2, 3], y_series: [10, 20, 30] }
- DO NOT create text-based visualizations - return data structures that the system will automatically render as interactive charts
- The system detects pie_data, plot_data, x_series, and y_series properties and renders charts automatically

CRITICAL: Your response must END with the closing \`\`\` of the code block. Do NOT add any text, analysis, summary, or explanation after the code block. Wait for execution results before providing any analysis.

SMART CODING PRACTICES (universal):
- Always check column names in COLUMN DETAILS - don't assume names
- Query ALL data - use data.filter().length, never estimate or sample
- Use optional chaining (?.) for safety: row?.columnName
- Combine filters properly: data.filter(row => condition1 && condition2 && condition3)
- Return proper chart data structures (pie_data, plot_data) - don't create text charts
- Inspect structure first: Object.keys(data[0]) to see available columns

AVAILABLE VARIABLES:
- data: array of all data rows (if match/table data loaded)
- csvData: array of all CSV rows (if CSV file selected)
- matchInfo: metadata object (if available)
- summary: pre-computed statistics (if available)

DATA STRUCTURE & FLEXIBILITY:
- Inspect data structure first: Object.keys(data[0]) or Object.keys(csvData[0]) to see available columns
- Check data[0] or csvData[0] to understand field names, types, and formats
- Adapt your queries to the actual column names in the data (column names vary by dataset)
- Use sample values to understand data types and write accurate filters
- Be flexible - column names and structures differ across datasets

CRITICAL REQUIREMENTS:
- Query ALL rows - never sample or estimate
- Always check for null/undefined: row && row.fieldName or row?.fieldName
- Write complete code blocks with return statements
- Return concise results: For simple questions, return just the number or a simple object
- Only return full data arrays when user explicitly asks for "all rows", "examples", or "details"

RETURN FORMAT EXAMPLES:
- "How many X?": return { total: 77 } or return 77
- "X by category?": return { categoryA: 37, categoryB: 40, total: 77 }
- DO NOT return full arrays unless user asks for details/examples

QUERY PATTERNS (these are just examples - you can adapt and use any JavaScript patterns):
- Filter: data.filter(row => row && row.fieldName === value)
- Text search: data.filter(row => row && row.field?.includes("text"))
- Extract: data.map(row => row ? row.fieldName : null)
- Aggregate: data.reduce((acc, row) => acc + (row?.numericField || 0), 0)
- Inspect: Object.keys(data[0]) // Get column names
- Group by: Use reduce or Map to group data by field values
- Sort: data.sort((a, b) => a.field - b.field)
- Find: data.find(row => row.field === value)
- Some/Every: data.some(row => condition) or data.every(row => condition)
- You can combine these, or use different coding - these are just starting points

NULL SAFETY:
- Always check: row && row.fieldName
- Use optional chaining: row?.fieldName
- Filter nulls first: data.filter(row => row !== null && row !== undefined)
- Default values: row?.fieldName || defaultValue

Always query ALL rows - never sample or estimate.`;

      const defaultRules = { id: "coding-rules", content: defaultCodingRulesText };
      setCodingRules(defaultRules);
      localStorage.setItem("db_coding_rules", JSON.stringify(defaultRules));
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
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: file.name,
        headers,
        rowCount: data.length,
        uploadedAt: Date.now()
      };

      const updatedFiles = [...csvFiles, csvFile];
      try {
        localStorage.setItem("db_csv_files", JSON.stringify(updatedFiles));
        await saveCsvDataText(csvFile.id, text, data);
        setCsvFiles(updatedFiles);
        alert(`CSV file "${file.name}" uploaded successfully! ${data.length} rows loaded.`);
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

  const handleDeleteCsvFile = async (fileId: string) => {
    if (confirm("Delete this CSV file?")) {
      const updatedFiles = csvFiles.filter(f => f.id !== fileId);
      setCsvFiles(updatedFiles);
      localStorage.setItem("db_csv_files", JSON.stringify(updatedFiles));
      await deleteCsvData(fileId);
    }
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-chat-bg rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold">Database Settings</h2>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Connection String */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">Database Connection String</label>
            <div className="flex gap-2">
              <Input
                value={connectionString}
                onChange={(e) => setConnectionString(e.target.value)}
                placeholder="postgresql://user:password@host/database"
                type="password"
              />
              <Button onClick={handleSaveConnectionString}>Save</Button>
            </div>
          </div>

          {/* Table Name */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">Table Name</label>
            <div className="flex gap-2">
              <Input
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="combined_dvw"
              />
              <Button onClick={handleSaveTableName}>Save</Button>
            </div>
          </div>

          {/* CSV Files */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">CSV Files</label>
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
            <Button onClick={handleSaveContextSections} className="mt-2">Save Context Sections</Button>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Close</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DatabaseSettings;

