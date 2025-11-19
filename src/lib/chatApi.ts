import { Message, MatchData } from "@/types/chat";
import { callApi } from "./apiProviders";
import { modelHasApiKey } from "./apiKeys";
import { CodeExecutor, CodeBlock, ExecutionResult } from "./codeExecutorV2";
import { getCsvDataRows } from "@/lib/csvStorage";

// Old Gemini API functions removed - now using apiProviders.ts

export const DEFAULT_MODEL = "openrouter/sherlock-think-alpha";

// Available AI models via OpenRouter
export const AVAILABLE_MODELS = [
  { id: "openrouter/sherlock-think-alpha", name: "Sherlock Think Alpha (Reasoning + Vision)", free: false },
  { id: "tngtech/deepseek-r1t2-chimera:free", name: "DeepSeek R1T2 Chimera (Free)", free: true },
  { id: "openrouter/sherlock-dash-alpha", name: "Sherlock Dash Alpha (Vision)", free: true },
  { id: "qwen/qwen3-coder:free", name: "Qwen3 Coder (Free)", free: true },
  { id: "kwaipilot/kat-coder-pro:free", name: "Kat Coder Pro (Free)", free: true },
  { id: "z-ai/glm-4.5-air:free", name: "GLM 4.5 Air (Free)", free: true },
];

// Helper function to load coding rules from localStorage
function getCodingRules(): string {
  try {
    const saved = localStorage.getItem("db_coding_rules");
    if (saved) {
      const parsed = JSON.parse(saved);
      const rulesContent = parsed.id ? parsed.content : (typeof parsed === 'string' ? parsed : parsed);
      if (rulesContent && typeof rulesContent === 'string' && rulesContent.trim()) {
        console.log('✅ Loaded coding rules from settings (length:', rulesContent.length, 'chars)');
        return rulesContent;
      }
    }
  } catch (e) {
    console.error('Error loading coding rules:', e);
  }
  
  console.log('⚠️ Using default coding rules (no custom rules found in settings)');
  
  // Return default if nothing saved
  return `CODE EXECUTION (MANDATORY FOR ALL DATA ANALYSIS):

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
- Analysis, comprehensive analysis, data analysis
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
- data: array of all data rows (if database/table data loaded)
- csvData: array of all CSV rows (if CSV file selected)
- dataInfo: metadata object (if available)
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
  // Keep it minimal - detailed instructions should come from user-configured context sections
  return `You are an expert data analyst assistant. Analyze data objectively and provide insights based on the actual data structure and values.`;
}

// Process conversation history to optimize token usage:
// - Recent messages (last 10): Full content
// - Middle messages (11-20): Summarized (key findings only)
// - Older messages (21+): Excluded or highly compressed
// - Strip execution results from all but recent messages
function processConversationHistory(history: Message[]): Message[] {
  if (history.length <= 10) {
    // Small history - return as-is
    return history;
  }
  
  const processed: Message[] = [];
  const totalMessages = history.length;
  
  // Last 10 messages: Full content (keep execution results only for last 3 messages)
  const recentMessages = history.slice(-10);
  const veryRecent = recentMessages.slice(-3); // Last 3 keep execution results
  const recentButNotVery = recentMessages.slice(0, -3); // Messages 4-10 from end: strip execution results
  
  // Add very recent messages with execution results
  processed.push(...veryRecent);
  // Add recent messages without execution results
  processed.push(...recentButNotVery.map(msg => stripExecutionResults(msg, false)));
  
  if (totalMessages > 10) {
    // Messages 11-20: Summarized (key findings, conclusions)
    const middleMessages = history.slice(-20, -10);
    const summarized = middleMessages.map(msg => summarizeMessage(msg));
    processed.unshift(...summarized);
  }
  
  if (totalMessages > 20) {
    // Messages 21+: Highly compressed or excluded
    // For now, we'll exclude them to save tokens
    // Could add a very brief summary if needed
    const olderMessages = history.slice(0, -20);
    // Optionally add a single summary message for very old context
    if (olderMessages.length > 0) {
      const oldSummary: Message = {
        role: 'assistant',
        content: `[Previous conversation context: ${olderMessages.length} older messages discussing data analysis. Key datasets and findings are preserved in recent messages above.]`,
        timestamp: olderMessages[0].timestamp
      };
      processed.unshift(oldSummary);
    }
  }
  
  return processed;
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

// Summarize a message to extract key findings and conclusions
function summarizeMessage(msg: Message): Message {
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

function buildConversationContext(newMessage: string, conversationHistory: Message[], dataInfo?: { id?: string; [key: string]: any }, dataAnalysisMode: boolean = true, includeHistoryInPrompt: boolean = false, hasData: boolean = false, selectedContextSectionId?: string | null): string {
  // Note: When includeHistoryInPrompt is false, conversation history is handled via messages array in API
  // This prevents duplication and confusion for the AI
  
  let context = '';
  
  // Always include context sections if one is selected, regardless of dataAnalysisMode
  const shouldIncludeContextSection = selectedContextSectionId && selectedContextSectionId !== "none";
  
  if (dataAnalysisMode) {
    // Load context sections from settings (use selected section if provided, even if no data)
    const contextSections = getContextSections(selectedContextSectionId || undefined);
    context = contextSections + '\n\n';
    
    // Add dataset information prominently if available
    if (dataInfo && Object.keys(dataInfo).length > 0) {
      context += `=== CURRENT DATASET BEING ANALYZED ===\n`;
      if (dataInfo.id) {
        context += `Dataset ID: ${dataInfo.id}\n`;
      }
      // Include any other metadata fields
      Object.entries(dataInfo).forEach(([key, value]) => {
        if (key !== 'id' && value) {
          context += `${key}: ${value}\n`;
        }
      });
      context += `You are analyzing data from this specific dataset. All statistics and analysis should be based on this dataset only.\n\n`;
    }
    
    // Only load coding rules if data is available (dataInfo indicates data, or hasData is true)
    // Context sections are always included if selected, but coding rules only when data exists
    if (dataInfo || hasData) {
      const codingRules = getCodingRules();
      context += codingRules + '\n\n';
    }
  } else {
    // Even in non-data-analysis mode, include context sections if one is selected
    if (shouldIncludeContextSection) {
      const contextSections = getContextSections(selectedContextSectionId);
      context = contextSections + '\n\n';
    }
    context += 'You are a helpful AI assistant.\n\n';
    context += 'Instructions:\n- Answer directly and helpfully\n- Be clear and concise\n- Format responses professionally: Use clear paragraphs with natural flow, supplement with structured lists when helpful, use tables for data, bold key points, and organize with headers for major sections\n- For mathematical expressions, wrap them in math delimiters: use $...$ for inline math and $$...$$ for block math (display equations)\n\n';
  }
  
  // Only include conversation history in prompt if explicitly requested
  // Otherwise, it's handled via messages array in API (prevents duplication)
  if (includeHistoryInPrompt && conversationHistory.length > 0) {
    const recentMessages = conversationHistory.slice(-12); // Increased to 12 messages (6 exchanges) for better memory
    context += '\n═══════════════════════════════════════════════════════════════\n';
    context += 'CONVERSATION HISTORY (for context - understand what you were doing):\n';
    context += '═══════════════════════════════════════════════════════════════\n';
    recentMessages.forEach((msg, idx) => {
      // Safety check for message structure
      if (!msg || typeof msg !== 'object') return;
      
      const role = msg.role || 'user';
      const msgContent = msg.content || '';
      
      // Format messages clearly with numbering
      context += `\n[${idx + 1}] ${role === 'user' ? 'USER' : 'ASSISTANT'}:\n${msgContent}\n`;
      
      // If message has execution results (saved JSON data), include summary for reference
      if (role === 'assistant' && (msg as Message).executionResults) {
        const execData = (msg as Message).executionResults;
        try {
          const jsonStr = typeof execData === 'string' ? execData : JSON.stringify(execData, null, 2);
          // Include full execution results if small, otherwise summary
          if (jsonStr.length < 1000) {
            context += `[Execution results from this response: ${jsonStr}]\n`;
          } else {
            // Extract key information from execution results
            const execObj = typeof execData === 'object' ? execData : JSON.parse(jsonStr);
            const keys = Object.keys(execObj || {});
            context += `[Execution results from this response: Contains ${keys.length} properties including: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}]\n`;
          }
        } catch (e) {
          // Ignore if can't stringify
        }
      }
    });
    context += '\n═══════════════════════════════════════════════════════════════\n';
    context += 'END OF CONVERSATION HISTORY\n';
    context += '═══════════════════════════════════════════════════════════════\n\n';
  }
  
  context += `User: ${newMessage}`;
  
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
  selectedContextSectionId?: string | null
): string {
  // If data analysis context is disabled, return generic AI assistant context
  // But still include context sections if one is selected
  if (!volleyballContextEnabled) {
    return buildConversationContext(userMessage, conversationHistory, undefined, false, false, false, selectedContextSectionId);
  }
  
  let context = '';
  
  // Check for current_selection first (grouped data selection takes precedence)
  // Only treat as having data if there's actual data array with rows
  const hasCurrentSelectionData = currentSelectionValueInfo && 
                                  currentSelectionValueInfo.data && 
                                  Array.isArray(currentSelectionValueInfo.data) && 
                                  currentSelectionValueInfo.data.length > 0;
  
  if (hasCurrentSelectionData) {
    // Build context with current_selection data - always include history for better memory
    const includeHistory = true; // Always include history for better context and memory
    context = buildConversationContext(userMessage, conversationHistory, undefined, true, includeHistory, true, selectedContextSectionId); // hasData = true (currentSelectionValueInfo has actual data)
    
    // Extract filter criteria from description (format: "Selected Group: col1=val1, col2=val2")
    const filterDescription = currentSelectionValueInfo.description || currentSelectionValueInfo.name || 'Custom grouped selection';
    
    // Add concise selected data summary
    context += `\n=== SELECTED DATA ===
