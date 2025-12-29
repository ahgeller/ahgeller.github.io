import { MatchData } from '@/types/chat';

export interface ExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  executionTime?: number;
}

export interface CodeBlock {
  code: string;
  startIndex: number;
  endIndex: number;
  type: 'execute' | 'query' | 'javascript' | 'xml' | 'js' | 'code';
  isComplete: boolean;
}

// Hoisted regex patterns for better performance (compiled once, not on every call)
const PYTHON_PATTERNS: RegExp[] = [
  /^import\s+(pandas|numpy|pd|np|duckdb)\s+/im,
  /^from\s+(pandas|numpy|duckdb)\s+import/im,
  /\bpd\.read_csv\s*\(/i,
  /\bpd\.DataFrame\s*\(/i,
  /\bnp\.array\s*\(/i,
  /\bnp\.mean\s*\(/i,
  /\bdf\.shape\b/i,
  /\bdf\.dtypes\b/i,
  /\bdf\.head\s*\(/i,
  /\bdf\.info\s*\(/i,
  /\bdf\.isnull\s*\(/i,
  /\bduckdb\.connect\s*\(/i,
  /\bcon\.execute\s*\(/i,
  /\bcon\.query\s*\(/i,
  /\bcon\.fetchall\s*\(/i,
  /\bcon\.fetchdf\s*\(/i,
  /\bos\.listdir\s*\(/i,
];

const DATA_PATTERNS: RegExp[] = [
  /data\.(filter|map|reduce|find|some|every|length|forEach|slice|sort)/i,
  /csvData\.(filter|map|reduce|find|some|every|length|forEach|slice|sort)/i,
  /matchInfo\./i,
  /summary\./i,
  /\bdata\s*\[/i,
  /\bdata\s*\./i,
  /\bcsvData\s*\[/i,
  /\bcsvData\s*\./i,
  /Object\.(keys|values|entries)\s*\(/i,
  /SELECT\s+.*\s+FROM/i,
  /\bdata\b/i,
  /\bcsvData\b/i,
  /console\.log/i,
  /return\s+/i,
  /const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=/i,
  // CRITICAL: Add explicit pattern for query() calls (common in DuckDB code)
  /\bquery\s*\(/i,
  /\bawait\s+query\s*\(/i,
];

/**
 * Modern, efficient code execution system
 * Inspired by Cursor and other AI coding assistants
 */
export class CodeExecutor {
  private matchData: MatchData | null;
  private data: any[] | null; // Universal data array (can be from MatchData or any other source)
  private executionTimeout: number = 30000; // 30 seconds (increased for large datasets)
  private filterColumns: string[] | null = null;
  private filterValues: Record<string, any> | null = null;
  private allowSql: boolean = false; // Allow SQL for database data (remote Neon DB via Cloudflare Workers)
  private csvId: string | string[] | null = null; // CSV file ID(s) for DuckDB queries
  private executionState: Record<string, any> = {}; // Persistent state across blocks in current prompt
  
  /**
   * Sanitize state variable keys to prevent prototype pollution
   * Only allow valid JavaScript identifiers and block dangerous keys
   */
  private sanitizeStateKey(key: string): boolean {
    // Valid JS identifier: starts with letter/$/_, contains only alphanumeric/$/_
    const isValidIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key);
    const isDangerousKey = ['__proto__', 'constructor', 'prototype'].includes(key);
    return isValidIdentifier && !isDangerousKey;
  }

  constructor(matchData: MatchData | null, data?: any[] | null, filterColumns?: string[] | null, filterValues?: Record<string, any> | null, allowSql: boolean = false, csvId?: string | string[] | null) {
    this.matchData = matchData;
    // If data is provided directly, use it; otherwise use matchData.data
    this.data = data !== undefined ? data : (matchData?.data || null);
    this.filterColumns = filterColumns || null;
    this.filterValues = filterValues || null;
    this.allowSql = allowSql; // True for database data (remote Neon DB), false for CSV data
    this.csvId = csvId || null; // Store CSV ID for DuckDB queries
  }

  /**
   * Clear execution state (called when AI response completes)
   */
  clearExecutionState(): void {
    this.executionState = {};
  }

  /**
   * Get current execution state (for debugging)
   */
  getExecutionState(): Record<string, any> {
    return { ...this.executionState };
  }

  /**
   * Detect code blocks in streaming text
   * More efficient than waiting for complete response
   * Handles malformed blocks (like backticks in the middle of code)
   */
  detectCodeBlocksInStream(text: string): CodeBlock[] {
    const blocks: CodeBlock[] = [];
    const seenCodeHashes = new Set<string>(); // Track duplicate code blocks
    
    // Pattern 1: Markdown code blocks with execute/query/javascript/js/code (defaults to JavaScript)
    // Create fresh regex instance to avoid lastIndex issues with global flag
    const markdownPattern = new RegExp(
      '```(execute|query|javascript|js|code|sql|python|py)?\\s*\\n?([\\s\\S]*?)(?:```|$)',
      'gi'
    );
    let match;
    let lastMatchEnd = 0; // Track where the last match ended to prevent overlap
    
    while ((match = markdownPattern.exec(text)) !== null) {
      // Skip if this match overlaps with a previous block (shouldn't happen with proper regex, but safety check)
      if (match.index < lastMatchEnd) {
        console.warn('⚠️ Overlapping code block detected, skipping:', match.index);
        continue;
      }
      lastMatchEnd = match.index + match[0].length;
      
      // Default to 'execute' (JavaScript) if no language specified
      const rawType = match[1]?.toLowerCase() || 'execute';
      // Map 'code' to 'execute' (JavaScript) as default
      const type = (rawType === 'code' ? 'execute' : rawType) as CodeBlock['type'];
      let code = match[2].trim();
      
      // Clean up malformed code (remove stray backticks/javascript markers in middle)
      // Example: `data.filter(a``````javascript` -> `data.filter(a`
      // CRITICAL: Don't remove template literal backticks (single backticks) - they're valid JavaScript
      // Only remove malformed patterns like `````javascript or multiple consecutive backticks in wrong places
      code = code.replace(/``+javascript/gi, '');
      code = code.replace(/``+js/gi, '');
      code = code.replace(/``+execute/gi, '');
      code = code.replace(/``+code/gi, '');
      // Only remove 4+ consecutive backticks (markdown code block markers that got mangled)
      // Don't remove 1-3 backticks as they might be template literals
      code = code.replace(/`{4,}/g, '');
      
      // CRITICAL: Check if this code block is part of an error message or execution result
      // Error messages contain code blocks with stack traces that should NOT be executed
      if (match.index !== undefined) {
        const blockEnd = match.index + match[0].length;
        const textAfterBlock = text.substring(blockEnd, blockEnd + 50); // Check next 50 chars (stricter adjacency)
        const textBeforeBlock = text.substring(Math.max(0, match.index - 200), match.index); // Check previous 200 chars
        
        // Check if execution result immediately follows (within reasonable whitespace)
        // Skip blocks that were already executed in this response (have results immediately after)
        const hasExecutionResult = /^\s*(?:\n\s*){0,3}\*\*Code Execution (?:Result|Error)\*\*/i.test(textAfterBlock);
        if (hasExecutionResult) {
          // This block has already been executed in THIS response - skip it
          console.log('⏭️ Skipping already-executed code block (has execution result immediately after)');
          continue;
        }
        
        // CRITICAL: Check if this block is part of an error message (appears AFTER "Code Execution Error")
        const isPartOfError = /\*\*Code Execution Error\*\*[^\n]*\n\s*```\s*$/i.test(textBeforeBlock);
        if (isPartOfError) {
          console.log('⏭️ Skipping code block inside error message (error text, not executable code)');
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/32c189e0-1daa-40e4-b57d-2657b124730c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'codeExecutorV2.ts:171',message:'Skipped: part of error',data:{blockIndex:match.index,codePreview:code.substring(0,100)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          continue;
        }
        
        // Check if this block contains ACTUAL error stack traces (not just the word "error" in code)
        // CRITICAL: Must match actual error patterns like "ReferenceError: x is not defined" followed by stack trace
        // NOT valid code like "if (result.error)" or "return { error: 'message' }"
        const hasStackTrace = /Stack Trace:/i.test(code);
        const hasErrorWithStackLine = /(?:ReferenceError|TypeError|SyntaxError|Error):\s*[^\n]+\n\s+at\s+/i.test(code);
        const looksLikeError = hasStackTrace || hasErrorWithStackLine;
        if (looksLikeError && code.length < 500) {
          console.log('⏭️ Skipping code block that looks like an error message (contains stack trace)');
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/32c189e0-1daa-40e4-b57d-2657b124730c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'codeExecutorV2.ts:181',message:'Skipped: looks like error',data:{blockIndex:match.index,codePreview:code.substring(0,100)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          continue;
        }
      }
      
      // Check if code block is complete - look for closing ``` after the code
      const fullMatch = match[0];
      const hasClosingBackticks = fullMatch.endsWith('```');
      const isComplete = hasClosingBackticks;
      
      // Debug: Log what we found
      const isDataQueryResult = this.isDataQuery(code);
      console.log(`🔍 Code block candidate: type=${type}, length=${code.length}, isDataQuery=${isDataQueryResult}, complete=${isComplete}, hasClosing=${hasClosingBackticks}`);
      console.log(`   First 100 chars: ${code.substring(0, 100).replace(/\n/g, '\\n')}`);
      console.log(`   Last 50 chars: ${code.substring(Math.max(0, code.length - 50)).replace(/\n/g, '\\n')}`);
      
      if (code.length > 10 && isDataQueryResult) {
        // CRITICAL: Detect and skip duplicate code blocks
        // Create a more robust hash of the code (normalize whitespace and use full code, not just first 200 chars)
        const normalizedCode = code.replace(/\s+/g, ' ').trim();
        // Use a more unique hash - combine first 100 chars + last 100 chars + length
        // This catches duplicates even if they have slight variations
        const lineCount = (normalizedCode.match(/\n/g) || []).length;
          const codeHash = normalizedCode.length > 200 
          ? `${normalizedCode.substring(0, 100)}...${normalizedCode.substring(normalizedCode.length - 100)}|${normalizedCode.length}|lines:${lineCount}`
          : `${normalizedCode}|${normalizedCode.length}|lines:${lineCount}`;
        
        if (seenCodeHashes.has(codeHash)) {
          console.warn('⚠️ DUPLICATE CODE BLOCK DETECTED - SKIPPING:', codeHash.substring(0, 100) + '...');
          console.warn('   This suggests the AI is repeating itself. Check prompts.');
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/32c189e0-1daa-40e4-b57d-2657b124730c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'codeExecutorV2.ts:204',message:'Skipped: duplicate hash',data:{codeHash:codeHash.substring(0,100),blockIndex:match.index},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          continue; // Skip this duplicate block
        }
        seenCodeHashes.add(codeHash);
        
        // CRITICAL: Also check if this exact code block was already added to blocks array
        // This prevents duplicates that might slip through the hash check
        const isExactDuplicate = blocks.some(existingBlock => {
          const existingNormalized = existingBlock.code.replace(/\s+/g, ' ').trim();
          return existingNormalized === normalizedCode;
        });
        
        if (isExactDuplicate) {
          console.warn('⚠️ EXACT DUPLICATE CODE BLOCK DETECTED - SKIPPING (already in blocks array)');
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/32c189e0-1daa-40e4-b57d-2657b124730c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'codeExecutorV2.ts:218',message:'Skipped: exact duplicate',data:{blockIndex:match.index,codePreview:code.substring(0,100)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          continue;
        }
        
        blocks.push({
          code,
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          type,
          isComplete
        });
        
        console.log(`🔍 DEBUG: Block ${blocks.length} ADDED - type: ${type}, length: ${code.length}, preview:`, code.substring(0,80));
        console.log(`✅ Detected code block ${blocks.length}: ${type} (${code.length} chars, complete: ${isComplete})`);
      } else {
        const reason = code.length <= 10 ? 'too short' : `isDataQuery=false (doesn't match data query patterns)`;
        console.log(`⏭️ Skipping code block: ${reason}`);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/32c189e0-1daa-40e4-b57d-2657b124730c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'codeExecutorV2.ts:240',message:'Skipped: validation failed',data:{reason:reason,codeLength:code.length,isDataQuery:isDataQueryResult,codePreview:code.substring(0,100)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,C'})}).catch(()=>{});
        // #endregion
        if (!isDataQueryResult && code.length > 10) {
          console.log(`   Code preview: ${code.substring(0, 150).replace(/\n/g, '\\n')}...`);
        }
      }
    }
    
    console.log(`🔍 DEBUG: Detection complete - total blocks: ${blocks.length}`);
    console.log(`📊 Total code blocks detected: ${blocks.length}`);
    
    // Pattern 2: XML-style <execute> tags
    const xmlPattern = /<execute>([\s\S]*?)(?:<\/execute>|$)/gi;
    while ((match = xmlPattern.exec(text)) !== null) {
      let code = match[1].trim();
      
      // Check if execution result immediately follows
      if (match.index !== undefined) {
        const blockEnd = match.index + match[0].length;
        const textAfterBlock = text.substring(blockEnd, blockEnd + 50);
        const hasExecutionResult = /^\s*(?:\n\s*){0,3}\*\*Code Execution (?:Result|Error)\*\*/i.test(textAfterBlock);
        if (hasExecutionResult) {
          console.log('⏭️ Skipping already-executed XML code block (has execution result)');
          continue;
        }
      }
      
      // Clean up malformed code in XML tags too
      code = code.replace(/``+javascript/gi, '');
      code = code.replace(/``+js/gi, '');
      code = code.replace(/``+execute/gi, '');
      code = code.replace(/`{3,}/g, '');
      
      const isComplete = text.substring(match.index).includes('</execute>');
      
      if (code.length > 10 && this.isDataQuery(code)) {
        blocks.push({
          code,
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          type: 'xml',
          isComplete
        });
      }
    }
    
    // Pattern 3: Detect and fix broken code blocks (code with malformed markers in middle)
    // Look for patterns like: `data.filter(a``````javascript` or `const x = data.filter(a``````
    if (blocks.length === 0) {
      // Try to find code that looks like it was cut off with malformed markers
      const brokenPattern = /(const|let|var)\s+\w+\s*=\s*data\.filter\([^)]*[`]{2,}(?:javascript|js|execute|code)/gi;
      const brokenMatch = brokenPattern.exec(text);
      
      if (brokenMatch) {
        // Extract the code before the malformation
        const malformationStart = brokenMatch[0].search(/[`]{2,}(?:javascript|js|execute|code)/i);
        if (malformationStart > 0) {
          const validCode = brokenMatch[0].substring(0, malformationStart).trim();
          // Check if there's a complete statement before this
          const beforeBroken = text.substring(0, brokenMatch.index);
          const lastCompleteBlock = beforeBroken.match(/```(?:execute|query|javascript|js|code)\s*\n?([\s\S]*?)```/i);
          
          if (lastCompleteBlock && this.isDataQuery(lastCompleteBlock[1])) {
            // We already have a complete block, use that
            blocks.push({
              code: lastCompleteBlock[1].trim(),
              startIndex: lastCompleteBlock.index || 0,
              endIndex: (lastCompleteBlock.index || 0) + lastCompleteBlock[0].length,
              type: (lastCompleteBlock[0].match(/```(\w+)/)?.[1] || 'javascript') as CodeBlock['type'],
              isComplete: true
            });
          } else if (this.isDataQuery(validCode)) {
            // Try to extract valid code portion
            console.warn('Detected broken code block, extracted valid portion:', validCode.substring(0, 100));
            // Don't add it automatically - let validation catch it and request completion
          }
        }
      }
    }
    
    return blocks;
  }

  /**
   * Check if code appears to be a data query
   * REJECTS Python code (pandas, numpy, duckdb, etc.) - only JavaScript is supported
   */
  private isDataQuery(code: string): boolean {
    // REJECT Python code immediately - we only support JavaScript
    if (PYTHON_PATTERNS.some(pattern => pattern.test(code))) {
      return false; // Reject Python code
    }
    
    // Check for JavaScript data access patterns
    return DATA_PATTERNS.some(pattern => pattern.test(code));
  }

  /**
   * Validate code syntax and completeness
   * Returns validation result with error details
   */
  validateCode(code: string): { valid: boolean; error?: string; needsCompletion?: boolean } {
    // Clean code first (remove any remaining malformed markers)
    let cleanCode = code.trim();
    cleanCode = cleanCode.replace(/``+javascript/gi, '');
    cleanCode = cleanCode.replace(/``+js/gi, '');
    cleanCode = cleanCode.replace(/``+execute/gi, '');
    cleanCode = cleanCode.replace(/`{4,}/g, ''); // Only remove 4+ backticks (preserve template literals)
    
    // CRITICAL: Check for incomplete template literals (backticks)
    // Count backticks to detect unpaired template literals
    // But exclude backticks in comments and strings
    const withoutCodeBlocks = cleanCode.replace(/```/g, '');
    
    // Remove comments (both // and /* */)
    const withoutComments = withoutCodeBlocks
      .replace(/\/\*[\s\S]*?\*\//g, '')  // Remove /* */ comments
      .replace(/\/\/.*/g, '');            // Remove // comments
    
    // Remove string literals (both ' and ")
    const withoutStrings = withoutComments
      .replace(/'([^'\\]|\\.)*'/g, '')    // Remove 'strings'
      .replace(/"([^"\\]|\\.)*"/g, '');   // Remove "strings"
    
    // Count remaining backticks (should be even for balanced template literals)
    const backtickCount = (withoutStrings.match(/`/g) || []).length;
    
    if (backtickCount % 2 !== 0) {
      // Odd number of backticks = incomplete template literal
      // But allow if code ends with common valid patterns like `);` or `);return`
      const endsWithValidPattern = /`\s*\)\s*;?\s*(?:return\s+[^;]+;?)?\s*$/.test(cleanCode);
      
      if (!endsWithValidPattern) {
        return { 
          valid: false, 
          needsCompletion: true, 
          error: 'Code appears to have an incomplete template literal. The code block may have been cut off mid-template.'
        };
      }
    }
    
    // Check for malformed code blocks (triple backticks in middle of statements)
    if (cleanCode.includes('```') && !cleanCode.endsWith('```')) {
      return { valid: false, needsCompletion: true, error: 'Code contains malformed code block markers' };
    }
    
    // Auto-fix common typos/cutoffs before validation
    cleanCode = cleanCode.replace(/\ba\.tea\b/g, 'a.team');
    cleanCode = cleanCode.replace(/\brow\.tea\b/g, 'row.team');
    cleanCode = cleanCode.replace(/\bevaluation\b(?!_code)/g, 'evaluation_code');
    cleanCode = cleanCode.replace(/\beval\b(?!uation)/g, 'evaluation_code');
    
    // REMOVED: Aggressive incomplete expression detection
    // This was causing valid code blocks to be skipped. Let the code execute and show errors naturally.
    
    // Only check for the most extreme cases of incomplete code
    const openParens = (cleanCode.match(/\(/g) || []).length;
    const closeParens = (cleanCode.match(/\)/g) || []).length;
    const openBraces = (cleanCode.match(/\{/g) || []).length;
    const closeBraces = (cleanCode.match(/\}/g) || []).length;
    const openBrackets = (cleanCode.match(/\[/g) || []).length;
    const closeBrackets = (cleanCode.match(/\]/g) || []).length;
    
    const parenDiff = openParens - closeParens;
    const braceDiff = openBraces - closeBraces;
    const bracketDiff = openBrackets - closeBrackets;
    
    // Only flag as incomplete if brackets are VERY unbalanced (likely truncated code)
    // Allow tolerance of 5 to avoid false positives from regex, comments, strings, etc.
    if (Math.abs(parenDiff) > 5 || Math.abs(braceDiff) > 5 || Math.abs(bracketDiff) > 5) {
      return { valid: false, needsCompletion: true, error: `Code appears truncated - unbalanced brackets (parens: ${parenDiff}, braces: ${braceDiff}, brackets: ${bracketDiff})` };
    }
    
    // REMOVED: All other "incomplete" checks - let execution fail with clear error instead
    // This prevents false positives like:
    // - Code ending with . or , (valid in many contexts)
    // - const/let patterns (might be followed by comments)
    // - Method chaining patterns (valid if continued on next line)
    // 
    // Philosophy: Better to execute and fail with a clear JavaScript error
    // than to show "Code appears incomplete" warning for valid code
    
    return { valid: true };
  }

  /**
   * Check if code is a SQL query
   */
  private isSqlQuery(code: string): boolean {
    const trimmed = code.trim().toUpperCase();
    return trimmed.startsWith('SELECT') || 
           trimmed.startsWith('WITH') ||
           trimmed.startsWith('INSERT') ||
           trimmed.startsWith('UPDATE') ||
           trimmed.startsWith('DELETE');
  }

  /**
   * Execute SQL query directly on database via Cloudflare D1 API
   */
  private async executeSqlQuery(sqlCode: string): Promise<ExecutionResult> {
    const startTime = Date.now();
    let finalQuery = sqlCode.trim(); // Declare here so it's available in catch block
    try {
      // SQL queries are ONLY for the remote database (Neon via Cloudflare Workers)
      // NOT for CSV files - CSV files use JavaScript code execution with DuckDB data retrieval
      const { isDatabaseConnected, executeDbQuery } = await import("@/lib/database");
      if (!isDatabaseConnected()) {
        return {
          success: false,
          error: 'Database connection not available',
          executionTime: Date.now() - startTime
        };
      }

      const tableName = localStorage.getItem("db_table_name") || "combined_dvw";
      
      // Build WHERE clause from filter criteria if available
      finalQuery = sqlCode.trim(); // Reassign for clarity
      const queryParams: any[] = [];
      
      if (this.filterColumns && this.filterValues && this.filterColumns.length > 0) {
        const whereConditions: string[] = [];
        this.filterColumns.forEach((col: string) => {
          const filterValue = this.filterValues![col];
          if (filterValue != null && filterValue !== '__SELECT_ALL__') {
            // PostgreSQL uses double quotes for identifiers, escape them
            const quotedCol = `"${col.replace(/"/g, '""')}"`;
            if (Array.isArray(filterValue)) {
              // Check if array contains "(null)" - need to handle separately
              const hasNull = filterValue.some(v => String(v) === '(null)');
              const nonNullValues = filterValue.filter(v => String(v) !== '(null)');

              if (hasNull && nonNullValues.length > 0) {
                // Include both NULL and specific values
                const placeholders = nonNullValues.map(() => '?').join(', ');
                whereConditions.push(`(${quotedCol} IN (${placeholders}) OR ${quotedCol} IS NULL)`);
                queryParams.push(...nonNullValues);
              } else if (hasNull) {
                // Only NULL values
                whereConditions.push(`${quotedCol} IS NULL`);
              } else {
                // Only non-NULL values
                const placeholders = filterValue.map(() => '?').join(', ');
                whereConditions.push(`${quotedCol} IN (${placeholders})`);
                queryParams.push(...filterValue);
              }
            } else {
              // Single value
              if (String(filterValue) === '(null)') {
                whereConditions.push(`${quotedCol} IS NULL`);
              } else {
                whereConditions.push(`${quotedCol} = ?`);
                queryParams.push(filterValue);
              }
            }
          }
        });

        if (whereConditions.length > 0) {
          // Check if query already has WHERE clause
          const hasWhere = /WHERE\s+/i.test(finalQuery);
          if (hasWhere) {
            // Add to existing WHERE with AND
            finalQuery = finalQuery.replace(/WHERE\s+/i, `WHERE ${whereConditions.join(' AND ')} AND `);
          } else {
            // Add new WHERE clause
            const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
            // Check if query has FROM clause - if not, add it
            const hasFrom = /FROM\s+/i.test(finalQuery);
            if (!hasFrom) {
              // Query doesn't specify table - add FROM clause
              finalQuery += ` FROM ${quotedTable}`;
            } else {
              // Replace table name in query with full table reference if needed
              finalQuery = finalQuery.replace(new RegExp(`FROM\\s+${tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), `FROM ${quotedTable}`);
            }
            finalQuery += ` WHERE ${whereConditions.join(' AND ')}`;
          }
        }
      }

      // Execute query via API
      const rows = await executeDbQuery(finalQuery, queryParams.length > 0 ? queryParams : undefined);
      
      return {
        success: true,
        result: rows,
        executionTime: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        success: false,
        error: `SQL Query Error: ${error?.message || 'Unknown SQL error'}\n\nQuery: ${finalQuery}\n\nTip: Check column names, table name (use 'csvData'), and SQL syntax (DuckDB dialect)`,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Execute code with proper sandboxing and timeout
   */
  async executeCode(code: string): Promise<ExecutionResult> {
    // Check if this is a SQL query - only allow if explicitly enabled (for limited database data)
    if (this.allowSql && this.isSqlQuery(code)) {
      return await this.executeSqlQuery(code);
    }
    
    // If SQL query detected but not allowed, return error
    if (this.isSqlQuery(code) && !this.allowSql) {
      return {
        success: false,
        error: 'SQL queries are only available for database data. CSV files must use DuckDB with await query() instead.',
        executionTime: 0
      };
    }

    // For large CSV files, data might be null (using DuckDB on-demand)
    // Try to load from DuckDB if csvId is available
    if ((!this.data || !Array.isArray(this.data) || this.data.length === 0)) {
      console.log('CodeExecutor: No data in memory, checking if can load from DuckDB. csvId:', this.csvId);
      // Check if we have csvId and can load from DuckDB
      if (this.csvId) {
        try {
          console.log('CodeExecutor: Importing DuckDB module...');
          const { initDuckDB, isDuckDBInitialized } = await import('./duckdb');
          console.log('CodeExecutor: DuckDB module imported');
          
          // Try to initialize DuckDB if not already initialized
          if (!isDuckDBInitialized()) {
            console.log('CodeExecutor: DuckDB not initialized, attempting to initialize...');
            try {
              await initDuckDB();
              console.log('CodeExecutor: DuckDB initialized successfully');
            } catch (initError) {
              console.error('CodeExecutor: Failed to initialize DuckDB:', initError);
              return {
                success: false,
                error: `Failed to initialize DuckDB: ${initError instanceof Error ? initError.message : 'Unknown error'}. The CSV data needs to be loaded for code execution.`,
                executionTime: 0
              };
            }
          } else {
            console.log('CodeExecutor: DuckDB already initialized');
          }
          
          if (isDuckDBInitialized()) {
            // For large datasets or selections, don't load all data into memory
            // Set empty arrays and let AI use query() function for DuckDB access
            console.log('⚡ CodeExecutor: Using DuckDB query mode (no data preloading)');
            console.log('   csvData will be empty - AI must use query() function');
            
            this.data = [];
            (this as any).csvData = [];
            
            console.log('✅ CodeExecutor: Ready for DuckDB query execution')
          } else {
            console.error('❌ CodeExecutor: DuckDB is not initialized after init attempt');
            return {
              success: false,
              error: 'DuckDB is not initialized. Please ensure DuckDB is available.',
              executionTime: 0
            };
          }
        } catch (duckdbError) {
          console.error('❌ CodeExecutor: Exception while loading from DuckDB:', duckdbError);
          return {
            success: false,
            error: `Failed to load data from DuckDB: ${duckdbError instanceof Error ? duckdbError.message : 'Unknown error'}`,
            executionTime: 0
          };
        }
      } else {
        // No csvId and no data - return error
        console.error('❌ CodeExecutor: No csvId provided and no data in memory');
        return {
          success: false,
          error: 'No data available for code execution. Please ensure data is loaded or CSV file is registered in DuckDB.',
          executionTime: 0
        };
      }
    } else {
      console.log('✅ CodeExecutor: Data already in memory:', this.data.length, 'rows');
    }

    const startTime = Date.now();

    try {
      // Security validation
      const securityCheck = this.validateSecurity(code);
      if (!securityCheck.safe) {
        return {
          success: false,
          error: securityCheck.error || 'Code contains prohibited patterns',
          executionTime: Date.now() - startTime
        };
      }

      // Prepare execution environment - use universal data array
      let data = this.data;
      
      // Check if this is a sample of a larger dataset
      const isSample = (data as any)?.__isSample === true;
      const totalRows = (data as any)?.__totalRows;
      
      // If it's a sample, create a clean array without metadata
      if (isSample && Array.isArray(data)) {
        data = [...data]; // Create clean copy without metadata
        // Add note about sample in console
        console.log(`⚠️ Using sample data (${data.length.toLocaleString()} rows) - full dataset has ${totalRows?.toLocaleString() || 'unknown'} rows. Use DuckDB queries for full dataset.`);
      }
      
      // Also provide csvData as an alias for data when it's CSV data (for compatibility)
      // Check if csvData was explicitly set (when CSV filters are used)
      const csvData = (this as any).csvData || data; // Use explicit csvData if set, otherwise use data
      
      // IMPORTANT: If data is empty but csvId exists, code MUST use query() function
      // Inject a helpful note that will be visible if code tries to use empty data
      const dataIsEmpty = (!data || !Array.isArray(data) || data.length === 0) && (!csvData || !Array.isArray(csvData) || csvData.length === 0);
      if (dataIsEmpty && this.csvId) {
        console.log('⚠️ Data arrays are empty. Code must use: const result = await query("SELECT * FROM csvData ...");');
      }
      // Provide matchInfo and summary only if matchData exists (for backward compatibility)
      // For universal data, use minimal empty objects - code should only use the data array
      const matchInfo = this.matchData?.matchInfo || {} as any;
      const summary = this.matchData?.summary || {} as any;

      // Clean and prepare code
      let cleanCode = code.trim();
      
      // Auto-fix common typos/cutoffs
      // Universal: Fix common typos (domain-agnostic)
      // Note: These are generic fixes, not domain-specific
      cleanCode = cleanCode.replace(/\ba\.tea\b/g, 'a.team');
      cleanCode = cleanCode.replace(/\brow\.tea\b/g, 'row.team');
      // Don't auto-fix evaluation -> evaluation_code as that's domain-specific
      // Let the AI or validation catch incomplete property access
      
      // REMOVED: Complex await query transformation that was breaking template literals
      // The transformation was causing syntax errors when code contained template literals
      // Let the code execute as-is - if there's a precedence issue, the error message will be clear
      
      // Check if code has a return statement
      const hasReturn = /\breturn\s+/.test(cleanCode);
      
      // If code has variable declarations but no return, add return for the last expression
      if (!hasReturn) {
        // Try to find all variable declarations
        const varMatches = cleanCode.match(/(?:const|let|var)\s+(\w+)\s*=/g);
        if (varMatches && varMatches.length > 0) {
          const varNames = varMatches.map(m => {
            const match = m.match(/(?:const|let|var)\s+(\w+)\s*=/);
            return match ? match[1] : null;
          }).filter(Boolean) as string[];
          
          if (varNames.length > 0) {
            // Create return statement with all variables as an object
            // Check if last line already ends with semicolon
            const lastChar = cleanCode.trim().slice(-1);
            if (lastChar !== ';') {
              cleanCode += ';';
            }
            cleanCode += `\nreturn { ${varNames.join(', ')} };`;
            console.log('Auto-added return statement with variables:', varNames);
          }
        } else {
          // No variables, but might have an expression - check last line
          const lines = cleanCode.split('\n').filter(l => l.trim());
          const lastLine = lines[lines.length - 1];
          if (lastLine && !lastLine.includes('return') && !lastLine.endsWith(';')) {
            // Last line might be an expression, wrap it in return
            const lastLineIndex = cleanCode.lastIndexOf(lastLine);
            cleanCode = cleanCode.substring(0, lastLineIndex) + `return ${lastLine.trim()};`;
          }
        }
      }

      // Create DuckDB query function for AI to use
      const queryFunction = async (sql: string): Promise<any[]> => {
        if (!this.csvId) {
          // Check if data is available - if so, guide towards using data directly
          if (this.data && Array.isArray(this.data) && this.data.length > 0) {
            throw new Error(`query() is for CSV/DuckDB data, but you have in-memory data (${this.data.length} rows). Use JavaScript array methods instead:\n\n// Example:\nconst result = data.filter(row => row.column === 'value');\nreturn result;`);
          }
          throw new Error('No CSV data available. Make sure a CSV file is selected before using query().');
        }

        try {
          // Ensure DuckDB is initialized before executing
          const { executeDuckDBSql, initDuckDB, isDuckDBInitialized, getDuckDBTableName } = await import('./duckdb');
          
          if (!isDuckDBInitialized()) {
            console.log('query(): DuckDB not initialized, initializing now...');
            await initDuckDB();
          }
          
          const csvIds = Array.isArray(this.csvId) ? this.csvId : [this.csvId];
          
          // CRITICAL FIX: Replace 'csvData' with actual DuckDB table name
          // The AI is instructed to always use 'csvData' as the table name, but the actual
          // table in DuckDB is named 'csv_{fileId}'. We need to replace it before executing.
          const actualTableName = getDuckDBTableName(csvIds[0]);
          let modifiedSql = sql;
          
          if (actualTableName) {
            // Replace all occurrences of csvData (case-insensitive, as a complete word)
            // Use word boundaries to avoid replacing it within other identifiers
            modifiedSql = sql.replace(/\bcsvData\b/gi, `"${actualTableName.replace(/"/g, '""')}"`);
            console.log(`query(): Replaced 'csvData' with actual table name: ${actualTableName}`);
          } else {
            // Table name not found - will likely fail but let DuckDB handle the error
            console.warn(`query(): Could not find DuckDB table name for CSV ID: ${csvIds[0]}`);
          }

          // Use the first CSV ID for queries
          const result = await executeDuckDBSql(csvIds[0], modifiedSql, this.filterColumns, this.filterValues);
          return result;
        } catch (error: any) {
          const errorMsg = error?.message || 'Unknown error';
          // Extract useful info from DuckDB errors
          // Show raw DuckDB error without extra help messages
          throw new Error(errorMsg);
        }
      };

      // Wrap code in IIFE for isolation
      // IMPORTANT: The return statement in cleanCode must be at the top level of the function
      // If cleanCode has a return, it will return from the IIFE
      // We need to wrap the try-catch around the entire function, not inside it
      // CRITICAL FIX: Build wrappedCode without using template literals
      // Template literals can break when cleanCode contains backticks or ${}
      // Use string concatenation instead for safety
      
      // Build available variables list including state variables
      const baseVars = ['data', 'csvData', 'summary', 'query()'];
      const stateVars = Object.keys(this.executionState);
      const availableVars = [...baseVars, ...stateVars].join(', ');
      
      // Build result-specific error message based on execution state
      // CRITICAL: Escape all quotes in error messages to prevent Function constructor issues
      let resultErrorHelp = '';
      if (stateVars.length === 0) {
        // Avoid quotes in error message to prevent Function constructor issues
        // Use a simpler message without example code that contains quotes
        resultErrorHelp = '\\n\\n⚠️ Previous block did NOT return anything (or didn\'t execute).\\n✅ Solution: Check if previous block executed successfully, or use query() function to get data.';
      } else if (stateVars.includes('result')) {
        resultErrorHelp = '\\n\\n✅ Previous block returned an array/primitive - use: result';
      } else {
        resultErrorHelp = '\\n\\n⚠️ Previous block returned an OBJECT, not an array. Available variables: ' + stateVars.join(', ') + '\\n✅ Solution: Use the property names directly (e.g., ' + (stateVars[0] || 'propertyName') + ') instead of \'result\'';
      }
      
      // Normalize line endings first
      let safeCode = cleanCode
        .replace(/\r\n/g, '\n')  // Normalize line endings
        .replace(/\r/g, '\n');   // Handle old Mac line endings

      // Build parameter list dynamically from execution state
      const stateKeys = Object.keys(this.executionState);
      const stateValues = Object.values(this.executionState);
      
      // CRITICAL: Filter out state keys that are already in base parameters to avoid duplicates
      // Note: matchInfo is NOT a base param - it should ONLY come from execution state
      // Never pass matchInfo as a hardcoded parameter to avoid "already declared" errors
      const baseParams = ['data', 'csvData', 'summary', 'query'];
      const filteredStateKeys = stateKeys.filter(key => !baseParams.includes(key));
      const filteredStateValues = filteredStateKeys.map(key => this.executionState[key]);
      
      // DON'T add matchInfo from context - let code declare it if needed
      // If matchInfo exists in execution state, it will be in filteredStateKeys
      const allParams = [...baseParams, ...filteredStateKeys];
      const allValues = [data, csvData, summary, queryFunction, ...filteredStateValues];
      
      // DEBUG: Log available variables for debugging
      if (stateKeys.length > 0) {
        console.log(`🔍 Block execution - Available variables from previous blocks: ${stateKeys.join(', ')}`);
      }

      // CRITICAL FIX: Auto-handle variable redeclarations
      // If AI tries to redeclare a variable with const/let that already exists in scope,
      // automatically convert it to a reassignment to prevent "already declared" errors
      const existingVars = new Set([...allParams, ...Object.keys(this.executionState)]);

      // Step 1: Handle simple declarations (const varName = ...)
      // Pattern matches: const varName = ... or let varName = ...
      // Handle single and multiple declarations: const x = 1, y = 2;
      const declarationPattern = /\b(const|let)\s+([a-zA-Z_$][a-zA-Z0-9_$]*(?:\s*,\s*[a-zA-Z_$][a-zA-Z0-9_$]*)*)\s*=/g;

      safeCode = safeCode.replace(declarationPattern, (match, keyword, varNames) => {
        // Split multiple declarations (e.g., "x, y, z")
        const names = varNames.split(',').map((n: string) => n.trim());
        const redeclared = names.filter((name: string) => existingVars.has(name));

        if (redeclared.length > 0) {
          // Some or all variables are being redeclared
          console.log(`🔧 Auto-fix: Converting redeclaration to reassignment for: ${redeclared.join(', ')}`);

          // If ALL variables are redeclared, remove the keyword entirely
          if (redeclared.length === names.length) {
            return varNames + ' =';  // Convert "const x = " to "x = "
          }

          // If SOME are redeclared (mixed case), keep keyword for new ones, separate redeclared ones
          // This is complex, so for simplicity, convert all to reassignment
          console.warn(`⚠️ Mixed redeclaration detected (${keyword} ${varNames}). Converting all to reassignment.`);
          return varNames + ' =';
        }

        // No redeclaration, keep original
        return match;
      });

      // Step 2: Handle destructuring (const { varName } = ...)
      // This is complex, so we'll use a simpler approach: detect and warn
      // Pattern: const { x, y } = obj or const [ a, b ] = arr
      const destructuringPattern = /\b(const|let)\s*([{[][^}=\]]+[}\]])\s*=/g;
      const destructuringMatches = [...safeCode.matchAll(destructuringPattern)];

      for (const match of destructuringMatches) {
        const keyword = match[1];
        const destructure = match[2];

        // Extract variable names from destructuring (simple approach)
        const varNamesInDestructure = destructure
          .replace(/[{}\[\]]/g, '')  // Remove brackets
          .split(',')
          .map(v => v.trim().split(':')[0].trim())  // Handle { x: y } syntax
          .filter(v => v && /^[a-zA-Z_$]/.test(v));

        const redeclaredInDestructure = varNamesInDestructure.filter(name => existingVars.has(name));

        if (redeclaredInDestructure.length > 0) {
          console.warn(`⚠️ Destructuring redeclaration detected for: ${redeclaredInDestructure.join(', ')}`);
          console.warn(`   Original: ${match[0]}`);
          console.warn(`   This may cause "already declared" errors. AI should use different variable names.`);
          // Don't auto-fix destructuring - it's too complex. Let it fail with clear error.
        }
      }

      // CRITICAL FIX: Use AsyncFunction constructor directly without wrapping
      // The issue was that wrapping code in a string and passing to Function() constructor
      // causes it to parse template literals during construction, which fails
      // Solution: Pass raw code to AsyncFunction, variables are passed as parameters

      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

      let executeFunction: Function;
      try {
        // Create async function with code directly - no wrapping needed
        // Template literals will be evaluated during execution, not construction
        executeFunction = new AsyncFunction(...allParams, safeCode);
      } catch (constructorError: any) {
        // If AsyncFunction constructor fails, log error
        console.error('❌ AsyncFunction constructor error:', constructorError);
        console.error('Error message:', constructorError.message);
        console.error('Code length:', safeCode.length);
        console.error('Code (first 500 chars):', safeCode.substring(0, 500));
        
        return {
          success: false,
          error: `Code syntax error: ${constructorError.message}`,
          executionTime: Date.now() - startTime
        };
      }

      // Execute with timeout
      const executionPromise = executeFunction(...allValues);
      
      // CRITICAL FIX: Store timeout ID to clear it and prevent memory leak
      let timeoutId: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Execution timeout (${this.executionTimeout/1000}s)`)), this.executionTimeout);
      });

      let result;
      try {
        result = await Promise.race([executionPromise, timeoutPromise]);
      } finally {
        // Always clear timeout to prevent memory leaks
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
      }
      const executionTime = Date.now() - startTime;

      // Check if result is an error object
      if (result && typeof result === 'object' && result.error) {
        return {
          success: false,
          error: result.error,
          executionTime
        };
      }

      // Store result in execution state for next block to access
      // CRITICAL: State is preserved even if this block fails - previous blocks' state remains
      // CRITICAL: ALWAYS store the entire result as 'result' variable so subsequent blocks can access it
      // Additionally, if result is an object, also store each property separately for convenience
      if (result !== undefined && result !== null) {
        // ALWAYS store the entire result as 'result' variable
        this.executionState.result = result;
        
        if (typeof result === 'object' && !Array.isArray(result)) {
          // ALSO store each property of the object (with sanitization to prevent prototype pollution)
          // This allows both `result.matchId` and direct `matchId` access
          const sanitizedKeys: string[] = [];
          const skippedKeys: string[] = [];
          Object.entries(result).forEach(([key, value]) => {
            if (this.sanitizeStateKey(key)) {
              this.executionState[key] = value;
              sanitizedKeys.push(key);
            } else {
              skippedKeys.push(key);
              console.warn(`⚠️ Skipped invalid/dangerous state variable name: "${key}"`);
            }
          });
          if (skippedKeys.length > 0) {
            console.warn(`⚠️ Skipped ${skippedKeys.length} variable(s): ${skippedKeys.join(', ')}`);
          }
        }
      } else {
        // Result is undefined/null, but we still have captured variables
        // This is fine - variables are already stored above
        console.log('ℹ️ Block returned undefined/null - previous state preserved');
      }

      // Enhanced fallback: Check if result is undefined (code executed but didn't return anything)
      if (result === undefined) {
        console.warn('Code executed but returned undefined.');
        console.warn('Code preview:', cleanCode.substring(0, 500));
        console.warn('Full code length:', cleanCode.length);
        
        // Check if code actually has a return statement
        const hasReturnInCode = /\breturn\s+/.test(cleanCode);
        if (hasReturnInCode) {
          // Code has return but still undefined - provide helpful error message
          // This can happen if the return statement is in a conditional that didn't execute
          // or if there's a syntax error preventing the return from being reached
          console.error('Code has return statement but still returned undefined. This may indicate a logic error.');
          
          // Try to provide more specific error message
          const returnMatch = cleanCode.match(/\breturn\s+([^;]+)/);
          if (returnMatch) {
            const returnValue = returnMatch[1].trim();
            return {
              success: false,
              error: `Code executed but returned undefined. The return statement references "${returnValue}" which may be undefined. Check that all variables are defined before the return statement.`,
              executionTime
            };
          }
          
          return {
            success: false,
            error: 'Code executed but returned undefined even though it contains a return statement. Check that all variables are defined and the return statement is reachable. Try adding console.log statements to debug.',
            executionTime
          };
        }
        
        // Try to extract variables from the code to return them - enhanced fallback
        const varMatches = cleanCode.match(/(?:const|let|var)\s+(\w+)\s*=/g);
        if (varMatches && varMatches.length > 0) {
          const varNames = varMatches.map(m => {
            const match = m.match(/(?:const|let|var)\s+(\w+)\s*=/);
            return match ? match[1] : null;
          }).filter(Boolean) as string[];
          
          // Provide helpful suggestion based on number of variables
          if (varNames.length === 1) {
            return {
              success: false,
              error: `Code executed but returned undefined. Please add a return statement. Example: return ${varNames[0]}; or return { ${varNames[0]} };`,
              executionTime
            };
          } else {
          return {
            success: false,
            error: `Code executed but returned undefined. Please add a return statement. Example: return { ${varNames.join(', ')} };`,
            executionTime
          };
          }
        }
        
        return {
          success: false,
          error: 'Code executed but returned undefined. Please add a return statement to your code. For example: return data.filter(...).length; or return { result: value };',
          executionTime
        };
      }

      return {
        success: true,
        result: result,
        executionTime
      };
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      // Show raw error message without enhancement
      const errorMessage = error.message || 'Unknown execution error';

      return {
        success: false,
        error: errorMessage,
        executionTime
      };
    }
  }

  /**
   * Validate code doesn't contain dangerous patterns
   */
  private validateSecurity(code: string): { safe: boolean; error?: string } {
    const dangerousPatterns = [
      { pattern: /require\s*\(/, error: 'require() is not allowed' },
      { pattern: /import\s+/, error: 'import statements are not allowed' },
      { pattern: /eval\s*\(/, error: 'eval() is not allowed' },
      { pattern: /Function\s*\(/, error: 'Function constructor is not allowed' },
      { pattern: /setTimeout\s*\(/, error: 'setTimeout() is not allowed' },
      { pattern: /setInterval\s*\(/, error: 'setInterval() is not allowed' },
      { pattern: /XMLHttpRequest/, error: 'XMLHttpRequest is not allowed' },
      { pattern: /fetch\s*\(/, error: 'fetch() is not allowed' },
      { pattern: /process\./, error: 'process object is not allowed' },
      { pattern: /global\./, error: 'global object is not allowed' },
      { pattern: /window\./, error: 'window object is not allowed' },
      { pattern: /document\./, error: 'document object is not allowed' },
      { pattern: /localStorage/, error: 'localStorage is not allowed' },
      { pattern: /sessionStorage/, error: 'sessionStorage is not allowed' },
      { pattern: /indexedDB/, error: 'indexedDB is not allowed' },
    ];

    for (const { pattern, error } of dangerousPatterns) {
      if (pattern.test(code)) {
        return { safe: false, error };
      }
    }

    return { safe: true };
  }

  /**
   * Format execution result for display
   */
  formatResult(result: ExecutionResult): string {
    if (result.success) {
      const resultStr = typeof result.result === 'object' 
        ? JSON.stringify(result.result, null, 2)
        : String(result.result);
      
      return `**Code Execution Result** (${result.executionTime}ms):\n\`\`\`json\n${resultStr}\n\`\`\``;
    } else {
      return `**Code Execution Error** (${result.executionTime}ms):\n\`\`\`\n${result.error}\n\`\`\``;
    }
  }
}

/**
 * Legacy function exports for backward compatibility
 */
export async function executeCode(code: string, matchData: MatchData | null): Promise<ExecutionResult> {
  const executor = new CodeExecutor(matchData);
  return executor.executeCode(code);
}

export function extractCodeBlocks(text: string): string[] {
  const executor = new CodeExecutor(null);
  const blocks = executor.detectCodeBlocksInStream(text);
  return blocks.map(b => b.code);
}

export function hasCodeExecutionRequest(text: string): boolean {
  const executor = new CodeExecutor(null);
  const blocks = executor.detectCodeBlocksInStream(text);
  return blocks.length > 0;
}

export function formatExecutionResult(result: ExecutionResult): string {
  const executor = new CodeExecutor(null);
  return executor.formatResult(result);
}

