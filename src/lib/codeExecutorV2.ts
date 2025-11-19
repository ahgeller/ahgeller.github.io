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
  type: 'execute' | 'query' | 'javascript' | 'xml';
  isComplete: boolean;
}

/**
 * Modern, efficient code execution system
 * Inspired by Cursor and other AI coding assistants
 */
export class CodeExecutor {
  private matchData: MatchData | null;
  private data: any[] | null; // Universal data array (can be from MatchData or any other source)
  private executionTimeout: number = 10000; // 10 seconds

  constructor(matchData: MatchData | null, data?: any[] | null) {
    this.matchData = matchData;
    // If data is provided directly, use it; otherwise use matchData.data
    this.data = data !== undefined ? data : (matchData?.data || null);
  }

  /**
   * Detect code blocks in streaming text
   * More efficient than waiting for complete response
   * Handles malformed blocks (like backticks in the middle of code)
   */
  detectCodeBlocksInStream(text: string): CodeBlock[] {
    const blocks: CodeBlock[] = [];
    
    // Pattern 1: Markdown code blocks with execute/query/javascript
    // Improved regex to handle malformed blocks (backticks in middle of code)
    const markdownPattern = /```(execute|query|javascript|js|code)\s*\n?([\s\S]*?)(?:```|$)/gi;
    let match;
    while ((match = markdownPattern.exec(text)) !== null) {
      const type = match[1].toLowerCase() as CodeBlock['type'];
      let code = match[2].trim();
      
      // Clean up malformed code (remove stray backticks/javascript markers in middle)
      // Example: `data.filter(a``````javascript` -> `data.filter(a`
      code = code.replace(/``+javascript/gi, '');
      code = code.replace(/``+js/gi, '');
      code = code.replace(/``+execute/gi, '');
      code = code.replace(/``+code/gi, '');
      // Remove multiple consecutive backticks
      code = code.replace(/`{3,}/g, '');
      
      const isComplete = text.substring(match.index + match[0].indexOf(code)).includes('```');
      
      if (code.length > 10 && this.isDataQuery(code)) {
        blocks.push({
          code,
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          type,
          isComplete
        });
      }
    }
    
    // Pattern 2: XML-style <execute> tags
    const xmlPattern = /<execute>([\s\S]*?)(?:<\/execute>|$)/gi;
    while ((match = xmlPattern.exec(text)) !== null) {
      let code = match[1].trim();
      
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
   */
  private isDataQuery(code: string): boolean {
    const dataPatterns = [
      /data\.(filter|map|reduce|find|some|every|length|forEach)/i,
      /matchInfo\./i,
      /summary\./i,
      /\bdata\s*\[/i,
      /\bdata\s*\./i
    ];
    
    return dataPatterns.some(pattern => pattern.test(code));
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
    cleanCode = cleanCode.replace(/`{3,}/g, '');
    
    // Check for malformed code blocks (backticks in middle of statements)
    if (cleanCode.includes('```') && !cleanCode.endsWith('```')) {
      return { valid: false, needsCompletion: true, error: 'Code contains malformed code block markers' };
    }
    
    // Auto-fix common typos/cutoffs before validation
    cleanCode = cleanCode.replace(/\ba\.tea\b/g, 'a.team');
    cleanCode = cleanCode.replace(/\brow\.tea\b/g, 'row.team');
    cleanCode = cleanCode.replace(/\bevaluation\b(?!_code)/g, 'evaluation_code');
    cleanCode = cleanCode.replace(/\beval\b(?!uation)/g, 'evaluation_code');
    
    // Check for incomplete statements at the end
    const trimmedCode = cleanCode.trim();
    const incompletePatterns = [
      /const\s+\w+\s*$/,           // const varName without assignment
      /let\s+\w+\s*$/,             // let varName without assignment
      /data\.filter\([^)]*$/,      // Incomplete filter
      /\.includes\([`'"]?$/,       // Incomplete includes
      /\.\w+\s*$/,                // Ends with .propertyName (incomplete property access)
      /a\.\w+\s*$/,                // Ends with a.propertyName (incomplete)
      /row\.\w+\s*$/,              // Ends with row.propertyName (incomplete)
      /team\s*$/,                  // Ends with team (incomplete - generic property name)
      /\.team\s*$/,                 // Ends with .team (incomplete)
      /a\.team\s*$/,                // Incomplete property access
      /a\.tea\s*$/,                 // Typo: a.tea (should be a.team)
      /row\.tea\s*$/,               // Typo: row.tea (should be row.team)
      /\.length\s*$/,              // Just .length without preceding code
      /&&\s*$/,                    // Ends with &&
      /\|\|\s*$/,                  // Ends with ||
      /===\s*$/,                   // Ends with ===
      /==\s*$/,                    // Ends with ==
      /\.filter\([^)]*$/,          // Incomplete filter (any object)
      /\.map\([^)]*$/,             // Incomplete map
      /\.reduce\([^)]*$/,         // Incomplete reduce
    ];
    
    const hasIncomplete = incompletePatterns.some(pattern => pattern.test(trimmedCode));
    
    if (hasIncomplete) {
      return { valid: false, needsCompletion: true, error: 'Code appears incomplete - statement not finished' };
    }
    
    // Basic syntax checks
    const openParens = (cleanCode.match(/\(/g) || []).length;
    const closeParens = (cleanCode.match(/\)/g) || []).length;
    const openBraces = (cleanCode.match(/\{/g) || []).length;
    const closeBraces = (cleanCode.match(/\}/g) || []).length;
    const openBrackets = (cleanCode.match(/\[/g) || []).length;
    const closeBrackets = (cleanCode.match(/\]/g) || []).length;
    
    const parenDiff = openParens - closeParens;
    const braceDiff = openBraces - closeBraces;
    const bracketDiff = openBrackets - closeBrackets;
    
    // Check for unbalanced brackets (more strict)
    if (Math.abs(parenDiff) > 2 || Math.abs(braceDiff) > 2 || Math.abs(bracketDiff) > 2) {
      return { valid: false, needsCompletion: true, error: `Unbalanced brackets/parentheses (parens: ${parenDiff}, braces: ${braceDiff}, brackets: ${bracketDiff})` };
    }
    
    // Check for incomplete string literals
    const singleQuotes = (cleanCode.match(/'/g) || []).length;
    const doubleQuotes = (cleanCode.match(/"/g) || []).length;
    const backticks = (cleanCode.match(/`/g) || []).length;
    
    // If odd number of quotes, likely incomplete string
    if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0 || (backticks % 2 !== 0 && backticks < 3)) {
      return { valid: false, needsCompletion: true, error: 'Incomplete string literal detected' };
    }
    
    // Check if code ends with incomplete expression
    if (trimmedCode.endsWith('.') || trimmedCode.endsWith(',') || trimmedCode.endsWith('=')) {
      return { valid: false, needsCompletion: true, error: 'Code ends with incomplete expression' };
    }
    
    return { valid: true };
  }

  /**
   * Execute code with proper sandboxing and timeout
   */
  async executeCode(code: string): Promise<ExecutionResult> {
    if (!this.data || !Array.isArray(this.data) || this.data.length === 0) {
      return {
        success: false,
        error: 'No data available for code execution',
        executionTime: 0
      };
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
      const data = this.data;
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

      // Wrap code in IIFE for isolation
      // IMPORTANT: The return statement in cleanCode must be at the top level of the function
      // If cleanCode has a return, it will return from the IIFE
      // We need to wrap the try-catch around the entire function, not inside it
      const wrappedCode = `
        (function() {
          "use strict";
          try {
            ${cleanCode}
          } catch (error) {
            return { error: error.message, stack: error.stack };
          }
        })();
      `;
      
      // Debug: log the wrapped code to see what we're executing
      console.log('Executing wrapped code (first 500 chars):', wrappedCode.substring(0, 500));

      // Create isolated function
      // The wrappedCode is an IIFE that will execute and return a value
      // We need to make sure the function body actually executes the IIFE
      const executeFunction = new Function('data', 'matchInfo', 'summary', `return ${wrappedCode.trim()};`);

      // Execute with timeout
      // The function will return the result of the IIFE
      const executionPromise = Promise.resolve(executeFunction(data, matchInfo, summary));
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Execution timeout (10s)')), this.executionTimeout);
      });

      const result = await Promise.race([executionPromise, timeoutPromise]);
      const executionTime = Date.now() - startTime;

      // Check if result is an error object
      if (result && typeof result === 'object' && result.error) {
        return {
          success: false,
          error: result.error,
          executionTime
        };
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
      return {
        success: false,
        error: error.message || 'Unknown execution error',
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