Rows: ${currentSelectionValueInfo.data.length} | Filter: ${filterDescription}
CRITICAL: Data is pre-filtered. Use entire 'data' array - do NOT filter by selection criteria again.`;
    
    // Add valueInfo summary if available (with actual unique values)
    if (currentSelectionValueInfo.summary && currentSelectionValueInfo.columns) {
      context += `\n\n=== COLUMN DETAILS ===
${currentSelectionValueInfo.columns.map((col: any) => {
  const uniqueVals = col.uniqueValues && Array.isArray(col.uniqueValues) && col.uniqueValues.length > 0
    ? col.uniqueValues.slice(0, 30).map((v: any) => {
        // Format values for display - handle null, undefined, and long strings
        if (v === null || v === undefined) return 'null';
        const str = String(v);
        return str.length > 50 ? str.substring(0, 47) + '...' : str;
      }).join(', ') + (col.uniqueValues.length > 30 ? ` ... (${col.uniqueValues.length} total)` : '')
    : 'none';
  return `${col.name} (${col.type}): [${uniqueVals}] | ${col.nullCount || 0} null`;
}).join('\n')}

Use exact column names above when writing queries.`;
    }
    
    // Load context sections from settings (use selected section if provided)
    const contextSections = getContextSections(selectedContextSectionId || undefined);
    context = contextSections + '\n\n' + context;
    
    return context;
  }
  
  if (matchData) {
    const { matchInfo, data, summary } = matchData;
    
    // Build context with conversation history and dataset info prominently displayed
    // Always include history for better memory and context
    const includeHistory = true; // Always include history for better context and memory
    
    // Create generic dataInfo object from matchInfo (universal)
    const dataInfo: { id?: string; [key: string]: any } = {
      id: matchInfo.match_id
    };
    // Include any other matchInfo fields as generic metadata
    if (matchInfo.home_team) dataInfo.home_team = matchInfo.home_team;
    if (matchInfo.visiting_team) dataInfo.visiting_team = matchInfo.visiting_team;
    
    context = buildConversationContext(userMessage, conversationHistory, dataInfo, true, includeHistory, true, selectedContextSectionId); // hasData = true (matchData exists)
    
    // Load context sections from settings (use selected section if provided)
    const contextSections = getContextSections(selectedContextSectionId || undefined);
    context = contextSections + '\n\n' + context;
    
    // Create condensed dataset summary (universal format)
    const datasetSummary = `\n=== DATASET ===
ID: ${matchInfo.match_id} | Rows: ${data.length}${matchInfo.home_team && matchInfo.visiting_team ? ` | ${matchInfo.home_team} vs ${matchInfo.visiting_team}` : ''}${summary.setScores ? ` | Sets: ${Object.entries(summary.setScores).map(([set, scores]) => `${set}:${scores.home}-${scores.visiting}`).join(' ')} | Result: ${summary.homeSetWins}-${summary.visitingSetWins}` : ''}`;
    
    // Universal data structure reference
    const dataStructure = `\n=== DATA STRUCTURE ===
CRITICAL: Query ALL rows - never sample/estimate. Each row = one record.

GENERAL PRINCIPLES:
- Use exact column names from COLUMN DETAILS below - don't assume names
- Check for null/undefined: Use optional chaining (?.) or null checks
- Combine filters: data.filter(row => condition1 && condition2 && condition3)
- Always use .length to count - never estimate
- Inspect structure: Object.keys(data[0]) to see available columns`;
    
    // Check if value info exists for this dataset - try multiple lookup strategies
    let valueInfo = getValueInfo(matchInfo.match_id, 'match');
    
    // Fallback: try to find valueInfo by id as string or number
    if (!valueInfo) {
      const allValueInfos = getAllValueInfos();
      valueInfo = allValueInfos.find((v: any) => 
        v.type === 'match' && (
          v.id === matchInfo.match_id ||
          v.id?.toString() === matchInfo.match_id?.toString() ||
          (matchInfo.home_team && v.name?.includes(matchInfo.home_team)) ||
          (matchInfo.visiting_team && v.name?.includes(matchInfo.visiting_team))
        )
      ) || null;
    }
    
    if (valueInfo && valueInfo.summary && valueInfo.columns) {
      // Value info exists - include it in context (universal column details with actual values)
      context += `\n\n=== COLUMN DETAILS ===
${valueInfo.columns.map((col: any) => {
  const uniqueVals = col.uniqueValues && Array.isArray(col.uniqueValues) && col.uniqueValues.length > 0
    ? col.uniqueValues.slice(0, 30).map((v: any) => {
        // Format values for display - handle null, undefined, and long strings
        if (v === null || v === undefined) return 'null';
        const str = String(v);
        return str.length > 50 ? str.substring(0, 47) + '...' : str;
      }).join(', ') + (col.uniqueValues.length > 30 ? ` ... (${col.uniqueValues.length} total)` : '')
    : 'none';
  return `${col.name} (${col.type}): [${uniqueVals}] | ${col.nullCount || 0} null`;
}).join('\n')}

Use exact column names above when writing queries.`;
    } else {
      // If no valueInfo, provide basic structure info (universal) with fallback instructions
      context += `\n\n=== COLUMN DETAILS ===
Inspect available columns: Object.keys(data[0])
Use exact column names from the data structure - don't assume names.
If you need to understand the data structure, inspect data[0] to see available fields and their types.`;
    }
    
    context += datasetSummary;
    context += dataStructure;
  } else {
    // No match data - check if CSV data or current selection exists
    const hasCsvData = csvData && Array.isArray(csvData) && csvData.length > 0;
    
    // Check if there's a current_selection valueInfo with actual data (not just filter criteria)
    const currentSelectionValueInfo = getValueInfo('current_selection', 'match');
    const hasCurrentSelectionData = currentSelectionValueInfo && 
                                    currentSelectionValueInfo.data && 
                                    Array.isArray(currentSelectionValueInfo.data) && 
                                    currentSelectionValueInfo.data.length > 0;
    
    // Use generic context (data analysis mode only if enabled)
    // Only include coding rules if actual data is available (CSV data or current selection with data rows)
    // But always include context sections if selected (even without data)
    context = buildConversationContext(userMessage, conversationHistory, undefined, volleyballContextEnabled, false, hasCsvData || hasCurrentSelectionData, selectedContextSectionId);
    
    if (hasCurrentSelectionData) {
      // Include current selection valueInfo in context (universal)
      const filterDescription = currentSelectionValueInfo.description || currentSelectionValueInfo.name || 'Custom selection';
      context += `\n\n=== SELECTED DATA ===
Rows: ${currentSelectionValueInfo.data.length} | Filter: ${filterDescription}
CRITICAL: Data is pre-filtered. Use entire 'data' array - do NOT filter by selection criteria again.`;
      
      if (currentSelectionValueInfo.summary && currentSelectionValueInfo.columns) {
        context += `\n\nCOLUMN DETAILS:
