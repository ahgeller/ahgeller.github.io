import { Message, MatchData } from "@/types/chat";
import { ValueInfo, ColumnInfo, DataInfo, CsvFile } from "@/types/valueInfo";
import { callApi } from "./apiProviders";
import { modelHasApiKey } from "./apiKeys";
import { CodeExecutor, CodeBlock, ExecutionResult } from "./codeExecutorV2";
import { getCsvDataRows } from "@/lib/csvStorage";
import {
  getCsvFileNames,
  hasCsvFilters,
  hasMatchFilters,
  hasValueInfoForCsvs,
  getCurrentSelectionValueInfo,
  belongsToCurrentChat,
  matchesCurrentSelection,
  getCsvFilesFromStorageSync
} from "./chatApiHelpers";
import { loadCsvDataWithValueInfo, getCurrentSelectionData } from "./csvDataLoader";

// Debug flag - set to false in production to reduce console noise

import { getAvailableModelsFormat } from "./openRouterModels";

// Track follow-up responses to detect infinite loops
const followUpResponseHistory = new Map<string, Set<string>>();

// Track consecutive failures per chat to detect persistent errors
const consecutiveFailureCount = new Map<string, number>();

// Helper functions for consecutive failure tracking
function incrementFailureCount(chatId: string): number {
  const current = consecutiveFailureCount.get(chatId) || 0;
  const newCount = current + 1;
  consecutiveFailureCount.set(chatId, newCount);
  return newCount;
}

function resetFailureCount(chatId: string): void {
  consecutiveFailureCount.set(chatId, 0);
}

// Clear failure count for a chat (call when chat is cleared or completed)
export function clearFailureCount(chatId: string) {
  consecutiveFailureCount.delete(chatId);
}

// Hash function for detecting similar responses using Web Crypto API
async function hashResponse(content: string): Promise<string> {
  // Normalize response more aggressively to catch similar patterns
  const normalized = content
    .replace(/\s+/g, ' ')           // Collapse all whitespace
    .replace(/\d+/g, 'N')           // Replace numbers with N
    .replace(/```[\s\S]*?```/g, '[CODE]')  // Replace code blocks with marker
    .replace(/["'][^"']{20,}["']/g, '[STR]')  // Replace long strings
    .toLowerCase()                  // Case insensitive
    .trim();

  // Use Web Crypto API for proper SHA-256 hashing
  const msgBuffer = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

// Check if we're in an infinite loop
async function isInfiniteLoop(chatId: string, responseContent: string): Promise<boolean> {
  if (!followUpResponseHistory.has(chatId)) {
    followUpResponseHistory.set(chatId, new Set());
  }

  const history = followUpResponseHistory.get(chatId)!;
  const hash = await hashResponse(responseContent);

  // If we've seen this response pattern before, it's likely a loop
  if (history.has(hash)) {
    return true;
  }

  // CRITICAL: If we've seen too many followups in this chat (>8), it's likely a loop
  // This is an absolute safety limit regardless of maxFollowupDepth setting
  if (history.size >= 8) {
    return true;
  }

  // Track this response
  history.add(hash);

  // Clean up old responses if we have too many (keep last 10)
  if (history.size > 10) {
    const firstKey = history.values().next().value;
    if (firstKey !== undefined) {
      history.delete(firstKey);
    }
  }

  return false;
}

// Clear follow-up history for a chat (call when chat is cleared or completed)
export function clearFollowUpHistory(chatId: string) {
  followUpResponseHistory.delete(chatId);
  clearFailureCount(chatId);
}

// Generate COMPACT column info string - optimized for clarity and tokens
// NOTE: This shows SAMPLED unique values from valueInfo (max 20), not all unique values in dataset
function generateColumnInfoString(columns: ColumnInfo[], _totalRowCount?: number): string {
  // Removed sample values to save tokens - AI can query if needed
  return columns.filter(col => col.name !== '__index').map((col) => {
    const uniqueCount = col.uniqueValues?.length || 0;
    const typeInfo = `${col.type}${uniqueCount > 0 ? `, ${uniqueCount} sampled unique` : ''}`;
    const nullInfo = (col.nullCount ?? 0) > 0 ? ` | ${col.nullCount} null` : '';
    return `${col.name} (${typeInfo})${nullInfo}`;
  }).join('\n');
}

// Generate efficient column summary - scans more rows to get accurate unique counts
function generateCompactColumnInfo(csvData: any[]): string {
  if (!csvData || csvData.length === 0) return '';
  
  const sampleRow = csvData[0];
  const columnNames = Object.keys(sampleRow).filter(col => col !== '__index'); // Exclude __index from column inspection
  const totalRows = csvData.length;
  const sampleSize = Math.min(1000, totalRows); // Sample up to 1000 rows for accurate counts
  
  return columnNames.map(colName => {
    // OPTIMIZED: Single pass - collect unique values, nulls, and type in one loop
    const uniqueSet = new Set();
    let nullCount = 0;
    let sampleType = 'unknown';
    
    for (let i = 0; i < sampleSize; i++) {
      const value = csvData[i][colName];
      if (value === null || value === undefined || value === '') {
        nullCount++;
      } else {
        if (sampleType === 'unknown') {
          sampleType = typeof value;
        }
        uniqueSet.add(value);
      }
    }
    
    const uniqueValues = Array.from(uniqueSet);

    // Removed sample values to save tokens - just show type and count
    const uniqueInfo = uniqueValues.length;
    const typeInfo = `${sampleType}, ${uniqueInfo}${uniqueInfo >= sampleSize ? '+' : ''} unique`;
    const nullInfo = nullCount > 0 ? ` | ${nullCount} null` : '';

    return `${colName} (${typeInfo})${nullInfo}`;
  }).join('\n');
}

// Get default model from storage, or return empty string
export async function getDefaultModel(): Promise<string> {
  try {
    const { getDefaultModelId } = await import("./openRouterModels");
    return getDefaultModelId() || "";
  } catch (error) {
    console.error('Error getting default model:', error);
    return "";
  }
}

export const DEFAULT_MODEL = ""; // Fallback - will be loaded from storage

// Available AI models via OpenRouter (loaded dynamically from storage)
export const AVAILABLE_MODELS = getAvailableModelsFormat();

// Helper function to load coding rules from localStorage
function getCodingRules(): string {
  const RULES_VERSION = "2.3"; // Increment this when rules change significantly
  
  try {
    const saved = localStorage.getItem("db_coding_rules");
    const savedVersion = localStorage.getItem("db_coding_rules_version");
    
    // If version doesn't match, clear cached rules to get new defaults
    if (savedVersion !== RULES_VERSION) {
      localStorage.removeItem("db_coding_rules");
      localStorage.setItem("db_coding_rules_version", RULES_VERSION);
      return getDefaultCodingRules();
    }
    
    if (saved) {
      const parsed = JSON.parse(saved);
      const rulesContent = parsed.id ? parsed.content : (typeof parsed === 'string' ? parsed : parsed);
      if (rulesContent && typeof rulesContent === 'string' && rulesContent.trim()) {
        return rulesContent;
      }
    }
  } catch (e) {
    console.error('Error loading coding rules:', e);
  }
  
  return getDefaultCodingRules();
}

export function getDefaultCodingRules(isDatabaseTable: boolean = false): string {

  const defaultRules = `═══ EXECUTION FLOW ═══
🚨 CRITICAL: If you see "CODE EXECUTION COMPLETE" with results → DO NOT instantly re-plan or re-code → follow followup instructions!

P.S. if you can answer a question without code, answer without code

${isDatabaseTable ? `🚨 DATABASE TABLE MODE: You are working with a database table that has been pre-loaded into memory. DO NOT generate SQL queries. Instead:
- Use JavaScript array methods (filter, map, reduce, etc.) on the 'data' variable
- The data is already in memory - no need to query the database
- Example: const result = data.filter(row => row.team === 'UCSD');
- This prevents excessive database queries` : ''}

1. VERIFY: Check if all steps completed & answer user's question (if not a followup ignore)
2. PLAN: List all steps needed (e.g., "Step 1: Load data, Step 2: Calculate stats, Step 3: Create chart")
3. CODE: Write ALL \`\`\`execute blocks for each step (start each block with //step: N)
4. STOP - wait for results
5. If yes → ANALYZE results; If no → fix errors with more code

🚨 DO NOT analyze dataset before executing code - write code FIRST, STOP, you will get results in next message

⚠️ If results are already provided, just analyze them - don't execute the same code again!

EXAMPLE:
Plan: Step 1: Get top 10 players, Step 2: Chart their scores

\`\`\`execute
//step: 1
const players = await query("SELECT name, score FROM csvData ORDER BY score DESC LIMIT 10");
if (!players || players.length === 0) return { error: "No data" };
return { players };
\`\`\`
\`\`\`execute
//step: 2
return { echarts_chart: { option: { xAxis: { type: 'category', data: players.map(p => p.name) }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: players.map(p => p.score) }] }}};
\`\`\`

═══ VARIABLE PERSISTENCE ═══
🚨 ONLY returned values persist between blocks!
• Object return: return { matchId: '123', count: 5 } → variables available in next block
• Array/primitive return: return [1,2,3] → stored as 'result' variable
• 'result' gets overwritten by each new return - use objects to preserve all values
• Variables clear on new user message

🚨 CRITICAL: JavaScript variables CANNOT be used in DuckDB queries!
❌ const players = await query("SELECT name FROM csvData"); return {players};
   await query("SELECT * FROM players"); // ERROR! players is JS variable, not a table
✅ DuckDB can ONLY query "csvData" table - use JavaScript to filter or recreate the query logic

═══ CODE SYNTAX ═══
• \`\`\`execute blocks - JavaScript ONLY (no Python/pandas/imports)
• Table name ALWAYS "csvData"
• ALWAYS await query() - it's async
• ALWAYS check results before [0] access

✅ const rows = await query("SELECT * FROM csvData LIMIT 5");
   if (!rows || rows.length === 0) return { error: "No data" };
❌ const first = (await query("SELECT * FROM csvData"))[0]; // Crashes if empty!

═══ BUILT-IN VARIABLES ═══
Cannot redeclare: data, csvData, matchInfo, summary, query
❌ const data = await query(...); // ERROR!
✅ const matchData = await query(...); // Different name
✅ data = await query(...); // Or reassign (no const/let)

═══ DuckDB SQL ═══
🚨🚨🚨 CRITICAL: NEVER USE SQL COMMENTS (-- or /* */)! They cause FATAL parsing errors! 🚨🚨🚨
❌ WRONG: SELECT id FROM csvData -- get IDs
❌ WRONG: /* comment */ SELECT id FROM csvData
✅ CORRECT: SELECT id FROM csvData

PostgreSQL-like syntax, table "csvData", case-sensitive columns

🚨 COLUMN NAMES WITH SPACES: Use DOUBLE QUOTES, not backticks!
❌ WRONG: SELECT \`Termination Type\` FROM csvData  (MySQL syntax - will FAIL!)
✅ CORRECT: SELECT "Termination Type" FROM csvData  (DuckDB requires double quotes)
✅ CORRECT: SELECT "Employee Name", "Hire Date" FROM csvData

Functions: MEDIAN(col), QUANTILE(col, 0.5), COALESCE(col, 0), NULLIF(divisor, 0), strptime('2024-01-15', '%Y-%m-%d')
Categorical sorting: Use CASE for bin labels + separate bin_order column, then ORDER BY bin_order

═══ RESULT SIZE ═══
🚨 Large results break context limits!
✅ Use LIMIT: SELECT * FROM csvData LIMIT 100
✅ Use aggregation: COUNT, SUM, AVG, GROUP BY
✅ Sample: ORDER BY RANDOM() LIMIT 1000
❌ const data = await query("SELECT * FROM csvData"); // Could be 100K rows!

═══ CHARTS ═══
Return ECharts config (DO NOT import echarts):
\`\`\`execute
const data = await query("SELECT category, SUM(value) as total FROM csvData GROUP BY category");
return { echarts_chart: { option: { title: { text: 'Title' }, xAxis: { type: 'category', data: data.map(r => r.category) }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: data.map(r => r.total) }] }}};
\`\`\`
⚠️ CRITICAL: The key MUST be exactly "echarts_chart" - NOT "chart", "myChart", "barChart", etc.
Types: bar, line, pie, scatter, heatmap, radar, boxplot, treemap

═══ COMMON ERRORS ═══
"matchId is not defined" → Previous block didn't return it: return { matchId };
"ucsdMatch is not defined" → Variable was defined in previous block but NOT returned. You must return it: return { ucsdMatch, ... };
"Cannot redeclare 'data'" → Use different name: const matchData = ...
"Cannot read property" → Check first: if (!rows || rows.length === 0) return {error};
"attacks.match_id undefined" → attacks is array: attacks[0].match_id
Using vars from prev message → Vars don't persist. Query again.
Chart not displaying → Key must be "echarts_chart": return { echarts_chart: { option: {...} } };
⚠️ CRITICAL: Variables persist ONLY if returned!
- If you define "const x = ..." in block 1, you MUST "return { x, ... }" for block 2 to use it
"syntax error at or near" → Use "double quotes" for columns with spaces, NOT \`backticks\`!

🚨 NO FABRICATED DATA! Query real data, never make up results.

═══ KEY RULES ═══
✅ await query() + check: if (!rows || rows.length === 0)
✅ Return objects: return { matchId, data }
❌ No SQL comments in queries
❌ Don't analyze before seeing results
❌ Don't redeclare built-in vars
❌ No Python syntax`;
  
  return defaultRules;
}

// Helper function to load context sections from localStorage
// If sectionId is provided, return only that section; if "none", return empty string; otherwise combine all sections
export function getContextSections(sectionId?: string | null): string {
  // If "none" is explicitly selected, return empty string (no context sections)
  if (sectionId === "none") {
    return '';
  }
  
  try {
    const saved = localStorage.getItem("db_context_sections");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        if (sectionId && sectionId !== "none") {
          // Return only the specified section
          // Try exact ID match first
          let section = parsed.find((s: any) => s.id === sectionId || s.id?.toString() === sectionId?.toString());
          
          // If not found by ID, try case-insensitive title match as fallback
          if (!section) {
            section = parsed.find((s: any) => s.title?.toLowerCase() === sectionId?.toLowerCase());
          }
          
          if (section) {
            const title = section.title || '';
            const content = section.content || '';
            if (!content || content.trim() === '') {
              return ''; // Return empty if content is empty
            }
            return title ? `=== ${title} ===\n${content}` : content;
          }
          // Fall back to combining all if specified section not found
        }
        
        // Combine all context sections (default behavior or fallback)
        const combined = parsed.map((section: any) => {
          const title = section.title || '';
          const content = section.content || '';
          return title ? `=== ${title} ===\n${content}` : content;
        }).join('\n\n');
        return combined;
      }
    }
  } catch (e) {
    console.error('Error loading context sections:', e);
  }
  
  // Return generic default context if nothing saved (user should configure context sections in settings)
  return `You are an expert data analyst. Analyze data objectively and provide insights based on the actual data structure and values. Use code execution to query and analyze the data.`;
}

/**
 * Get conversation history from LangChain memory or fallback to processed history
 */
async function getConversationHistory(history: Message[], chatId?: string): Promise<Message[]> {
  if (chatId) {
    try {
      const { getOrCreateMemoryManager } = await import('@/lib/memoryStore');
      const memoryManager = getOrCreateMemoryManager(chatId);
      return await memoryManager.getConversationContext();
    } catch (error) {
      // Fallback to old method if LangChain fails
      return processConversationHistory(history);
    }
  }
  // No chatId - use old method
  return processConversationHistory(history);
}

// DEPRECATED: Use LangChain memory instead via getConversationHistory
// This function is kept for backwards compatibility during migration
function processConversationHistory(history: Message[]): Message[] {
  if (history.length === 0) {
    return history;
  }

  const processed: Message[] = [];
  const totalMessages = history.length;

  // ALL messages: Strip code blocks and execution results
  // AI understands what happened from user's text questions and analysis
  const recentMessages = history.slice(-8);
  processed.push(...recentMessages.map(msg => stripCodeAndResults(msg)));

  if (totalMessages > 8 && totalMessages <= 15) {
    // Messages 9-15: Strip code and results
    const middleMessages = history.slice(0, -8);
    processed.unshift(...middleMessages.map(msg => stripCodeAndResults(msg)));
  }

  if (totalMessages > 15) {
    // Messages 9-15: Strip code and results
    const middleMessages = history.slice(-15, -8);
    processed.unshift(...middleMessages.map(msg => stripCodeAndResults(msg)));
    
    // Messages 16+: Keep only key conclusions (coding rules are always in prompt, don't need to preserve)
    const olderMessages = history.slice(0, -15);
    
    // Extract key conclusions from older messages (text only, no code/results)
    const conclusions: string[] = [];
    for (const msg of olderMessages) {
      if (msg.role === 'assistant') {
        const summary = extractKeyConclusions(msg.content || '');
        if (summary) conclusions.push(summary);
      }
    }
    
    // Add compressed summary (coding rules not needed - always in context prompt)
    if (olderMessages.length > 0) {
      let summaryContent = `[Earlier: ${olderMessages.length} messages]`;
      if (conclusions.length > 0) {
        summaryContent += `\n📝 Key findings: ${conclusions.slice(0, 3).join('; ')}`;
      }
      
      const oldSummary: Message = {
        role: 'assistant',
        content: summaryContent,
        timestamp: olderMessages[0].timestamp
      };
      processed.unshift(oldSummary);
    }
  }

  return processed;
}

// Extract code blocks and execution results from message content
// Returns: { codeBlocks: string[], executionResults: string[] }
function extractCodeAndResults(content: string): { codeBlocks: string[]; executionResults: string[] } {
  const codeBlocks: string[] = [];
  const executionResults: string[] = [];
  
  // Extract code blocks
  const codeBlockPattern = /```(?:execute|javascript|js|query|code|python|sql)\s*\n([\s\S]*?)```/gi;
  let match;
  while ((match = codeBlockPattern.exec(content)) !== null) {
    codeBlocks.push(match[0]); // Include the full code block with markers
  }
  
  // Extract execution results
  const resultPattern = /\*\*Code Execution Result\*\*[^`]*```json\s*([\s\S]*?)\s*```/gi;
  while ((match = resultPattern.exec(content)) !== null) {
    executionResults.push(match[0]); // Include the full result block
  }
  
  // Extract execution errors
  const errorPattern = /\*\*Code Execution Error\*\*[^`]*```\s*([\s\S]*?)\s*```/gi;
  while ((match = errorPattern.exec(content)) !== null) {
    executionResults.push(match[0]); // Include the full error block
  }
  
  return { codeBlocks, executionResults };
}

// Strip code blocks and execution results completely from message
// Preserves: User questions, AI text/analysis, coding rules, dataset info
// Removes: ALL code blocks and execution results to save tokens
// AI understands context from user's follow-up questions, not from seeing code/results again
// EXCEPTION: Preserves code/results in follow-up user messages (they need to see what was executed)
function stripCodeAndResults(msg: Message): Message {
  let content = msg.content;
  
  // CRITICAL FIX: Don't strip code/results from follow-up user messages
  // These messages contain the code and results that the AI needs to see
  const isFollowUpMessage = msg.role === 'user' && 
                           (content.includes('Code execution complete') || 
                            content.includes('Code execution completed') ||
                            content.includes('**Code that was executed:**') ||
                            content.includes('**Execution results:**') ||
                            content.includes('**Results:**'));
  
  if (isFollowUpMessage) {
    // Preserve the entire message content for follow-up messages
    return msg;
  }

  // STRIP context sections - they're already in the prompt, no need to save in history
  // This saves significant tokens since context is rebuilt fresh each time
  content = content.replace(/═══ SYSTEM OVERVIEW ═══[\s\S]*?(?=\n\n(?:═══|❓|$))/g, '');
  content = content.replace(/═══ DATA QUERY & CODE EXECUTION RULES ═══[\s\S]*?(?=\n\n(?:═══|❓|$))/g, '');
  content = content.replace(/═══ CODE EXECUTION ═══[\s\S]*?(?=\n\n(?:═══|❓|$))/g, '');
  content = content.replace(/═══ DuckDB SQL ═══[\s\S]*?(?=\n\n(?:═══|❓|$))/g, '');
  content = content.replace(/═══ CHARTS ═══[\s\S]*?(?=\n\n(?:═══|❓|$))/g, '');
  content = content.replace(/═══ ERROR HANDLING ═══[\s\S]*?(?=\n\n(?:═══|❓|$))/g, '');
  content = content.replace(/═══ COMMON MISTAKES ═══[\s\S]*?(?=\n\n(?:═══|❓|$))/g, '');
  content = content.replace(/═══ FORMATTING ═══[\s\S]*?(?=\n\n(?:═══|❓|$))/g, '');
  content = content.replace(/═══ KEY REMINDERS ═══[\s\S]*?(?=\n\n(?:═══|❓|$))/g, '');
  
  // Remove column details sections (already in context prompt)
  content = content.replace(/=== COLUMN DETAILS ===[\s\S]*?(?=\n\n|$)/g, '');
  content = content.replace(/AVAILABLE COLUMNS: [^\n]+/g, '');
  content = content.replace(/═══ CSV DATA[\s\S]*?(?=\n\n(?:═══|❓|$))/g, '');
  content = content.replace(/=== CSV DATA \(FOLLOW-UP\) ===[\s\S]*?(?=\n\n|$)/g, '');
  content = content.replace(/📁 [^\n]+\n📊 TOTAL ROWS:[\s\S]*?(?=\n\n|$)/g, '');

  // Remove ALL code blocks (execute, javascript, python, sql, etc.)
  content = content.replace(/```(?:execute|javascript|js|query|code|python|sql)\s*\n[\s\S]*?```/gi, '');

  // Remove ALL execution results (both successes and errors)
  // AGGRESSIVE: Remove any large JSON blocks (likely execution results)
  // Match execution results with timing info: **Code Execution Result** (94ms):\n```json...
  content = content.replace(/\*\*Code Execution Result\*\*[^`]*?```json\s*[\s\S]*?```/gi, '');
  content = content.replace(/\*\*Code Execution Error\*\*[^`]*?```\s*[\s\S]*?```/gi, '');
  // Also match without timing: **Code Execution Result**:\n```json...
  content = content.replace(/\*\*Code Execution Result\*\*:\s*```json\s*[\s\S]*?```/gi, '');
  content = content.replace(/\*\*Code Execution Error\*\*:\s*```\s*[\s\S]*?```/gi, '');
  
  // CRITICAL FIX: Also remove execution results without the header (edge case)
  // Remove any large JSON blocks (>500 chars) that look like execution results
  content = content.replace(/```json\s*\[[\s\S]{500,}?\]\s*```/g, '[Large result removed]');
  content = content.replace(/```json\s*\{[\s\S]{500,}?\}\s*```/g, '[Large result removed]');
  
  // Remove execution status messages
  content = content.replace(/\n\n\*\*Executing additional code from follow-up\.\.\.\*\*\n\n/g, '');
  content = content.replace(/\n\n\*\[Code execution cancelled by user\]\*/g, '');

  // Remove executionResults property from message
  const { executionResults, ...msgWithoutResults } = msg;

  return {
    ...msgWithoutResults,
    content: content.trim()
  };
}

// Smart compression: Strip code but keep execution result summaries
// NEVER compresses coding rules - they're essential for correct code generation
function smartCompressMessage(msg: Message): Message {
  let content = msg.content;

  // CRITICAL: Preserve coding rules - never compress these
  const hasCodingRules = content.includes('═══ DATA QUERY & CODE EXECUTION RULES ═══');
  let rulesSection = '';
  
  if (hasCodingRules) {
    const rulesMatch = content.match(/(═══ DATA QUERY & CODE EXECUTION RULES ═══[\s\S]*?)(?=\n\n[^═]|$)/);
    if (rulesMatch) {
      rulesSection = rulesMatch[0];
      content = content.replace(rulesSection, '__RULES_PRESERVED__');
    }
  }

  // Remove code blocks but note what was executed with better context
  content = content.replace(/```(?:execute|javascript|js|query|code|python|sql)\s*\n[\s\S]*?```/gi, (match) => {
    // Check if it's a query
    if (match.includes('await query') || match.includes('SELECT')) {
      return '[SQL query executed]';
    }
    return '[Code executed]';
  });

  // Keep execution results with sample data for AI context
  content = content.replace(/\*\*Code Execution Result\*\*[^`]*```json\s*([\s\S]*?)\s*```/g, (_match, json) => {
    try {
      const result = JSON.parse(json);
      if (Array.isArray(result)) {
        if (result.length === 0) return '[Result: empty array]';
        if (result.length <= 3) return `[Result: ${JSON.stringify(result)}]`;
        // Include sample for AI context
        const firstRow = result[0];
        const cols = firstRow ? Object.keys(firstRow).join(', ') : '';
        return `[Result: ${result.length} rows (${cols}). Sample: ${JSON.stringify(firstRow)}]`;
      } else if (typeof result === 'object') {
        const keys = Object.keys(result);
        return `[Result: {${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}}]`;
      }
      return '[Result available]';
    } catch {
      return '[Result available]';
    }
  });

  // Keep error summaries with context
  content = content.replace(/\*\*Code Execution Error\*\*[^`]*```\s*([\s\S]*?)\s*```/g, (_match, error) => {
    // Keep first line of error for context
    const firstLine = error.split('\n')[0];
    return `[Execution error: ${firstLine.substring(0, 100)}]`;
  });

  // Preserve column info
  if (content.includes('AVAILABLE COLUMNS:')) {
    const columnsMatch = content.match(/AVAILABLE COLUMNS: ([^\n]+)/);
    if (columnsMatch) {
      content = content.replace(/=== COLUMN DETAILS ===[\s\S]*?(?=\n\n|$)/g, `[Columns: ${columnsMatch[1]}]`);
    }
  }

  // Restore coding rules if they were preserved
  if (hasCodingRules && content.includes('__RULES_PRESERVED__')) {
    content = content.replace('__RULES_PRESERVED__', rulesSection);
  }

  const { executionResults, ...msgWithoutResults } = msg;

  return {
    ...msgWithoutResults,
    content: content.trim()
  };
}

