import { MatchData } from '@/types/chat';

export interface ExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  executionTime?: number;
}

/**
 * Safely execute JavaScript code with match data in browser
 * Uses Function constructor with controlled scope (browser-compatible)
 * Universal version - works with any data array, not just matchData
 */
export async function executeCode(code: string, matchData: MatchData | null, dataArray?: any[] | null): Promise<ExecutionResult> {
  // Universal: Accept data array directly or from matchData
  const data = dataArray || matchData?.data || null;
  
  if (!data || !Array.isArray(data) || data.length === 0) {
    return {
      success: false,
      error: 'No data available for code execution. Please ensure data is loaded.'
    };
  }

  const startTime = Date.now();

  try {
    // Validate code doesn't contain dangerous patterns
    const dangerousPatterns = [
      /require\s*\(/,
      /import\s+/,
      /eval\s*\(/,
      /Function\s*\(/,
      /setTimeout\s*\(/,
      /setInterval\s*\(/,
      /XMLHttpRequest/,
      /fetch\s*\(/,
      /process\./,
      /global\./,
      /window\./,
      /document\./,
      /localStorage/,
      /sessionStorage/,
      /indexedDB/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        return {
          success: false,
          error: `Code contains prohibited pattern: ${pattern.source}`,
          executionTime: Date.now() - startTime
        };
      }
    }

    // Create isolated scope with only safe operations
    // Universal: Use provided data array or fallback to matchData
    const matchInfo = matchData?.matchInfo || {} as any;
    const summary = matchData?.summary || {} as any;

    // Try to auto-fix common incomplete code issues
    let fixedCode = code.trim();
    
    // Count unclosed parentheses, brackets, braces
    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;
    const missingParens = openParens - closeParens;
    
    // Check if code ends with incomplete statements (universal patterns)
    const trimmedCode = fixedCode;
    const endsWithIncomplete = trimmedCode.endsWith('&&') || trimmedCode.endsWith('||') || 
                               trimmedCode.endsWith('.') || trimmedCode.endsWith('=>') || 
                               trimmedCode.endsWith('=') || trimmedCode.endsWith(',') ||
                               trimmedCode.endsWith('row.') || trimmedCode.endsWith('a.') ||
                               /const\s+\w+\s*$/.test(trimmedCode); // Incomplete const declaration
    
    // Check for incomplete string literals or includes statements
    // Pattern: ends with .includes(` or .includes(' without closing, or row['sksub'].includes(`
    // Also check for patterns like row['sksub'].includes(` at end of code
    const hasIncompleteIncludes = /\.includes\([`'"]?$/.test(trimmedCode) || 
                                  /\[['"]\w+['"]\]\s*\.includes\([`'"]?$/.test(trimmedCode) ||
                                  /row\[['"]\w+['"]\]\s*\.includes\([`'"]?$/.test(trimmedCode);
    
    if (hasIncompleteIncludes) {
      console.warn('Code has incomplete string literal in includes statement');
      // Universal completion - just add empty string, let the AI fix it or provide generic placeholder
      // Don't assume specific values like 'attack' - that's domain-specific
          fixedCode = code.replace(/\.includes\([`'"]?$/, ".includes('')");
      
      // Also need to close any unclosed parentheses from the filter
      const openParensAfterFix = (fixedCode.match(/\(/g) || []).length;
      const closeParensAfterFix = (fixedCode.match(/\)/g) || []).length;
      const stillMissingParens = openParensAfterFix - closeParensAfterFix;
      if (stillMissingParens > 0 && fixedCode.includes('.filter')) {
        fixedCode = fixedCode + ')'.repeat(stillMissingParens);
        if (!fixedCode.includes('.length') && fixedCode.includes('.filter')) {
          fixedCode += '.length';
        }
      }
    }
    
    // Check for incomplete const declarations (universal - no domain-specific assumptions)
    const incompleteConstMatch = trimmedCode.match(/const\s+(\w+)\s*$/m);
    if (incompleteConstMatch) {
      console.warn('Code has incomplete const declaration:', incompleteConstMatch[1]);
      const varName = incompleteConstMatch[1];
      
      // Try to find a similar pattern above it to complete (universal approach)
      const lines = code.split('\n');
      const incompleteLineIndex = lines.findIndex(l => l.trim().match(/const\s+\w+\s*$/));
      
      if (incompleteLineIndex > 0) {
        // Look for similar filter/map/reduce patterns in previous lines
        for (let i = incompleteLineIndex - 1; i >= 0; i--) {
          const prevLine = lines[i].trim();
          const similarPattern = prevLine.match(/const\s+(\w+)\s*=\s*(.+);/);
          
          if (similarPattern && (prevLine.includes('filter') || prevLine.includes('map') || prevLine.includes('reduce'))) {
            // Found a similar pattern - use it as template (universal)
            const prevVarName = similarPattern[1];
            const prevExpression = similarPattern[2];
            
            // Replace the previous variable name with the new one
            const completion = `const ${varName} = ${prevExpression.replace(new RegExp(`\\b${prevVarName}\\b`, 'g'), varName)};`;
            
            fixedCode = code.replace(
              new RegExp(`const\\s+${varName}\\s*$`, 'm'),
              completion
            );
            break; // Found a match, stop looking
          }
        }
      }
    }
    
    // Universal: Check if code ends with incomplete property access (no domain-specific assumptions)
    // Just detect incomplete property access patterns, don't assume specific field names or values
    if (trimmedCode.endsWith('row.') || trimmedCode.endsWith('a.') || 
        /row\.\w+\s*$/.test(trimmedCode) || /a\.\w+\s*$/.test(trimmedCode)) {
      console.warn('Code ends with incomplete property access');
      // Don't auto-complete with specific values - let the AI fix it or provide generic error
    }
    
    // Universal: Removed volleyball-specific auto-completion - code is now domain-agnostic
    // This code is legacy and disabled - the system uses codeExecutorV2.ts instead
    if (false) { // Disabled - was volleyball-specific, now unused
      console.warn('Code ends with incomplete evaluation_code comparison');
      // Complete to evaluation_code === "#" (for kills)
      if (trimmedCode.endsWith('row.evaluation')) {
        fixedCode = code.replace(/row\.evaluation\s*$/, 'row.evaluation_code === "#"');
      } else if (trimmedCode.endsWith('a.evaluation')) {
        fixedCode = code.replace(/a\.evaluation\s*$/, 'a.evaluation_code === "#"');
      } else if (trimmedCode.endsWith('evaluation')) {
        // Check if it's part of a row or a reference
        if (code.includes('row.evaluation') || code.includes('row =>')) {
          fixedCode = code.replace(/evaluation\s*$/, 'evaluation_code === "#"');
        } else if (code.includes('a.evaluation') || code.includes('a =>')) {
          fixedCode = code.replace(/evaluation\s*$/, 'evaluation_code === "#"');
        } else {
          fixedCode = code.replace(/evaluation\s*$/, 'evaluation_code === "#"');
        }
      }
    }
    
    // Legacy volleyball-specific code - disabled and unused
    if (false && trimmedCode.endsWith('row.team') || trimmedCode.endsWith('a.team')) {
      console.warn('Code ends with incomplete team comparison');
      // Try to extract team name from context
      const teamMatch = code.match(/(?:const|let|var)\s+(ucsd|nau|homeTeam|visitingTeam|team1|team2)\s*=\s*["']([^"']+)["']/i);
      if (teamMatch) {
        const teamName = teamMatch[2];
        // Complete the team comparison
        if (trimmedCode.endsWith('row.team')) {
          fixedCode = code.replace(/row\.team\s*$/, `row.team === "${teamName}"`);
        } else if (trimmedCode.endsWith('a.team')) {
          fixedCode = code.replace(/a\.team\s*$/, `a.team === "${teamName}"`);
        }
      } else {
        // Try to find team name from matchInfo or data context
        // Look for team names in the code
        const teamNameMatch = code.match(/["']([^"']*(?:University|College|State)[^"']*)["']/);
        if (teamNameMatch) {
          const teamName = teamNameMatch[1];
          if (trimmedCode.endsWith('row.team')) {
            fixedCode = code.replace(/row\.team\s*$/, `row.team === "${teamName}"`);
          } else if (trimmedCode.endsWith('a.team')) {
            fixedCode = code.replace(/a\.team\s*$/, `a.team === "${teamName}"`);
          }
        } else {
          // Fallback: use matchInfo if available
          if (trimmedCode.endsWith('row.team')) {
            fixedCode = code.replace(/row\.team\s*$/, 'row.team === matchInfo.home_team');
          } else if (trimmedCode.endsWith('a.team')) {
            fixedCode = code.replace(/a\.team\s*$/, 'a.team === matchInfo.home_team');
          }
        }
      }
    }
    
    if (endsWithIncomplete || missingParens > 0) {
      console.warn('Code appears incomplete - attempting to auto-complete');
      console.log('Missing parentheses:', missingParens);
      console.log('Code ends with:', trimmedCode.substring(Math.max(0, trimmedCode.length - 30)));
      
      // If it's a filter/map/reduce, try to complete it
      if (code.includes('.filter') || code.includes('.map') || code.includes('.reduce')) {
        // Universal: Don't assume specific field names or values
        // Just add missing closing parens if needed
        
        // Add missing closing parens
        if (missingParens > 0) {
          fixedCode = fixedCode + ')'.repeat(missingParens);
        }
        
        // If it's a filter without .length, add it (common for counts)
        if (!fixedCode.includes('.length') && fixedCode.includes('.filter')) {
          fixedCode += '.length';
        }
        
        // Universal: If filter ends with &&, it's incomplete but don't assume specific field names
        // Just note it's incomplete - the validation will catch it
      } else if (missingParens > 0) {
        // Not a filter/map/reduce, but missing parens - just add them
        fixedCode = fixedCode + ')'.repeat(missingParens);
      }
    }
    
    // Enhanced fallback: Try to add return statement if code looks like it should return something
    // This helps with incomplete code from AI
    if (!fixedCode.includes('return') && !fixedCode.includes('console.log')) {
      const lines = fixedCode.split('\n').filter(l => l.trim());
      
      // Check if it's a simple expression or filter/map/reduce
      if (fixedCode.includes('.filter') || fixedCode.includes('.map') || fixedCode.includes('.reduce')) {
        // It's likely a data query - try to add return
      if (lines.length <= 5) {
          fixedCode = `return ${fixedCode.trim()};`;
        } else {
          // Multiple lines - try to return the last expression
          const lastLine = lines[lines.length - 1];
          if (lastLine && !lastLine.includes(';') && !lastLine.includes('return')) {
            // Replace last line with return statement
            const lastLineIndex = fixedCode.lastIndexOf(lastLine);
            fixedCode = fixedCode.substring(0, lastLineIndex) + `return ${lastLine.trim()};`;
          }
        }
      } else if (fixedCode.includes('=') && lines.length <= 3) {
        // Simple variable assignment - wrap in return
        const match = fixedCode.match(/const\s+(\w+)\s*=\s*(.+)/);
        if (match) {
          fixedCode = `return ${match[2].trim()};`;
        } else {
        fixedCode = `return ${fixedCode.trim()};`;
        }
      }
    }
    
    // Final fallback: if code still looks incomplete, try to make it returnable
    if (!fixedCode.includes('return') && !fixedCode.includes(';') && fixedCode.includes('=')) {
      // It's a variable assignment, make it return the value
      const match = fixedCode.match(/const\s+(\w+)\s*=\s*(.+)/);
      if (match) {
        fixedCode = `return ${match[2].trim()};`;
      }
    }
    
    // Use Function constructor to create isolated function
    // This is safer than eval but still allows code execution
    // Wrap in IIFE to avoid scope conflicts with multiple const declarations
    const executeFunction = new Function(
      'data',
      'matchInfo',
      'summary',
      `
      return (function() {
        try {
          ${fixedCode}
        } catch (error) {
          return { error: error.message, stack: error.stack };
        }
      })();
      `
    );

    // Execute with timeout using Promise.race
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const executionPromise = Promise.resolve(executeFunction(data, matchInfo, summary));
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Execution timeout (10s)')), 10000);
    });

    try {
      const result = await Promise.race([executionPromise, timeoutPromise]);
      if (timeoutId) clearTimeout(timeoutId);
      const executionTime = Date.now() - startTime;

      // Check if result is an error object
      if (result && typeof result === 'object' && result.error) {
        return {
          success: false,
          error: result.error,
          executionTime
        };
      }

      return {
        success: true,
        result: result,
        executionTime
      };
    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId);
      const executionTime = Date.now() - startTime;
      return {
        success: false,
        error: error.message || 'Unknown execution error',
        executionTime
      };
    }
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
 * Extract code blocks from AI response that should be executed
 * Looks for patterns like: ```execute, ```query, ```javascript, or ```js
 * Also detects plain ```javascript blocks that contain data queries
 * Handles incomplete blocks (missing closing ```)
 */
export function extractCodeBlocks(text: string): string[] {
  console.log('Extracting code blocks from text, length:', text.length);
  
  // First, try to find explicitly marked code blocks (execute, query, etc.)
  // Handle both complete blocks (with closing ```) and incomplete blocks (end of text)
  // Match from ```execute to either ``` or end of string
  const explicitPattern = /```(?:execute|query|javascript|js|code)\s*\n?([\s\S]*?)(?:```|$)/gi;
  let match;
  const explicitMatches: string[] = [];
  
  while ((match = explicitPattern.exec(text)) !== null) {
    const code = match[1].trim();
    console.log('Found explicit code block, length:', code.length, 'preview:', code.substring(0, 100));
    if (code.length > 10) {
      explicitMatches.push(code);
    }
  }
  
  // Also check for <execute> tags (XML/HTML style)
  const xmlExecutePattern = /<execute>([\s\S]*?)<\/execute>/gi;
  while ((match = xmlExecutePattern.exec(text)) !== null) {
    const code = match[1].trim();
    console.log('Found XML execute tag, length:', code.length, 'preview:', code.substring(0, 100));
    if (code.length > 10) {
      explicitMatches.push(code);
    }
  }
  
  // Check for incomplete <execute> tags (missing closing tag)
  if (explicitMatches.length === 0) {
    const incompleteXmlPattern = /<execute>([\s\S]*)$/i;
    const incompleteXmlMatch = incompleteXmlPattern.exec(text);
    if (incompleteXmlMatch) {
      const code = incompleteXmlMatch[1].trim();
      console.log('Found incomplete XML execute tag, length:', code.length, 'preview:', code.substring(0, 100));
      if (code.length > 10) {
        explicitMatches.push(code);
      }
    }
  }
  
  if (explicitMatches.length > 0) {
    // Filter to only include code that references data/matchInfo/summary
    // Also check if code looks complete (has balanced parentheses, brackets, braces)
    const validMatches = explicitMatches.filter(code => {
      const hasDataRef = code.includes('data') || code.includes('matchInfo') || code.includes('summary') || code.includes('filter') || code.includes('map');
      if (!hasDataRef) return false;
      
      // Check for basic syntax completeness
      const openParens = (code.match(/\(/g) || []).length;
      const closeParens = (code.match(/\)/g) || []).length;
      const openBraces = (code.match(/\{/g) || []).length;
      const closeBraces = (code.match(/\}/g) || []).length;
      const openBrackets = (code.match(/\[/g) || []).length;
      const closeBrackets = (code.match(/\]/g) || []).length;
      
      // Allow some imbalance (code might be complete but missing some closing)
      // But flag if it's clearly incomplete (missing many closing chars)
      const parenBalance = openParens - closeParens;
      const braceBalance = openBraces - closeBraces;
      const bracketBalance = openBrackets - closeBrackets;
      
      // If missing more than 2 closing characters, likely incomplete
      // BUT still return it - our auto-completion will fix it
      if (parenBalance > 2 || braceBalance > 2 || bracketBalance > 2) {
        console.warn('Code block appears incomplete - unbalanced brackets/parens/braces, but will attempt auto-completion');
      }
      
      return true;
    });
    
    if (validMatches.length > 0) {
      return validMatches;
    }
    
    // If no valid matches but we have explicit matches, return them anyway
    // (the execution will fail with a clear error, or auto-completion will fix it)
    return explicitMatches.filter(code => 
      code.includes('data') || code.includes('matchInfo') || code.includes('summary') || code.includes('filter') || code.includes('map')
    );
  }
  
  // If no explicit blocks found, look for javascript/js blocks that contain data queries
  const jsPattern = /```(?:javascript|js|code)\s*\n?([\s\S]*?)(?:```|$)/gi;
  const jsMatches: string[] = [];
  
  while ((match = jsPattern.exec(text)) !== null) {
    const code = match[1].trim();
    console.log('Found js code block, length:', code.length, 'preview:', code.substring(0, 100));
    if (code.length > 10) {
      jsMatches.push(code);
    }
  }
  
  // Only return if the code looks like a data query (contains 'data.filter', 'data.map', etc.)
  const dataQueryPattern = /data\.(filter|map|reduce|find|some|every|length)/i;
  return jsMatches.filter(code => dataQueryPattern.test(code));
}

/**
 * Check if text contains code execution requests
 */
export function hasCodeExecutionRequest(text: string): boolean {
  // Check for explicit execution markers (execute, query) with ``` format
  if (/```(?:execute|query)/i.test(text)) {
    return true;
  }
  
  // Check for <execute> tags (XML/HTML style)
  if (/<execute>/i.test(text)) {
    return true;
  }
  
  // Check for javascript/js blocks that contain data queries (AI writing code to query data)
  if (/```(?:javascript|js|code)/i.test(text)) {
    const dataQueryPattern = /data\.(filter|map|reduce|find|some|every|length)/i;
    if (dataQueryPattern.test(text)) {
      return true;
    }
  }
  
  // Also check <execute> tags for data query patterns
  const xmlExecuteMatch = text.match(/<execute>([\s\S]*?)<\/execute>/i);
  if (xmlExecuteMatch) {
    const code = xmlExecuteMatch[1];
    const dataQueryPattern = /data\.(filter|map|reduce|find|some|every|length)/i;
    if (dataQueryPattern.test(code)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Format execution result for AI consumption
 */
export function formatExecutionResult(result: ExecutionResult): string {
  if (result.success) {
    const resultStr = typeof result.result === 'object' 
      ? JSON.stringify(result.result, null, 2)
      : String(result.result);
    
    return `**Code Execution Result** (${result.executionTime}ms):\n\`\`\`json\n${resultStr}\n\`\`\``;
  } else {
    return `**Code Execution Error** (${result.executionTime}ms):\n\`\`\`\n${result.error}\n\`\`\``;
  }
}