${currentSelectionValueInfo.columns.map((col: any) => {
  const uniqueVals = col.uniqueValues && Array.isArray(col.uniqueValues) && col.uniqueValues.length > 0
    ? col.uniqueValues.slice(0, 30).map((v: any) => {
        // Format values for display - handle null, undefined, and long strings
        if (v === null || v === undefined) return 'null';
        const str = String(v);
        return str.length > 50 ? str.substring(0, 47) + '...' : str;
      }).join(', ') + (col.uniqueValues.length > 30 ? ` ... (${col.uniqueValues.length} total)` : '')
    : 'none';
  return `${col.name} (${col.type}): [${uniqueVals}] | ${col.nullCount || 0} null`;
}).join('\n')}

Use exact column names above when writing queries.`;
      }
    }
    
    // Add CSV data info if available (even without match data)
    if (csvData && csvData.length > 0) {
      // Check if value info exists for this CSV
      const csvId = csvFileName ? (() => {
        try {
          const saved = localStorage.getItem("db_csv_files");
          if (saved) {
            const parsed = JSON.parse(saved);
            const files = Array.isArray(parsed) ? parsed : [];
            const file = files.find((f: any) => f.name === csvFileName);
            return file ? file.id : null;
          }
        } catch (e) {
          return null;
        }
        return null;
      })() : null;
      
      if (csvId) {
        // Try multiple lookup strategies for CSV value info
        let csvValueInfo = getValueInfo(csvId, 'csv');
        
        // Fallback: try to find by filename
        if (!csvValueInfo && csvFileName) {
          const allValueInfos = getAllValueInfos();
          csvValueInfo = allValueInfos.find((v: any) => 
            v.type === 'csv' && (
              v.id === csvId ||
              v.name === csvFileName ||
              v.name?.includes(csvFileName)
            )
          ) || null;
        }
        
        if (csvValueInfo && csvValueInfo.summary) {
          // CSV value info exists - include it in context (universal with actual values)
          context += `\n\n=== CSV DATA ===
File: ${csvFileName || 'CSV File'} | Rows: ${csvData.length}

COLUMN DETAILS:
${csvValueInfo.columns.map((col: any) => {
  const uniqueVals = col.uniqueValues && Array.isArray(col.uniqueValues) && col.uniqueValues.length > 0
    ? col.uniqueValues.slice(0, 30).map((v: any) => {
        // Format values for display - handle null, undefined, and long strings
        if (v === null || v === undefined) return 'null';
        const str = String(v);
        return str.length > 50 ? str.substring(0, 47) + '...' : str;
      }).join(', ') + (col.uniqueValues.length > 30 ? ` ... (${col.uniqueValues.length} total)` : '')
    : 'none';
  return `${col.name} (${col.type}): [${uniqueVals}] | ${col.nullCount || 0} null`;
}).join('\n')}

Use exact column names above when writing queries. Data available in 'csvData' variable.`;
        } else {
          // CSV value info doesn't exist yet - provide enhanced fallback info
          const sampleRow = csvData[0];
          const columnNames = sampleRow ? Object.keys(sampleRow) : [];
          context += `\n\n=== CSV DATA AVAILABLE ===
File: ${csvFileName || 'CSV File'}
Rows: ${csvData.length}
Columns (${columnNames.length}): ${columnNames.slice(0, 20).join(', ')}${columnNames.length > 20 ? '...' : ''}
The CSV data is available in the 'csvData' variable for analysis. 
${sampleRow ? `Sample row structure: ${JSON.stringify(Object.fromEntries(Object.entries(sampleRow).slice(0, 5)))}` : ''}
You can use csvData in your code execution blocks to analyze this data.
If you need to understand column types, inspect csvData[0] to see sample values.`;
        }
      } else {
        // No CSV ID found - just show basic info with enhanced fallback
        const sampleRow = csvData[0];
        const columnNames = sampleRow ? Object.keys(sampleRow) : [];
        context += `\n\n=== CSV DATA AVAILABLE ===