// Aggressively compress conversation when it gets too long (>50K tokens estimate)
// Keeps only recent messages and creates a summary of older ones
function compressLongConversation(history: Message[]): Message[] {
  if (history.length <= 10) return history; // Short conversations don't need compression

  // Estimate tokens (rough: 1 token ≈ 4 chars)
  const estimateTokens = (msg: Message) => (msg.content?.length || 0) / 4;
  const totalTokens = history.reduce((sum, msg) => sum + estimateTokens(msg), 0);

  // If under 50K tokens, just use smart compression on all messages
  if (totalTokens < 50000) {
    return history.map(msg => msg.role === 'assistant' ? smartCompressMessage(msg) : msg);
  }

  // Aggressive compression for long conversations
  const recentCount = 6; // Keep last 6 messages in full detail
  const recentMessages = history.slice(-recentCount);
  const olderMessages = history.slice(0, -recentCount);

  // Extract key facts from older messages
  const keyFacts: string[] = [];
  olderMessages.forEach(msg => {
    if (msg.role === 'user') {
      // Keep user questions concise
      const question = msg.content?.substring(0, 200) || '';
      if (question) keyFacts.push(`Q: ${question}`);
    } else if (msg.role === 'assistant') {
      // Extract key results/conclusions
      const content = msg.content || '';

      // Extract execution results summaries
      const resultMatches = content.match(/\[Result: ([^\]]+)\]/g);
      if (resultMatches) {
        resultMatches.forEach(match => keyFacts.push(match));
      }

      // Extract chart creations
      if (content.includes('chart') || content.includes('Chart')) {
        keyFacts.push('[Chart created in earlier conversation]');
      }

      // Extract key numbers/stats
      const numberMatches = content.match(/(\d{1,3}(,\d{3})*(\.\d+)?)\s*(rows?|columns?|records?|items?)/gi);
      if (numberMatches && numberMatches.length > 0) {
        keyFacts.push(`[Data: ${numberMatches[0]}]`);
      }
    }
  });

  // Create a compressed summary message
  const summaryMessage: Message = {
    role: 'user',
    content: `[Earlier conversation summary - ${olderMessages.length} messages compressed]\nKey facts: ${keyFacts.slice(0, 10).join('; ')}`,
    timestamp: Date.now()
  };

  // Return: summary + recent messages (compressed)
  return [
    summaryMessage,
    ...recentMessages.map(msg => msg.role === 'assistant' ? smartCompressMessage(msg) : msg)
  ];
}

// Strip code blocks from assistant messages but preserve execution results
// This reduces tokens when sending history to API while keeping the results the AI needs
// PRESERVES: markdown tables, display boxes, column info, headers with ═══ or ---, CODING RULES
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function stripCodeBlocksKeepResults(content: string, preserveCodingRules: boolean = true): string {
  let stripped = content;
  
  // CRITICAL: Never strip coding rules - they're essential for correct code generation
  if (preserveCodingRules && content.includes('═══ DATA QUERY & CODE EXECUTION RULES ═══')) {
    // Extract and preserve the rules section
    const rulesMatch = content.match(/(═══ DATA QUERY & CODE EXECUTION RULES ═══[\s\S]*?)(═══|$)/);
    const rulesSection = rulesMatch ? rulesMatch[0] : '';
    
    if (rulesSection) {
      // Remove rules temporarily, process rest, then add back
      stripped = content.replace(rulesSection, '__RULES_PLACEHOLDER__');
    }
  }
  
  // First, identify and mark EXECUTED code blocks (those followed by execution results)
  // These will be replaced with [Code executed - see results] placeholder
  // Use atomic grouping pattern to prevent catastrophic backtracking
  const executedPattern = /(```(?:execute|query|javascript|js|code|sql)\s*\n(?:[^\`]|`(?!``))*```)\s{0,100}(\*\*Code Execution (?:Result|Error)\*\*)/gi;
  const markers: string[] = [];
  
  stripped = stripped.replace(executedPattern, (_, codeBlock, resultHeader) => {
    markers.push(codeBlock);
    return `__EXEC_MARKER_${markers.length - 1}__\n\n${resultHeader}`;
  });
  
  // Remove any remaining execute blocks (these are UNEXECUTED - stopped/cancelled)
  // Use more specific marker to distinguish from executed code
  stripped = stripped.replace(
    /```(?:execute|query|javascript|js|code|sql)\s*\n[\s\S]*?```/gi,
    '[Code pending execution]'
  );
  
  // Restore executed block markers as [Code executed - see results]
  markers.forEach((_, i) => {
    stripped = stripped.replace(`__EXEC_MARKER_${i}__`, '[Code executed - see results]');
  });
  
  // Remove chart definition blocks (they're massive JSON and redundant once rendered)
  // But preserve other json blocks that might be showing data examples
  stripped = stripped.replace(
    /```(?:chart)\s*\n[\s\S]*?```/gi,
    '[Chart rendered]'
  );
  
  // CRITICAL FIX: Preserve FULL execution result format for display (green boxes)
  // This function is used when preparing messages for API context, but we need to preserve
  // the full format in the actual message content so ChatMessage can parse and display green boxes
  // Do NOT summarize execution results - keep them intact so they can be displayed
  // The execution results format is: **Code Execution Result** (94ms):\n```json\n{...}\n```
  
  // Keep execution results FULLY intact - don't modify them
  // ChatMessage component parses this format to show green boxes
  
  // Truncate error blocks if very long but keep key info
  stripped = stripped.replace(
    /\*\*Code Execution Error\*\*[^`]*```\s*([\s\S]*?)\s*```/g,
    (_match, error) => {
      const truncated = error.length > 500 ? error.substring(0, 500) + '...[see full error above]' : error;
      return `**Execution Error:** ${truncated}`;
    }
  );
  
  // Restore coding rules if they were preserved
  if (preserveCodingRules && stripped.includes('__RULES_PLACEHOLDER__')) {
    const rulesMatch = content.match(/(═══ DATA QUERY & CODE EXECUTION RULES ═══[\s\S]*?)(═══|$)/);
    const rulesSection = rulesMatch ? rulesMatch[0] : '';
    stripped = stripped.replace('__RULES_PLACEHOLDER__', rulesSection);
  }
  
  return stripped;
}

// Extract key conclusions from analysis text
function extractKeyConclusions(text: string): string {
  // Look for sentences with key findings
  const patterns = [
    /(?:found|discovered|shows?|indicates?|reveals?|total|average)[:\s]+([^.\n]{20,100})/i,
    /(?:\d+(?:\.\d+)?%?[^.\n]{10,80})/
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    } else if (match && match[0]) {
      return match[0].trim().substring(0, 100);
    }
  }
  
  // Fallback: first meaningful sentence
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
  return sentences[0]?.trim().substring(0, 100) || '';
}

// Strip execution results from a message to reduce token usage
function stripExecutionResults(msg: Message, keepForRecent: boolean = true): Message {
  if (keepForRecent || !msg.executionResults) {
    // Keep execution results for recent messages, or if message doesn't have them
    return { ...msg };
  }

  // Remove execution results but keep the message content
  const { executionResults, ...msgWithoutResults } = msg;
  return msgWithoutResults;
}

// Strip code blocks and execution results from message to save tokens
// preserveDatasetInfo: if true, keeps column names even when stripping other content
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _stripCodeBlocksAndResults(msg: Message, preserveDatasetInfo: boolean = false): Message {
  let content = msg.content;

  // Remove code blocks (```execute, ```javascript, etc.)
  content = content.replace(/```(?:execute|javascript|js|query|code|python|sql)\s*\n[\s\S]*?```/gi, '[Code block removed to save tokens]');

  // Remove execution result blocks
  content = content.replace(/\*\*Code Execution Result\*\*[^`]*```json\s*[\s\S]*?\s*```/g, '[Execution result removed]');
  content = content.replace(/\*\*Code Execution Error\*\*[^`]*```\s*[\s\S]*?\s*```/g, '[Execution error removed]');

  // If preserving dataset info, keep the AVAILABLE COLUMNS line
  if (preserveDatasetInfo && content.includes('AVAILABLE COLUMNS:')) {
    const columnsMatch = content.match(/AVAILABLE COLUMNS: ([^\n]+)/);
    if (columnsMatch) {
      // Keep only the column names, strip the detailed column info
      content = content.replace(/=== COLUMN DETAILS ===[\s\S]*?(?=\n\n|$)/g, (match) => {
        const cols = match.match(/AVAILABLE COLUMNS: ([^\n]+)/);
        return cols ? `[Available columns: ${cols[1]}]` : '';
      });
    }
  }

  // Remove execution results data
  const { executionResults, ...msgWithoutResults } = msg;

  return {
    ...msgWithoutResults,
    content: content.trim()
  };
}

// Truncate execution results to save tokens
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _truncateExecutionResults(msg: Message, _maxChars: number = 500): Message {
  if (!msg.executionResults) {
    return { ...msg };
  }

  // Truncate the execution results object
  const results = msg.executionResults;
  let truncated: any;

  if (Array.isArray(results)) {
    // If array, keep only first few items
    truncated = results.slice(0, 3);
    if (results.length > 3) {
      truncated.push({ __truncated: `... ${results.length - 3} more items` });
    }
  } else if (typeof results === 'object' && results !== null) {
    // If object, keep only first few keys
    const keys = Object.keys(results);
    truncated = {};
    const keysToKeep = keys.slice(0, 5);
    keysToKeep.forEach(key => {
      const value = results[key];
      // Truncate nested arrays/objects
      if (Array.isArray(value) && value.length > 3) {
        truncated[key] = [...value.slice(0, 3), { __truncated: `... ${value.length - 3} more` }];
      } else if (typeof value === 'string' && value.length > 100) {
        truncated[key] = value.substring(0, 100) + '...';
      } else {
        truncated[key] = value;
      }
    });
    if (keys.length > 5) {
      truncated.__truncated = `... ${keys.length - 5} more keys`;
    }
  } else {
    truncated = results;
  }

  return {
    ...msg,
    executionResults: truncated
  };
}

// Summarize a message to extract key findings and conclusions
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _summarizeMessage(msg: Message): Message {
  if (msg.role === 'user') {
    // For user messages, keep them but remove any large content
    // Truncate very long user messages
    const maxUserLength = 500;
    if (msg.content.length > maxUserLength) {
      return {
        ...msg,
        content: msg.content.substring(0, maxUserLength) + '... [truncated]',
        executionResults: undefined // Remove execution results
      };
    }
    return stripExecutionResults(msg, false);
  }
  
  // For assistant messages, extract key insights
  let summary = '';
  
  // Try to extract key findings from the content
  const content = msg.content || '';
  
  // Look for common patterns that indicate key findings
  const keyPatterns = [
    /(?:found|discovered|identified|shows?|indicates?|reveals?|concludes?)[:\s]+([^.\n]+)/gi,
    /(?:key|important|notable|significant)[:\s]+([^.\n]+)/gi,
    /(?:result|finding|conclusion|summary)[:\s]+([^.\n]+)/gi,
    /(?:total|average|percentage|count)[:\s]+([^.\n]+)/gi
  ];
  
  const findings: string[] = [];
  keyPatterns.forEach(pattern => {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && match[1].length < 200) {
        findings.push(match[1].trim());
      }
    }
  });
  
  // Extract numbers and statistics
  const numberPattern = /\b\d+(?:\.\d+)?%?\b/g;
  const numbers = content.match(numberPattern);
  if (numbers && numbers.length > 0) {
    const uniqueNumbers = [...new Set(numbers)].slice(0, 5);
    if (uniqueNumbers.length > 0) {
      findings.push(`Key statistics: ${uniqueNumbers.join(', ')}`);
    }
  }
  
  // If we found key findings, create a summary
  if (findings.length > 0) {
    summary = `[Summary of previous analysis: ${findings.slice(0, 5).join('; ')}]`;
  } else {
    // Fallback: Extract first sentence and last sentence
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
    if (sentences.length > 0) {
      const first = sentences[0].trim();
      const last = sentences.length > 1 ? sentences[sentences.length - 1].trim() : '';
      summary = `[Previous response: ${first}${last ? `... ${last}` : ''}]`;
    } else {
      // Very short summary
      summary = `[Previous assistant message about data analysis]`;
    }
  }
  
  // Limit summary length
  if (summary.length > 300) {
    summary = summary.substring(0, 297) + '...';
  }
  
  return {
    role: msg.role,
    content: summary,
    timestamp: msg.timestamp,
    model: msg.model,
    images: msg.images
    // Explicitly exclude executionResults
  };
}

function buildConversationContext(newMessage: string, conversationHistory: Message[], dataInfo?: DataInfo, dataAnalysisMode: boolean = true, includeHistoryInPrompt: boolean = false, hasData: boolean = false, selectedContextSectionId?: string | null, maxFollowupDepth: number = 0, currentFollowupDepth: number = 0, isLastFollowup: boolean = false): string {
  // Note: When includeHistoryInPrompt is false, conversation history is handled via messages array in API
  // This prevents duplication and confusion for the AI
  
  let context = '';
  
  // Add followup depth information at the start
  if (maxFollowupDepth > 0) {
    context += `=== FOLLOWUP DEPTH INFORMATION ===\n`;
    context += `Maximum followup depth: ${maxFollowupDepth} exchanges\n`;
    context += `Current followup depth: ${currentFollowupDepth} (this is followup #${currentFollowupDepth + 1})\n`;
    if (isLastFollowup) {
      context += `⚠️ THIS IS YOUR LAST FOLLOWUP. Provide a complete, final answer. Do not leave questions unanswered or suggest further followups.\n`;
    } else {
      const remaining = maxFollowupDepth - currentFollowupDepth - 1;
      context += `Remaining followups: ${remaining}\n`;
    }
    context += `\n`;
  }
  
  // Always include context sections if one is selected, regardless of dataAnalysisMode
  const shouldIncludeContextSection = selectedContextSectionId && selectedContextSectionId !== "none";
  
  if (dataAnalysisMode) {
    // RESTRUCTURED FOR CLARITY: Instructions → Dataset Info → Question
    
    // 1. CODE EXECUTION INSTRUCTIONS (if data available)
    if (dataInfo || hasData) {
      const codingRules = getCodingRules();
      context = codingRules + '\n\n';
    }
    
    // 2. DOMAIN CONTEXT (volleyball rules, terminology, etc.)
    const contextSections = getContextSections(selectedContextSectionId || undefined);
    if (contextSections.trim()) {
      context += '═══════════════════════════════════\n';
      context += '📚 DOMAIN KNOWLEDGE\n';
      context += '═══════════════════════════════════\n';
      context += contextSections + '\n\n';
    }
    
    // 3. CURRENT DATASET INFO (if available)
    if (dataInfo && Object.keys(dataInfo).length > 0) {
      context += '═══════════════════════════════════\n';
      context += '📊 CURRENT DATASET\n';
      context += '═══════════════════════════════════\n';
      if (dataInfo.id) {
        context += `[Internal ID: ${dataInfo.id} - for reference only, do not display]\n`;
      }
      Object.entries(dataInfo).forEach(([key, value]) => {
        if (key !== 'id' && value) {
          context += `${key}: ${value}\n`;
        }
      });
      context += '\n';
    }
  } else {
    // Even in non-data-analysis mode, include context sections if one is selected
    if (shouldIncludeContextSection) {
      const contextSections = getContextSections(selectedContextSectionId);
      context = contextSections + '\n\n';
    }
    context += 'You are a helpful AI assistant. Answer questions clearly and concisely. Use markdown formatting for structure when helpful.\n\n';
  }
  
  // Only include conversation history in prompt if explicitly requested
  // Otherwise, it's handled via messages array in API (prevents duplication)
  // Reduced history length to optimize token usage
  if (includeHistoryInPrompt && conversationHistory.length > 0) {
    const recentMessages = conversationHistory.slice(-8); // Reduced from 12 to 8 messages (4 exchanges) to save tokens
    
    // Check if this is a new question (not a follow-up)
    const isNewQuestion = !newMessage.includes('Execution results') && 
                          !newMessage.includes('Code execution complete') &&
                          !newMessage.includes('**Executed code:**') &&
                          !newMessage.includes('**🚨 EXECUTION RESULTS**');
    
    context += '\n═══════════════════════════════════════════════════════════════\n';
    if (isNewQuestion) {
      context += '🚨🚨🚨 OLD CONVERSATION HISTORY - IGNORE FOR NEW QUESTION 🚨🚨🚨\n';
      context += '⚠️⚠️⚠️ DO NOT use execution results, match_ids, or data from messages below\n';
      context += '⚠️⚠️⚠️ Answer ONLY the NEW question shown above, not questions from history\n';
    } else {
      context += 'OLD HISTORY (may have different values):\n';
      context += '⚠️ Use CURRENT QUESTION/EXECUTION RESULTS above, NOT old messages.\n';
    }
    context += '═══════════════════════════════════════════════════════════════\n';
    recentMessages.forEach((msg, idx) => {
      // Safety check for message structure
      if (!msg || typeof msg !== 'object') return;
      
      const role = msg.role || 'user';
      let msgContent = msg.content || '';
      
      // Truncate very long messages more aggressively to save tokens (keep first 300 chars + last 100 chars)
      if (msgContent.length > 600) {
        msgContent = msgContent.substring(0, 300) + '...[truncated]...' + msgContent.substring(msgContent.length - 100);
      }
      
      // Format messages clearly with numbering
      context += `\n[${idx + 1}] ${role === 'user' ? 'USER' : 'ASSISTANT'}:\n${msgContent}\n`;
      
      // Skip execution results summary in old history - saves tokens, not needed
    });
    context += '\n═══════════════════════════════════════════════════════════════\n\n';
  }
  
  // 4. CURRENT QUESTION
  context += '═══════════════════════════════════\n';
  context += '❓ CURRENT QUESTION (THIS EXCHANGE)\n';
  context += '═══════════════════════════════════\n';
  context += newMessage;
  
  // Check if this is a NEW question (not a follow-up with execution results)
  const isNewQuestion = !newMessage.includes('Execution results') && 
                        !newMessage.includes('Code execution complete') &&
                        !newMessage.includes('**Executed code:**') &&
                        !newMessage.includes('**🚨 EXECUTION RESULTS**');
  
  // Check if the current question mentions execution results (follow-up)
  if (!isNewQuestion) {
    context += '\n\n🚨 CRITICAL: The execution results shown in the question above are from THIS CURRENT EXCHANGE.\n';
    context += 'Use THOSE values (match_id, query results, etc.) - NOT values from old conversation history.\n';
  } else if (conversationHistory && conversationHistory.length > 0) {
    // NEW QUESTION - strongly emphasize ignoring old history
    context += '\n\n🚨🚨🚨 THIS IS A NEW QUESTION - IGNORE ALL OLD CONVERSATION HISTORY 🚨🚨🚨\n';
    context += '⚠️ DO NOT use execution results, match_ids, or data from old messages above\n';
    context += '⚠️ DO NOT answer questions from old conversation history\n';
    context += '⚠️ Answer ONLY this new question: "' + newMessage.substring(0, 100) + (newMessage.length > 100 ? '...' : '') + '"\n';
    context += '⚠️ Start fresh - write NEW code to answer THIS question\n';
  }

  // 5. REMINDERS (if in multi-turn conversation)
  if (conversationHistory && conversationHistory.length > 0) {
    context += '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    if (isNewQuestion) {
      context += '🚨 NEW QUESTION - IGNORE OLD HISTORY ABOVE\n';
      context += '⚠️ Answer ONLY the current question\n';
      context += '⚠️ Write NEW code - do NOT reuse old queries or results\n';
    } else {
      context += '⚠️ Answer ONLY the current question above\n';
      context += '📋 Use values from CURRENT execution results, NOT from old conversation history\n';
      context += '⚡ Don\'t repeat queries already executed\n';
    }
    context += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  }
  
  return context;
}

// Build data analysis context with dataset
export function buildVolleyballContext(
  userMessage: string,
  matchData: MatchData | null,
  conversationHistory: Message[],
  volleyballContextEnabled: boolean = true,
  csvData: any[] | null = null,
  csvFileName: string | null = null,
  currentSelectionValueInfo?: any | null,
  selectedContextSectionId?: string | null,
  maxFollowupDepth: number = 0,
  currentFollowupDepth: number = 0,
  isLastFollowup: boolean = false,
  csvId: string | string[] | null = null,
  chatId?: string
): string {
  // Simplified: Just coding rules + summary
  // Build base context
  const hasData = !!(matchData || csvData || csvFileName || csvId || currentSelectionValueInfo);
  let context = buildConversationContext(
    userMessage,
    conversationHistory,
    matchData ? { id: matchData.matchInfo.match_id } : undefined,
    volleyballContextEnabled,
    false, // includeHistory handled separately
    hasData,
    selectedContextSectionId,
    maxFollowupDepth,
    currentFollowupDepth,
    isLastFollowup
  );

  // Get summary from valueInfo
  let summaryText = '';
  
  // Priority: currentSelectionValueInfo > csvId > matchData
  if (currentSelectionValueInfo?.summary) {
    summaryText = `\n\n📋 DATASET SUMMARY:\n${currentSelectionValueInfo.summary}`;
  } else if (csvId) {
    const csvIds = Array.isArray(csvId) ? csvId : [csvId];
    let csvValueInfo = null;

    if (csvIds.length > 1) {
      // Multiple files - look for combined value info
      const combinedId = `combined_${[...csvIds].sort().join('_')}`;
      csvValueInfo = getValueInfo(combinedId, 'csv', chatId);
    } else if (csvIds.length === 1) {
      // Single file - look for single value info
      csvValueInfo = getValueInfo(csvIds[0], 'csv', chatId);
    }

    if (csvValueInfo?.summary) {
      summaryText = `\n\n📋 DATASET SUMMARY:\n${csvValueInfo.summary}`;
    }
  } else if (matchData) {
    const matchValueInfo = getValueInfo(matchData.matchInfo.match_id, 'match');
    if (matchValueInfo?.summary) {
      summaryText = `\n\n📋 DATASET SUMMARY:\n${matchValueInfo.summary}`;
    }
  }

  // Add summary to context
  if (summaryText) {
    context += summaryText;
  }

  return context;
}

// Get CSV file data by ID(s) with optional filtering
// csvId can be a single string, array of strings, or null
// onProgress: optional callback to report loading progress
export async function getCsvFileData(
  csvId: string | string[] | null, 
  filterColumns?: string[] | null, 
  filterValues?: Record<string, string | string[] | null> | null,
  onProgress?: (progress: { file: string; percent: number; rows?: number }) => void
): Promise<any[] | null> {
  // Input validation
  if (csvId !== null) {
    const ids = Array.isArray(csvId) ? csvId : [csvId];
    for (const id of ids) {
      if (typeof id !== 'string' || id.length === 0) {
        console.error('getCsvFileData: Invalid csvId - must be non-empty string');
        return null;
      }
      if (id.length > 500) {
        console.error('getCsvFileData: csvId too long (max 500 chars)');
        return null;
      }
    }
  }
  
  try {
    // Try IndexedDB first (new approach)
    const { getAllCsvFileMetadata } = await import("@/lib/csvStorage");
    let files: CsvFile[] = [];
    
    try {
      const metadataFiles = await getAllCsvFileMetadata();
      files = metadataFiles;
    } catch (e) {
      // Fallback to localStorage for migration
      const saved = localStorage.getItem("db_csv_files");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          files = Array.isArray(parsed) ? parsed : [];
        } catch (parseError) {
          console.error('Error parsing CSV files from localStorage:', parseError);
          files = [];
        }
      }
    }
    
    if (files.length === 0) {
      return null;
    }

    // If csvId is provided, get that specific file(s); otherwise combine all files
    let dataToFilter: any[] = [];

    if (csvId) {
      // Handle array of CSV IDs
      const csvIds = Array.isArray(csvId) ? csvId : [csvId];
      
      // Process files in parallel
      const filePromises = csvIds.map(async (id) => {
        const file = files.find((f: any) => f.id === id);
        if (file) {
          
          // ALWAYS try DuckDB first if available (check registered files, not just flags)
            try {
            const { queryCSVWithDuckDB, isDuckDBInitialized, getDuckDBTableName } = await import("@/lib/duckdb");
              if (isDuckDBInitialized()) {
              // Check if file is registered in DuckDB (even if hasDuckDB flag is false)
              const tableName = getDuckDBTableName(file.id) || file.tableName;
              
              if (tableName || file.hasDuckDB) {
                const rows = await queryCSVWithDuckDB(
                  file.id,
                  filterColumns || null,
                  filterValues || null,
                  onProgress ? (progress) => {
                    onProgress({ 
                      file: file.name, 
                      percent: progress.percent, 
                      rows: progress.rows 
                    });
                  } : undefined
                );
                return rows || [];
              }
              }
            } catch (duckdbError) {
              // Fall through to standard retrieval
          }
          
          // First check if file has embedded data that needs to be saved
          if (Array.isArray(file.data) && file.data.length > 0) {
            try {
              const { saveCsvDataText } = await import("@/lib/csvStorage");
              const { stringifyCsv } = await import("@/lib/csvUtils");
              const headers = file.headers || (file.data[0] ? Object.keys(file.data[0]) : []);
              const csvText = stringifyCsv(headers, file.data);
              await saveCsvDataText(file.id, csvText, file.data);
            } catch (e) {
              console.error('getCsvFileData: Error saving embedded data:', e);
            }
            // Use embedded data directly
            return file.data;
          } else {
            // Try to get data from IndexedDB
            // Wrap getCsvDataRows to report progress
            const rows = await (async () => {
              try {
                // Check if it's a blob file that needs progress reporting
                const storageKey = `db_csv_data_${file.id}`;
                const db = await import("@/lib/csvStorage").then(m => m.initDB());
                const transaction = db.transaction(["csvFiles"], "readonly");
                const store = transaction.objectStore("csvFiles");
                const result = await new Promise<any>((resolve, reject) => {
                  const request = store.get(storageKey);
                  request.onsuccess = () => resolve(request.result);
                  request.onerror = () => reject(request.error);
                });
                
                if (result?.isBlob && result?.fileBlob) {
                  // It's a blob file - pass progress callback to getCsvDataRows
                  try {
                    const rows = await getCsvDataRows(file, onProgress);
                    return rows;
                  } catch (e) {
                    throw e;
                  }
                } else {
                  // Regular file - pass progress callback if provided
                  return await getCsvDataRows(file, onProgress);
                }
              } catch (e) {
                console.error('Error getting CSV data with progress:', e);
                return await getCsvDataRows(file, onProgress);
              }
            })();
            
            if (rows && rows.length > 0) {
              return rows;
            } else {
              return null;
            }
          }
        } else {
          return null;
        }
      });
      
      const fileDataArrays = await Promise.all(filePromises);
      fileDataArrays.forEach(data => {
        if (data && data.length > 0) {
          dataToFilter = dataToFilter.concat(data);
        }
      });
      
      if (dataToFilter.length === 0) return null;
      
      // No limit - data is already in browser, use all of it
    } else {
      // Combine all files if no specific IDs provided
      const filePromises = files.map(async (file) => {
        if (!file) return null;
        const rows = await getCsvDataRows(file);
        return rows && rows.length > 0 ? rows : null;
      });
      
      const fileDataArrays = await Promise.all(filePromises);
      fileDataArrays.forEach(data => {
        if (data && data.length > 0) {
          dataToFilter = dataToFilter.concat(data);
        }
      });
      
      if (dataToFilter.length === 0) return null;
      
      // No limit - data is already in browser, use all of it
    }
    
    // If columns are selected for grouping (even without values), return the data grouped
    // The grouping will be done by the caller if needed
    if (filterColumns && filterColumns.length > 0) {
      // If filterValues are provided, apply exact match filtering
      if (filterValues) {
        // Get first row to find actual column names (case-insensitive matching)
        const firstRow = dataToFilter[0];
        if (!firstRow) return dataToFilter;
        
        // Map filter columns to actual column names
        const columnMap: Record<string, string> = {};
        filterColumns.forEach(column => {
          let actualColumnName = column;
          if (!(column in firstRow)) {
            actualColumnName = Object.keys(firstRow).find(
              key => key.toLowerCase() === column.toLowerCase()
            ) || column;
          }
          columnMap[column] = actualColumnName;
        });
        
        const filtered = dataToFilter.filter((row: any) => {
          return filterColumns.every(column => {
            const filterValue = filterValues[column];
            if (!filterValue) return true; // No filter for this column

            // Handle special "SELECT_ALL" marker - means don't filter (select all, including NULLs)
            if (filterValue === '__SELECT_ALL__') {
              return true; // Select all values for this column, including NULL
            }

            const actualColumnName = columnMap[column];
            const cellValue = row && (row[actualColumnName] !== null && row[actualColumnName] !== undefined)
              ? String(row[actualColumnName]).trim()
              : '(null)';

            // Handle array values (multiple selection)
            if (Array.isArray(filterValue)) {
              return filterValue.some(val => {
                const valStr = String(val).trim();
                // Match "(null)" with actual null values
                if (valStr === '(null)') {
                  return !row || row[actualColumnName] === null || row[actualColumnName] === undefined || row[actualColumnName] === '';
                }
                return valStr === cellValue;
              });
            } else {
              // Single value: exact match
              const filterValueStr = String(filterValue).trim();
              if (filterValueStr === '') return true; // No filter for this column
              // Match "(null)" with actual null values
              if (filterValueStr === '(null)') {
                return !row || row[actualColumnName] === null || row[actualColumnName] === undefined || row[actualColumnName] === '';
              }
              return cellValue === filterValueStr;
            }
          });
        });
        
        // Reset index by adding index property to each row
        return filtered.map((row, index) => ({ ...row, __index: index }));
      }
      
      // If columns are selected but no values, just return the data (it will be grouped by the caller)
      // Reset index by adding index property to each row
      return dataToFilter.map((row, index) => ({ ...row, __index: index }));
    }
    
    return dataToFilter;
  } catch (e) {
    console.error("Error loading CSV file:", e);
  }
  return null;
}

// Get value info for a match or CSV
// Enhanced to support multiple value infos and better lookup
// Now handles current_selection references that point to unique Value Infos
export function getValueInfo(id: string, type: 'match' | 'csv' = 'match', chatId?: string): ValueInfo | null {
  if (!id) return null;
  try {
    const saved = localStorage.getItem("db_value_infos");
    if (saved) {
      const parsed = JSON.parse(saved);
      const infos = Array.isArray(parsed) ? parsed : [];
      // Try exact match first
      let info = infos.find((v: any) => v.id === id && v.type === type);
      
      // CRITICAL FIX: Validate that the value info matches the requested CSV
      // This prevents sending wrong CSV summary data to the AI
      if (info && type === 'csv' && id !== 'current_selection') {
        // For CSV type, verify the ID matches by cross-checking with CSV metadata
        const files = getCsvFilesFromStorageSync();
        const matchingFile = files.find((f: any) => f.id === id);
        
        // If we found the CSV file, verify the value info name matches the CSV name
        if (matchingFile && info.name && matchingFile.name) {
          if (info.name !== matchingFile.name) {
            info = null; // Reject mismatched value info
          }
        }
      }
      
      // If looking for current_selection, try to find it
      if (!info && id === 'current_selection') {
        // CRITICAL FIX: current_selection must be STRICTLY isolated by chatId
        // to prevent returning data from a different chat
        if (chatId) {
          // Only find current_selection for THIS specific chat
          const currentSelectionRefs = infos.filter((v: any) => 
            v.id === 'current_selection' && 
            v.type === type && 
            (v.chatId === chatId || (v.usedByChats && v.usedByChats.includes(chatId)))
          );
          if (currentSelectionRefs.length > 0) {
            // Get the most recent one for this chat
            const mostRecent = currentSelectionRefs.sort((a: any, b: any) => 
              (b.generatedAt || 0) - (a.generatedAt || 0)
            )[0];
            // If it references another Value Info, resolve it
            if (mostRecent.referencedValueInfoId) {
              info = infos.find((v: any) => v.id === mostRecent.referencedValueInfoId && v.type === type);
            } else {
              info = mostRecent;
            }
          }
          // DO NOT fall back to any current_selection - return null if not found for this chat
        } else {
          // No chatId provided - this is acceptable for initial queries before chat exists
          // In this case, try to find any recent current_selection (but this is rare)
          const anyCurrentSelection = infos.find((v: any) => 
            v.id === 'current_selection' && v.type === type
          );
          if (anyCurrentSelection) {
            // If it references another Value Info, resolve it
            if (anyCurrentSelection.referencedValueInfoId) {
              info = infos.find((v: any) => v.id === anyCurrentSelection.referencedValueInfoId && v.type === type);
            } else {
              info = anyCurrentSelection;
            }
          }
        }
      }
      
      // Fallback: try case-insensitive match
      if (!info) {
        info = infos.find((v: any) => 
          v.id && v.id.toString().toLowerCase() === id.toString().toLowerCase() && 
          v.type === type
        );
        
        // CRITICAL FIX: Also validate case-insensitive matches
        if (info && type === 'csv' && id !== 'current_selection') {
          try {
            const csvFiles = localStorage.getItem("db_csv_files");
            if (csvFiles) {
              const parsedFiles = JSON.parse(csvFiles);
              const files = Array.isArray(parsedFiles) ? parsedFiles : [];
              const matchingFile = files.find((f: any) => 
                f.id && f.id.toString().toLowerCase() === id.toString().toLowerCase()
              );
              
              if (matchingFile && info.name && matchingFile.name) {
                if (info.name !== matchingFile.name) {
                  info = null;
                }
              }
            }
          } catch (csvCheckError) {
            console.error("Error validating CSV value info match (case-insensitive):", csvCheckError);
          }
        }
      }
      
      // If we found a reference, resolve it
      if (info && info.referencedValueInfoId) {
        const resolved = infos.find((v: any) => v.id === info.referencedValueInfoId && v.type === type);
        if (resolved) {
          return resolved;
        }
      }
      
      return info || null;
    }
  } catch (e) {
    console.error("Error loading value info:", e);
  }
  return null;
}