File: ${csvFileName || 'CSV File'}
Rows: ${csvData.length}
Columns (${columnNames.length}): ${columnNames.slice(0, 20).join(', ')}${columnNames.length > 20 ? '...' : ''}
The CSV data is available in the 'csvData' variable for analysis. 
${sampleRow ? `Sample row structure: ${JSON.stringify(Object.fromEntries(Object.entries(sampleRow).slice(0, 5)))}` : ''}
You can use csvData in your code execution blocks to analyze this data.
If you need to understand column types, inspect csvData[0] to see sample values.`;
      }
    }
  }
  
  return context;
}

// Get CSV file data by ID(s) with optional filtering
// csvId can be a single string, array of strings, or null
export async function getCsvFileData(csvId: string | string[] | null, filterColumns?: string[] | null, filterValues?: Record<string, string | null> | null): Promise<any[] | null> {
  try {
    const saved = localStorage.getItem("db_csv_files");
    if (!saved) return null;
    
    const parsed = JSON.parse(saved);
    const files = Array.isArray(parsed) ? parsed : [];
    
    // If csvId is provided, get that specific file(s); otherwise combine all files
    let dataToFilter: any[] = [];
    
    if (csvId) {
      // Handle array of CSV IDs
      const csvIds = Array.isArray(csvId) ? csvId : [csvId];
      console.log('getCsvFileData: Looking for CSV IDs:', csvIds, 'Total files:', files.length);
      
      // Process files in parallel
      const filePromises = csvIds.map(async (id) => {
        const file = files.find((f: any) => f.id === id);
        if (file) {
          console.log('getCsvFileData: Found file:', file.name, 'id:', file.id);
          // First check if file has embedded data that needs to be saved
          if (Array.isArray(file.data) && file.data.length > 0) {
            console.log('getCsvFileData: File has embedded data, rows:', file.data.length, 'Attempting to save...');
            try {
              const { saveCsvDataText } = await import("@/lib/csvStorage");
              const { stringifyCsv } = await import("@/lib/csvUtils");
              const headers = file.headers || (file.data[0] ? Object.keys(file.data[0]) : []);
              const csvText = stringifyCsv(headers, file.data);
              await saveCsvDataText(file.id, csvText, file.data);
              console.log('getCsvFileData: Successfully saved embedded data to IndexedDB');
            } catch (e) {
              console.error('getCsvFileData: Error saving embedded data:', e);
            }
            // Use embedded data directly
            console.log('getCsvFileData: Using embedded file.data directly, rows:', file.data.length);
            return file.data;
          } else {
            // Try to get data from IndexedDB
            const rows = await getCsvDataRows(file);
            console.log('getCsvFileData: Retrieved rows for', file.name, ':', rows?.length || 0);
            if (rows && rows.length > 0) {
              return rows;
            } else {
              console.warn('getCsvFileData: No rows returned for file:', file.name, 'id:', file.id);
              console.warn('getCsvFileData: File object keys:', Object.keys(file));
              console.warn('getCsvFileData: File has data property?', 'data' in file, 'Type:', typeof file.data);
              return null;
            }
          }
        } else {
          console.warn('getCsvFileData: File not found for ID:', id, 'Available IDs:', files.map((f: any) => f.id));
          return null;
        }
      });
      
      const fileDataArrays = await Promise.all(filePromises);
      fileDataArrays.forEach(data => {
        if (data && data.length > 0) {
          dataToFilter = dataToFilter.concat(data);
        }
      });
      
      console.log('getCsvFileData: Total rows collected:', dataToFilter.length);
      if (dataToFilter.length === 0) return null;
    } else {
      // Combine all files if no specific IDs provided
      const filePromises = files.map(async (file: any) => {
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
            if (!filterValue || filterValue.trim() === '') return true; // No filter for this column
            const actualColumnName = columnMap[column];
            if (!row || row[actualColumnName] === null || row[actualColumnName] === undefined) return false;
            const cellValue = String(row[actualColumnName]).trim();
            return cellValue === filterValue.trim(); // Exact match
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
export function getValueInfo(id: string, type: 'match' | 'csv' = 'match', chatId?: string): any | null {
  if (!id) return null;
  try {
    const saved = localStorage.getItem("db_value_infos");
    if (saved) {
      const parsed = JSON.parse(saved);
      const infos = Array.isArray(parsed) ? parsed : [];
      // Try exact match first
      let info = infos.find((v: any) => v.id === id && v.type === type);
      
      // If looking for current_selection, try to find it
      if (!info && id === 'current_selection') {
        // First, try to find one for the specific chat if chatId is provided
        if (chatId) {
          const currentSelectionRefs = infos.filter((v: any) => 
            v.id === 'current_selection' && 
            v.type === type && 
            (v.chatId === chatId || (v.usedByChats && v.usedByChats.includes(chatId)))
          );
          if (currentSelectionRefs.length > 0) {
            // Get the most recent one
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
        }
        
        // If still not found, try to find any current_selection (for when no chat exists yet)
        if (!info) {
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
export function getAllValueInfos(): any[] {
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
export function getValueInfosByType(type: 'match' | 'csv'): any[] {
  return getAllValueInfos().filter((v: any) => v.type === type);
}

// Save value info for a match or CSV
// Enhanced to support multiple value infos and prevent duplicates
// Now supports chatId tracking to prevent deletion when creating new selections
export function saveValueInfo(valueInfo: any, chatId?: string): void {
  try {
    if (!valueInfo || !valueInfo.id || !valueInfo.type) {
      console.warn("Invalid valueInfo structure:", valueInfo);
      return;
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
          .filter(k => v.filterValues[k] != null)
          .reduce((acc, k) => {
            acc[k] = v.filterValues[k];
            return acc;
          }, {} as Record<string, any>);
        const infoFilteredValues = Object.keys(valueInfo.filterValues || {})
          .filter(k => valueInfo.filterValues[k] != null)
          .reduce((acc, k) => {
            acc[k] = valueInfo.filterValues[k];
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
      infos[existingIndex] = { 
        ...existing, 
        ...valueInfo, 
        uniqueId: finalUniqueId, // Ensure uniqueId is consistent
        usedByChats: updatedChats,
        generatedAt: valueInfo.generatedAt || existing.generatedAt || Date.now() 
      };
      console.log(`✅ Updated existing value info: ${valueInfo.id} (${valueInfo.type})${chatId ? ` for chat ${chatId}` : ''} (matched by ${existing.id === valueInfo.id ? 'id' : existing.uniqueId === valueInfo.uniqueId ? 'uniqueId' : 'filterCriteria'})`);
    } else {
      // Add new - ensure it has required fields
      const newInfo = {
        ...valueInfo,
        usedByChats: chatId ? [chatId] : [],
        generatedAt: valueInfo.generatedAt || Date.now()
      };
      infos.push(newInfo);
      console.log(`✅ Saved new value info: ${valueInfo.id} (${valueInfo.type})${chatId ? ` for chat ${chatId}` : ''}`);
    }
    
    // After saving, check for and remove any duplicates that might have been created
    // This is a safety net in case duplicates slip through
    removeDuplicateValueInfos(infos);
    
    localStorage.setItem("db_value_infos", JSON.stringify(infos));
  } catch (e) {
    console.error("Error saving value info:", e);
  }
}

// Remove duplicate Value Infos based on filterColumns and filterValues
// This is a safety function to clean up any duplicates that might exist
export function removeDuplicateValueInfos(infos?: any[]): void {
  try {
    // If no infos provided, load from localStorage
    let valueInfos: any[] = infos || [];
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
      const filterKeys = Object.keys(info.filterValues)
        .filter(k => info.filterValues[k] != null)
        .sort();
      const filterValuesStr = filterKeys
        .map(k => `${k}=${String(info.filterValues[k]).trim()}`)
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
        console.log(`🗑️ Removing duplicate Value Info: ${info.id} (${info.type}) - keeping entry at index ${existingIndex}`);
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
        console.log(`🗑️ Removing duplicate Value Info by uniqueId: ${info.id} (${info.type}) - keeping entry at index ${existingIndex}`);
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
      console.log(`🧹 Cleaned up ${toRemove.length} duplicate Value Info entries`);
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
    console.log('Deleted valueInfo:', id, type);
  } catch (e) {
    console.error("Error deleting value info:", e);
  }
}

// Clear all value infos
export function clearAllValueInfos(): void {
  try {
    localStorage.removeItem("db_value_infos");
    console.log('Cleared all valueInfos');
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
      console.log(`Cleaned up valueInfos: removed ${infos.length - validInfos.length} orphaned entries`);
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
    console.log('Deleted valueInfo for chat:', chatId);
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
  const columns = Object.keys(firstRow);
  
  const columnInfo = columns.map(col => {
    const values = data.map(row => row && row[col]).filter(v => v !== null && v !== undefined && v !== '');
    const uniqueValues = Array.from(new Set(values.slice(0, 100))).slice(0, 50); // Limit to 50 unique values
    const nullCount = data.length - values.length;
    
    // Determine type
    let colType = 'unknown';
    const sampleValue = values[0];
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
  chatId?: string
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

  // Generate a basic summary automatically
  const columns = valueInfo.columns;
  const columnNames = columns.map((c: any) => c.name).join(', ');
  const totalRows = data.length;
  
  // Create a basic summary describing the data structure
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
  
  // Save the value info
  saveValueInfo(valueInfo, chatId);
  
  console.log(`✅ Auto-generated value info for ${type}: ${name}`);
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
  onDelta: (chunk: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
  csvId: string | null = null,
  csvFilterColumns: string[] | null = null,
  csvFilterValues: Record<string, string | null> | null = null,
  chatId?: string,
  matchFilterColumns: string[] | null = null,
  matchFilterValues: Record<string, string | null> | null = null,
  selectedContextSectionId?: string | null
) {
  try {
    // Check if model has API key
    if (!modelHasApiKey(model)) {
      onError(`No API key configured for this model. Please add an API key in Settings.`);
      return;
    }

    if (images.length > 0) {
      // Vision request with images - pass directly to OpenRouter API
      console.log('Sending image analysis request with model:', model, 'images:', images.length);
      
      // Build context message (images will be added in apiProviders.ts)
      const contextMessage = matchData && volleyballContextEnabled
        ? buildVolleyballContext(message, matchData, conversationHistory, volleyballContextEnabled, null, null, null, selectedContextSectionId)
        : buildConversationContext(message, conversationHistory, undefined, volleyballContextEnabled, false, false, selectedContextSectionId); // hasData = false (no data available), but include context section if selected
      
      // Use direct API call with images
      await callApi({
        prompt: contextMessage,
        model,
        images: images, // Pass images directly
        conversationHistory: conversationHistory,
        reasoningEnabled: reasoningEnabled,
        onDelta,
        onDone,
        onError
      });
      return;
    } else {
      // Text-only request
      // Get CSV data if csvId is provided (with optional filtering)
      const csvData = await getCsvFileData(csvId, csvFilterColumns, csvFilterValues);
      const csvFileName = csvId ? (() => {
        try {
          const saved = localStorage.getItem("db_csv_files");
          if (saved) {
            const parsed = JSON.parse(saved);
            const files = Array.isArray(parsed) ? parsed : [];
            const file = files.find((f: any) => f.id === csvId);
            return file ? file.name : null;
          }
        } catch (e) {
          return null;
        }
        return null;
      })() : null;
      
      // Check if there's a current_selection valueInfo - prioritize it over matchData (universal approach)
      // current_selection represents the user's active grouped selection and should take precedence
      // IMPORTANT: Only use current_selection if it belongs to the current chat
      let dataForExecution: any[] | null = null;
      let useCurrentSelection = false;
      let currentSelectionValueInfo: any | null = null;
      
      // Check if we have filter selections that might need data querying
      const hasFilterSelections = matchFilterColumns && matchFilterColumns.length > 0 && 
        matchFilterValues && Object.keys(matchFilterValues).some(col => matchFilterValues[col] !== null);
      
      // First, try to get existing current_selection Value Info
      currentSelectionValueInfo = getValueInfo('current_selection', 'match', chatId);
      // Verify this Value Info belongs to the current chat before using it
      const belongsToCurrentChat = !chatId || 
        !currentSelectionValueInfo || 
        currentSelectionValueInfo.chatId === chatId || 
        (currentSelectionValueInfo.usedByChats && currentSelectionValueInfo.usedByChats.includes(chatId));
      
      // Also verify that the stored filterColumns and filterValues match the current selection
      // (to handle cases where display columns were changed or selection was updated)
      let matchesCurrentSelection = true;
      if (currentSelectionValueInfo && belongsToCurrentChat && hasFilterSelections && matchFilterColumns && matchFilterValues) {
        // Filter to only group columns (columns with values) for comparison
        const currentGroupColumns = matchFilterColumns.filter(col => matchFilterValues[col] != null).sort();
        const storedGroupColumns = (currentSelectionValueInfo.filterColumns || []).sort();
        
        // Check if columns match
        if (currentGroupColumns.length !== storedGroupColumns.length ||
            !currentGroupColumns.every((col, idx) => col === storedGroupColumns[idx])) {
          matchesCurrentSelection = false;
        } else {
          // Check if values match
          currentGroupColumns.forEach(col => {
            if (currentSelectionValueInfo.filterValues?.[col] !== matchFilterValues[col]) {
              matchesCurrentSelection = false;
            }
          });
        }
      }
      
      // If Value Info exists but doesn't have data (we don't store it to avoid quota issues),
      // re-query the data using the stored filter criteria
      // Only use it if it matches the current selection
      if (currentSelectionValueInfo && belongsToCurrentChat && matchesCurrentSelection) {
        if (currentSelectionValueInfo.data && Array.isArray(currentSelectionValueInfo.data) && currentSelectionValueInfo.data.length > 0) {
          // Data is already in memory (from this session)
        const selectionData = currentSelectionValueInfo.data;
        dataForExecution = selectionData;
        useCurrentSelection = true;
          console.log('Using current_selection data for execution:', selectionData.length, 'rows', 'for chat:', chatId);
        } else if (currentSelectionValueInfo.filterColumns && currentSelectionValueInfo.filterValues) {
          // Value Info exists but data not in memory - re-query using stored filter criteria
          try {
            const { getDbConnection } = await import("@/lib/database");
            const db = getDbConnection();
            if (db) {
              const tableName = localStorage.getItem("db_table_name") || "combined_dvw";
              const whereConditions: string[] = [];
              currentSelectionValueInfo.filterColumns.forEach((col: string) => {
                const filterValue = currentSelectionValueInfo.filterValues[col];
                if (filterValue) {
                  const quotedCol = `"${col.replace(/"/g, '""')}"`;
                  const escapedValue = filterValue.replace(/'/g, "''");
                  whereConditions.push(`${quotedCol} = '${escapedValue}'`);
                }
              });
              
              if (whereConditions.length > 0) {
                const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
                const query = `SELECT * FROM ${quotedTable} WHERE ${whereConditions.join(' AND ')}`;
                
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
                const rawRows = Array.isArray(result) ? result : (result?.rows || []);
                
                if (rawRows && rawRows.length > 0) {
                  // Add data to Value Info in memory only (not saved)
                  currentSelectionValueInfo.data = rawRows;
                  dataForExecution = rawRows;
                  useCurrentSelection = true;
                  console.log('✅ Re-queried current_selection data:', rawRows.length, 'rows');
                }
              }
            }
          } catch (e) {
            console.error('Error re-querying data from Value Info:', e);
          }
        }
      }
      
      if (!dataForExecution && hasFilterSelections && matchFilterColumns && matchFilterValues) {
        // Filter selections exist but Value Info doesn't - query the data now
        try {
          const { getDbConnection } = await import("@/lib/database");
          const db = getDbConnection();
          if (db) {
            const tableName = localStorage.getItem("db_table_name") || "combined_dvw";
            
            // Build WHERE clause to match the selected grouped row
            // Only use columns that have values (display columns won't have values, so they're automatically excluded)
            // Filter to only include columns that actually have values
            const groupColumns = matchFilterColumns.filter(col => matchFilterValues[col] != null);
            const groupValues: Record<string, string | null> = {};
            groupColumns.forEach(col => {
              if (matchFilterValues[col] != null) {
                groupValues[col] = matchFilterValues[col];
              }
            });
            
            const whereConditions: string[] = [];
            groupColumns.forEach(col => {
              const filterValue = groupValues[col];
              if (filterValue) {
                const quotedCol = `"${col.replace(/"/g, '""')}"`;
                // Escape single quotes in value
                const escapedValue = filterValue.replace(/'/g, "''");
                whereConditions.push(`${quotedCol} = '${escapedValue}'`);
              }
            });
            
            if (whereConditions.length > 0) {
              const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
              const query = `SELECT * FROM ${quotedTable} WHERE ${whereConditions.join(' AND ')}`;
              
              console.log('sendChatMessage: Querying data with filters:', query);
              
              // Execute dynamic SQL
              const sql = db as any;
              let result;
              try {
                const executeQuery = new Function('sql', `return sql\`${query.replace(/`/g, '\\`')}\``);
                result = await executeQuery(sql);
              } catch (err) {
                console.error('Error querying data:', err);
                if (typeof sql.raw === 'function') {
                  result = await sql.raw(query);
                } else {
                  throw err;
                }
              }
              const rawRows = Array.isArray(result) ? result : (result?.rows || []);
              
              console.log('sendChatMessage: Queried', rawRows.length, 'rows');
              
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
                
                const valueInfo = generateValueInfoFromData(
                  rawRows,
                  uniqueValueInfoId,
                  'match',
                  `Selected Group: ${groupColumns.map(col => `${col}=${groupValues[col]}`).join(', ')}`
                );
                
                if (valueInfo) {
                  // DO NOT store data in Value Info - it causes localStorage quota issues
                  // Instead, store filter criteria so we can re-query when needed
                  // Only store group columns (columns with values), not display columns
                  valueInfo.filterColumns = groupColumns;
                  valueInfo.filterValues = groupValues;
                  // Store row count for display purposes only
                  valueInfo.rowCount = rawRows.length;
                  
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
                  console.log('✅ Created and using current_selection data:', rawRows.length, 'rows');
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
        console.log('Using matchData for execution:', dataForExecution.length, 'rows');
      }
      
      // Pass data directly to CodeExecutor - it can work with just the data array
      // If current_selection exists, pass null for matchData so it uses the data array instead
      const executor = new CodeExecutor(useCurrentSelection ? null : matchData, dataForExecution || null);
      
      // Log what data is being used for execution
      if (useCurrentSelection && dataForExecution) {
        console.log('✅ Using current_selection data:', dataForExecution.length, 'rows');
        console.log('✅ Sample data structure:', dataForExecution[0] ? Object.keys(dataForExecution[0]) : 'No data');
      } else if (matchData && matchData.data) {
        console.log('✅ Using matchData:', matchData.data.length, 'rows');
      } else {
        console.warn('⚠️ No data available for code execution');
      }
      let assistantResponse = '';
      
      // Check if we actually have data for execution (not just selections)
      const hasActualData = (dataForExecution && Array.isArray(dataForExecution) && dataForExecution.length > 0) || 
                           (matchData && matchData.data && Array.isArray(matchData.data) && matchData.data.length > 0) ||
                           (csvData && Array.isArray(csvData) && csvData.length > 0);
      
      // Prioritize current_selection context over matchData
      // Use buildVolleyballContext which now handles current_selection properly
      let contextMessage: string;
      if (useCurrentSelection && currentSelectionValueInfo && volleyballContextEnabled && hasActualData) {
        // Use buildVolleyballContext with current_selection - it will detect and use it
        contextMessage = buildVolleyballContext(message, null, conversationHistory, volleyballContextEnabled, csvData, csvFileName, currentSelectionValueInfo, selectedContextSectionId);
        console.log('Building context with current_selection valueInfo');
      } else if (matchData && volleyballContextEnabled && hasActualData) {
        contextMessage = buildVolleyballContext(message, matchData, conversationHistory, volleyballContextEnabled, csvData, csvFileName, null, selectedContextSectionId);
      } else {
        // No actual data - use generic context (context sections included, but no coding rules)
        contextMessage = buildConversationContext(message, conversationHistory, undefined, volleyballContextEnabled, false, false, selectedContextSectionId); // hasData = false (no data available), but include context section if selected
      }
      
      console.log('Sending message to API, model:', model, 'context length:', contextMessage.length);
      
      // Process conversation history to optimize token usage
      const processedHistory = processConversationHistory(conversationHistory);
      
      await callApi({
        prompt: contextMessage,
        model,
        images: [],
        conversationHistory: processedHistory, // Processed history (recent full, older summarized)
        reasoningEnabled: reasoningEnabled,
        onDelta: (chunk: string) => {
          assistantResponse += chunk;
          onDelta(chunk);
        },
        onDone: async () => {
          // Wait a bit to ensure full response is collected (especially for long code blocks)
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Check if response contains code execution request
          const blocks = executor.detectCodeBlocksInStream(assistantResponse);
          const executionResults: string[] = [];
          
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
            console.log('Response looks incomplete, waiting longer...');
            await new Promise(resolve => setTimeout(resolve, 3000)); // Increased wait time
            // Re-detect after waiting
            const updatedBlocks = executor.detectCodeBlocksInStream(assistantResponse);
            blocks.length = 0;
            blocks.push(...updatedBlocks);
            
            // If still looks incomplete after waiting, log warning
            if (looksIncomplete && assistantResponse.length > 100) {
              console.warn('⚠️ Response may have been truncated. Consider increasing max_tokens or checking API limits.');
            }
          }
          
          if (blocks.length > 0) {
            // Code blocks detected - proceed with execution
            // The AI should have been instructed not to include analysis/summary in the same response
            // We trust the AI to follow instructions, but log if it doesn't
            const codeRanges: Array<{ start: number, end: number }> = [];
            blocks.forEach(block => {
              codeRanges.push({ start: block.startIndex, end: block.endIndex });
            });
            
            // Check if there's text after code blocks (AI shouldn't have done this)
            const lastCodeEnd = codeRanges.length > 0 ? codeRanges[codeRanges.length - 1].end : assistantResponse.length;
            const textAfterCode = assistantResponse.substring(lastCodeEnd).trim();
            
            if (textAfterCode.length > 50) {
              console.warn(`⚠️ AI included ${textAfterCode.length} characters of text after code blocks. This should not happen - check prompts.`);
            }
            
            // Execute all code blocks and collect results
            // CRITICAL: These arrays must stay aligned - index i in all arrays corresponds to blocks[i]
            const rawExecutionResults: any[] = [];
            const executionStatus: Array<{ block: CodeBlock, result: ExecutionResult | null, error: string | null }> = [];
            
            // First pass: Execute all blocks SEQUENTIALLY (await ensures each completes before next starts)
            console.log(`🔄 Executing ${blocks.length} code block(s) sequentially...`);
            for (let i = 0; i < blocks.length; i++) {
              const block = blocks[i];
              console.log(`  Block ${i + 1}/${blocks.length}: Executing...`);
              
              const validation = executor.validateCode(block.code);
              if (validation.valid) {
                try {
                  // AWAIT ensures this completes before moving to next block
                  const result = await executor.executeCode(block.code);
                  const formattedResult = executor.formatResult(result);
                  executionResults.push(formattedResult);
                  executionStatus.push({ block, result, error: null });
                  
                  // Store raw result data for saving to chat history
                  if (result.success && result.result) {
                    rawExecutionResults.push(result.result);
                  } else {
                    rawExecutionResults.push(null);
                  }
                  
                  console.log(`  ✅ Block ${i + 1}/${blocks.length}: ${result.success ? 'Success' : 'Failed'}`);
                  
                  // Display execution results immediately after execution
                  onDelta(`\n\n${formattedResult}\n\n`);
                } catch (error) {
                  const errorResult = executor.formatResult({
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    executionTime: 0
                  });
                  executionResults.push(errorResult);
                  executionStatus.push({ 
                    block, 
                    result: { success: false, error: error instanceof Error ? error.message : 'Unknown error', executionTime: 0 },
                    error: error instanceof Error ? error.message : 'Unknown error'
                  });
                  rawExecutionResults.push(null);
                  
                  console.log(`  ❌ Block ${i + 1}/${blocks.length}: Execution error`);
                  
                  onDelta(`\n\n${errorResult}\n\n`);
                }
              } else if (validation.needsCompletion) {
                // Mark as needing completion - will be fixed in second pass
                executionResults.push(''); // Placeholder
                executionStatus.push({ block, result: null, error: validation.error || 'Code is incomplete' });
                rawExecutionResults.push(null);
                
                console.log(`  ⚠️ Block ${i + 1}/${blocks.length}: Incomplete code`);
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
                  error: validation.error || 'Invalid code'
                });
                rawExecutionResults.push(null);
                
                console.log(`  ❌ Block ${i + 1}/${blocks.length}: Invalid code`);
                
                onDelta(`\n\n${errorResult}\n\n`);
              }
            }
            
            console.log(`✅ First pass complete: ${executionStatus.length}/${blocks.length} blocks processed`);
            
            // Second pass: Fix errors and incomplete code one by one
            for (let i = 0; i < executionStatus.length; i++) {
              const status = executionStatus[i];
              
              // Skip if already successful
              if (status.result && status.result.success) continue;
              
              // Fix this specific block
              const errorMsg = status.error || (status.result?.error) || 'Code execution failed';
              const fixRequest = `Code execution failed with error: ${errorMsg}\n\nFailed code:\n\`\`\`javascript\n${status.block.code}\n\`\`\`\n\nFix this code block and provide the COMPLETE, corrected code. The code must be valid JavaScript that can execute successfully.`;
              
              const fixContext = matchData && volleyballContextEnabled
                ? buildVolleyballContext(fixRequest, matchData, conversationHistory, volleyballContextEnabled, null, null, null, selectedContextSectionId)
                : buildConversationContext(fixRequest, conversationHistory, undefined, volleyballContextEnabled, false, false, selectedContextSectionId); // hasData = false (no data available), but include context section if selected
              
              let fixedCode = '';
              
              // Wait for the fix to complete before moving to next error
              await new Promise<void>((resolve) => {
                callApi({
                  prompt: fixContext,
                  model,
                  images: [],
                  conversationHistory: conversationHistory,
                  reasoningEnabled: reasoningEnabled,
                  onDelta: (chunk: string) => { fixedCode += chunk; },
                  onDone: async () => {
                    // Extract fixed code block
                    const fixedBlocks = executor.detectCodeBlocksInStream(fixedCode);
                    
                    for (const fixedBlock of fixedBlocks) {
                      const fixedValidation = executor.validateCode(fixedBlock.code);
                      if (fixedValidation.valid) {
                        try {
                          const fixedResult = await executor.executeCode(fixedBlock.code);
                          const formattedResult = executor.formatResult(fixedResult);
                          
                          // Replace the error result with the fixed result
                          executionResults[i] = formattedResult;
                          executionStatus[i] = { block: fixedBlock, result: fixedResult, error: null };
                          
                          // Store raw result data
                          if (fixedResult.success && fixedResult.result) {
                            // Replace or add to rawExecutionResults
                            if (rawExecutionResults[i]) {
                              rawExecutionResults[i] = fixedResult.result;
                            } else {
                              rawExecutionResults.push(fixedResult.result);
                            }
                          }
                          
                          // Display fixed execution result
                          onDelta(`\n\n**Fixed Code Execution Result** (${fixedResult.executionTime}ms):\n\`\`\`json\n${typeof fixedResult.result === 'object' ? JSON.stringify(fixedResult.result, null, 2) : String(fixedResult.result)}\n\`\`\`\n\n`);
                        } catch (error) {
                          console.error('Error executing fixed code:', error);
                          // Keep the error status
                        }
                      }
                    }
                    
                    // Wait a bit after fix completes
                    await new Promise(r => setTimeout(r, 300));
                    resolve();
                  },
                  onError: (error: string) => {
                    console.error('Error fixing code:', error);
                    resolve();
                  }
                });
              });
            }
            
            // CRITICAL: Ensure ALL code blocks have completed execution before proceeding
            // Wait a moment to ensure all async operations are complete
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Verify that executionStatus array has an entry for EVERY block
            if (executionStatus.length !== blocks.length) {
              console.error(`⚠️ Execution status mismatch: ${executionStatus.length} status entries for ${blocks.length} blocks`);
              // Wait longer and check again
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            // Check if all code blocks have completed (either success or final failure)
            // A block is "completed" if it has a result (success or failure) OR a final error (not incomplete)
            const allBlocksCompleted = executionStatus.length === blocks.length && 
              executionStatus.every((s, idx) => {
                if (!s) {
                  console.warn(`⚠️ Missing execution status for block ${idx}`);
                  return false;
                }
                // Block is complete if it has a result (success or failure)
                if (s.result !== null) {
                  return true;
                }
                // Block is complete if it has a final error (not incomplete)
                if (s.error && !s.error.toLowerCase().includes('incomplete')) {
                  return true;
                }
                // Block is not complete
                return false;
              });
            
            if (!allBlocksCompleted) {
              console.warn(`⚠️ Not all code blocks completed. Status: ${executionStatus.length}/${blocks.length} blocks processed`);
              console.warn('Execution status:', executionStatus.map((s, i) => ({
                block: i,
                hasResult: s?.result !== null,
                success: s?.result?.success,
                error: s?.error
              })));
              // Wait longer for any remaining executions
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              // Re-check after waiting
              const stillIncomplete = executionStatus.some((s) => {
                if (!s || executionStatus.length !== blocks.length) return true;
                return s.result === null && (!s.error || s.error.toLowerCase().includes('incomplete'));
              });
              
              if (stillIncomplete) {
                console.error('⚠️ Some code blocks still incomplete after waiting. Proceeding anyway but results may be incomplete.');
              }
            }
            
            // Ensure rawExecutionResults array is properly aligned with executionStatus
            // Fill in any missing entries
            while (rawExecutionResults.length < executionStatus.length) {
              rawExecutionResults.push(null);
            }
            
            // Only proceed to final answer if we have at least one successful result
            const hasSuccessfulResults = executionStatus.some(s => s?.result?.success);
            
            if (hasSuccessfulResults) {
              // Filter to only successful raw results, maintaining alignment with executionStatus
              const successfulRawResults: any[] = [];
              const successfulExecutionResults: string[] = [];
              
              executionStatus.forEach((status, idx) => {
                if (status?.result?.success) {
                  successfulExecutionResults.push(executionResults[idx] || '');
                  successfulRawResults.push(rawExecutionResults[idx] || null);
                }
              });
              
              console.log(`✅ All ${blocks.length} code block(s) completed. ${successfulExecutionResults.length} successful. Requesting final analysis...`);
              
              // Add a clear separator before requesting final analysis
              onDelta('\n\n---\n\n**All code execution complete. Generating analysis...**\n\n');
              
              // Process conversation history to optimize token usage
              const processedHistory = processConversationHistory(conversationHistory);
              
              await requestFinalAnswer(
                successfulExecutionResults,
                successfulRawResults,
                message,
                assistantResponse,
                matchData,
                processedHistory, // Use processed history
                model,
                reasoningEnabled,
                volleyballContextEnabled,
                onDelta,
                onDone,
                onError,
                useCurrentSelection,
                dataForExecution,
                selectedContextSectionId
              );
            } else {
              // All executions failed, just finish
              console.warn('⚠️ All code executions failed. Unable to generate analysis.');
              onDelta('\n\n⚠️ Code execution failed. Unable to generate analysis.\n\n');
              onDone();
            }
          } else {
            // No code blocks detected - AI provided direct answer without code execution
            // This is expected when the question doesn't require data analysis or the AI chooses to answer directly
            console.log('✅ No code blocks detected - AI provided direct answer without code execution');
            onDone();
          }
        },
        onError
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    onError(errorMessage);
  }
}

// Helper function to request final answer after code execution
async function requestFinalAnswer(
  executionResults: string[],
  rawExecutionResults: any[],
  originalMessage: string,
  codeResponse: string,
  matchData: MatchData | null,
  conversationHistory: Message[],
  model: string,
  reasoningEnabled: boolean,
  volleyballContextEnabled: boolean,
  onDelta: (chunk: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
  useCurrentSelection?: boolean,
  dataForExecution?: any[] | null,
  selectedContextSectionId?: string | null
) {
  // Check if execution results contain plot data that needs visualization
  const hasPlotData = (() => {
    // Check raw execution results objects - be strict about what constitutes chart data
    for (const result of rawExecutionResults) {
      if (!result || typeof result !== 'object') continue;
      
      // Check for explicit chart data properties (top-level only)
      if (result.plot_data || result.plotData) {
        const plotData = result.plot_data || result.plotData;
        if (Array.isArray(plotData) && plotData.length > 0) {
          const firstItem = plotData[0];
          if (firstItem && typeof firstItem === 'object') {
            // Must have chart-like structure (x/y coordinates or point_id/efficiency or point_number/efficiency)
            if (firstItem.point_id !== undefined || firstItem.pointId !== undefined ||
                firstItem.point_number !== undefined || firstItem.pointNumber !== undefined ||
                firstItem.x !== undefined || firstItem.y !== undefined ||
                firstItem.efficiency !== undefined || firstItem.point_efficiency !== undefined ||
                firstItem.cumulative_efficiency !== undefined || firstItem.attempts !== undefined) {
              return true;
            }
          }
        }
      }
      
      // Check for pie_data (top-level only)
      if (result.pie_data || result.pieData) {
        const pieData = result.pie_data || result.pieData;
        if (Array.isArray(pieData) && pieData.length > 0) {
          const firstItem = pieData[0];
          if (firstItem && typeof firstItem === 'object') {
            // Must have pie chart structure: label AND value
            if ((firstItem.label !== undefined || firstItem.name !== undefined) && 
                firstItem.value !== undefined) {
              return true;
            }
          }
        }
      }
      
      // Check for x_series and y_series together (both must exist for line chart)
      if ((result.x_series && Array.isArray(result.x_series) && result.x_series.length > 0) &&
          (result.y_series && Array.isArray(result.y_series) && result.y_series.length > 0)) {
        return true;
      }
      if ((result.xSeries && Array.isArray(result.xSeries) && result.xSeries.length > 0) &&
          (result.ySeries && Array.isArray(result.ySeries) && result.ySeries.length > 0)) {
        return true;
      }
      
      // Check if result itself is an array with plot-like structure (only if it has chart-like properties)
      if (Array.isArray(result) && result.length > 0) {
        const firstItem = result[0];
        if (firstItem && typeof firstItem === 'object') {
          // Must have multiple chart indicators (not just one)
          const chartIndicators = [
            firstItem.point_id !== undefined, firstItem.pointId !== undefined,
            firstItem.point_number !== undefined, firstItem.pointNumber !== undefined,
            firstItem.x !== undefined, firstItem.y !== undefined,
            firstItem.efficiency !== undefined, firstItem.point_efficiency !== undefined,
            firstItem.cumulative_efficiency !== undefined, firstItem.attempts !== undefined
          ].filter(Boolean).length;
          if (chartIndicators >= 2) {
            return true;
          }
        }
      }
    }
    
    // Only check execution results strings for explicit chart keywords (not generic words)
    const resultsText = executionResults.join(' ').toLowerCase();
    if ((resultsText.includes('plot_data') || resultsText.includes('plotdata')) &&
        (resultsText.includes('x_series') || resultsText.includes('y_series'))) {
      return true;
    }
    if (resultsText.includes('pie_data') || resultsText.includes('piedata')) {
      return true;
    }
    
    return false;
  })();
  
  let visualizationInstructions = '';
  if (hasPlotData) {
    // Extract plot data details for better instructions
    let plotDataDetails = '';
    for (const result of rawExecutionResults) {
      if (!result || typeof result !== 'object') continue;
      
      if (result.plot_data || result.plotData) {
        const plotData = result.plot_data || result.plotData;
        if (Array.isArray(plotData) && plotData.length > 0) {
          const firstItem = plotData[0];
          plotDataDetails = `The execution results contain plot_data with ${plotData.length} data points. `;
          
          // Check what fields are available for X and Y axes
          if (firstItem && typeof firstItem === 'object') {
            if (firstItem.point_number !== undefined || firstItem.pointNumber !== undefined) {
              plotDataDetails += `X-axis: point_number, Y-axis: efficiency values (point_efficiency, cumulative_efficiency). `;
            } else if (firstItem.point_id !== undefined || firstItem.pointId !== undefined) {
              plotDataDetails += `X-axis: point_id, Y-axis: efficiency. `;
            } else if (firstItem.x !== undefined && firstItem.y !== undefined) {
              plotDataDetails += `X-axis: x, Y-axis: y. `;
            }
          }
          
          if (result.x_series || result.xSeries) {
            plotDataDetails += `X-axis data (x_series) and Y-axis data (y_series) are also available. `;
          }
          break;
        }
      } else if (result.x_series || result.xSeries) {
        const xSeries = result.x_series || result.xSeries;
        const ySeries = result.y_series || result.ySeries;
        if (Array.isArray(xSeries) && Array.isArray(ySeries)) {
          plotDataDetails = `The execution results contain x_series (${xSeries.length} points) and y_series (${ySeries.length} points) for plotting. `;
          break;
        }
      }
    }
    
    // Check what type of chart data we have
    let chartType = 'plot/chart';
    
    for (const result of rawExecutionResults) {
      if (!result || typeof result !== 'object') continue;
      
      if (result.pie_data || result.pieData) {
        chartType = 'pie chart';
        break;
      } else if (result.plot_data || result.plotData || result.x_series || result.xSeries) {
        chartType = 'line plot';
        break;
      }
    }
    
    visualizationInstructions = `\n\n${plotDataDetails}CRITICAL - VISUALIZATION REQUIREMENT:\n- The execution results contain ${chartType} data that MUST be visualized\n- IMPORTANT: The system will AUTOMATICALLY render interactive charts from the data structure in execution results\n- The chart data (pie_data, plot_data, x_series, y_series) in the execution results above will be automatically converted to visual charts\n- You do NOT need to generate mermaid code - the system handles chart rendering automatically\n- However, you SHOULD:\n  1. Reference the chart data in your analysis (e.g., "The pie chart shows...", "As seen in the line plot...")\n  2. Provide a detailed textual description of what the visualization shows\n  3. For pie charts: describe slice sizes, percentages, and what each slice represents\n  4. For line plots: describe the line shape, trends, peaks, valleys, and patterns\n- The charts will appear automatically based on the data structure in the execution results\n`;
  }
  
  // Build context about what the AI was doing
  const previousContext = conversationHistory.length > 0 
    ? `\n\nCONTEXT: You previously responded to the user's question: "${originalMessage}"\nYou provided code to analyze the data, and that code has now executed successfully.\n` 
    : '';
  
  const followUpMessage = `${previousContext}Code execution completed successfully. Here are the execution results:\n\n${executionResults.join('\n\n')}\n\n═══════════════════════════════════════════════════════════════\nCRITICAL INSTRUCTIONS FOR YOUR RESPONSE - READ CAREFULLY:\n═══════════════════════════════════════════════════════════════\n\n1. This is your response AFTER code execution - you already provided code in your first response\n2. The user asked: "${originalMessage}"\n3. You wrote code to answer that question, and it has now executed\n4. You have received the execution results above\n5. NOW you have TWO options:\n\n   OPTION A - You have enough information:\n   - Provide your FULL analysis, summary, and insights based on the execution results\n   - Use ONLY natural language - NO code blocks (charts are rendered automatically)\n   - Format with clear sections, tables, bold text, bullet points\n   - Reference the execution results to provide specific numbers and data\n   - Provide actionable insights and analysis - explain WHAT the results mean\n\n   OPTION B - You need MORE information:\n   - If the execution results don't fully answer the question, you can run ADDITIONAL code\n   - Provide additional code blocks in \`\`\`execute format\n   - Explain what additional information you're gathering (1-2 sentences)\n   - After those code blocks execute, you'll receive another follow-up with those results\n   - You can continue this iterative process until you have complete information\n   - Then provide your full analysis\n\n6. Remember: Code execution is ASYNCHRONOUS - you provide code, then receive results in the next message\n7. You can include BOTH additional code blocks AND preliminary analysis in the same response if helpful\n8. Charts are rendered automatically from plot_data/pie_data structures${visualizationInstructions}\n\nRemember: You are answering the user's original question: "${originalMessage}"\nIf you need more data, provide additional code. If you have enough, provide complete analysis.`;
  
  // Merge raw execution results into a single object for easy reference
  const mergedExecutionData = rawExecutionResults.length > 0 
    ? rawExecutionResults.reduce((acc, result) => ({ ...acc, ...result }), {})
    : null;
  
  // Check for duplicate summaries - look for assistant messages that look like summaries
  const isSummaryLike = (content: string) => {
    const summaryKeywords = ['summary', 'comprehensive', 'analysis', 'overview', 'insights'];
    const lowerContent = content.toLowerCase();
    // Check if content contains summary keywords and is substantial (likely a summary)
    return summaryKeywords.some(keyword => lowerContent.includes(keyword)) && 
           content.length > 200; // Substantial content likely indicates a summary
  };
  
  // Remove duplicate summaries from conversation history (keep only the most recent)
  const filteredHistory = [...conversationHistory];
  let lastSummaryIndex = -1;
  for (let i = filteredHistory.length - 1; i >= 0; i--) {
    if (filteredHistory[i].role === 'assistant' && isSummaryLike(filteredHistory[i].content)) {
      if (lastSummaryIndex === -1) {
        lastSummaryIndex = i; // Keep the most recent one
      } else {
        // Remove older duplicate
        filteredHistory.splice(i, 1);
      }
    }
  }
  
  // Save execution results to the code response message for reference
  const codeResponseMessage: Message = {
    role: 'assistant',
    content: codeResponse,
    timestamp: Date.now(),
    model,
    executionResults: mergedExecutionData // Save raw JSON data for future reference
  };
  
  const updatedHistory = [
    ...filteredHistory,
    { role: 'user' as const, content: originalMessage, timestamp: Date.now() },
    codeResponseMessage,
    { role: 'user' as const, content: followUpMessage, timestamp: Date.now() }
  ];
  
  // Process conversation history to optimize token usage
  const processedHistory = processConversationHistory(updatedHistory);
  
  const contextMessage = matchData && volleyballContextEnabled
    ? buildVolleyballContext('', matchData, processedHistory, volleyballContextEnabled, null, null, null, selectedContextSectionId)
    : buildConversationContext('', processedHistory, undefined, volleyballContextEnabled, true, false, selectedContextSectionId); // Include history in prompt for final answer, hasData = false, but include context section if selected
  
  let finalAnswerContent = '';
  // Create a code executor instance for potential iterative execution
  const executor = new CodeExecutor(useCurrentSelection ? null : matchData, dataForExecution || null);
  
  await callApi({
    prompt: contextMessage,
    model,
    images: [],
    conversationHistory: processedHistory, // Use processed history
    reasoningEnabled: reasoningEnabled,
    onDelta: (chunk: string) => {
      finalAnswerContent += chunk;
      // Stream the final answer directly - we'll check for code blocks in onDone
      onDelta(chunk);
    },
    onDone: async () => {
      // Check if final answer contains additional code blocks for iterative execution
      const additionalBlocks = executor.detectCodeBlocksInStream(finalAnswerContent);
      
      if (additionalBlocks.length > 0) {
        // AI wants to run more code iteratively - execute it
        console.log(`🔄 AI requested ${additionalBlocks.length} additional code block(s) for iterative analysis`);
        onDelta(`\n\n---\n\n**Running additional code for deeper analysis...**\n\n`);
        
        // Execute additional blocks and collect results
        const additionalResults: string[] = [];
        const additionalRawResults: any[] = [];
        
        for (let i = 0; i < additionalBlocks.length; i++) {
          const block = additionalBlocks[i];
          console.log(`  Iterative block ${i + 1}/${additionalBlocks.length}: Executing...`);
          
          try {
            const validation = executor.validateCode(block.code);
            if (validation.valid) {
              const result = await executor.executeCode(block.code);
              const formattedResult = executor.formatResult(result);
              additionalResults.push(formattedResult);
              
              if (result.success && result.result) {
                additionalRawResults.push(result.result);
              } else {
                additionalRawResults.push(null);
              }
              
              // Display execution results immediately
              onDelta(`\n\n**Additional Code Execution Result** (${result.executionTime}ms):\n${formattedResult}\n\n`);
            } else {
              const errorResult = executor.formatResult({
                success: false,
                error: validation.error || 'Invalid code',
                executionTime: 0
              });
              additionalResults.push(errorResult);
              additionalRawResults.push(null);
              onDelta(`\n\n${errorResult}\n\n`);
            }
          } catch (error) {
            const errorResult = executor.formatResult({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
              executionTime: 0
            });
            additionalResults.push(errorResult);
            additionalRawResults.push(null);
            onDelta(`\n\n${errorResult}\n\n`);
          }
        }
        
        // If we have successful results, request another follow-up for analysis
        const hasSuccessfulAdditionalResults = additionalRawResults.some(r => r !== null);
        
        if (hasSuccessfulAdditionalResults) {
          // Combine original results with additional results
          const allExecutionResults = [...executionResults, ...additionalResults];
          const allRawResults = [...rawExecutionResults, ...additionalRawResults];
          
          // Process conversation history to optimize token usage
          const processedHistory = processConversationHistory(conversationHistory);
          
          // Request final answer with all results (recursive call)
          await requestFinalAnswer(
            allExecutionResults,
            allRawResults,
            originalMessage,
            codeResponse + '\n\n[Additional iterative code execution]\n\n' + finalAnswerContent,
            matchData,
            processedHistory, // Use processed history
            model,
            reasoningEnabled,
            volleyballContextEnabled,
            onDelta,
            onDone,
            onError,
            useCurrentSelection,
            dataForExecution,
            selectedContextSectionId
          );
        } else {
          // Additional code failed, but we still have original results
          onDelta(`\n\n⚠️ Additional code execution failed, but you can still analyze the original results above.\n\n`);
          onDone();
        }
      } else {
        // No additional code - final answer is complete
      // Execution results are already saved in the conversation history
      // The final answer message will be saved via the onDelta callback in ChatMain
      onDone();
      }
    },
    onError
  });
}