// Get all value infos (for multiple active value infos support)
export function getAllValueInfos(): ValueInfo[] {
  try {
    const saved = localStorage.getItem("db_value_infos");
    if (saved) {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) {
    console.error("Error loading all value infos:", e);
  }
  return [];
}

// Get value infos by type
export function getValueInfosByType(type: 'match' | 'csv'): ValueInfo[] {
  return getAllValueInfos().filter((v) => v.type === type);
}

// Save value info for a match or CSV
// Enhanced to support multiple value infos and prevent duplicates
// Now supports chatId tracking to prevent deletion when creating new selections
export function saveValueInfo(valueInfo: ValueInfo, chatId?: string): void {
  try {
    if (!valueInfo || !valueInfo.id || !valueInfo.type) {
      return;
    }
    
    // CRITICAL: Remove data array before saving to localStorage to prevent quota exceeded errors
    // Data should only be stored in IndexedDB, not localStorage
    const valueInfoToSave = { ...valueInfo };
    if (valueInfoToSave.data && Array.isArray(valueInfoToSave.data)) {
      // Keep metadata about data but remove the actual array
      valueInfoToSave.hasData = true;
      valueInfoToSave.dataLength = valueInfoToSave.data.length;
      delete valueInfoToSave.data;
    }
    
    const saved = localStorage.getItem("db_value_infos");
    const infos = saved ? JSON.parse(saved) : [];
    
    // Check for duplicates by ID and type first
    let existingIndex = infos.findIndex((v: any) => v.id === valueInfo.id && v.type === valueInfo.type);
    
    // Also check for duplicates by uniqueId (if present) - this is the most reliable way
    // IMPORTANT: Check this BEFORE filterColumns/filterValues to catch duplicates with same uniqueId but different id
    if (existingIndex < 0 && valueInfo.uniqueId) {
      existingIndex = infos.findIndex((v: any) => 
        v.uniqueId === valueInfo.uniqueId && 
        v.type === valueInfo.type
      );
    }
    
    // Also check for duplicates by filterColumns and filterValues (if present) - this ensures same selection = same Value Info
    // This is critical for catching duplicates even when uniqueId might differ slightly
    if (existingIndex < 0 && valueInfo.filterColumns && valueInfo.filterValues) {
      existingIndex = infos.findIndex((v: any) => {
        if (v.type !== valueInfo.type) return false;
        if (!v.filterColumns || !v.filterValues) return false;
        
        // Compare filterColumns (sorted arrays)
        const vCols = [...(v.filterColumns || [])].sort().join(',');
        const infoCols = [...(valueInfo.filterColumns || [])].sort().join(',');
        if (vCols !== infoCols) return false;
        
        // Compare filterValues (sorted keys and values)
        // Filter out null/undefined values for comparison
        const vFilteredValues = Object.keys(v.filterValues || {})
          .filter(k => v.filterValues![k] != null)
          .reduce((acc, k) => {
            acc[k] = v.filterValues![k];
            return acc;
          }, {} as Record<string, any>);
        const infoFilteredValues = Object.keys(valueInfo.filterValues || {})
          .filter(k => valueInfo.filterValues![k] != null)
          .reduce((acc, k) => {
            acc[k] = valueInfo.filterValues![k];
            return acc;
          }, {} as Record<string, any>);
        
        const vKeys = Object.keys(vFilteredValues).sort();
        const infoKeys = Object.keys(infoFilteredValues).sort();
        if (vKeys.length !== infoKeys.length) return false;
        if (!vKeys.every(k => infoKeys.includes(k))) return false;
        
        // Compare values (case-insensitive string comparison for robustness)
        return vKeys.every(k => {
          const vVal = String(vFilteredValues[k] || '').trim();
          const infoVal = String(infoFilteredValues[k] || '').trim();
          return vVal === infoVal;
        });
      });
    }
    
    // Also check for duplicates by name and selection criteria (for current_selection, check by name and chatId)
    // IMPORTANT: For main Value Infos (not current_selection), also check if there's a current_selection with same criteria
    if (existingIndex < 0 && valueInfo.name) {
      // For current_selection, check if there's already one with the same name for this chat
      if (valueInfo.id === 'current_selection' && chatId) {
        existingIndex = infos.findIndex((v: any) => 
          v.id === 'current_selection' && 
          v.type === valueInfo.type && 
          v.name === valueInfo.name &&
          (v.chatId === chatId || (v.usedByChats && v.usedByChats.includes(chatId)))
        );
      } else if (valueInfo.name) {
        // For other Value Infos, check by name and type (to avoid duplicates with same selection criteria)
        // Also check if there's a current_selection with the same name (they might be duplicates)
        existingIndex = infos.findIndex((v: any) => {
          if (v.type !== valueInfo.type) return false;
          if (v.name !== valueInfo.name) return false;
          // Match either main Value Info or current_selection with same name
          // This catches cases where we have both a main Value Info and current_selection with same criteria
          return true;
        });
      }
    }
    
    // Add chatId to valueInfo if provided
    if (chatId) {
      valueInfo.chatId = chatId;
      // Also track which chats use this valueInfo
      if (!valueInfo.usedByChats) {
        valueInfo.usedByChats = [];
      }
      if (!valueInfo.usedByChats.includes(chatId)) {
        valueInfo.usedByChats.push(chatId);
      }
    }
    
    if (existingIndex >= 0) {
      // Update existing - merge to preserve any additional properties and chat associations
      const existing = infos[existingIndex];
      const updatedChats = existing.usedByChats || [];
      if (chatId && !updatedChats.includes(chatId)) {
        updatedChats.push(chatId);
      }
      
      // If the new valueInfo has a uniqueId but the existing one doesn't, use the new one
      // If both have uniqueIds but they differ, prefer the existing one (it was created first)
      // But if the new one has uniqueId and existing doesn't, update it
      const finalUniqueId = existing.uniqueId || valueInfo.uniqueId;
      
      // Update the existing entry instead of creating a duplicate
      // Remove data array if present to prevent quota exceeded errors
      const updatedValueInfo = { ...valueInfoToSave };
      if (updatedValueInfo.data && Array.isArray(updatedValueInfo.data)) {
        updatedValueInfo.hasData = true;
        updatedValueInfo.dataLength = updatedValueInfo.data.length;
        delete updatedValueInfo.data;
      }
      
      infos[existingIndex] = {
        ...existing,
        ...updatedValueInfo,
        uniqueId: finalUniqueId, // Ensure uniqueId is consistent
        usedByChats: updatedChats,
        generatedAt: valueInfo.generatedAt || existing.generatedAt || Date.now()
      };
    } else {
      // Add new - ensure it has required fields
      // Use valueInfoToSave which already has data removed
      const newInfo = {
        ...valueInfoToSave,
        usedByChats: chatId ? [chatId] : [],
        generatedAt: valueInfo.generatedAt || Date.now()
      };
      infos.push(newInfo);
    }
    
    // After saving, check for and remove any duplicates that might have been created
    // This is a safety net in case duplicates slip through
    removeDuplicateValueInfos(infos);
    
    try {
      localStorage.setItem("db_value_infos", JSON.stringify(infos));
    } catch (quotaError: any) {
      console.error("❌ LocalStorage quota exceeded while saving value info:", quotaError);
      // Try to free up space by removing old unused value infos
      try {
        const oldInfos = infos.filter((info: any) => {
          const isOld = info.usedByChats && info.usedByChats.length === 0;
          return isOld; // Remove old/unused infos
        });
        const keptInfos = infos.filter((info: any) => {
          const isOld = info.usedByChats && info.usedByChats.length === 0;
          return !isOld; // Keep active infos
        });
        localStorage.setItem("db_value_infos", JSON.stringify(keptInfos));
      } catch (retryError) {
        console.error("❌ Failed to save even after cleanup. Storage critically full.");
        throw new Error("Storage quota exceeded. Please clear some data.");
      }
    }
  } catch (e) {
    console.error("Error saving value info:", e);
  }
}

// Remove duplicate Value Infos based on filterColumns and filterValues
// This is a safety function to clean up any duplicates that might exist
export function removeDuplicateValueInfos(infos?: ValueInfo[]): void {
  try {
    // If no infos provided, load from localStorage
    let valueInfos: ValueInfo[] = infos || [];
    if (!infos) {
      const saved = localStorage.getItem("db_value_infos");
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return;
      valueInfos = parsed;
    }
    
    if (!Array.isArray(valueInfos) || valueInfos.length === 0) return;
    const seen = new Map<string, number>(); // Map of criteria key -> index of entry to keep
    const toRemove: number[] = [];
    
    for (let i = 0; i < valueInfos.length; i++) {
      const info = valueInfos[i];
      
      // Skip if it doesn't have filter criteria
      if (!info.filterColumns || !info.filterValues || !info.type) {
        continue;
      }
      
      // Create a unique key from filterColumns and filterValues
      const filterKeys = Object.keys(info.filterValues || {})
        .filter(k => info.filterValues![k] != null)
        .sort();
      const filterValuesStr = filterKeys
        .map(k => `${k}=${String(info.filterValues![k]).trim()}`)
        .join('|');
      const criteriaKey = `${info.type}:${[...(info.filterColumns || [])].sort().join(',')}:${filterValuesStr}`;
      
      // Also check by uniqueId if present
      const uniqueKey = info.uniqueId ? `${info.type}:${info.uniqueId}` : null;
      
      // Check if we've seen this criteria before
      const existingIndex = seen.get(criteriaKey);
      if (existingIndex !== undefined) {
        // Duplicate found - mark for removal
        toRemove.push(i);
        // Merge chat associations if needed
        const existing = valueInfos[existingIndex];
        if (info.usedByChats && Array.isArray(info.usedByChats)) {
          const mergedChats = [...(existing.usedByChats || [])];
          info.usedByChats.forEach((chatId: string) => {
            if (!mergedChats.includes(chatId)) {
              mergedChats.push(chatId);
            }
          });
          existing.usedByChats = mergedChats;
        }
      } else if (uniqueKey && seen.has(uniqueKey)) {
        // Duplicate by uniqueId
        toRemove.push(i);
        const existingIndex = seen.get(uniqueKey)!;
        const existing = valueInfos[existingIndex];
        if (info.usedByChats && Array.isArray(info.usedByChats)) {
          const mergedChats = [...(existing.usedByChats || [])];
          info.usedByChats.forEach((chatId: string) => {
            if (!mergedChats.includes(chatId)) {
              mergedChats.push(chatId);
            }
          });
          existing.usedByChats = mergedChats;
        }
      } else {
        // First time seeing this - mark it
        seen.set(criteriaKey, i);
        if (uniqueKey) {
          seen.set(uniqueKey, i);
        }
      }
    }
    
    // Remove duplicates (in reverse order to maintain indices)
    toRemove.sort((a, b) => b - a);
    toRemove.forEach(index => {
      valueInfos.splice(index, 1);
    });
    
    if (toRemove.length > 0) {
      // Save cleaned up infos back to localStorage
      localStorage.setItem("db_value_infos", JSON.stringify(valueInfos));
    }
  } catch (e) {
    console.error("Error removing duplicate value infos:", e);
  }
}

// Delete value info by ID and type
export function deleteValueInfo(id: string, type: 'match' | 'csv' = 'match'): void {
  try {
    const saved = localStorage.getItem("db_value_infos");
    if (!saved) return;
    
    const infos = JSON.parse(saved);
    const filtered = infos.filter((v: any) => !(v.id === id && v.type === type));

    localStorage.setItem("db_value_infos", JSON.stringify(filtered));
  } catch (e) {
    console.error("Error deleting value info:", e);
  }
}

// Clear all value infos
export function clearAllValueInfos(): void {
  try {
    localStorage.removeItem("db_value_infos");
  } catch (e) {
    console.error("Error clearing value infos:", e);
  }
}

// Clean up valueInfo for deleted chats - only keep data for existing chats
export function cleanupValueInfosForDeletedChats(): void {
  try {
    // Get all existing chats
    const savedChats = localStorage.getItem("volleyball-chats");
    const existingChatIds = new Set<string>();
    
    if (savedChats) {
      try {
        const chats = JSON.parse(savedChats);
        if (Array.isArray(chats)) {
          chats.forEach((chat: any) => {
            if (chat.id) existingChatIds.add(chat.id);
          });
        }
      } catch (e) {
        console.error("Error parsing chats:", e);
      }
    }
    
    // Get all valueInfos
    const saved = localStorage.getItem("db_value_infos");
    if (!saved) return;
    
    const infos = JSON.parse(saved);
    
    // Filter to only keep valueInfos that:
    // 1. Are used by existing chats (check usedByChats array)
    // 2. Are for CSV files (csv type - these are independent, keep if usedByChats is empty or has existing chats)
    // 3. Are match valueInfos that are used by existing chats or have no chat association (legacy support)
    const validInfos = infos.filter((info: any) => {
      // Keep CSV valueInfos if they're used by existing chats or have no chat association (legacy)
      if (info.type === 'csv') {
        if (!info.usedByChats || info.usedByChats.length === 0) {
          return true; // Keep legacy CSV valueInfos
        }
        // Keep if used by at least one existing chat
        return info.usedByChats.some((chatId: string) => existingChatIds.has(chatId));
      }
      
      // For match type, check if it's used by existing chats
      if (info.type === 'match') {
        // Keep if used by at least one existing chat
        if (info.usedByChats && info.usedByChats.length > 0) {
          return info.usedByChats.some((chatId: string) => existingChatIds.has(chatId));
        }
        // Keep legacy match valueInfos (no usedByChats) - they might be for match_id selections
        // But only if they're not current_selection (which should be chat-specific)
        if (info.id === 'current_selection') {
          return false; // Remove orphaned current_selection
        }
        return true; // Keep legacy match valueInfos
      }
      
      // Remove anything else
      return false;
    });
    
    // Only update if something was removed
    if (validInfos.length !== infos.length) {
      localStorage.setItem("db_value_infos", JSON.stringify(validInfos));
    }
  } catch (e) {
    console.error("Error cleaning up value infos:", e);
  }
}

// Delete valueInfo for a specific chat (when chat is deleted)
export function deleteValueInfoForChat(chatId: string): void {
  try {
    const saved = localStorage.getItem("db_value_infos");
    if (!saved) return;
    
    const infos = JSON.parse(saved);
    // Remove valueInfos that are only used by this chat
    // If a valueInfo is used by multiple chats, just remove this chat from the list
    const filtered = infos.map((v: any) => {
      if (v.usedByChats && Array.isArray(v.usedByChats)) {
        const updatedChats = v.usedByChats.filter((id: string) => id !== chatId);
        if (updatedChats.length === 0) {
          // Not used by any chats anymore, remove it
          return null;
        }
        // Still used by other chats, just remove this chat from the list
        return { ...v, usedByChats: updatedChats };
      }
      // Legacy valueInfos without usedByChats - check if they reference this chat
      if (v.id === chatId || v.id === `chat_${chatId}` || v.chatId === chatId) {
        return null; // Remove legacy chat-specific valueInfos
      }
      // Keep other legacy valueInfos (they might be for matches or CSVs)
      return v;
    }).filter((v: any) => v !== null);
    
    localStorage.setItem("db_value_infos", JSON.stringify(filtered));
  } catch (e) {
    console.error("Error deleting value info for chat:", e);
  }
}

// Generate value info from data (for inspection)
export function generateValueInfoFromData(
  data: any[],
  id: string,
  type: 'match' | 'csv',
  name: string
): any {
  if (!data || data.length === 0) {
    return null;
  }

  const firstRow = data[0];
  const columns = Object.keys(firstRow).filter(col => col !== '__index'); // Exclude internal __index column
  
  // Sample data to avoid memory issues with large files
  // Use first 10,000 rows for value info generation (gives solid idea without processing millions)
  const SAMPLE_SIZE = 10000;
  const sampledData = data.length > SAMPLE_SIZE ? data.slice(0, SAMPLE_SIZE) : data;
  const totalRows = data.length;
  
  const columnInfo = columns.map(col => {
    // OPTIMIZED: Single pass with early exit when we have enough unique values
    const MIN_UNIQUE_VALUES = 6;
    const MAX_UNIQUE_VALUES = 20;
    const uniqueSet = new Set();
    let sampleNullCount = 0;
    
    for (let i = 0; i < sampledData.length; i++) {
      const row = sampledData[i];
      const value = row?.[col];
      
      if (value === null || value === undefined || value === '') {
        sampleNullCount++;
      } else {
        // Only add to set if we haven't reached max yet (saves memory)
        if (uniqueSet.size < MAX_UNIQUE_VALUES) {
          uniqueSet.add(value);
        }
        // Continue loop to count ALL nulls accurately (don't break early)
      }
    }
    
    const allUniqueValues = Array.from(uniqueSet);
    const uniqueValues = allUniqueValues.slice(0, Math.max(MIN_UNIQUE_VALUES, Math.min(allUniqueValues.length, MAX_UNIQUE_VALUES)));
    
    // Estimate null count from sample (more accurate for large datasets)
    const nullCount = totalRows > SAMPLE_SIZE 
      ? Math.round((sampleNullCount / sampledData.length) * totalRows)
      : sampleNullCount;
    
    // Determine type from first non-null value in uniqueSet
    let colType = 'unknown';
    const sampleValue = allUniqueValues[0];
    if (sampleValue !== undefined) {
      if (typeof sampleValue === 'number') {
        colType = 'number';
      } else if (typeof sampleValue === 'string') {
        colType = 'string';
      } else if (typeof sampleValue === 'boolean') {
        colType = 'boolean';
      } else if (Array.isArray(sampleValue)) {
        colType = 'array';
      } else if (typeof sampleValue === 'object') {
        colType = 'object';
      }
    }
    
    return {
      name: col,
      type: colType,
      uniqueValues: uniqueValues,
      nullCount: nullCount
    };
  });

  return {
    id,
    type,
    name,
    columns: columnInfo,
    summary: '', // Will be filled by AI
    generatedAt: Date.now()
  };
}

// Automatically inspect data and generate value info if it doesn't exist
// Auto-inspect data and save value info (now supports chatId tracking)
export function autoInspectData(
  data: any[],
  id: string,
  type: 'match' | 'csv',
  name: string,
  chatId?: string,
  actualTotalRows?: number // ACTUAL total row count in the full dataset (not sample size)
): void {
  if (!data || data.length === 0) {
    return;
  }

  // Check if value info already exists
  const existing = getValueInfo(id, type);
  if (existing && existing.summary) {
    // Already has summary, skip
    return;
  }

  // Generate value info structure
  const valueInfo = generateValueInfoFromData(data, id, type, name);
  if (!valueInfo) {
    return;
  }

  // Generate a CONCISE summary to avoid localStorage quota issues
  const columns = valueInfo.columns;
  const sampleSize = data.length; // How many rows we analyzed
  const totalRows = actualTotalRows || sampleSize; // ACTUAL total rows in full dataset

  // Create a compact summary with CRYSTAL CLEAR distinction between sample and total
  let summary = '';
  if (sampleSize < totalRows) {
    summary = `Dataset: ${totalRows.toLocaleString()} TOTAL ROWS (sampled ${sampleSize.toLocaleString()} rows for this summary), ${columns.length} columns.\n`;
    summary += `IMPORTANT: This is a SUMMARY, not actual data - write code to analyze specifics. Analyzed ${sampleSize.toLocaleString()} sample rows, NOT all ${totalRows.toLocaleString()} rows. Unique values are from sample only.\n\n`;
  } else {
    summary = `Dataset: ${totalRows.toLocaleString()} rows (all rows analyzed), ${columns.length} columns.\n`;
    summary += `NOTE: This is a SUMMARY, not actual data - write code to analyze specifics. Unique values show sample only (max 20 per column).\n\n`;
  }

  // Add compact column details (type and unique count only - no samples to save tokens)
  summary += columns.map((c: any) => {
    const uniqueCount = c.uniqueValues?.length || 0;
    const nullPart = c.nullCount > 0 ? `, ${c.nullCount} null` : '';
    return `${c.name} (${c.type}, ~${uniqueCount}+ unique${nullPart})`;
  }).join('\n');

  valueInfo.summary = summary;
  
  // Save the value info
  saveValueInfo(valueInfo, chatId);
}

// Send chat message with streaming support
export async function sendChatMessage(
  message: string,
  images: string[],
  conversationHistory: Message[],
  matchData: MatchData | null,
  model: string = DEFAULT_MODEL,
  reasoningEnabled: boolean = false,
  volleyballContextEnabled: boolean = true,
  maxFollowupDepth: number = 0,
  currentFollowupDepth: number = 0,
  isLastFollowup: boolean = false,
  onDelta: (chunk: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
  csvId: string | string[] | null = null,
  csvFilterColumns: string[] | null = null,
  csvFilterValues: Record<string, string | string[] | null> | null = null,
  chatId?: string,
  matchFilterColumns: string[] | null = null,
  matchFilterValues: Record<string, string | string[] | null> | null = null,
  selectedContextSectionId?: string | null,
  onCsvProgress?: (progress: { file: string; percent: number; rows?: number }) => void,
  signal?: AbortSignal,
  onCodeExecutionRequest?: (blocks: CodeBlock[]) => Promise<{ approved: boolean; editedBlocks?: CodeBlock[] }>
) {
  // Input validation
  if (!message || typeof message !== 'string') {
    onError('Message is required and must be a string');
    return;
  }
  if (message.length > 500000) {
    onError('Message too long (max 500KB)');
    return;
  }
  if (!model || typeof model !== 'string') {
    onError('Model is required');
    return;
  }
  if (!Array.isArray(images)) {
    onError('Images must be an array');
    return;
  }
  if (!Array.isArray(conversationHistory)) {
    onError('Conversation history must be an array');
    return;
  }
  
  try {
    // Check if model has API key
    if (!modelHasApiKey(model)) {
      onError(`No API key configured for this model. Please add an API key in Settings.`);
      return;
    }

    if (images.length > 0) {
      // Vision request with images - pass directly to OpenRouter API

      // Build context message (images will be added in apiProviders.ts)
      const contextMessage = matchData && volleyballContextEnabled
        ? buildVolleyballContext(message, matchData, conversationHistory, volleyballContextEnabled, null, null, null, selectedContextSectionId, maxFollowupDepth, currentFollowupDepth, isLastFollowup, csvId, chatId)
        : buildConversationContext(message, conversationHistory, undefined, volleyballContextEnabled, false, false, selectedContextSectionId); // hasData = false (no data available), but include context section if selected
      
      // Use direct API call with images
      await callApi({
        prompt: contextMessage,
        model,
        images: images, // Pass images directly
        conversationHistory: conversationHistory,
        reasoningEnabled: reasoningEnabled,
        signal: signal,
        onDelta,
        onDone,
        onError
      });
      return;
    } else {
      // Text-only request
      const hasCsvFiltersSet = hasCsvFilters(csvFilterColumns, csvFilterValues);
      let csvData: any[] | null = null;

      // Check if value info already exists
      const csvIds = csvId ? (Array.isArray(csvId) ? csvId : [csvId]) : [];
      const hasValueInfo = hasValueInfoForCsvs(csvId, chatId);

      // Check if current_selection exists for this CSV BEFORE loading
      let hasCurrentSelectionForCsv = false;
      let currentSelectionData: any[] | null = null;
      let currentSelection: ValueInfo | null = null;
      if (csvId) {
        currentSelection = getValueInfo('current_selection', 'csv', chatId);
        // CRITICAL FIX: Check if current_selection is for the correct CSV file
        // current_selection.id is always 'current_selection', we need to check referencedValueInfoId
        if (currentSelection && currentSelection.referencedValueInfoId && 
            csvIds.some(id => currentSelection!.referencedValueInfoId === id)) {
          hasCurrentSelectionForCsv = true;
          currentSelectionData = getCurrentSelectionData(currentSelection);
        }
      }

      if (csvId && hasCsvFiltersSet) {
        // CSV filters are set - check if we already have matching valueInfo before loading
        // Verify currentSelection is for the correct CSV file
        const isForCorrectCsv = currentSelection && currentSelection.referencedValueInfoId && 
          csvIds.some(id => currentSelection!.referencedValueInfoId === id);
        const hasMatchingSelection = isForCorrectCsv && currentSelection && 
          matchesCurrentSelection(currentSelection, csvFilterColumns, csvFilterValues);
        
        if (hasCurrentSelectionForCsv && currentSelectionData && Array.isArray(currentSelectionData) && currentSelectionData.length > 0) {
          // Use existing current_selection data if available and valid
          csvData = currentSelectionData;
        } else if (hasMatchingSelection && hasValueInfo) {
          // ValueInfo already exists for this filtered selection - skip loading
          // DuckDB will handle queries on-demand
          csvData = null; // DuckDB will handle queries
        } else {
          // Load CSV data with filtering - this will create filtered data and valueInfo
          csvData = await loadCsvDataWithValueInfo(csvId, csvFilterColumns, csvFilterValues, chatId, onCsvProgress);
        }
      } else if (csvId && !hasCsvFiltersSet) {
        // CRITICAL FIX: When CSV ID is provided but no filters, we still need data for execution
        // The executor will load from DuckDB on-demand, but we need to signal that CSV data exists
        // Set csvData to empty array as signal that CSV exists (executor will load actual data)
        // But ONLY if valueInfo exists - if no valueInfo, don't load yet
        if (hasValueInfo) {
          csvData = null; // Executor will load from DuckDB using csvId
        } else {
          // No valueInfo yet - don't attempt to load
          csvData = null;
        }
      }
      // Get CSV file name(s)
      const csvFileName = await getCsvFileNames(csvId, chatId);
      
      // Check if there's a current_selection valueInfo
      let dataForExecution: any[] | null = null;
      let useCurrentSelection = false;

      // Check if we have filter selections
      const hasMatchFilterSelections = hasMatchFilters(matchFilterColumns, matchFilterValues);
      // CRITICAL FIX: hasCsvFilterSelections should be true if we have CSV data OR valueInfo (even without filters)
      // This ensures CSV files work even when no filters are applied
      const hasCsvFilterSelections = csvData !== null || hasValueInfo;

      // Get current selection value info
      let currentSelectionValueInfo = getCurrentSelectionValueInfo(
        hasCsvFilterSelections,
        hasMatchFilterSelections,
        csvId,
        hasValueInfo,
        chatId
      );

      // CRITICAL: Validate that currentSelectionValueInfo matches the actual CSV file
      if (currentSelectionValueInfo && csvFileName && currentSelectionValueInfo.type === 'csv') {
        if (currentSelectionValueInfo.name !== csvFileName) {
          console.error(`❌ CURRENT_SELECTION MISMATCH - REJECTED:
  Expected CSV: "${csvFileName}"
  But current_selection is for: "${currentSelectionValueInfo.name}"
  This prevents sending wrong column data (like PGN) to AI.`);
          currentSelectionValueInfo = null; // Reject mismatched current_selection
        } else {
        }
      }

      // Verify value info belongs to current chat
      const belongsToChatCheck = belongsToCurrentChat(currentSelectionValueInfo, chatId);

      // Verify stored selection matches current selection
      const filterColumnsToCheck = hasCsvFilterSelections && !hasMatchFilterSelections ? csvFilterColumns : matchFilterColumns;
      const filterValuesToCheck = hasCsvFilterSelections && !hasMatchFilterSelections ? csvFilterValues : matchFilterValues;
      const hasFilterSelections = hasCsvFilterSelections || hasMatchFilterSelections;

      const matchesSelection = hasFilterSelections
        ? matchesCurrentSelection(currentSelectionValueInfo, filterColumnsToCheck, filterValuesToCheck)
        : true;

      // Only use current selection if it belongs to chat and matches current selection
      // CRITICAL FIX: Only use current_selection if we actually HAVE filter selections
      // Without filters, we should use the base CSV data, not stale current_selection
      if (currentSelectionValueInfo && belongsToChatCheck && matchesSelection && hasFilterSelections) {
        // Check if data is already in memory
        const selectionData = getCurrentSelectionData(currentSelectionValueInfo);
        if (selectionData) {
          dataForExecution = selectionData;
          useCurrentSelection = true;
        } else if (currentSelectionValueInfo.filterColumns && currentSelectionValueInfo.filterValues) {
          // Value Info exists but data not in memory - re-query using stored filter criteria
          try {
            const { isDatabaseConnected, getRowCount, executeDbQuery } = await import("@/lib/database");
            if (isDatabaseConnected()) {
              const tableName = localStorage.getItem("db_table_name") || "combined_dvw";
              const whereConditions: string[] = [];
              currentSelectionValueInfo.filterColumns.forEach((col: string) => {
                const filterValue = currentSelectionValueInfo.filterValues[col];
                if (filterValue) {
                  // PostgreSQL uses double quotes for identifiers
                  const quotedCol = `"${col.replace(/"/g, '""')}"`;
                  // Handle array values (multiple selection) with IN clause
                  if (Array.isArray(filterValue)) {
                    const escapedValues = filterValue.map(val => {
                      const escaped = String(val).replace(/'/g, "''");
                      return `'${escaped}'`;
                    });
                    whereConditions.push(`${quotedCol} IN (${escapedValues.join(', ')})`);
                  } else {
                    // Single value: use = operator
                    const escapedValue = String(filterValue).replace(/'/g, "''");
                    whereConditions.push(`${quotedCol} = '${escapedValue}'`);
                  }
                }
              });
              
              if (whereConditions.length > 0) {
                // Get row count to estimate size - no artificial limits with DuckDB
                let rowCount = 0;
                try {
                  rowCount = await getRowCount(tableName, whereConditions);
                } catch (err) {
                  rowCount = 0;
                }
                
                // Build query with PostgreSQL syntax (double quotes for identifiers)
                const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
                
                // NO LIMIT - DuckDB can handle millions of rows efficiently
                // Only apply limit if explicitly needed for memory management
                const query = `SELECT * FROM ${quotedTable} WHERE ${whereConditions.join(' AND ')}`;
                
                let rawRows: any[] = [];
                try {
                  rawRows = await executeDbQuery(query);
                } catch (err: any) {
                  // Check for size limit error
                  if (err?.message?.includes('response is too large') || err?.message?.includes('507')) {
                    throw new Error('Selection too large - please select fewer items (database response limit: ~64MB)');
                  }
                    throw err;
                  }
                
                // Log actual rows returned for monitoring
                
                if (rawRows && rawRows.length > 0) {
                  // Add data to Value Info in memory only (not saved)
                  currentSelectionValueInfo.data = rawRows;
                  // Store row count information
                  currentSelectionValueInfo.rowCount = rawRows.length;
                  currentSelectionValueInfo.totalRowCount = rowCount;
                  // NO LIMIT - All rows are loaded
                  currentSelectionValueInfo.isLimited = false;
                  dataForExecution = rawRows;
                  useCurrentSelection = true;
                }
              }
            }
          } catch (e) {
            console.error('Error re-querying data from Value Info:', e);
          }
        }
      }
      
      // Only query database if we have match filters (not CSV filters - CSV data is loaded separately via getCsvFileData)
      if (!dataForExecution && hasMatchFilterSelections && !hasCsvFilterSelections && matchFilterColumns && matchFilterValues) {
        // Filter selections exist but Value Info doesn't - query the data now
        try {
          const { isDatabaseConnected } = await import("@/lib/database");
          if (isDatabaseConnected()) {
            const tableName = localStorage.getItem("db_table_name") || "combined_dvw";
            
            // Build WHERE clause to match the selected grouped row
            // Only use columns that have values (display columns won't have values, so they're automatically excluded)
            // Filter to only include columns that actually have values
            const groupColumns = matchFilterColumns.filter(col => matchFilterValues[col] != null);
            const groupValues: Record<string, string | string[] | null> = {};
            groupColumns.forEach(col => {
              if (matchFilterValues[col] != null) {
                groupValues[col] = matchFilterValues[col];
              }
            });
            
            const whereConditions: string[] = [];
            groupColumns.forEach(col => {
              const filterValue = groupValues[col];
              if (filterValue) {
                // PostgreSQL uses double quotes for identifiers
                const quotedCol = `"${col.replace(/"/g, '""')}"`;
                // Handle array values (multiple selection) with IN clause
                if (Array.isArray(filterValue)) {
                  const escapedValues = filterValue.map(val => {
                    const escaped = String(val).replace(/'/g, "''");
                    return `'${escaped}'`;
                  });
                  whereConditions.push(`${quotedCol} IN (${escapedValues.join(', ')})`);
                } else {
                  // Single value: use = operator
                  const escapedValue = String(filterValue).replace(/'/g, "''");
                  whereConditions.push(`${quotedCol} = '${escapedValue}'`);
                }
              }
            });
            
            if (whereConditions.length > 0) {
              // Get row count for information (no limits applied)
              const { getRowCount, executeDbQuery } = await import("@/lib/database");
              
              let rowCount = 0;
              try {
                rowCount = await getRowCount(tableName, whereConditions);
              } catch (err) {
                rowCount = 0;
              }
              
              // Build query with PostgreSQL syntax (double quotes for identifiers)
              // NO LIMIT - Query all rows that match the filters
              const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
              const query = `SELECT * FROM ${quotedTable} WHERE ${whereConditions.join(' AND ')}`;
              
              
              // Execute query via API
              let rawRows: any[] = [];
              try {
                rawRows = await executeDbQuery(query);
              } catch (err: any) {
                // Check for size limit error
                if (err?.message?.includes('response is too large') || err?.message?.includes('507')) {
                  throw new Error('Selection too large - please select fewer items (database response limit: ~64MB)');
                }
                console.error('Error querying data:', err);
                  throw err;
                }
              
              
              if (rawRows && rawRows.length > 0) {
                // Generate Value Info for this selection
                // Only use group columns (columns with values) for the selection key and name
                const { generateValueInfoFromData } = await import("@/lib/chatApi");
                const selectionKey = `${groupColumns.sort().join(',')}:${Object.keys(groupValues).sort().map(k => `${k}=${groupValues[k]}`).join(',')}`;
                const selectionHash = selectionKey.split('').reduce((acc, char) => {
                  acc = ((acc << 5) - acc) + char.charCodeAt(0);
                  return acc & acc;
                }, 0);
                const uniqueValueInfoId = chatId ? `selection_${chatId}_${Math.abs(selectionHash)}` : `selection_${Math.abs(selectionHash)}`;
                
                // Build name with truncation for arrays
                const nameParts = groupColumns.map(col => {
                  const val = groupValues[col];
                  if (Array.isArray(val)) {
                    const maxDisplay = 2;
                    if (val.length > maxDisplay) {
                      return `${col}=${val.slice(0, maxDisplay).join(',')}... (${val.length} total)`;
                    }
                    return `${col}=${val.join(',')}`;
                  }
                  return `${col}=${val}`;
                });
                const valueInfo = generateValueInfoFromData(
                  rawRows,
                  uniqueValueInfoId,
                  'match',
                  `Selected Group: ${nameParts.join(', ')}`
                );
                
                if (valueInfo) {
                  // DO NOT store data in Value Info - it causes localStorage quota issues
                  // Instead, store filter criteria so we can re-query when needed
                  // Only store group columns (columns with values), not display columns
                  valueInfo.filterColumns = groupColumns;
                  valueInfo.filterValues = groupValues;
                  // Store row count information
                  valueInfo.rowCount = rawRows.length;
                  valueInfo.totalRowCount = rowCount;
                  // NO LIMIT - All rows are loaded
                  valueInfo.isLimited = false;
                  
                  // Generate a CONCISE summary to avoid localStorage quota issues
                  if (!valueInfo.summary || valueInfo.summary.trim() === '') {
                    const columns = valueInfo.columns;
                    const totalRows = rawRows.length;
                    
                    let summary = `Dataset: ${totalRows.toLocaleString()} rows${rowCount > 0 && rowCount !== totalRows ? ` (of ${rowCount.toLocaleString()} total)` : ''}, ${columns.length} columns.\n`;
                    summary += `NOTE: Unique counts below are from SAMPLE (max 20 shown per column), NOT total unique values in dataset.\n\n`;
                    
                    // Add compact column details (type and unique count only - no samples to save tokens)
                    summary += columns.map((c: any) => {
                      const uniqueCount = c.uniqueValues?.length || 0;
                      const nullPart = c.nullCount > 0 ? `, ${c.nullCount} null` : '';
                      return `${c.name} (${c.type}, ~${uniqueCount}+ unique${nullPart})`;
                    }).join('\n');
                    
                    valueInfo.summary = summary;
                  }
                  
                  // Save Value Info WITHOUT data (to avoid quota issues)
                  const valueInfoToSave = { ...valueInfo };
                  delete valueInfoToSave.data; // Remove data before saving
                  saveValueInfo(valueInfoToSave, chatId);
                  
                  // Also save as current_selection (without data)
                  const currentSelectionCopy = {
                    ...valueInfoToSave,
                    id: 'current_selection',
                    uniqueId: uniqueValueInfoId,
                  };
                  saveValueInfo(currentSelectionCopy, chatId);
                  
                  // For execution, we need the data - but don't store it
                  // Create a temporary Value Info object with data for this execution only
                  currentSelectionValueInfo = {
                    ...currentSelectionCopy,
                    data: rawRows, // Only in memory, not saved
                  };
                  dataForExecution = rawRows;
                  useCurrentSelection = true;
                }
              }
            }
          }
        } catch (e) {
          console.error('Error querying data with filters:', e);
        }
      }
      
        // Fallback to matchData if no current_selection
      if (!dataForExecution && matchData && matchData.data && Array.isArray(matchData.data) && matchData.data.length > 0) {
        dataForExecution = matchData.data;
      }
      
      // Pass data directly to CodeExecutor - it can work with just the data array
      // If current_selection exists, pass null for matchData so it uses the data array instead
      // Enable SQL for ALL database data (works at any size), but NEVER for CSV data
      // CRITICAL FIX: Use CSV filters if CSV data is selected AND filters are actually set, not match filters
      // Check if filters actually have values (not just if CSV data exists)
      const csvFiltersExist = csvFilterColumns && csvFilterColumns.length > 0 && csvFilterValues && Object.keys(csvFilterValues).some(col => csvFilterValues[col] != null);
      const matchFiltersExist = matchFilterColumns && matchFilterColumns.length > 0 && matchFilterValues && Object.keys(matchFilterValues).some(col => matchFilterValues[col] != null);
      
      let filterCols = csvFiltersExist ? csvFilterColumns : (useCurrentSelection && currentSelectionValueInfo ? currentSelectionValueInfo.filterColumns : (matchFiltersExist ? matchFilterColumns : null));
      let filterVals = csvFiltersExist ? csvFilterValues : (useCurrentSelection && currentSelectionValueInfo ? currentSelectionValueInfo.filterValues : (matchFiltersExist ? matchFilterValues : null));
      
      // SQL is available ONLY for database data (matchData or current_selection from remote Neon DB via Cloudflare Workers)
      // NOT for CSV files - CSV files use JavaScript code execution with DuckDB for efficient data retrieval
      // The 50k limit only affects how much data is loaded into memory for JavaScript
      // SQL queries can always access the full dataset regardless of the 50k limit
      const allowSql = !csvData && (!!matchData || (useCurrentSelection && currentSelectionValueInfo && !currentSelectionValueInfo.type?.includes('csv')));
      
      // Determine what data to pass to CodeExecutor
      // Priority: CSV data (when CSV filters are set) > current_selection > matchData > csvData (fallback)
      let executionData = dataForExecution;
      
      // IMPORTANT: When CSV filters are set, ALWAYS use CSV data for execution, even if current_selection exists
      // This ensures CSV data is available when __SELECT_ALL__ or other CSV filters are used
      // NO LIMITS - Use ALL data for execution (user requested no capping)
      
      if (hasCsvFilterSelections && csvData && Array.isArray(csvData) && csvData.length > 0) {
        // CSV filters are set - use CSV data directly (ALL data, no sampling)
        executionData = csvData;
      } else if (!executionData && csvData && Array.isArray(csvData) && csvData.length > 0) {
        // Use CSV data if no matchData or current_selection (fallback) - ALL data, no sampling
        executionData = csvData;
      } else if (csvData && Array.isArray(csvData) && csvData.length > 0) {
      } else if (csvId && (!csvData || csvData.length === 0)) {
        // CRITICAL: Don't load blob if value info exists - use DuckDB for execution instead
        // Value info indicates data is available, just not in memory
        // Only load if we don't have value info AND we don't have current_selection data
        // Also check if DuckDB is available - if so, don't load blob
        const csvIds = Array.isArray(csvId) ? csvId : [csvId];
        const hasAnyValueInfo = csvIds.some(id => {
          const valueInfo = getValueInfo(id, 'csv', chatId);
          return !!valueInfo;
        });
        
        if (hasAnyValueInfo || hasCurrentSelectionForCsv) {
          // Don't load - execution will use DuckDB or current_selection data
          // executionData will be set from dataForExecution or current_selection later
          // If executionData is still null after all checks, CodeExecutor will handle it via DuckDB
        } else {
          // Check if DuckDB is available - if so, don't load blob, let CodeExecutor use DuckDB
          try {
            const { isDuckDBInitialized, isFileRegisteredInDuckDB } = await import("@/lib/duckdb");
            if (isDuckDBInitialized() && csvIds.some(id => isFileRegisteredInDuckDB(id))) {
              // Don't load blob, but ensure executionData is set from csvData if available
              // CodeExecutor will use DuckDB for queries, but csvData is still needed for context
              if (csvData && Array.isArray(csvData) && csvData.length > 0) {
                executionData = csvData;
              }
            } else {
              // For large datasets that were cleared from memory, try to load data
              // NO LIMITS - Load ALL data (user requested no capping)
              try {
                // Load data - DuckDB will return all rows, no sampling
                const loadedData = await getCsvFileData(csvId, csvFilterColumns, csvFilterValues, undefined);
                if (loadedData && Array.isArray(loadedData) && loadedData.length > 0) {
                  // Use ALL data - no sampling, no limits
                  executionData = loadedData;
                }
              } catch (e) {
              }
            }
          } catch (e) {
          }
        }
      }
      
      // Auto-generate value info for CSV files if they don't have one yet
      // This happens when user sends a message without clicking the checkmark
      // IMPORTANT: Always create value info after CSV data loads, even if filters are applied
      if (csvData && Array.isArray(csvData) && csvData.length > 0 && csvId) {
        const csvIds = Array.isArray(csvId) ? csvId : [csvId];
        for (const id of csvIds) {
          // Check if value info already exists for this CSV
          const existingValueInfo = getValueInfo(id, 'csv', chatId);
          if (!existingValueInfo) {
            // Generate value info for this CSV file
            const files = getCsvFilesFromStorageSync();
            const file = files.find((f: any) => f.id === id);
            if (file) {
              // Pass actual total rows from metadata (important for chunked files where csvData might be sample)
              const actualTotalRows = file.rowCount || csvData.length;
              autoInspectData(csvData, id, 'csv', file.name, chatId, actualTotalRows);
            }
          }
        }
      }
      
      // Pass CSV data to CodeExecutor so it's available as 'csvData' variable
      // When CSV filters are set, pass csvData even if executionData is from current_selection
      // CRITICAL FIX: ALWAYS pass csvId to CodeExecutor when CSV data is involved
      // The CodeExecutor needs csvId to execute DuckDB queries with await query()
      // The filters (filterCols/filterVals) will be passed separately and applied by DuckDB
      const csvIdForExecutor = csvId;
      if (csvIdForExecutor && filterCols && filterCols.length > 0) {
      } else if (csvIdForExecutor) {
      }
      // CRITICAL: Create executor ONCE and reuse for all blocks in this response chain
      // This preserves executionState (including 'result' variable) across blocks within the SAME AI exchange
      // State is automatically cleared when a NEW user message starts
      const executor = new CodeExecutor(useCurrentSelection ? null : matchData, executionData || null, filterCols || null, filterVals || null, allowSql, csvIdForExecutor);
      
      // IMPORTANT: Expose csvData in execution environment even when using other data sources
      // This ensures csvData is always available when CSV filters are set
      if (hasCsvFilterSelections && csvData && Array.isArray(csvData) && csvData.length > 0) {
        // Expose csvData in the execution environment
        (executor as any).csvData = csvData;
      }
      
      // Log what data is being used for execution
      if (useCurrentSelection && dataForExecution) {
      } else if (matchData && matchData.data) {
      } else if (csvData && Array.isArray(csvData) && csvData.length > 0) {
      } else if (csvIdForExecutor) {
        // Data is available via DuckDB even if not in memory
      } else {
      }
      let assistantResponse = '';
      
      // Check if we actually have data for execution (not just selections)
      // IMPORTANT: Include executionData in the check, and also check csvData
      const hasActualData = (executionData && Array.isArray(executionData) && executionData.length > 0) ||
                           (dataForExecution && Array.isArray(dataForExecution) && dataForExecution.length > 0) || 
                           (matchData && matchData.data && Array.isArray(matchData.data) && matchData.data.length > 0) ||
                           (csvData && Array.isArray(csvData) && csvData.length > 0);
      
      // Prioritize CSV data when CSV filters are set, then current_selection, then matchData
      // Use buildVolleyballContext which now handles current_selection properly
      let contextMessage: string;
      // Removed verbose logging to reduce token usage
      
      // IMPORTANT: When CSV filters are set, prioritize CSV data over current_selection
      // CSV data is already loaded and filtered via getCsvFileData, so use it directly
      // For large datasets, don't pass data to context to prevent performance issues
      const LARGE_CONTEXT_THRESHOLD = 100000; // Don't pass datasets >100k rows to context
      
      // Removed redundant hasDataAvailable check - buildVolleyballContext handles this
      
      if (hasCsvFilterSelections && volleyballContextEnabled) {
        // Check if we have data available (either csvData or via current_selection)
        const csvDataForContext = csvData && Array.isArray(csvData) && csvData.length > 0 
          ? csvData 
          : (dataForExecution && Array.isArray(dataForExecution) && dataForExecution.length > 0)
            ? dataForExecution
            : null;
        
        // OPTIMIZED: Get value info for context
        // Priority: 1) currentSelectionValueInfo (already validated), 2) csvFileValueInfo (validate it)
        let valueInfoForContext = currentSelectionValueInfo;
        
        // CRITICAL FIX: If filters are applied, prefer current_selection valueInfo over base CSV valueInfo
        // This ensures the summary reflects the filtered data, not the full dataset
        if (csvFilterColumns && csvFilterColumns.length > 0 && csvFilterValues && Object.keys(csvFilterValues).length > 0) {
          // Filters are active - use current_selection if available
          const currentSelection = getValueInfo('current_selection', 'csv', chatId);
          if (currentSelection && currentSelection.referencedValueInfoId) {
            const csvIds = Array.isArray(csvId) ? csvId : [csvId];
            if (csvIds.includes(currentSelection.referencedValueInfoId)) {
              valueInfoForContext = currentSelection;
            }
          }
        }
        
        // Only fetch csvFileValueInfo if we don't have valueInfoForContext and no filters are applied
        if (!valueInfoForContext && csvId && csvFileName) {
          const csvIdsForValueInfo = Array.isArray(csvId) ? csvId : [csvId];
          let csvFileValueInfo = null;

          if (csvIdsForValueInfo.length > 1) {
            // Multiple files - look for combined value info
            const combinedId = `combined_${csvIdsForValueInfo.sort().join('_')}`;
            csvFileValueInfo = getValueInfo(combinedId, 'csv', chatId);
          } else if (csvIdsForValueInfo.length === 1) {
            // Single file - look for single value info
            csvFileValueInfo = getValueInfo(csvIdsForValueInfo[0], 'csv', chatId);
          }

          // CRITICAL: Validate that csvFileValueInfo matches the actual CSV file
          if (csvFileValueInfo) {
            if (csvFileValueInfo.name === csvFileName) {
              valueInfoForContext = csvFileValueInfo;
            } else {
              console.error(`❌ VALUE INFO MISMATCH - REJECTED:
  Expected CSV: "${csvFileName}"
  Got valueInfo for: "${csvFileValueInfo.name}"
  This prevents sending wrong column data to AI.`);
            }
          }
        }
        
        if (csvDataForContext && csvDataForContext.length > 0) {
          // Log what columns are being sent to AI
          if (valueInfoForContext && valueInfoForContext.columns) {
            const columnNames = valueInfoForContext.columns.map((c: any) => c.name).join(', ');
          } else if (csvDataForContext[0]) {
            const columnNames = Object.keys(csvDataForContext[0]).filter(c => c !== '__index').join(', ');
          }
          
          if (csvDataForContext.length > LARGE_CONTEXT_THRESHOLD) {
            // Very large dataset - don't pass to context, just metadata
            // Data will be available via DuckDB for code execution
            // hasData = true because csvData exists (even if not passed to context)
            // CRITICAL: Pass csvData as null but ensure valueInfoForContext is passed so hasDataSelected is true
            // Ensure valueInfoForContext is set so buildVolleyballContext knows data is available
            // Use already validated valueInfoForContext instead of re-fetching
            contextMessage = buildVolleyballContext(message, null, conversationHistory, volleyballContextEnabled, null, csvFileName, valueInfoForContext, selectedContextSectionId, maxFollowupDepth, currentFollowupDepth, isLastFollowup, csvId, chatId);
            contextMessage += `\n\nLarge dataset (${csvDataForContext.length.toLocaleString()} rows) - use DuckDB SQL: await query('SELECT...').`;
        } else {
            // Include CSV data in context for smaller datasets
            // hasData = true ensures coding rules are included
            contextMessage = buildVolleyballContext(message, null, conversationHistory, volleyballContextEnabled, csvDataForContext, csvFileName, valueInfoForContext, selectedContextSectionId, maxFollowupDepth, currentFollowupDepth, isLastFollowup, csvId, chatId);
          }
        } else if (useCurrentSelection && currentSelectionValueInfo) {
          // Data is available via current_selection even if csvData is null
          const dataFromSelection = currentSelectionValueInfo.data && Array.isArray(currentSelectionValueInfo.data) && currentSelectionValueInfo.data.length > 0
            ? currentSelectionValueInfo.data
            : null;
          // hasData = true if dataFromSelection exists OR valueInfo exists (indicates data is available via DuckDB)
          contextMessage = buildVolleyballContext(message, null, conversationHistory, volleyballContextEnabled, dataFromSelection, csvFileName, currentSelectionValueInfo, selectedContextSectionId, maxFollowupDepth, currentFollowupDepth, isLastFollowup, csvId, chatId);
        } else if (hasValueInfo || valueInfoForContext) {
          // Value info exists - data is available, just not in memory
          // hasData = true because value info indicates data is selected and available via DuckDB
          // Get the actual value info to pass to buildVolleyballContext so it includes column names and unique values
          contextMessage = buildVolleyballContext(message, null, conversationHistory, volleyballContextEnabled, null, csvFileName, valueInfoForContext, selectedContextSectionId, maxFollowupDepth, currentFollowupDepth, isLastFollowup, csvId, chatId);
        } else if (csvId) {
          // CRITICAL FIX: DuckDB skipped loading data, but csvId exists - data is available via DuckDB
          // Even without valueInfo, if csvId exists, we have data available
          // This handles the case where DuckDB skips full data load for performance
          contextMessage = buildVolleyballContext(message, null, conversationHistory, volleyballContextEnabled, null, csvFileName, null, selectedContextSectionId, maxFollowupDepth, currentFollowupDepth, isLastFollowup, csvId, chatId);
          contextMessage += '\n\n💡 Data available via DuckDB - use await query(\'SELECT...\') to access.';
        } else {
          // CSV filters are set but data failed to load and no csvId
          contextMessage = buildVolleyballContext(message, null, conversationHistory, volleyballContextEnabled, null, csvFileName, null, selectedContextSectionId, maxFollowupDepth, currentFollowupDepth, isLastFollowup, csvId, chatId);
          contextMessage += '\n\n⚠️ CSV data loading. Use DuckDB SQL: await query(\'SELECT...\') once loaded.';
        }
      } else if (csvId && !hasCsvFilterSelections && volleyballContextEnabled) {
        // CSV ID provided but no filter selections in this message
        // BUT: Check if we have value info or current_selection - if so, data is available
        const csvIds = Array.isArray(csvId) ? csvId : [csvId];
        const hasAnyValueInfo = csvIds.some(id => {
          const valueInfo = getValueInfo(id, 'csv', chatId);
          return !!valueInfo;
        });
        const hasCsvCurrentSelection = useCurrentSelection && currentSelectionValueInfo && 
                                      currentSelectionValueInfo.type === 'csv' &&
                                      csvIds.some(id => currentSelectionValueInfo.id === id || currentSelectionValueInfo.uniqueId?.includes(id));
        
        if (hasAnyValueInfo || hasCsvCurrentSelection) {
          // Value info exists - data is available, build context with it
          // hasData = true because value info indicates data is selected
          if (hasCsvCurrentSelection && currentSelectionValueInfo) {
            // Use current_selection which has the CSV data
            contextMessage = buildVolleyballContext(message, null, conversationHistory, volleyballContextEnabled, null, csvFileName, currentSelectionValueInfo, selectedContextSectionId, maxFollowupDepth, currentFollowupDepth, isLastFollowup, csvId, chatId);
          } else {
            // Use buildVolleyballContext with CSV file info (will include value info if available)
            // hasData = true because hasAnyValueInfo indicates data is selected
            // Get value info for the CSV file to pass to buildVolleyballContext
            let csvFileValueInfo = null;

            if (csvIds.length > 1) {
              // Multiple files - look for combined value info
              const combinedId = `combined_${[...csvIds].sort().join('_')}`;
              csvFileValueInfo = getValueInfo(combinedId, 'csv', chatId);
            } else if (csvIds.length === 1) {
              // Single file - look for single value info
              csvFileValueInfo = getValueInfo(csvIds[0], 'csv', chatId);
            }

            // CRITICAL FIX: Validate csvFileValueInfo matches CSV file name
            if (csvFileValueInfo && csvFileName && csvFileValueInfo.name !== csvFileName) {
              console.error(`❌ VALUE INFO MISMATCH (else branch):
  CSV file: "${csvFileName}"
  ValueInfo: "${csvFileValueInfo.name}"
  Rejecting mismatched valueInfo.`);
              csvFileValueInfo = null;
            }
            
            // Pass csvFileValueInfo so buildVolleyballContext can include column names and unique values
            contextMessage = buildVolleyballContext(message, null, conversationHistory, volleyballContextEnabled, null, csvFileName, csvFileValueInfo, selectedContextSectionId, maxFollowupDepth, currentFollowupDepth, isLastFollowup, csvId, chatId);
          }
        } else {
          // No value info yet, but csvId exists - data is available via DuckDB
          // CRITICAL: On first message, DuckDB table creation happens asynchronously, but csvId existing means data will be available
          // Set hasData = true so coding rules are included
          contextMessage = buildVolleyballContext(message, null, conversationHistory, volleyballContextEnabled, null, csvFileName, null, selectedContextSectionId, maxFollowupDepth, currentFollowupDepth, isLastFollowup, csvId, chatId);
          contextMessage += `\n\n💡 CSV file (${csvFileName || 'unknown'}) available via DuckDB - use await query('SELECT...') to access. Column info will be available after table registration completes.`;
        }
      } else if (useCurrentSelection && currentSelectionValueInfo && volleyballContextEnabled && hasActualData) {
        // hasData = true because hasActualData is true
        contextMessage = buildVolleyballContext(message, null, conversationHistory, volleyballContextEnabled, csvData, csvFileName, currentSelectionValueInfo, selectedContextSectionId, maxFollowupDepth, currentFollowupDepth, isLastFollowup, csvId, chatId);
      } else if (matchData && volleyballContextEnabled && hasActualData) {
        // hasData = true because hasActualData is true
        contextMessage = buildVolleyballContext(message, matchData, conversationHistory, volleyballContextEnabled, csvData, csvFileName, null, selectedContextSectionId, maxFollowupDepth, currentFollowupDepth, isLastFollowup, csvId, chatId);
      } else if (csvData && Array.isArray(csvData) && csvData.length > 0 && volleyballContextEnabled) {
        // hasData = true because csvData exists
        contextMessage = buildVolleyballContext(message, null, conversationHistory, volleyballContextEnabled, csvData, csvFileName, null, selectedContextSectionId, maxFollowupDepth, currentFollowupDepth, isLastFollowup, csvId, chatId);
      } else {
        // hasData = false because no data is available
        contextMessage = buildConversationContext(message, conversationHistory, undefined, volleyballContextEnabled, false, false, selectedContextSectionId, maxFollowupDepth, currentFollowupDepth, isLastFollowup);
      }
      
      
      // Add user message to LangChain memory
      if (chatId) {
        try {
          const { getOrCreateMemoryManager } = await import('@/lib/memoryStore');
          const memoryManager = getOrCreateMemoryManager(chatId);
          await memoryManager.addMessage('user', message);
        } catch (error) {
          // Continue even if LangChain fails
        }
      }
      
      // Use LangChain memory for conversation history management
      const processedHistory = await getConversationHistory(conversationHistory, chatId);
      
      await callApi({
        prompt: contextMessage,
        model,
        images: [],
        conversationHistory: processedHistory, // LangChain managed history
        reasoningEnabled: reasoningEnabled,
        signal: signal,
        onDelta: (chunk: string) => {
          assistantResponse += chunk;
          onDelta(chunk);
        },
        onDone: async () => {
          try {
            // Wait a bit to ensure full response is collected (especially for long code blocks)
            
            
            // Check if response contains code execution request
            const blocks = executor.detectCodeBlocksInStream(assistantResponse);
            const executionResults: string[] = [];
            
            // DEBUG: Log if multiple code blocks detected (may indicate AI repeating itself)
            if (blocks.length > 3) {
            }
            
            // Check for Python code that won't execute - show warning to user
            // This includes both code blocks and inline Python patterns
            const pythonPatterns = [
              /```python[\s\S]*?```/i,
              /```py[\s\S]*?```/i,
              /^import\s+(pandas|numpy|pd|np|duckdb)\s+/im,
              /^from\s+(pandas|numpy|duckdb)\s+import/im,
              /pd\.|np\.|df\.|duckdb\.|con\s*=\s*duckdb\.connect|con\.execute|con\.query|\.fetchall\s*\(|\.fetchdf\s*\(|\.shape\b|\.dtypes\b|\.head\s*\(|\.info\s*\(|\.isnull\s*\(|\.read_csv\s*\(|SHOW\s+TABLES|SHOW\s+SCHEMAS|information_schema/i
            ];
            const hasPythonCode = pythonPatterns.some(pattern => pattern.test(assistantResponse));
            if (hasPythonCode) {
              // Python code detected - show warning (even if some blocks were executed)
              const pythonWarning = `⚠️ **Python code detected - JavaScript only**\n\nThis system only supports JavaScript code execution. Python code (import pandas, import duckdb, df.shape, con.execute, etc.) will NOT execute.\n\n**Use JavaScript instead:**\n\`\`\`execute\n// Count rows\ncsvData.length\n\n// Get columns\nObject.keys(csvData[0])\n\n// Filter data\ncsvData.filter(row => row.column === 'value')\n\n// First 5 rows\ncsvData.slice(0, 5)\n\n// Summary stats\ncsvData.reduce((acc, row) => acc + row.value, 0) / csvData.length\n\`\`\``;
              executionResults.push(pythonWarning);
            }
          
          // Enhanced incomplete detection - check for various patterns
          const looksIncomplete = assistantResponse.trim().endsWith('evaluation_code') ||
                                  assistantResponse.trim().endsWith('skill_type') ||
                                  assistantResponse.trim().endsWith('team') ||
                                  assistantResponse.trim().endsWith('filter(') ||
                                  assistantResponse.trim().endsWith('const') ||
                                  assistantResponse.trim().endsWith('let') ||
                                  assistantResponse.trim().endsWith('var') ||
                                  assistantResponse.trim().endsWith('return') ||
                                  assistantResponse.trim().endsWith('&&') ||
                                  assistantResponse.trim().endsWith('||') ||
                                  assistantResponse.trim().endsWith('.') ||
                                  assistantResponse.trim().endsWith(',') ||
                                  assistantResponse.trim().endsWith(';') ||
                                  assistantResponse.trim().endsWith('=') ||
                                  assistantResponse.trim().endsWith('(') ||
                                  assistantResponse.trim().endsWith('[') ||
                                  assistantResponse.trim().endsWith('{') ||
                                  (assistantResponse.includes('```') && !assistantResponse.match(/```[\s\S]*?```/g)?.some(block => block.endsWith('```'))) ||
                                  // Check if last line looks incomplete (ends mid-statement)
                                  (() => {
                                    const lastLine = assistantResponse.split('\n').pop()?.trim();
                                    return lastLine && lastLine.length > 0 && !lastLine.match(/[;})\]]$/);
                                  })();
          
          if (looksIncomplete) {
            // Response appears incomplete, wait a bit more and check again
                         // Re-detect after waiting
            const updatedBlocks = executor.detectCodeBlocksInStream(assistantResponse);
            blocks.length = 0;
            blocks.push(...updatedBlocks);
            
            // If still looks incomplete after waiting, log warning
            if (looksIncomplete && assistantResponse.length > 100) {
            }
          }
          
          if (blocks.length > 0) {
            // Code blocks detected - ALWAYS request user approval before execution
            // CRITICAL: Execution should NEVER happen automatically - user MUST explicitly approve
            if (!onCodeExecutionRequest) {
              // No approval callback - cannot execute without user approval
              onDelta('\n\n*[Code execution requires user approval - click Execute to run]*');
              onDone();
              return;
            }
            
            // Request user approval - this Promise will only resolve when user clicks approve/reject
            let shouldExecute = false;
            let editedBlocks: CodeBlock[] | undefined;
            
            try {
              // CRITICAL: This await should block until user clicks approve/reject in dialog
              // Add a timestamp to track when approval was requested
              const approvalRequestTime = Date.now();
              
              const result = await onCodeExecutionRequest(blocks);
              
              const approvalTime = Date.now();
              const waitTime = approvalTime - approvalRequestTime;
              
              // CRITICAL: If Promise resolved too quickly (< 100ms), it might have resolved automatically
              // This should NEVER happen - user needs time to see dialog and click
              if (waitTime < 100) {
                console.error(`🚨 CRITICAL: Promise resolved too quickly (${waitTime}ms) - this suggests auto-approval! Execution will be blocked.`);
                shouldExecute = false;
              } else {
                shouldExecute = result.approved;
                editedBlocks = result.editedBlocks;
              }
            } catch (error) {
              console.error('❌ Error requesting code execution approval:', error);
              shouldExecute = false;
            }
            
            if (!shouldExecute) {
              // User rejected code execution
              onDelta('\n\n*[Code execution cancelled by user]*');
              onDone();
              return;
            }
            
            // CRITICAL: Log that we're about to execute - this should ONLY happen after user approval
            // DOUBLE-CHECK: Ensure we have explicit approval before proceeding
            if (!shouldExecute) {
              console.error('🚨 CRITICAL: Execution attempted without approval - blocking execution');
              onDelta('\n\n*[Code execution requires user approval - execution blocked]*');
              onDone();
              return;
            }
            
            
            // Use edited blocks if provided, otherwise use original blocks
            let blocksToExecute = editedBlocks || blocks;
            
            // CRITICAL: Deduplicate blocks before execution to prevent executing the same code multiple times
            const seenBlockHashes = new Set<string>();
            const uniqueBlocks: CodeBlock[] = [];
            
            blocksToExecute.forEach((block, idx) => {
              // Create a hash of the normalized code
              const normalizedCode = block.code.replace(/\s+/g, ' ').trim();
              const codeHash = normalizedCode.length > 200 
                ? `${normalizedCode.substring(0, 100)}...${normalizedCode.substring(normalizedCode.length - 100)}|${normalizedCode.length}`
                : `${normalizedCode}|${normalizedCode.length}`;
              
              if (!seenBlockHashes.has(codeHash)) {
                seenBlockHashes.add(codeHash);
                uniqueBlocks.push(block);
              } else {
              }
            });
            
            if (uniqueBlocks.length !== blocksToExecute.length) {
            }
            
            blocksToExecute = uniqueBlocks;
            
            if (editedBlocks) {
            }
            
            
            // User approved - proceed with execution
            const codeRanges: Array<{ start: number, end: number }> = [];
            blocksToExecute.forEach(block => {
              codeRanges.push({ start: block.startIndex, end: block.endIndex });
            });
            
            // Check if there's text after code blocks (AI shouldn't have done this)
            const lastCodeEnd = codeRanges.length > 0 ? codeRanges[codeRanges.length - 1].end : assistantResponse.length;
            const textAfterCode = assistantResponse.substring(lastCodeEnd).trim();
            
            if (textAfterCode.length > 50) {
            }
            
            // Execute all code blocks and collect results
            // CRITICAL: These arrays must stay aligned - index i in all arrays corresponds to blocksToExecute[i]
            const rawExecutionResults: any[] = [];
            const executionStatus: Array<{ 
              block: CodeBlock, 
              result: ExecutionResult | null, 
              error: string | null,
              code?: string,
              fixed?: boolean,
              retryCount?: number
            }> = [];
            // First pass: Execute all blocks SEQUENTIALLY (await ensures each completes before next starts)
            // CRITICAL: Continue executing all blocks even if previous ones fail
            // Blocks that fail after a previous error will be marked as "skipped" (orange)
            // Blocks that fail without a previous error will be marked as "failed" (red)
            let hasPreviousError = false; // Track if any previous block failed
            
            for (let i = 0; i < blocksToExecute.length; i++) {
              const block = blocksToExecute[i];

              const validation = executor.validateCode(block.code);
              if (validation.valid) {
                try {
                  // AWAIT ensures this completes before moving to next block
                  const result = await executor.executeCode(block.code);
                  
                  // CRITICAL: If block failed and there was a previous error, mark as "skipped" (orange)
                  // If block failed but no previous error, mark as regular error (red)
                  // hasPreviousError is set when a block fails, but CLEARED when a block succeeds
                  // This means only consecutive failures after an initial error are marked as skipped (orange)
                  let errorMessage = null;
                  let isSkipped = false;
                  
                  if (!result.success && result.error) {
                    if (hasPreviousError) {
                      // Previous block failed - mark this as "skipped" (orange)
                      errorMessage = `Skipped: Previous block failed, this block also failed: ${result.error}`;
                      isSkipped = true;
                    } else {
                      // First failure - mark as regular error (red)
                      errorMessage = result.error;
                      hasPreviousError = true; // Set flag for subsequent blocks
                    }
                  } else if (result.success) {
                    // Success - clear the error flag so next failure is treated as new error (red)
                    hasPreviousError = false;
                  }
                  
                  // Format result with appropriate error message
                  const resultToFormat = {
                    ...result,
                    error: errorMessage || result.error,
                    success: result.success // Keep original success value
                  };
                  
                  const formattedResult = executor.formatResult(resultToFormat);
                  executionResults.push(formattedResult);

                  // CRITICAL FIX: Set error field if execution failed (e.g., DuckDB query errors)
                  // If skipped, use the "Skipped:" prefix so ChatMessage can detect it
                  const statusError = isSkipped ? errorMessage : (result.success ? null : (errorMessage || result.error || 'Execution failed'));
                  executionStatus.push({ block, result: resultToFormat, error: statusError, code: block.code });

                  // Store raw result data for saving to chat history
                  // CRITICAL FIX: Truncate large arrays to prevent context overflow
                  if (result.success && result.result) {
                    let resultToStore = result.result;
                    if (Array.isArray(resultToStore) && resultToStore.length > 100) {
                      // Truncate to first 100 rows for large datasets
                      resultToStore = resultToStore.slice(0, 100);
                    }
                    rawExecutionResults.push(resultToStore);
                  } else {
                    rawExecutionResults.push(null);
                  }

                  // DON'T send results via onDelta during execution - collect them first
                  // Results will be inserted into assistantResponse in the correct order after all blocks execute
                } catch (error) {
                  // Exception during execution
                  let errorMessage = error instanceof Error ? error.message : 'Unknown error';
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                  let isSkipped = false;

                  if (hasPreviousError) {
                    errorMessage = `Skipped: Previous block failed, this block threw exception: ${errorMessage}`;
                    isSkipped = true;
                  } else {
                    hasPreviousError = true; // Set flag for subsequent blocks
                  }
                  
                  const errorResult = executor.formatResult({
                    success: false,
                    error: errorMessage,
                    executionTime: 0
                  });
                  executionResults.push(errorResult);
                  executionStatus.push({
                    block,
                    result: { success: false, error: errorMessage, executionTime: 0 },
                    error: errorMessage,
                    code: block.code
                  });
                  rawExecutionResults.push(null);

                  // DON'T send error via onDelta during execution - will be inserted after all blocks complete
                }
              } else if (validation.needsCompletion) {
                // Mark as needing completion - will be fixed in second pass
                executionResults.push(''); // Placeholder
                executionStatus.push({ block, result: null, error: validation.error || 'Code is incomplete', code: block.code });
                rawExecutionResults.push(null);

                // Warning will be shown after all blocks complete
              } else {
                // Invalid code
                const errorResult = executor.formatResult({
                  success: false,
                  error: validation.error || 'Invalid code',
                  executionTime: 0
                });
                executionResults.push(errorResult);
                executionStatus.push({
                  block,
                  result: { success: false, error: validation.error || 'Invalid code', executionTime: 0 },
                  error: validation.error || 'Invalid code',
                  code: block.code
                });
                rawExecutionResults.push(null);

                // Error will be shown after all blocks complete
              }
            }
            
            
            // CRITICAL: Send execution results to UI via onDelta in execution order
            // onDelta will append them to assistantResponse AND send to UI
            // This ensures results appear in the order they were executed
            for (let i = 0; i < executionResults.length; i++) {
              if (executionResults[i]) {
                onDelta(`\n\n${executionResults[i]}`);
              } else {
              }
            }
            
            // Check if all blocks are now successful
            // CRITICAL: Check both result.success AND that result is not null
            const allSuccessful = executionStatus.length > 0 && executionStatus.every(s => s.result !== null && s.result?.success === true);
            
            // Check if we have any execution errors
            // Error can be: result is null, result.success is false, or error field is set
            const hasErrors = executionStatus.some(s => {
              if (s.result === null) return true; // No result means error
              if (s.result.success === false) return true; // Explicit failure
              if (s.error) return true; // Error field set
              return false;
            });
            
            // Check if we have any execution results (even if some are empty/null)
            const hasExecutionResults = executionResults.length > 0;
            const hasRawResults = rawExecutionResults.length > 0;
            
            // CRITICAL: Send follow-up for BOTH success and mixed success/error cases
            // Only use error fix path if ALL blocks failed
            // If some succeeded, send normal follow-up with successful results + error info
            let followUpDepth: number = 0;
            let isFollowUpLast: boolean = false;
            
            // Check if we have any successful blocks
            const hasSuccessfulBlocks = executionStatus.some(s => s.result?.success && !s.error);
            const allFailed = hasErrors && !hasSuccessfulBlocks;
            
            if (!hasErrors && allSuccessful && hasExecutionResults && hasRawResults) {
              
              // Reset consecutive failure count on successful execution
              if (chatId) {
                resetFailureCount(chatId);
              }

              // Check if we should send followup based on maxFollowupDepth
              followUpDepth = currentFollowupDepth + 1;
              isFollowUpLast = maxFollowupDepth > 0 && followUpDepth >= maxFollowupDepth;


              // If maxFollowupDepth is set and we've reached it, don't send followup
              if (maxFollowupDepth > 0 && followUpDepth >= maxFollowupDepth) {
                onDone();
                return;
              }

            } else if (hasErrors && hasSuccessfulBlocks) {
              // Mixed case: some succeeded, some failed - send follow-up with successful results + error info
              const successfulCount = executionStatus.filter(s => s.result?.success && !s.error).length;
              const failedCount = executionStatus.filter(s => !s.result?.success || s.error).length;
              
              // If more blocks failed than succeeded, increment failure count
              // Otherwise, reset it (more succeeded or equal)
              if (failedCount > successfulCount) {
                const failureCount = chatId ? incrementFailureCount(chatId) : 0;
              } else {
                // More succeeded or equal - reset counter
                if (chatId) {
                  resetFailureCount(chatId);
                }
              }

              followUpDepth = currentFollowupDepth + 1;
              isFollowUpLast = maxFollowupDepth > 0 && followUpDepth >= maxFollowupDepth;


              if (maxFollowupDepth > 0 && followUpDepth >= maxFollowupDepth) {
                onDone();
                return;
              }

            }
            
            // Handle error case - only if ALL blocks failed (use error fix path)
            if (allFailed) {
              
              // All blocks failed - increment consecutive failure count
              const failureCount = chatId ? incrementFailureCount(chatId) : 0;
              
              // For error follow-ups, set depth to 0 (this is an error fix, not a continuation)
              followUpDepth = 0;
              isFollowUpLast = false;
              
              // Extract failed executions
              const failedExecutions = executionStatus.filter(s => {
                if (s.result === null) return true; // No result means error
                if (s.result?.success === false) return true; // Explicit failure
                if (s.error) return true; // Error field set
                return false;
              });
              
              // CRITICAL: Ensure assistantResponse has ALL execution results (both success and error)
              // The onDelta calls should have added them, but verify the content is complete
              // Keep the full assistantResponse with all execution results for display (green/red boxes)
              // CRITICAL FIX: Keep FULL content with execution results for UI display (green boxes)
              // Even when there are errors, we want to show successful blocks' results
              const assistantMessageWithErrors: Message = {
                role: 'assistant',
                content: assistantResponse, // Keep FULL content with all execution results for UI display
                timestamp: Date.now(),
                model: model,
                executionResults: rawExecutionResults.length > 0 ? rawExecutionResults : undefined
              };
              
              // If we've had 4+ consecutive failures, ask clarifying questions instead of trying to fix
              if (failureCount >= 4) {
                
                // Collect all errors for context
                const allErrors = failedExecutions.map(s => {
                  const error = s.result?.error || s.error || 'Unknown error';
                  const code = s.code || '';
                  const firstLine = code.split('\n')[0] || '';
                  return `- **Error:** ${error}\n  **Code:** ${firstLine.substring(0, 100)}${code.length > 100 ? '...' : ''}`;
                }).join('\n\n');
                
                // Build clarifying question message for the AI to ask the user
                const clarifyingQuestionPrompt = `🚨 **MULTIPLE CONSECUTIVE FAILURES DETECTED**

I've encountered ${failureCount} consecutive execution failures. I need to ask the user clarifying questions to understand what's going wrong.

**Errors encountered:**
${allErrors}

**Your task:** Ask the user the following clarifying questions in a friendly, helpful way:
1. What specific data or columns are you trying to access? Are the column names correct?
2. Are there any special requirements or constraints I should know about?
3. What is the expected outcome or result you're looking for?
4. Are there any examples or sample data that might help clarify the task?

Please ask these questions clearly and wait for the user's response before attempting to fix the code again.`;
                
                const clarifyingQuestionUserMessage: Message = {
                  role: 'user',
                  content: clarifyingQuestionPrompt,
                  timestamp: Date.now()
                };
                
                // Build conversation history with clarifying question prompt
                const updatedHistory = [...conversationHistory.map(msg => 
                  msg.role === 'assistant' ? smartCompressMessage(msg) : msg
                ), assistantMessageWithErrors, clarifyingQuestionUserMessage];
                
                // Send clarifying question prompt to AI so it asks the user
                await sendChatMessage(
                  clarifyingQuestionPrompt,
                  [],
                  updatedHistory,
                  matchData,
                  model,
                  reasoningEnabled,
                  volleyballContextEnabled,
                  maxFollowupDepth,
                  currentFollowupDepth,
                  isFollowUpLast,
                  onDelta,
                  onDone,
                  onError,
                  csvId,
                  csvFilterColumns,
                  csvFilterValues,
                  chatId,
                  matchFilterColumns,
                  matchFilterValues,
                  selectedContextSectionId,
                  onCsvProgress,
                  signal,
                  onCodeExecutionRequest
                );
                return;
              }
              
              // CRITICAL FIX: Build message with only the failed code blocks for the AI to fix
              // Only include the failed code (not successful code) to minimize tokens
              const failedCodeBlocks = failedExecutions
                .map((s) => {
                  const originalIndex = executionStatus.indexOf(s);
                  const error = s.result?.error || s.error || 'Unknown error';
                  // Truncate very long code blocks
                  const code = s.code || '';
                  const truncatedCode = code.length > 500 ? code.substring(0, 500) + '\n// ... truncated' : code;
                  
                  // Detect variable-related errors
                  const isVariableError = /(?:is not defined|Cannot find name|ReferenceError|is undefined)/i.test(error);
                  const variableMatch = error.match(/(?:'|"|`)?([a-zA-Z_$][a-zA-Z0-9_$]*)(?:'|"|`)?\s+(?:is not defined|Cannot find name|is undefined)/i);
                  const undefinedVariable = variableMatch ? variableMatch[1] : null;
                  
                  let errorInstructions = `**Error:** ${error}`;
                  
                  if (isVariableError && undefinedVariable) {
                    errorInstructions += `\n\n⚠️ **VARIABLE ERROR DETECTED:** "${undefinedVariable}" is not defined.\n`;
                    errorInstructions += `**SOLUTION:**\n`;
                    errorInstructions += `- **If this variable was defined in a previous block:** You must RETURN it from that block for it to be available here.\n`;
                    errorInstructions += `  Example: If block 1 has "const ${undefinedVariable} = ...", you need "return { ${undefinedVariable}, ... }" in that block.\n`;
                    errorInstructions += `- **If you need this variable:** DEFINE it in THIS block (e.g., const ${undefinedVariable} = ...)\n`;
                    errorInstructions += `- **If this variable doesn't exist:** DO NOT use it - use the correct variable/column name from the dataset instead\n`;
                    errorInstructions += `- **Check what was returned:** Look at previous blocks' return statements - only returned values persist to next blocks\n`;
                    errorInstructions += `- **Common mistake:** Using local variables from previous blocks (like "${undefinedVariable}") that weren't returned - you must return them or redefine them\n`;
                    errorInstructions += `- **Common mistake:** Using non-existent variables (like "ucsdMatches", "matchData", etc.) - use the actual data source (csvData, query results, etc.)`;
                  } else if (isVariableError) {
                    errorInstructions += `\n\n⚠️ **VARIABLE ERROR:** A variable in your code is not defined.\n`;
                    errorInstructions += `**SOLUTION:**\n`;
                    errorInstructions += `- If this was defined in a previous block, you must RETURN it from that block\n`;
                    errorInstructions += `- Otherwise, define the variable in this block, or use the correct variable name from the dataset`;
                  }
                  
                  return `**Failed Block ${originalIndex + 1}:**\n\`\`\`execute\n${truncatedCode}\n\`\`\`\n\n${errorInstructions}`;
                })
                .join('\n\n');
              
              // Get successful blocks info to show what already worked
              const successfulExecutions = executionStatus.filter(s => s.result?.success && !s.error);
              const successfulBlocksInfo = successfulExecutions
                .map((s) => {
                  const originalIndex = executionStatus.indexOf(s);
                  const code = s.code || '';
                  const firstLine = code.split('\n')[0] || '';
                  return `Block ${originalIndex + 1}: ${firstLine.substring(0, 80)}${code.length > 80 ? '...' : ''}`;
                })
                .join('\n');
              
              const successCount = executionStatus.length - failedExecutions.length;
              let errorFixMessageContent = `CODE EXECUTION ERROR REPORT:

✅ ${successCount} block(s) executed successfully (DO NOT recreate these):
${successCount > 0 ? successfulBlocksInfo : 'None'}

❌ ${failedExecutions.length} block(s) FAILED (fix ONLY these):

${failedCodeBlocks}

🚨 CRITICAL FIX INSTRUCTIONS:
1. Fix ONLY the FAILED block(s) listed above
2. DO NOT recreate or re-run successful blocks - they already executed successfully
3. DO NOT write all blocks again - only provide the corrected failed block(s)
4. Successful blocks' variables are still available - you can use them in your fix
5. Use \`\`\`execute with "return" statement for the fixed block
6. Use ONLY column names that exist in the dataset (see column details in context)
7. Do NOT use information_schema - it's not available in DuckDB-WASM

EXAMPLE: If Block 1 succeeded and Block 2 failed, only provide:
\`\`\`execute
// Fixed Block 2 code here
\`\`\`
Do NOT include Block 1 again!`;

              const errorFixUserMessage: Message = {
                role: 'user',
                content: errorFixMessageContent,
                timestamp: Date.now()
              };
              
              // Build updated conversation history - COMPRESS older messages to save tokens
              const updatedHistory = [...conversationHistory.map(msg => 
                msg.role === 'assistant' ? smartCompressMessage(msg) : msg
              ), assistantMessageWithErrors, errorFixUserMessage];
              
              // Determine data context for error fix (same as original message)
              const errorFixData = (dataForExecution && Array.isArray(dataForExecution) && dataForExecution.length > 0) 
                                   ? dataForExecution 
                                   : (csvData && Array.isArray(csvData) && csvData.length > 0) 
                                     ? csvData 
                                     : null;
              
              let errorFixValueInfo = currentSelectionValueInfo;
              if (!errorFixData && hasCsvFilterSelections && hasValueInfo) {
                if (!errorFixValueInfo) {
                  const csvIds = csvId ? (Array.isArray(csvId) ? csvId : [csvId]) : [];
                  if (csvIds.length > 0) {
                    let retrievedValueInfo = null;

                    if (csvIds.length > 1) {
                      // Multiple files - look for combined value info
                      const combinedId = `combined_${[...csvIds].sort().join('_')}`;
                      retrievedValueInfo = getValueInfo(combinedId, 'csv', chatId);
                    } else if (csvIds.length === 1) {
                      // Single file - look for single value info
                      retrievedValueInfo = getValueInfo(csvIds[0], 'csv', chatId);
                    }

                    // CRITICAL FIX: Validate valueInfo matches CSV file name
                    if (retrievedValueInfo && csvFileName && retrievedValueInfo.name !== csvFileName) {
                      console.error(`❌ VALUE INFO MISMATCH (error-fix):
  CSV file: "${csvFileName}"
  ValueInfo: "${retrievedValueInfo.name}"
  Rejecting mismatched valueInfo.`);
                      retrievedValueInfo = null;
                    }
                    errorFixValueInfo = retrievedValueInfo;
                  }
                }
              }
              
              const hasActualData = (dataForExecution && Array.isArray(dataForExecution) && dataForExecution.length > 0) || 
                                   (matchData && matchData.data && Array.isArray(matchData.data) && matchData.data.length > 0) ||
                                   (errorFixData && Array.isArray(errorFixData) && errorFixData.length > 0);
              
              // Check followup depth
              const errorFixDepth = currentFollowupDepth + 1;
              const isErrorFixLast = maxFollowupDepth > 0 && errorFixDepth >= maxFollowupDepth;

              // IMPORTANT: Always allow at least ONE error fix attempt, even if depth limit is reached
              // Only skip if we're already past the first error fix (depth > 1)
              if (maxFollowupDepth > 0 && errorFixDepth > maxFollowupDepth && currentFollowupDepth > 0) {
                onDone();
                return;
              }
              
              // Build context for error fix message
              let errorFixContextMessage: string;
              if (hasCsvFilterSelections && volleyballContextEnabled && errorFixData && Array.isArray(errorFixData) && errorFixData.length > 0) {
                errorFixContextMessage = buildVolleyballContext(errorFixUserMessage.content, null, updatedHistory.slice(0, -1), volleyballContextEnabled, errorFixData, csvFileName, errorFixValueInfo, selectedContextSectionId, maxFollowupDepth, errorFixDepth, isErrorFixLast, csvId, chatId);
              } else if (useCurrentSelection && currentSelectionValueInfo && volleyballContextEnabled && hasActualData) {
                errorFixContextMessage = buildVolleyballContext(errorFixUserMessage.content, null, updatedHistory.slice(0, -1), volleyballContextEnabled, errorFixData, csvFileName, currentSelectionValueInfo, selectedContextSectionId, maxFollowupDepth, errorFixDepth, isErrorFixLast, csvId, chatId);
              } else if (hasCsvFilterSelections && volleyballContextEnabled && errorFixValueInfo) {
                errorFixContextMessage = buildVolleyballContext(errorFixUserMessage.content, null, updatedHistory.slice(0, -1), volleyballContextEnabled, null, csvFileName, errorFixValueInfo, selectedContextSectionId, maxFollowupDepth, errorFixDepth, isErrorFixLast, csvId, chatId);
              } else if (matchData && volleyballContextEnabled && hasActualData) {
                errorFixContextMessage = buildVolleyballContext(errorFixUserMessage.content, matchData, updatedHistory.slice(0, -1), volleyballContextEnabled, errorFixData, csvFileName, null, selectedContextSectionId, maxFollowupDepth, errorFixDepth, isErrorFixLast, csvId, chatId);
              } else if (errorFixData && Array.isArray(errorFixData) && errorFixData.length > 0 && volleyballContextEnabled) {
                errorFixContextMessage = buildVolleyballContext(errorFixUserMessage.content, null, updatedHistory.slice(0, -1), volleyballContextEnabled, errorFixData, csvFileName, errorFixValueInfo, selectedContextSectionId, maxFollowupDepth, errorFixDepth, isErrorFixLast, csvId, chatId);
              } else {
                errorFixContextMessage = buildConversationContext(errorFixUserMessage.content, updatedHistory.slice(0, -1), undefined, volleyballContextEnabled, false, false, selectedContextSectionId, maxFollowupDepth, errorFixDepth, isErrorFixLast);
              }
              
              if (hasActualData) {
                errorFixContextMessage += `\n\nCode execution available - use \`\`\`execute blocks when data analysis is needed.`;
              }
              
              // CRITICAL: Always include column information in error fix messages to prevent AI from guessing
              if (errorFixValueInfo && errorFixValueInfo.columns) {
                const columnNames = errorFixValueInfo.columns.map((col: any) => col.name).join(', ');
                const columnInfo = generateColumnInfoString(errorFixValueInfo.columns, (errorFixValueInfo as any).totalRowCount || 0);
                errorFixContextMessage += `\n\n=== COLUMN INFORMATION (FOR ERROR FIX) ===
AVAILABLE COLUMNS: ${columnNames}

${columnInfo}

⚠️ CRITICAL: Use ONLY the column names listed above. Do NOT use information_schema (not available in DuckDB-WASM).
The error above was likely caused by using a column name that doesn't exist. Check the exact column names listed above.`;
              } else if (csvFileName && csvId) {
                // Try to get valueInfo from csvId if not already available
                const csvIds = csvId ? (Array.isArray(csvId) ? csvId : [csvId]) : [];
                if (csvIds.length > 0) {
                  let baseCsvValueInfo = null;

                  if (csvIds.length > 1) {
                    // Multiple files - look for combined value info
                    const combinedId = `combined_${[...csvIds].sort().join('_')}`;
                    baseCsvValueInfo = getValueInfo(combinedId, 'csv', chatId);
                  } else if (csvIds.length === 1) {
                    // Single file - look for single value info
                    baseCsvValueInfo = getValueInfo(csvIds[0], 'csv', chatId);
                  }

                  if (baseCsvValueInfo && baseCsvValueInfo.columns) {
                    const columnNames = baseCsvValueInfo.columns.map((col: any) => col.name).join(', ');
                    const columnInfo = generateColumnInfoString(baseCsvValueInfo.columns, (baseCsvValueInfo as any).totalRowCount || 0);
                    errorFixContextMessage += `\n\n=== COLUMN INFORMATION (FOR ERROR FIX) ===
AVAILABLE COLUMNS: ${columnNames}

${columnInfo}

⚠️ CRITICAL: Use ONLY the column names listed above. Do NOT use information_schema (not available in DuckDB-WASM).
The error above was likely caused by using a column name that doesn't exist. Check the exact column names listed above.`;
                  }
                }
              }
              
              // Prepare execution data for error fix
              let errorFixExecutionData = null;
              if (currentSelectionValueInfo && currentSelectionValueInfo.data && Array.isArray(currentSelectionValueInfo.data) && currentSelectionValueInfo.data.length > 0) {
                errorFixExecutionData = currentSelectionValueInfo.data;
              } else if (errorFixData && Array.isArray(errorFixData) && errorFixData.length > 0) {
                errorFixExecutionData = errorFixData;
              } else if (dataForExecution && Array.isArray(dataForExecution) && dataForExecution.length > 0) {
                errorFixExecutionData = dataForExecution;
              } else if (csvData && Array.isArray(csvData) && csvData.length > 0) {
                errorFixExecutionData = csvData;
              }
              
              // Create executor for error fix
              const errorFixExecutor = new CodeExecutor(
                useCurrentSelection ? null : matchData, 
                errorFixExecutionData, 
                filterCols || null, 
                filterVals || null, 
                allowSql,
                csvId
              );
              
              if (hasCsvFilterSelections && errorFixExecutionData && Array.isArray(errorFixExecutionData) && errorFixExecutionData.length > 0) {
                (errorFixExecutor as any).csvData = errorFixExecutionData;
              }
              
              // Send error fix follow-up
              let errorFixContent = '';
              const errorFixProcessedHistory = await getConversationHistory(updatedHistory, chatId);
              await callApi({
                prompt: errorFixContextMessage,
                model,
                images: [],
                conversationHistory: errorFixProcessedHistory,
                reasoningEnabled: reasoningEnabled,
                signal: signal,
                onDelta: (chunk: string) => {
                  errorFixContent += chunk;
                  onDelta(chunk);
                },
                onDone: async () => {
                  try {
                    
                    const errorFixBlocks = errorFixExecutor.detectCodeBlocksInStream(errorFixContent);
                    
                    if (errorFixBlocks.length === 0) {
                      onDone();
                      return;
                    }
                    
                    // CRITICAL: Request user approval before executing error fix code
                    // Error fix code should NEVER execute automatically
                    let shouldExecuteErrorFix = false;
                    let editedErrorFixBlocks: CodeBlock[] | undefined;
                    
                    if (onCodeExecutionRequest) {
                      try {
                        const result = await onCodeExecutionRequest(errorFixBlocks);
                        shouldExecuteErrorFix = result.approved;
                        editedErrorFixBlocks = result.editedBlocks;
                      } catch (error) {
                        console.error('❌ Error requesting error fix code execution approval:', error);
                        shouldExecuteErrorFix = false;
                      }
                    } else {
                      onDelta('\n\n*[Error fix code execution requires user approval - click Execute to run]*');
                      onDone();
                      return;
                    }
                    
                    if (!shouldExecuteErrorFix) {
                      onDelta('\n\n*[Error fix code execution cancelled by user]*');
                      onDone();
                      return;
                    }
                    
                    // Use edited blocks if provided
                    const blocksToExecuteErrorFix = editedErrorFixBlocks || errorFixBlocks;
                    
                    // Execute the fixed code blocks (reuse same execution logic)
                    const errorFixExecutionResults: string[] = [];
                    const errorFixRawResults: any[] = [];
                    const errorFixExecutionStatus: Array<{ block: CodeBlock; result?: ExecutionResult; error?: string; code: string }> = [];
                    
                    for (const block of blocksToExecuteErrorFix) {
                      try {
                        const validation = errorFixExecutor.validateCode(block.code);
                        if (validation.valid) {
                          const result = await errorFixExecutor.executeCode(block.code);
                          const formattedResult = errorFixExecutor.formatResult(result);
                          errorFixExecutionResults.push(formattedResult);
                          // CRITICAL FIX: Set error field if execution failed (e.g., DuckDB query errors)
                          errorFixExecutionStatus.push({ block, result, error: result.success ? undefined : (result.error || 'Execution failed'), code: block.code });
                          errorFixRawResults.push(result.success ? result.result : null);
                          onDelta(`\n\n${formattedResult}\n\n`);
            
                        } else {
                          const errorResult = errorFixExecutor.formatResult({
                            success: false,
                            error: validation.error || 'Invalid code',
                            executionTime: 0
                          });
                          errorFixExecutionResults.push(errorResult);
                          errorFixExecutionStatus.push({ block, error: validation.error || 'Invalid code', code: block.code });
                          errorFixRawResults.push(null);
                          onDelta(`\n\n${errorResult}\n\n`);
                        }
                       
                      } catch (error: any) {
                        const errorResult = errorFixExecutor.formatResult({
                          success: false,
                          error: error.message || 'Execution error',
                          executionTime: 0
                        });
                        errorFixExecutionResults.push(errorResult);
                        errorFixExecutionStatus.push({ block, error: error.message || 'Execution error', code: block.code });
                        errorFixRawResults.push(null);
                        onDelta(`\n\n${errorResult}\n\n`);
                      }
                    }
                    
                    const hasSuccessfulFixes = errorFixExecutionStatus.some(status => status.result?.success);
                    if (hasSuccessfulFixes) {
                      const combinedErrorFixRawResults = errorFixRawResults.length === 1 
                        ? errorFixRawResults[0] 
                        : errorFixRawResults;
                      
                      const errorFixAssistantMessage: Message = {
                        role: 'assistant',
                        content: errorFixContent,
                        timestamp: Date.now(),
                        model: model,
                        executionResults: combinedErrorFixRawResults
                      };
                      
                      const hasErrorsInErrorFix = errorFixExecutionStatus.some(status => !status.result?.success || status.error);
                      
                      // CRITICAL: Check for infinite loop in error fix as well
                      const isErrorFixLoop = await isInfiniteLoop(chatId || 'default', errorFixContent);
                      
                      if (isErrorFixLoop) {
                        console.error('⛔ INFINITE LOOP DETECTED in error fix - Stopping follow-ups');
                        console.error('   The AI is repeatedly generating the same error fixes.');
                        onDelta('\n\n*[Follow-up stopped: repetitive error fix pattern detected]*');
                        onDone();
                        return;
                      }
                      
                      // Build execution results section for error fix follow-up
                      let errorFixResultsSection = '\n\n**RESULTS:**\n';
                      if (!hasErrorsInErrorFix && errorFixRawResults && errorFixRawResults.length > 0) {
                        errorFixRawResults.forEach((result, idx) => {
                          if (result === null || result === undefined) {
                            errorFixResultsSection += `[Execution failed - no result returned]\n`;
                            return;
                          }
                          
                          if (errorFixRawResults.length > 1) {
                            errorFixResultsSection += `\nResult ${idx + 1}:\n`;
                          }

                          // Check if this is a chart/visualization
                          if (result && typeof result === 'object' && ('echarts_chart' in result || 'chart' in result)) {
                            errorFixResultsSection += '[Chart/visualization created - displayed to user]\n';
                          } else if (Array.isArray(result) && result.length > 500) {
                            // Truncate large arrays
                            const truncated = result.slice(0, 500);
                            const remaining = result.length - 500;
                            errorFixResultsSection += '```json\n' + JSON.stringify(truncated, null, 2) + '\n```\n';
                            errorFixResultsSection += `[Truncated - showing first 500 of ${result.length} rows]\n`;
                          } else {
                            // Show full result for small data
                            errorFixResultsSection += '```json\n' + JSON.stringify(result, null, 2) + '\n```\n';
                          }
                        });
                      } else {
                        errorFixResultsSection += '[No results available - code may have failed to execute]\n';
                      }
                      
                      const nextErrorFixUserMessage: Message = {
                        role: 'user',
                        content: hasErrorsInErrorFix
                          ? 'Fix the errors above and run corrected code. Use ```execute blocks.'
                          : `✅ Error fixed! Code executed successfully.
${errorFixResultsSection}
**User's Original Question:** "${message}"

🎯 **YOUR TASK NOW:**
STOP DO NOT CODE OR PLAN YET

The results above are from your fixed code. Check if they answer the user's question.

✅ **IF YES (results have the data):**
   → State the answer using the results
   → DO NOT write more code
   → DO NOT re-plan

❌ **IF NO (missing data):**
   → Write ONLY the additional code needed

🚨 DO NOT re-execute code that already worked. The results above are real data - use them!`,
                        timestamp: Date.now()
                      };
                      
                      const nextUpdatedHistory = [...updatedHistory, errorFixAssistantMessage, nextErrorFixUserMessage];
                      const nextFollowUpDepth = errorFixDepth + 1;
                      const isNextFollowUpLast = maxFollowupDepth > 0 && nextFollowUpDepth >= maxFollowupDepth;
                      
                      if (maxFollowupDepth > 0 && nextFollowUpDepth > maxFollowupDepth) {
                        onDone();
                        return;
                      }
                      
                      await sendChatMessage(
                        nextErrorFixUserMessage.content,
                        [],
                        nextUpdatedHistory.slice(0, -1),
                        matchData,
                        model,
                        reasoningEnabled,
                        volleyballContextEnabled,
                        maxFollowupDepth,
                        nextFollowUpDepth,
                        isNextFollowUpLast,
                        onDelta,
                        onDone,
                        onError,
                        csvId,
                        csvFilterColumns,
                        csvFilterValues,
                        chatId,
                        matchFilterColumns,
                        matchFilterValues,
                        selectedContextSectionId,
                        undefined, // onCsvProgress
                        signal,
                        onCodeExecutionRequest // CRITICAL: Pass approval callback to recursive calls
                      );
                      return;
                    } else {
                      onDone(); // Only end if error fix failed
                    }

                  } catch (error: any) {
                    console.error('Error processing error fix code execution:', error);
                    onDone();
                  }
                },
                onError: (error: string) => {
                  console.error('Error in error fix follow-up:', error);
                  errorFixExecutor.clearExecutionState();
                  onDone();
                }
              });
            } else if (!allFailed) {
              // Success case OR mixed success/error case - proceed with follow-up
              // (allFailed case goes to error fix path above)
              
              // Get the raw execution results data (for saving to message)
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const combinedRawResults = rawExecutionResults.length === 1 
                ? rawExecutionResults[0] 
                : rawExecutionResults;
              
              // Get the original user request - use the CURRENT message parameter
              // NOT from conversation history (that could be from a previous question!)
              const originalUserMessage = message;
              
              // CRITICAL FIX: Extract code blocks and execution results BEFORE stripping
              // This ensures the AI can see what code was executed and what the results were
              const { codeBlocks } = extractCodeAndResults(assistantResponse);

              // CRITICAL: Detect if a chart/visualization was successfully created
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const chartCreated = rawExecutionResults.some(result => {
                if (!result) return false;
                if (typeof result === 'object' && result !== null) {
                  return 'echarts_chart' in result || 'chart' in result;
                }
                return false;
              });

              // Build code blocks section to show what code was executed
              let codeBlocksSection = '';
              if (codeBlocks && codeBlocks.length > 0) {
                codeBlocks.forEach((block, idx) => {
                  if (codeBlocks.length > 1) {
                    codeBlocksSection += `\n**Code Block ${idx + 1}:**\n`;
                  }
                  codeBlocksSection += block + '\n';
                });
              }

              // Build execution results - show RAW results
              // IMPORTANT: If results are huge (>10MB), warn but still try to send
              let executionResultsSection = '';
              if (rawExecutionResults && rawExecutionResults.length > 0) {
                rawExecutionResults.forEach((result, idx) => {
                  if (rawExecutionResults.length > 1) {
                    executionResultsSection += `\n**Result ${idx + 1}:**\n`;
                  }

                  // Check if result is null (failed execution)
                  if (result === null || result === undefined) {
                    executionResultsSection += '[Execution failed - no result returned]\n';
                  }
                  // Check if this is a chart/visualization
                  else if (result && typeof result === 'object' && ('echarts_chart' in result || 'chart' in result)) {
                    executionResultsSection += '[Chart/visualization created - displayed to user]\n';
                  } else {
                    // Show full result
                    const resultStr = JSON.stringify(result, null, 2);

                    // Warn if result is very large (but still send it)
                    const resultSizeMB = resultStr.length / (1024 * 1024);
                    if (resultSizeMB > 10) {
                      executionResultsSection += `⚠️ WARNING: Result is very large (${resultSizeMB.toFixed(1)}MB) - this may cause performance issues.\n`;
                      executionResultsSection += `Consider using aggregation (GROUP BY, COUNT, AVG) instead of returning full dataset.\n\n`;
                    }

                    executionResultsSection += '```json\n' + resultStr + '\n```\n';
                  }
                });
              } else {
                // ALWAYS show results section, even if empty
                executionResultsSection = '\n[No results available - code may have failed to execute]\n';
              }

              // Build CLEAR follow-up message with code blocks and execution results
              let followUpMessageContent = `🔄 CODE EXECUTION COMPLETE

**CODE EXECUTED:**${codeBlocksSection}

**RESULTS:**${executionResultsSection}${chartCreated ? '\n\n**📊 CHART DETECTED:** A chart/visualization was successfully created and is displayed above. When you provide your response, explain what the graph shows, important data points, patterns, trends, and the significance of the visualization.' : ''}

**User's Original Question:** "${originalUserMessage}"

🎯 **YOUR TASK NOW:**
STOP DO NOT CODE OR PLAN YET

STOP and READ the results above. They contain the data you executed code to get.

✅ **IF the results ANSWER the user's question:**
   → Simply state the answer clearly using the results
   → DO NOT write more code
   → DO NOT create new plans
   → Example: "Based on the results, there were 1,234 white wins, 987 black wins, and 456 draws."

❌ **IF the results are INCOMPLETE (missing data the user asked for):**
   → Write ONLY the missing code
   → Example: User asked for a chart but results show only data → Add chart code

🚨 **CRITICAL - DO NOT:**
- Re-plan or re-execute code you already ran
- Write code if the data is already in the results
- Ignore the results and start over

The results above contain real data. Use them to answer: "${originalUserMessage}"`;


              // Add error info if there were failures
              if (hasErrors && hasSuccessfulBlocks) {
                const failedCount = executionStatus.filter(s => !s.result?.success || s.error).length;
                followUpMessageContent += `\n\n⚠️ Note: ${failedCount} block(s) failed to execute. The results shown are from successful blocks only.`;
              }

              // Add explicit completion signal if this is the last followup
              if (isFollowUpLast) {
                followUpMessageContent += `\n\n🚨 **THIS IS YOUR FINAL FOLLOWUP** - Provide complete analysis with the available results. Do NOT suggest additional code.`;
              }
              
              const followUpUserMessage: Message = {
                role: 'user',
                content: followUpMessageContent,
                timestamp: Date.now()
              };
              
              // Add the current assistant response to history
              // CRITICAL: This message is for DISPLAY only (saved to memory with full content)
              // For API calls, we'll strip it to save tokens
              const assistantMessageWithResults: Message = {
                role: 'assistant',
                content: assistantResponse, // Keep FULL content with execution results for display
                timestamp: Date.now(),
                model: model,
                executionResults: rawExecutionResults.length === 1 ? rawExecutionResults[0] : rawExecutionResults
              };

              // Build updated conversation history with compression
              // Use aggressive compression if conversation is getting long
              const compressedHistory = compressLongConversation(conversationHistory);
              const updatedHistory = [
                ...compressedHistory,
                smartCompressMessage(assistantMessageWithResults), // Compress - details are in followUpUserMessage
                followUpUserMessage
              ];
              
              // Determine data context for follow-up (same as original message)
              // IMPORTANT: Use dataForExecution if available (from current_selection), otherwise use csvData
              // This ensures follow-up has data even if csvData was cleared from memory
              const followUpData = (dataForExecution && Array.isArray(dataForExecution) && dataForExecution.length > 0) 
                                   ? dataForExecution 
                                   : (csvData && Array.isArray(csvData) && csvData.length > 0) 
                                     ? csvData 
                                     : null;
              
              // CRITICAL: Don't reload if we have value info - use value info for context instead
              // Get value info for follow-up if csvData is null but value info exists
              let followUpValueInfo = currentSelectionValueInfo;
              if (!followUpData && hasCsvFilterSelections && hasValueInfo) {
                // Value info exists - don't reload blob, use value info for context
                if (!followUpValueInfo) {
                  const csvIds = csvId ? (Array.isArray(csvId) ? csvId : [csvId]) : [];
                  if (csvIds.length > 0) {
                    let retrievedValueInfo = null;

                    if (csvIds.length > 1) {
                      // Multiple files - look for combined value info
                      const combinedId = `combined_${[...csvIds].sort().join('_')}`;
                      retrievedValueInfo = getValueInfo(combinedId, 'csv', chatId);
                    } else if (csvIds.length === 1) {
                      // Single file - look for single value info
                      retrievedValueInfo = getValueInfo(csvIds[0], 'csv', chatId);
                    }

                    // CRITICAL FIX: Validate valueInfo matches CSV file name
                    if (retrievedValueInfo && csvFileName && retrievedValueInfo.name !== csvFileName) {
                      console.error(`❌ VALUE INFO MISMATCH (follow-up):
  CSV file: "${csvFileName}"
  ValueInfo: "${retrievedValueInfo.name}"
  Rejecting mismatched valueInfo.`);
                      retrievedValueInfo = null;
                    }
                    followUpValueInfo = retrievedValueInfo;
                  }
                }
              }
              
              const hasActualData = (dataForExecution && Array.isArray(dataForExecution) && dataForExecution.length > 0) || 
                                   (matchData && matchData.data && Array.isArray(matchData.data) && matchData.data.length > 0) ||
                                   (followUpData && Array.isArray(followUpData) && followUpData.length > 0);
              
              // Build context for follow-up message (reuse same logic as original)
              // Use followUpData instead of csvData to ensure we have data even if csvData was null
              // IMPORTANT: Pass followUpValueInfo so dataset info is included even when data is null
              let followUpContextMessage: string;
              if (hasCsvFilterSelections && volleyballContextEnabled && followUpData && Array.isArray(followUpData) && followUpData.length > 0) {
                followUpContextMessage = buildVolleyballContext(followUpUserMessage.content, null, updatedHistory.slice(0, -1), volleyballContextEnabled, followUpData, csvFileName, followUpValueInfo, selectedContextSectionId, maxFollowupDepth, followUpDepth, isFollowUpLast, csvId, chatId);
              } else if (useCurrentSelection && currentSelectionValueInfo && volleyballContextEnabled && hasActualData) {
                followUpContextMessage = buildVolleyballContext(followUpUserMessage.content, null, updatedHistory.slice(0, -1), volleyballContextEnabled, followUpData, csvFileName, currentSelectionValueInfo, selectedContextSectionId, maxFollowupDepth, followUpDepth, isFollowUpLast, csvId, chatId);
              } else if (hasCsvFilterSelections && volleyballContextEnabled && followUpValueInfo) {
                // CSV filters set but no data in memory - use value info for context
                followUpContextMessage = buildVolleyballContext(followUpUserMessage.content, null, updatedHistory.slice(0, -1), volleyballContextEnabled, null, csvFileName, followUpValueInfo, selectedContextSectionId, maxFollowupDepth, followUpDepth, isFollowUpLast, csvId, chatId);
              } else if (matchData && volleyballContextEnabled && hasActualData) {
                followUpContextMessage = buildVolleyballContext(followUpUserMessage.content, matchData, updatedHistory.slice(0, -1), volleyballContextEnabled, followUpData, csvFileName, null, selectedContextSectionId, maxFollowupDepth, followUpDepth, isFollowUpLast, csvId, chatId);
              } else if (followUpData && Array.isArray(followUpData) && followUpData.length > 0 && volleyballContextEnabled) {
                followUpContextMessage = buildVolleyballContext(followUpUserMessage.content, null, updatedHistory.slice(0, -1), volleyballContextEnabled, followUpData, csvFileName, followUpValueInfo, selectedContextSectionId, maxFollowupDepth, followUpDepth, isFollowUpLast, csvId, chatId);
              } else {
                followUpContextMessage = buildConversationContext(followUpUserMessage.content, updatedHistory.slice(0, -1), undefined, volleyballContextEnabled, false, false, selectedContextSectionId, maxFollowupDepth, followUpDepth, isFollowUpLast);
              }
              
              // DO NOT add code execution reminder in follow-ups
              // The follow-up message already tells the AI whether to write code or not
              // Adding "code execution available" here contradicts our instruction to just provide the answer
              // if (hasActualData) {
              //   followUpContextMessage += `\n\nCode execution available - use \`\`\`execute blocks when data analysis is needed.`;
              // }
              
              // Send follow-up message to AI with execution results in conversation history
              let followUpContent = '';

              // DEBUG: Log what we're sending to AI

              // CRITICAL: Ensure follow-up executor has data available
              // Check currentSelectionValueInfo.data first, then followUpData, then dataForExecution, then csvData
              let followUpExecutionData = null;
              if (currentSelectionValueInfo && currentSelectionValueInfo.data && Array.isArray(currentSelectionValueInfo.data) && currentSelectionValueInfo.data.length > 0) {
                // Use data from current_selection if available
                followUpExecutionData = currentSelectionValueInfo.data;
              } else if (followUpData && Array.isArray(followUpData) && followUpData.length > 0) {
                followUpExecutionData = followUpData;
              } else if (dataForExecution && Array.isArray(dataForExecution) && dataForExecution.length > 0) {
                followUpExecutionData = dataForExecution;
              } else if (csvData && Array.isArray(csvData) && csvData.length > 0) {
                followUpExecutionData = csvData;
              } else {
                // Last resort: Try to get data from current_selection value info lookup
                const currentSelection = getValueInfo('current_selection', hasCsvFilterSelections ? 'csv' : 'match', chatId);
                if (currentSelection && currentSelection.data && Array.isArray(currentSelection.data) && currentSelection.data.length > 0) {
                  followUpExecutionData = currentSelection.data;
                } else {
                  // Last resort: Try to load data from blob if we have csvId and filters
                  if (csvId && hasCsvFilterSelections && csvFilterColumns && csvFilterValues) {
                    try {
                      const loadedData = await getCsvFileData(csvId, csvFilterColumns, csvFilterValues, undefined);
                      if (loadedData && Array.isArray(loadedData) && loadedData.length > 0) {
                        followUpExecutionData = loadedData;
                      }
                    } catch (e) {
                      console.error('Follow-up executor: Failed to load data from blob:', e);
                    }
                  }

                  if (!followUpExecutionData) {
                  }
                }
              }
              
              // Create executor for follow-up code execution (use same data as original)
              // Pass csvId so executor can load from DuckDB if data is null
              // CRITICAL: Get filter columns/values from current selection or match data
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const followUpFilterCols = useCurrentSelection && currentSelectionValueInfo 
                ? currentSelectionValueInfo.filterColumns 
                : matchFilterColumns;
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const followUpFilterVals = useCurrentSelection && currentSelectionValueInfo 
                ? currentSelectionValueInfo.filterValues 
                : matchFilterValues;
              
              // CRITICAL FIX: Reuse the SAME executor to preserve executionState
              // This allows 'result' variable from previous blocks to be available
              // Don't create a new executor - reuse the existing one!
              
              const followUpProcessedHistory = await getConversationHistory(updatedHistory, chatId);
              await callApi({
                prompt: followUpContextMessage,
                model,
                images: [],
                conversationHistory: followUpProcessedHistory,
                reasoningEnabled: reasoningEnabled,
                signal: signal,
                onDelta: (chunk: string) => {
                  followUpContent += chunk;
                  onDelta(chunk);
                },
                onDone: async () => {
                  try {

                    // Wait a bit to ensure full response is collected
                    
                    
                    // Check if follow-up response contains code execution request
                    const followUpBlocks = executor.detectCodeBlocksInStream(followUpContent);
                    
                    // Check for duplicate code blocks and warn user, but don't stop execution
                    const previouslyExecutedCode = new Set<string>();

                    // Add code from current execution
                    if (executionStatus && executionStatus.length > 0) {
                      executionStatus.forEach(status => {
                        // Only track successfully executed code (green boxes)
                        if (status.result?.success && status.code) {
                          // Normalize code for comparison (remove whitespace differences)
                          const normalized = status.code.replace(/\s+/g, ' ').trim();
                          previouslyExecutedCode.add(normalized);
                        }
                      });
                    }

                    // IMPORTANT: Also check conversation history for ALL previously executed code
                    conversationHistory.forEach(msg => {
                      if (msg.role === 'assistant' && msg.content) {
                        // Extract code blocks from previous assistant messages
                        const codeBlockRegex = /```(?:execute|javascript|js|query|code)\s*\n([\s\S]*?)```/gi;
                        let match;
                        while ((match = codeBlockRegex.exec(msg.content)) !== null) {
                          const code = match[1];
                          const normalized = code.replace(/\s+/g, ' ').trim();
                          previouslyExecutedCode.add(normalized);
                        }
                      }
                    });
                    
                    // Check if ALL blocks have been executed before
                    // Only skip execution if ALL blocks are duplicates
                    const duplicateStatus = followUpBlocks.map(block => {
                      const normalizedBlock = block.code.replace(/\s+/g, ' ').trim();
                      return previouslyExecutedCode.has(normalizedBlock);
                    });

                    const allBlocksAlreadyExecuted = followUpBlocks.length > 0 && duplicateStatus.every(isDup => isDup);

                    // If ALL code blocks have been executed before, skip execution and do analysis
                    if (allBlocksAlreadyExecuted) {
                      onDelta('\n\n**ℹ️ Code already executed - showing analysis...**\n\n');

                      // Get previous execution results for context
                      const previousResults = rawExecutionResults.length > 0
                        ? (rawExecutionResults.length === 1 ? rawExecutionResults[0] : rawExecutionResults)
                        : null;

                      // Check if a chart was created in previous execution
                      // eslint-disable-next-line @typescript-eslint/no-unused-vars
                      const chartWasCreated = rawExecutionResults.some(result => {
                        if (!result) return false;
                        if (typeof result === 'object' && result !== null) {
                          return 'echarts_chart' in result || 'chart' in result;
                        }
                        return false;
                      });

                      // Build continuation message using clear prompt format
                      // Use the CURRENT message parameter, not from history
                      const originalUserMessage = message;

                      // Build code blocks section
                      let continuationCodeSection = '';
                      if (codeBlocks && codeBlocks.length > 0) {
                        continuationCodeSection = '\n**Code Executed:**\n';
                        codeBlocks.forEach((block, idx) => {
                          if (codeBlocks.length > 1) {
                            continuationCodeSection += `\nCode Block ${idx + 1}:\n`;
                          }
                          continuationCodeSection += block + '\n';
                        });
                      }

                      // Build execution results - show RAW but truncate large results
                      let continuationResultsSection = '\n**Execution Results:**\n';
                      if (rawExecutionResults && rawExecutionResults.length > 0) {
                        rawExecutionResults.forEach((result, idx) => {
                          if (rawExecutionResults.length > 1) {
                            continuationResultsSection += `\nResult ${idx + 1}:\n`;
                          }

                          // Check if this is a chart/visualization
                          if (result && typeof result === 'object' && ('echarts_chart' in result || 'chart' in result)) {
                            continuationResultsSection += '[This is a chart/visualization - displayed to user]\n';
                          } else if (Array.isArray(result) && result.length > 500) {
                            // Truncate large arrays
                            const truncated = result.slice(0, 500);
                            const remaining = result.length - 500;
                            continuationResultsSection += '```json\n' + JSON.stringify(truncated, null, 2) + '\n```\n';
                            continuationResultsSection += `[Truncated - ${remaining} more rows not shown]\n`;
                          } else {
                            // Show full result for small data
                            continuationResultsSection += '```json\n' + JSON.stringify(result, null, 2) + '\n```\n';
                          }
                        });
                      } else {
                        continuationResultsSection = '';
                      }

                      let continuationMessage = `🔄 CODE EXECUTION COMPLETE

**CODE EXECUTED:**${codeBlocksSection}
**RESULTS:**${executionResultsSection}

**User's Original Question:** "${originalUserMessage}"

🎯 **YOUR TASK NOW:**
STOP DO NOT CODE OR PLAN YET

STOP and READ the results above. They contain the data you executed code to get.

✅ **IF the results ANSWER the user's question:**
   → Simply state the answer clearly using the results
   → DO NOT write more code
   → DO NOT create new plans
   → Example: "Based on the results, there were 1,234 white wins, 987 black wins, and 456 draws."

❌ **IF the results are INCOMPLETE (missing data the user asked for):**
   → Write ONLY the missing code
   → Example: User asked for a chart but results show only data → Add chart code

🚨 **CRITICAL - DO NOT:**
- Re-plan or re-execute code you already ran
- Write code if the data is already in the results
- Ignore the results and start over

The results above contain real data. Use them to answer: "${originalUserMessage}"`;

                      // Calculate follow-up depth first
                      const nextFollowUpDepth = followUpDepth + 1;
                      const isNextFollowUpLast = maxFollowupDepth > 0 && nextFollowUpDepth >= maxFollowupDepth;

                      // Add explicit completion signal if this is the last followup
                      if (isNextFollowUpLast) {
                        continuationMessage += `\n\n🚨 **THIS IS YOUR FINAL FOLLOWUP** - Provide complete analysis with the available results. Do NOT suggest additional code.`;
                      }

                      const continuationUserMessage: Message = {
                        role: 'user',
                        content: continuationMessage,
                        timestamp: Date.now()
                      };

                      // Add assistant response to history
                      // CRITICAL FIX: Keep FULL content with execution results for UI display
                      const assistantMessageWithResults: Message = {
                        role: 'assistant',
                        content: followUpContent, // Keep FULL content with execution results for display
                        timestamp: Date.now(),
                        model: model,
                        executionResults: previousResults
                      };

                      // Build updated conversation history with compression
                      const compressedHistory = compressLongConversation(conversationHistory);
                      const updatedHistory = [
                        ...compressedHistory,
                        assistantMessageWithResults,
                        continuationUserMessage
                      ];
                      
                      if (maxFollowupDepth > 0 && nextFollowUpDepth > maxFollowupDepth) {
                        executor.clearExecutionState();
                        onDone();
                        return;
                      }
                      
                      // eslint-disable-next-line @typescript-eslint/no-unused-vars
                      const processedHistory = await getConversationHistory(updatedHistory, chatId);
                      await sendChatMessage(
                        continuationUserMessage.content,
                        [],
                        updatedHistory.slice(0, -1),
                        matchData,
                        model,
                        reasoningEnabled,
                        volleyballContextEnabled,
                        maxFollowupDepth,
                        nextFollowUpDepth,
                        isNextFollowUpLast,
                        onDelta,
                        onDone,
                        onError,
                        csvId,
                        csvFilterColumns,
                        csvFilterValues,
                        chatId,
                        matchFilterColumns,
                        matchFilterValues,
                        selectedContextSectionId,
                        undefined, // onCsvProgress
                        signal,
                        onCodeExecutionRequest // CRITICAL: Pass approval callback to recursive calls
                      );
                      return;
                    }
                    
                    const followUpExecutionResults: string[] = [];
                    const followUpExecutionStatus: Array<{ block: CodeBlock; result?: ExecutionResult; error?: string; code: string }> = [];
                    const followUpRawResults: any[] = [];
                    
                    // Check for Python code
                    const pythonPatterns = [
                      /```python[\s\S]*?```/i,
                      /```py[\s\S]*?```/i,
                      /^import\s+(pandas|numpy|pd|np|duckdb)\s+/im,
                      /^from\s+(pandas|numpy|duckdb)\s+import/im,
                      /pd\.|np\.|df\.|duckdb\.|con\s*=\s*duckdb\.connect|con\.execute|con\.query|\.fetchall\s*\(|\.fetchdf\s*\(|\.shape\b|\.dtypes\b|\.head\s*\(|\.info\s*\(|\.isnull\s*\(|\.read_csv\s*\(|SHOW\s+TABLES|SHOW\s+SCHEMAS|information_schema/i
                    ];
                    const hasPythonCode = pythonPatterns.some(pattern => pattern.test(followUpContent));
                    if (hasPythonCode) {
                      const pythonWarning = `⚠️ **Python code detected - JavaScript only**\n\nThis system only supports JavaScript code execution. Python code (import pandas, import duckdb, df.shape, con.execute, etc.) will NOT execute.\n\n**Use JavaScript instead:**\n\`\`\`execute\n// Count rows\ncsvData.length\n\n// Get columns\nObject.keys(csvData[0])\n\n// Filter data\ncsvData.filter(row => row.column === 'value')\n\n// First 5 rows\ncsvData.slice(0, 5)\n\n// Summary stats\ncsvData.reduce((acc, row) => acc + row.value, 0) / csvData.length\n\`\`\``;
                      followUpExecutionResults.push(pythonWarning);
                      onDelta('\n\n' + pythonWarning);
                    }

                    // If no code blocks at all, task is complete
                    if (followUpBlocks.length === 0) {
                      executor.clearExecutionState();
                      onDone();
                      return;
                    }

                    // Execute ALL blocks if at least one is new
                    if (followUpBlocks.length > 0) {
                      // Request user approval for follow-up code blocks (same as initial blocks)
                      let shouldExecuteFirstFollowup = false; // Default to FALSE for safety
                      let editedFirstFollowupBlocks: CodeBlock[] | undefined;

                      if (!onCodeExecutionRequest) {
                        // CRITICAL: No approval callback - cannot execute without user approval
                        onDelta('\n\n*[Code execution requires user approval - approval callback missing]*');
                        executor.clearExecutionState();
                        onDone();
                        return;
                      }

                      try {
                        const result = await onCodeExecutionRequest(followUpBlocks);
                        shouldExecuteFirstFollowup = result.approved;
                        editedFirstFollowupBlocks = result.editedBlocks;
                      } catch (error) {
                        console.error('❌ Error requesting follow-up code execution approval:', error);
                        shouldExecuteFirstFollowup = false;
                      }
                      
                      if (!shouldExecuteFirstFollowup) {
                        // User rejected follow-up code execution
                        onDelta('\n\n*[Code execution cancelled by user]*');
                        executor.clearExecutionState();
                        onDone();
                        return;
                      }
                      
                      // DOUBLE-CHECK: Ensure we have explicit approval before proceeding
                      if (!shouldExecuteFirstFollowup) {
                        console.error('🚨 CRITICAL: Follow-up execution attempted without approval - blocking execution');
                        onDelta('\n\n*[Code execution requires user approval - execution blocked]*');
                        executor.clearExecutionState();
                        onDone();
                        return;
                      }
                      
                      // Use edited blocks if provided, otherwise execute ALL blocks (including previously executed ones)
                      const blocksToExecuteFirstFollowup = editedFirstFollowupBlocks || followUpBlocks;
                      
                      onDelta('\n\n**Executing additional code from follow-up...**\n\n');
                      
                      for (let i = 0; i < blocksToExecuteFirstFollowup.length; i++) {
                        const block = blocksToExecuteFirstFollowup[i];

                        const validation = executor.validateCode(block.code);
                        if (validation.valid) {
                          try {
                            const result = await executor.executeCode(block.code);
                            const formattedResult = executor.formatResult(result);
                            followUpExecutionResults.push(formattedResult);
                            followUpExecutionStatus.push({ block, result, error: result.success ? undefined : (result.error || 'Execution failed'), code: block.code });
                            followUpRawResults.push(result.success ? result.result : null);

                            onDelta(formattedResult + '\n\n');
                          } catch (error: any) {
                            const errorResult = executor.formatResult({
                              success: false,
                              error: error.message || 'Execution error',
                              executionTime: 0
                            });
                            followUpExecutionResults.push(errorResult);
                            followUpExecutionStatus.push({ block, error: error.message, code: block.code });
                            followUpRawResults.push(null);
                            onDelta(errorResult + '\n\n');
                          }
                        } else {
                          const errorResult = executor.formatResult({
                            success: false,
                            error: validation.error || 'Invalid code',
                            executionTime: 0
                          });
                          followUpExecutionResults.push(errorResult);
                          followUpExecutionStatus.push({ block, error: validation.error, code: block.code });
                          followUpRawResults.push(null);
                          onDelta(errorResult + '\n\n');
                        }
                      }
                    }
                    
                    if (followUpExecutionResults.length > 0) {
                        
                        // Check if we should create another followup
                        // Error can be: result is null, result.success is false, or error field is set
                        const allFollowUpSuccessful = followUpExecutionStatus.length > 0 && followUpExecutionStatus.every(s => s.result !== null && s.result?.success === true);
                        const hasErrors = followUpExecutionStatus.some(s => {
                          if (s.result === null || s.result === undefined) return true; // No result means error
                          if (s.result.success === false) return true; // Explicit failure
                          if (s.error) return true; // Error field set
                          return false;
                        });
                        
                        // Reset consecutive failure count on successful execution
                        if (allFollowUpSuccessful && !hasErrors && chatId) {
                          resetFailureCount(chatId);
                        }

                        // CRITICAL: Check for infinite loop before creating follow-up
                        const isLoop = await isInfiniteLoop(chatId || 'default', followUpContent);
                        
                        // CRITICAL: Enforce depth limit strictly
                        const atMaxDepth = maxFollowupDepth > 0 && currentFollowupDepth >= maxFollowupDepth;
                        
                        if (isLoop) {
                          console.error('⛔ INFINITE LOOP DETECTED - Stopping follow-ups');
                          console.error('   The AI is generating repetitive responses. Check prompts or reduce follow-up depth.');
                          onDelta('\n\n*[Follow-up stopped: repetitive pattern detected]*');
                          executor.clearExecutionState();
                          onDone();
                          return;
                        }
                        
                        if (atMaxDepth) {
                          onDone();
                          return;
                        }

                        // Only create recursive follow-up if the follow-up response contains code blocks that need execution
                        // If the follow-up response is just analysis (no code blocks), the task is complete - no need for another follow-up
                        const followUpHasCodeBlocks = followUpBlocks && followUpBlocks.length > 0;
                        
                        // Only create recursive follow-up if:
                        // 1. There are errors that need fixing, OR
                        // 2. The follow-up response contains code blocks (regardless of execution success - might need another round)
                        const shouldCreateRecursiveFollowup = hasErrors || followUpHasCodeBlocks;
                        
                        if (!shouldCreateRecursiveFollowup) {
                          executor.clearExecutionState();
                          onDone();
                          return;
                        }


                        if (shouldCreateRecursiveFollowup) {
                          
                          // Get the raw execution results data
                          const combinedFollowUpRawResults = followUpRawResults.length === 1 
                            ? followUpRawResults[0] 
                            : followUpRawResults;
                          
                          // Create assistant message with execution results
                          const followUpAssistantMessage: Message = {
                            role: 'assistant',
                            content: followUpContent,
                            timestamp: Date.now(),
                            model: model,
                            executionResults: combinedFollowUpRawResults
                          };
                          
                          // Create user message for next follow-up
                          // Error can be: result is null, result.success is false, or error field is set
                          const hasErrorsInExecution = followUpExecutionStatus.some(s => {
                            if (s.result === null) return true; // No result means error
                            if (s.result?.success === false) return true; // Explicit failure
                            if (s.error) return true; // Error field set
                            return false;
                          });
                          
                          // CRITICAL FIX: Extract code blocks and execution results from follow-up response
                          // This ensures the AI can see what code was executed and what the results were
                          // eslint-disable-next-line @typescript-eslint/no-unused-vars
                          const { codeBlocks: followUpCodeBlocks, executionResults: followUpExtractedResults } = extractCodeAndResults(followUpContent);
                          
                          // Build next follow-up message content with code and results included
                          // Let AI decide based on context what needs to be done
                          let nextFollowUpMessageContent: string;
                          
                          if (hasErrorsInExecution) {
                            // Extract failed executions and format error details
                            const failedExecutions = followUpExecutionStatus.filter(s => {
                              if (s.result === null) return true; // No result means error
                              if (s.result?.success === false) return true; // Explicit failure
                              if (s.error) return true; // Error field set
                              return false;
                            });
                            
                            // Count successful and failed blocks
                            const successfulCount = followUpExecutionStatus.filter(s => s.result?.success && !s.error).length;
                            const failedCount = failedExecutions.length;
                            
                            // If more blocks failed than succeeded, increment failure count
                            // Otherwise, reset it (more succeeded or equal)
                            let failureCount = 0;
                            if (failedCount > successfulCount) {
                              failureCount = chatId ? incrementFailureCount(chatId) : 0;
                            } else {
                              // More succeeded or equal - reset counter
                              if (chatId) {
                                resetFailureCount(chatId);
                              }
                            }
                            
                            // If we've had 4+ consecutive failures, ask clarifying questions instead of trying to fix
                            if (failureCount >= 4) {
                              
                              // Collect all errors for context
                              const allErrors = failedExecutions.map(s => {
                                const error = s.result?.error || s.error || 'Unknown error';
                                const code = s.code || '';
                                const firstLine = code.split('\n')[0] || '';
                                return `- **Error:** ${error}\n  **Code:** ${firstLine.substring(0, 100)}${code.length > 100 ? '...' : ''}`;
                              }).join('\n\n');
                              
                              // Build clarifying question message for the AI to ask the user
                              const clarifyingQuestionPrompt = `🚨 **MULTIPLE CONSECUTIVE FAILURES DETECTED**

I've encountered ${failureCount} consecutive execution failures. I need to ask the user clarifying questions to understand what's going wrong.

**Errors encountered:**
${allErrors}

**Your task:** Ask the user the following clarifying questions in a friendly, helpful way:
1. What specific data or columns are you trying to access? Are the column names correct?
2. Are there any special requirements or constraints I should know about?
3. What is the expected outcome or result you're looking for?
4. Are there any examples or sample data that might help clarify the task?

Please ask these questions clearly and wait for the user's response before attempting to fix the code again.`;
                              
                              const clarifyingQuestionUserMessage: Message = {
                                role: 'user',
                                content: clarifyingQuestionPrompt,
                                timestamp: Date.now()
                              };
                              
                              // Build conversation history with clarifying question prompt
                              const updatedHistory = [...conversationHistory.map(msg => 
                                msg.role === 'assistant' ? smartCompressMessage(msg) : msg
                              ), followUpAssistantMessage, clarifyingQuestionUserMessage];
                              
                              // Send clarifying question prompt to AI so it asks the user
                              await sendChatMessage(
                                clarifyingQuestionPrompt,
                                [],
                                updatedHistory,
                                matchData,
                                model,
                                reasoningEnabled,
                                volleyballContextEnabled,
                                maxFollowupDepth,
                                currentFollowupDepth + 1,
                                false,
                                onDelta,
                                onDone,
                                onError,
                                csvId,
                                csvFilterColumns,
                                csvFilterValues,
                                chatId,
                                matchFilterColumns,
                                matchFilterValues,
                                selectedContextSectionId,
                                onCsvProgress,
                                signal,
                                onCodeExecutionRequest
                              );
                              return;
                            }
                            
                            const failedCodeBlocks = failedExecutions
                              .map((s, idx) => {
                                const error = s.result?.error || s.error || 'Unknown error';
                                const code = s.code || '';
                                const truncatedCode = code.length > 500 ? code.substring(0, 500) + '\n// ... truncated' : code;
                                
                                // Detect variable-related errors
                                const isVariableError = /(?:is not defined|Cannot find name|ReferenceError|is undefined)/i.test(error);
                                const variableMatch = error.match(/(?:'|"|`)?([a-zA-Z_$][a-zA-Z0-9_$]*)(?:'|"|`)?\s+(?:is not defined|Cannot find name|is undefined)/i);
                                const undefinedVariable = variableMatch ? variableMatch[1] : null;
                                
                                let errorInstructions = `**Error:** ${error}`;
                                
                                if (isVariableError && undefinedVariable) {
                                  errorInstructions += `\n\n⚠️ **VARIABLE ERROR DETECTED:** "${undefinedVariable}" is not defined.\n`;
                                  errorInstructions += `**SOLUTION:**\n`;
                                  errorInstructions += `- **If this variable was defined in a previous block:** You must RETURN it from that block for it to be available here.\n`;
                                  errorInstructions += `  Example: If block 1 has "const ${undefinedVariable} = ...", you need "return { ${undefinedVariable}, ... }" in that block.\n`;
                                  errorInstructions += `- **If you need this variable:** DEFINE it in THIS block (e.g., const ${undefinedVariable} = ...)\n`;
                                  errorInstructions += `- **If this variable doesn't exist:** DO NOT use it - use the correct variable/column name from the dataset instead\n`;
                                  errorInstructions += `- **Check what was returned:** Look at previous blocks' return statements - only returned values persist to next blocks\n`;
                                  errorInstructions += `- **Common mistake:** Using local variables from previous blocks (like "${undefinedVariable}") that weren't returned - you must return them or redefine them\n`;
                                  errorInstructions += `- **Common mistake:** Using non-existent variables (like "ucsdMatches", "matchData", etc.) - use the actual data source (csvData, query results, etc.)`;
                                } else if (isVariableError) {
                                  errorInstructions += `\n\n⚠️ **VARIABLE ERROR:** A variable in your code is not defined.\n`;
                                  errorInstructions += `**SOLUTION:**\n`;
                                  errorInstructions += `- If this was defined in a previous block, you must RETURN it from that block\n`;
                                  errorInstructions += `- Otherwise, define the variable in this block, or use the correct variable name from the dataset`;
                                }
                                
                                return `**Failed Block ${idx + 1}:**\n\`\`\`execute\n${truncatedCode}\n\`\`\`\n\n${errorInstructions}`;
                              })
                              .join('\n\n');
                            
                            // Get successful blocks info to show what already worked
                            const successfulExecutions = followUpExecutionStatus.filter(s => s.result?.success && !s.error);
                            const successfulBlocksInfo = successfulExecutions
                              .map((s) => {
                                const originalIndex = followUpExecutionStatus.indexOf(s);
                                const code = s.code || '';
                                const firstLine = code.split('\n')[0] || '';
                                return `Block ${originalIndex + 1}: ${firstLine.substring(0, 80)}${code.length > 80 ? '...' : ''}`;
                              })
                              .join('\n');
                            
                            const successCount = followUpExecutionStatus.length - failedExecutions.length;
                            nextFollowUpMessageContent = `CODE EXECUTION ERROR REPORT:

✅ ${successCount} block(s) executed successfully (DO NOT recreate these):
${successCount > 0 ? successfulBlocksInfo : 'None'}

❌ ${failedExecutions.length} block(s) FAILED (fix ONLY these):

${failedCodeBlocks}

🚨 CRITICAL FIX INSTRUCTIONS:
1. Fix ONLY the FAILED block(s) listed above
2. DO NOT recreate or re-run successful blocks - they already executed successfully
3. DO NOT write all blocks again - only provide the corrected failed block(s)
4. Successful blocks' variables are still available - you can use them in your fix
5. Use \`\`\`execute with "return" statement for the fixed block
6. Use ONLY column names that exist in the dataset (see column details in context)
7. Do NOT use information_schema - it's not available in DuckDB-WASM

EXAMPLE: If Block 1 succeeded and Block 2 failed, only provide:
\`\`\`execute
// Fixed Block 2 code here
\`\`\`
Do NOT include Block 1 again!`;
                          } else {
                            // Check if a chart was created in followup execution
                            const followupChartCreated = followUpRawResults.some(result => {
                              if (!result) return false;
                              if (typeof result === 'object' && result !== null) {
                                return 'echarts_chart' in result || 'chart' in result;
                              }
                              return false;
                            });

                            // Use clear completion check format
                            // Use the CURRENT message parameter, not from history
                            const originalUserMsg = message;

                            nextFollowUpMessageContent = `🔄 CODE EXECUTION COMPLETE

**CODE EXECUTED:**${codeBlocksSection}
**RESULTS:**${executionResultsSection}
${followupChartCreated ? '**📊 CHART DETECTED:** A chart/visualization was successfully created and is displayed above. When you provide your response, explain what the graph shows, important data points, patterns, trends, and the significance of the visualization.\n\n' : ''}
**User's Original Question:** "${originalUserMessage}"

🎯 **YOUR TASK NOW:**

STOP DO NOT CODE OR PLAN YET

STOP and READ the results above. They contain the data you executed code to get.

✅ **IF the results ANSWER the user's question:**
   → Simply state the answer clearly using the results
   → DO NOT write more code
   → DO NOT create new plans
   → Example: "Based on the results, there were 1,234 white wins, 987 black wins, and 456 draws."

❌ **IF the results are INCOMPLETE (missing data the user asked for):**
   → Write ONLY the missing code
   → Example: User asked for a chart but results show only data → Add chart code

🚨 **CRITICAL - DO NOT:**
- Re-plan or re-execute code you already ran
- Write code if the data is already in the results
- Ignore the results and start over

The results above contain real data. Use them to answer: "${originalUserMessage}"`
                            
                           
                              



                            // Add completion signal if last followup
                            const nextDepth = followUpDepth + 1;
                            const isNextLast = maxFollowupDepth > 0 && nextDepth >= maxFollowupDepth;
                            if (isNextLast) {
                              nextFollowUpMessageContent += `\n\n🚨 **THIS IS YOUR FINAL FOLLOWUP** - Provide complete analysis with the available results. Do NOT suggest additional code.`;
                            }

                            // Include code blocks and execution results for context
                            if (followUpCodeBlocks && followUpCodeBlocks.length > 0) {
                              let codeAndResultsSection = '\n\n**Code you executed:**\n';
                              followUpCodeBlocks.forEach((block, idx) => {
                                if (followUpCodeBlocks.length > 1) {
                                  codeAndResultsSection += `\nCode Block ${idx + 1}:\n`;
                                }
                                codeAndResultsSection += block + '\n';
                              });

                              // Add execution results
                              if (followUpExtractedResults && followUpExtractedResults.length > 0) {
                                codeAndResultsSection += '\n**Results from this code:**\n';
                                codeAndResultsSection += followUpExtractedResults.join('\n\n');
                              }

                              nextFollowUpMessageContent += codeAndResultsSection;
                            }
                          }
                          
                          const nextFollowUpUserMessage: Message = {
                            role: 'user',
                            content: nextFollowUpMessageContent,
                            timestamp: Date.now()
                          };
                          
                          // Build updated history with follow-up execution results
                          const nextUpdatedHistory = [...updatedHistory, followUpAssistantMessage, nextFollowUpUserMessage];
                          
                          // Check depth for recursive followup
                          const nextFollowUpDepth = followUpDepth + 1;
                          const isNextFollowUpLast = maxFollowupDepth > 0 && nextFollowUpDepth >= maxFollowupDepth;
                          
                          // Build context for next follow-up
                          let nextFollowUpContextMessage: string;
                          if (hasCsvFilterSelections && volleyballContextEnabled && followUpExecutionData && Array.isArray(followUpExecutionData) && followUpExecutionData.length > 0) {
                            nextFollowUpContextMessage = buildVolleyballContext(nextFollowUpUserMessage.content, null, nextUpdatedHistory.slice(0, -1), volleyballContextEnabled, followUpExecutionData, csvFileName, followUpValueInfo, selectedContextSectionId, maxFollowupDepth, nextFollowUpDepth, isNextFollowUpLast, csvId, chatId);
                          } else if (useCurrentSelection && currentSelectionValueInfo && volleyballContextEnabled && hasActualData) {
                            nextFollowUpContextMessage = buildVolleyballContext(nextFollowUpUserMessage.content, null, nextUpdatedHistory.slice(0, -1), volleyballContextEnabled, followUpExecutionData, csvFileName, currentSelectionValueInfo, selectedContextSectionId, maxFollowupDepth, nextFollowUpDepth, isNextFollowUpLast, csvId, chatId);
                          } else if (hasCsvFilterSelections && volleyballContextEnabled && followUpValueInfo) {
                            nextFollowUpContextMessage = buildVolleyballContext(nextFollowUpUserMessage.content, null, nextUpdatedHistory.slice(0, -1), volleyballContextEnabled, null, csvFileName, followUpValueInfo, selectedContextSectionId, maxFollowupDepth, nextFollowUpDepth, isNextFollowUpLast, csvId, chatId);
                          } else if (matchData && volleyballContextEnabled && hasActualData) {
                            nextFollowUpContextMessage = buildVolleyballContext(nextFollowUpUserMessage.content, matchData, nextUpdatedHistory.slice(0, -1), volleyballContextEnabled, followUpExecutionData, csvFileName, null, selectedContextSectionId, maxFollowupDepth, nextFollowUpDepth, isNextFollowUpLast, csvId, chatId);
                          } else if (followUpExecutionData && Array.isArray(followUpExecutionData) && followUpExecutionData.length > 0 && volleyballContextEnabled) {
                            nextFollowUpContextMessage = buildVolleyballContext(nextFollowUpUserMessage.content, null, nextUpdatedHistory.slice(0, -1), volleyballContextEnabled, followUpExecutionData, csvFileName, followUpValueInfo, selectedContextSectionId, maxFollowupDepth, nextFollowUpDepth, isNextFollowUpLast, csvId, chatId);
                          } else {
                            nextFollowUpContextMessage = buildConversationContext(nextFollowUpUserMessage.content, nextUpdatedHistory.slice(0, -1), undefined, volleyballContextEnabled, false, false, selectedContextSectionId, maxFollowupDepth, nextFollowUpDepth, isNextFollowUpLast);
                          }
                          
                          // DO NOT add code execution reminder in follow-ups analyzing results
                          // The follow-up message already tells the AI whether to write code or not
                          // if (hasActualData) {
                          //   nextFollowUpContextMessage += `\n\nCode execution available - use \`\`\`execute blocks when data analysis is needed.`;
                          // }
                          
                          // Check depth limit
                          if (maxFollowupDepth > 0 && nextFollowUpDepth >= maxFollowupDepth) {
                            onDone();
                            return;
                          }
                          
                          // Check if request was aborted before starting nested follow-up
                          if (signal?.aborted) {
                            onDone();
                            return;
                          }
                          
                          let nextFollowUpContent = '';
                          
                          const nextProcessedHistory = await getConversationHistory(nextUpdatedHistory, chatId);
                          await callApi({
                            prompt: nextFollowUpContextMessage,
                            model,
                            images: [],
                            conversationHistory: nextProcessedHistory,
                            reasoningEnabled: reasoningEnabled,
                            signal: signal,
                            onDelta: (chunk: string) => {
                              nextFollowUpContent += chunk;
                              onDelta(chunk);
                            },
                            onDone: async () => {
                              const nextBlocks = executor.detectCodeBlocksInStream(nextFollowUpContent);
                              
                              // CRITICAL FIX: Filter out code blocks that have already been executed successfully
                              // Track all previously executed code from initial execution and first follow-up
                              const allPreviouslyExecutedCode = new Set<string>();

                              // Add code from initial execution
                              if (executionStatus && executionStatus.length > 0) {
                                executionStatus.forEach(status => {
                                  if (status.result?.success && status.code) {
                                    const normalized = status.code.replace(/\s+/g, ' ').trim();
                                    allPreviouslyExecutedCode.add(normalized);
                                  }
                                });
                              }

                              // Add code from first follow-up execution
                              if (followUpExecutionStatus && followUpExecutionStatus.length > 0) {
                                followUpExecutionStatus.forEach(status => {
                                  if (status.result?.success && status.code) {
                                    const normalized = status.code.replace(/\s+/g, ' ').trim();
                                    allPreviouslyExecutedCode.add(normalized);
                                  }
                                });
                              }

                              // IMPORTANT: Also check conversation history for ALL previously executed code
                              // This prevents re-executing code from earlier questions in the conversation
                              conversationHistory.forEach(msg => {
                                if (msg.role === 'assistant' && msg.content) {
                                  // Extract code blocks from previous assistant messages
                                  const codeBlockRegex = /```(?:execute|javascript|js|query|code)\s*\n([\s\S]*?)```/gi;
                                  let match;
                                  while ((match = codeBlockRegex.exec(msg.content)) !== null) {
                                    const code = match[1];
                                    const normalized = code.replace(/\s+/g, ' ').trim();
                                    allPreviouslyExecutedCode.add(normalized);
                                  }
                                }
                              });
                              
                              // Check if ALL blocks have been executed before
                              // Only skip execution if ALL blocks are duplicates
                              const recursiveDuplicateStatus = nextBlocks.map(block => {
                                const normalizedBlock = block.code.replace(/\s+/g, ' ').trim();
                                return allPreviouslyExecutedCode.has(normalizedBlock);
                              });

                              const allRecursiveBlocksAlreadyExecuted = nextBlocks.length > 0 && recursiveDuplicateStatus.every(isDup => isDup);

                              // If ALL code blocks have been executed before, skip execution and do analysis
                              if (allRecursiveBlocksAlreadyExecuted) {
                                onDelta('\n\n**ℹ️ Code already executed - showing analysis...**\n\n');

                                // Get previous execution results (combine initial and follow-up results)
                                const combinedResults = followUpRawResults.length > 0
                                  ? (followUpRawResults.length === 1 ? followUpRawResults[0] : followUpRawResults)
                                  : (rawExecutionResults.length > 0 
                                    ? (rawExecutionResults.length === 1 ? rawExecutionResults[0] : rawExecutionResults)
                                    : null);
                                
                                // Get original user message for context
                                // Use the CURRENT message parameter, not from history
                                const originalUserMsg = message;

                                // Extract code blocks from previous executions for context
                                // First check if we have follow-up code blocks
                                let recursiveCodeSection = '';
                                const codeBlocksToShow = followUpCodeBlocks && followUpCodeBlocks.length > 0
                                  ? followUpCodeBlocks
                                  : (codeBlocks && codeBlocks.length > 0 ? codeBlocks : []);
                                
                                if (codeBlocksToShow.length > 0) {
                                  recursiveCodeSection = '\n**Code Executed:**\n';
                                  codeBlocksToShow.forEach((block, idx) => {
                                    if (codeBlocksToShow.length > 1) {
                                      recursiveCodeSection += `\nCode Block ${idx + 1}:\n`;
                                    }
                                    recursiveCodeSection += block + '\n';
                                  });
                                }

                                // Build execution results - show RAW but truncate large results
                                let recursiveResultsSection = '\n**Execution Results:**\n';
                                const resultsToShow = followUpRawResults && followUpRawResults.length > 0
                                  ? followUpRawResults
                                  : rawExecutionResults;
                                if (resultsToShow && resultsToShow.length > 0) {
                                  resultsToShow.forEach((result, idx) => {
                                    if (resultsToShow.length > 1) {
                                      recursiveResultsSection += `\nResult ${idx + 1}:\n`;
                                    }

                                    // Check if this is a chart/visualization
                                    if (result && typeof result === 'object' && ('echarts_chart' in result || 'chart' in result)) {
                                      recursiveResultsSection += '[This is a chart/visualization - displayed to user]\n';
                                    } else if (Array.isArray(result) && result.length > 500) {
                                      // Truncate large arrays
                                      const truncated = result.slice(0, 500);
                                      const remaining = result.length - 500;
                                      recursiveResultsSection += '```json\n' + JSON.stringify(truncated, null, 2) + '\n```\n';
                                      recursiveResultsSection += `[Truncated - ${remaining} more rows not shown]\n`;
                                    } else {
                                      // Show full result for small data
                                      recursiveResultsSection += '```json\n' + JSON.stringify(result, null, 2) + '\n```\n';
                                    }
                                  });
                                } else {
                                  recursiveResultsSection = '';
                                }

                                let continuationMessage = `**Code and results from your previous execution:**
${recursiveCodeSection}${recursiveResultsSection}
**Original question:** "${originalUserMsg}"

**🎯 YOUR TASK: PROVIDE THE ANSWER**

The code executed successfully and returned results. Now answer the user's question using these results.

**✅ DEFAULT ACTION: Just state the answer from the results in plain language. NO code blocks.**

Be direct: state what was found, calculated, or returned by the code execution.

**❌ DO NOT write any code unless the results are clearly incomplete or missing.**

**⚠️ IMPORTANT: Keep response SHORT and DIRECT. No code blocks in your answer.**`;
                                
                                const continuationUserMessage: Message = {
                                  role: 'user',
                                  content: continuationMessage,
                                  timestamp: Date.now()
                                };
                                
                                // Add assistant response to history
                                // CRITICAL FIX: Keep FULL content with execution results for UI display
                                const assistantMessageWithResults: Message = {
                                  role: 'assistant',
                                  content: nextFollowUpContent, // Keep FULL content with execution results for display
                                  timestamp: Date.now(),
                                  model: model,
                                  executionResults: combinedResults
                                };
                                
                                // Build updated history with compression
                                const compressedHistory = compressLongConversation(conversationHistory);
                                const historyWithFollowUp = followUpAssistantMessage
                                  ? [...compressedHistory, followUpAssistantMessage, assistantMessageWithResults, continuationUserMessage]
                                  : [...compressedHistory, assistantMessageWithResults, continuationUserMessage];
                                
                                // Send continuation
                                const nextRecursiveDepth = nextFollowUpDepth + 1;
                                const isNextRecursiveLast = maxFollowupDepth > 0 && nextRecursiveDepth >= maxFollowupDepth;
                                
                                if (maxFollowupDepth > 0 && nextRecursiveDepth > maxFollowupDepth) {
                                  executor.clearExecutionState();
                                  onDone();
                                  return;
                                }
                                
                                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                const processedHistory = await getConversationHistory(historyWithFollowUp, chatId);
                                await sendChatMessage(
                                  continuationUserMessage.content,
                                  [],
                                  historyWithFollowUp.slice(0, -1),
                                  matchData,
                                  model,
                                  reasoningEnabled,
                                  volleyballContextEnabled,
                                  maxFollowupDepth,
                                  nextRecursiveDepth,
                                  isNextRecursiveLast,
                                  onDelta,
                                  onDone,
                                  onError,
                                  csvId,
                                  csvFilterColumns,
                                  csvFilterValues,
                                  chatId,
                                  matchFilterColumns,
                                  matchFilterValues,
                                  selectedContextSectionId,
                                  undefined, // onCsvProgress
                                  signal,
                                  onCodeExecutionRequest // CRITICAL: Pass approval callback to recursive calls
                                );
                                return;
                              }

                              // If no code blocks at all, task is complete
                              if (nextBlocks.length === 0) {
                                onDone();
                                return;
                              }

                              // Execute ALL blocks if at least one is new
                              if (nextBlocks.length > 0) {
                                // Request user approval for follow-up code blocks (same as initial blocks)
                                let shouldExecuteFollowup = false; // Default to FALSE for safety
                                let editedFollowupBlocks: CodeBlock[] | undefined;

                                if (!onCodeExecutionRequest) {
                                  // CRITICAL: No approval callback - cannot execute without user approval
                                  onDelta('\n\n*[Code execution requires user approval - approval callback missing]*');
                                  onDone();
                                  return;
                                }

                                try {
                                  const result = await onCodeExecutionRequest(nextBlocks);
                                  shouldExecuteFollowup = result.approved;
                                  editedFollowupBlocks = result.editedBlocks;
                                } catch (error) {
                                  console.error('❌ Error requesting follow-up code execution approval:', error);
                                  shouldExecuteFollowup = false;
                                }
                                
                                if (!shouldExecuteFollowup) {
                                  // User rejected follow-up code execution
                                  onDelta('\n\n*[Code execution cancelled by user]*');
                                  onDone();
                                  return;
                                }
                                
                                // DOUBLE-CHECK: Ensure we have explicit approval before proceeding
                                if (!shouldExecuteFollowup) {
                                  console.error('🚨 CRITICAL: Recursive follow-up execution attempted without approval - blocking execution');
                                  onDelta('\n\n*[Code execution requires user approval - execution blocked]*');
                                  onDone();
                                  return;
                                }
                                
                                // Use edited blocks if provided, otherwise execute ALL blocks (including previously executed ones)
                                const blocksToExecute = editedFollowupBlocks || nextBlocks;
                                
                                onDelta('\n\n**Executing additional code from follow-up...**\n\n');

                                const nextExecutionResults: string[] = [];
                                const nextRawResults: any[] = [];

                                for (const block of blocksToExecute) {
                                  const validation = executor.validateCode(block.code);
                                  if (validation.valid) {
                                    try {
                                      const result = await executor.executeCode(block.code);
                                      const formattedResult = executor.formatResult(result);
                                      nextExecutionResults.push(formattedResult);
                                      // Note: We're not tracking status here, but we should check result.success
                                      nextRawResults.push(result.success ? result.result : null);
                                      onDelta(formattedResult + '\n\n');
                                    } catch (error: any) {
                                      const errorResult = executor.formatResult({ success: false, error: error.message, executionTime: 0 });
                                      nextExecutionResults.push(errorResult);
                                      nextRawResults.push(null);
                                      onDelta(errorResult + '\n\n');
                                    }
                                  } else {
                                    const errorResult = executor.formatResult({ success: false, error: validation.error || 'Invalid code', executionTime: 0 });
                                    nextExecutionResults.push(errorResult);
                                    nextRawResults.push(null);
                                    onDelta(errorResult + '\n\n');
                                  }
                                }

                                // CRITICAL FIX: Send execution results back to AI for analysis
                                if (nextExecutionResults.length > 0 && nextRawResults.some(r => r !== null)) {

                                  // Check depth limit before creating another follow-up
                                  const finalFollowUpDepth = nextFollowUpDepth + 1;
                                  if (maxFollowupDepth > 0 && finalFollowUpDepth >= maxFollowupDepth) {
                                    onDone();
                                    return;
                                  }

                                  // Create assistant message with execution results
                                  const nextAssistantMessage: Message = {
                                    role: 'assistant',
                                    content: nextFollowUpContent,
                                    timestamp: Date.now(),
                                    model: model,
                                    executionResults: nextRawResults.length === 1 ? nextRawResults[0] : nextRawResults
                                  };

                                  // Create user message with execution results
                                  const finalUserMessage: Message = {
                                    role: 'user',
                                    content: `Here are the code execution results:\n\n${nextExecutionResults.join('\n\n')}\n\nPlease analyze these results and provide insights.`,
                                    timestamp: Date.now()
                                  };

                                  const finalUpdatedHistory = [...nextUpdatedHistory, nextAssistantMessage, finalUserMessage];

                                  // Build context for final follow-up
                                  let finalContextMessage: string;
                                  if (hasCsvFilterSelections && volleyballContextEnabled && followUpExecutionData && Array.isArray(followUpExecutionData) && followUpExecutionData.length > 0) {
                                    finalContextMessage = buildVolleyballContext(finalUserMessage.content, null, finalUpdatedHistory.slice(0, -1), volleyballContextEnabled, followUpExecutionData, csvFileName, followUpValueInfo, selectedContextSectionId, maxFollowupDepth, finalFollowUpDepth, true, csvId, chatId);
                                  } else if (matchData && volleyballContextEnabled) {
                                    finalContextMessage = buildVolleyballContext(finalUserMessage.content, matchData, finalUpdatedHistory.slice(0, -1), volleyballContextEnabled, undefined, undefined, undefined, selectedContextSectionId, maxFollowupDepth, finalFollowUpDepth, true, csvId, chatId);
                                  } else {
                                    finalContextMessage = buildConversationContext(finalUserMessage.content, finalUpdatedHistory.slice(0, -1), undefined, volleyballContextEnabled, false, false, selectedContextSectionId, maxFollowupDepth, finalFollowUpDepth, true);
                                  }

                                  // Send final follow-up to get AI's analysis
                                  const finalProcessedHistory = await getConversationHistory(finalUpdatedHistory, chatId);
                                  await callApi({
                                    prompt: finalContextMessage,
                                    model,
                                    images: [],
                                    conversationHistory: finalProcessedHistory,
                                    reasoningEnabled: reasoningEnabled,
                                    signal: signal,
                                    onDelta: (chunk: string) => {
                                      onDelta(chunk);
                                    },
                                    onDone: () => {
                                      onDone();
                                    },
                                    onError: (error: string) => {
                                      console.error('Error in final analysis:', error);
                                      onDone();
                                    }
                                  });
                                } else {
                                  // No successful execution results to send back
                                  onDone();
                                }
                              } else {
                                // No code blocks in response
                                onDone();
                              }
                            },
                            onError: async (error: string) => {
                              console.error('Error in follow-up:', error);
                              onDone();
                            }
                          });
                        } else {
                          onDone();
                        }
                      } else {
                        executor.clearExecutionState();
                        onDone();
                      }
                  } catch (error: any) {
                    console.error('Error processing follow-up code execution:', error);
                    onDelta(`\n\n**Note**: Follow-up analysis completed, but code execution encountered an error: ${error.message || 'Unknown error'}\n\n`);
                    executor.clearExecutionState();
                    onDone();
                  }
                },
                onError: (error: string) => {
                  console.error('Error in follow-up message:', error);
                  onDelta(`\n\n**Note**: Execution completed, but follow-up analysis encountered an error: ${error}\n\n`);
                  onDone();
                }
              });
            }
          } else {
            // No code blocks to execute
            executor.clearExecutionState();
            onDone();
          }
        } catch (error: any) {
          console.error('Code execution failed completely:', error);
          onDelta(`\n\n**Code Execution Error**: ${error instanceof Error ? error.message : 'Unknown error'}\n\n`);
          executor.clearExecutionState();
          onDone();
        } finally {
          // Always clear execution state when response completes
          executor.clearExecutionState();
          
          // Add assistant response to LangChain memory
          if (chatId && assistantResponse) {
            try {
              const { getOrCreateMemoryManager } = await import('@/lib/memoryStore');
              const memoryManager = getOrCreateMemoryManager(chatId);
              
              // Include execution results in the message content for better context
              let content = assistantResponse;
              // Note: executionResults would be in rawExecutionResults but we don't have access here
              // The execution results are already in assistantResponse content via onDelta
              
              await memoryManager.addMessage('assistant', content);
            } catch (error) {
              // Don't fail the request if LangChain update fails
            }
          }
        }
      },
      onError: (error: string) => {
        onError(error);
      }
    });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('sendChatMessage error:', errorMessage);
    onError(errorMessage);
  }
}
