import { Message } from "@/types/chat";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { cn } from "@/lib/utils";
import { AVAILABLE_MODELS } from "@/lib/chatApi";
import React, { memo, useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import "katex/dist/katex.min.css";
import { ChartRenderer } from "./ChartRenderer";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { ChevronDown, ChevronRight, Code2, BarChart3 } from "lucide-react";
// Removed framer-motion to prevent glitching during scroll virtualization
// import { motion, AnimatePresence } from "framer-motion";

interface ChatMessageProps {
  message: Message;
  sidebarOpen?: boolean;
}

// Preprocess content to fix inline code with newlines
// NOTE: Creating new regex instances each time to avoid state mutation issues
function preprocessMath(content: string): string {
  try {
    // First, normalize ''' to ``` (some AI models use single quotes instead of backticks)
    content = content.replace(/'''/g, '```');
    
    // Protect code blocks from being processed
    const codeBlocks: { placeholder: string; content: string }[] = [];
    let blockIndex = 0;
    
    // Store and replace code blocks with placeholders
    content = content.replace(/```[a-zA-Z]*\n[\s\S]*?```|```[\s\S]*?```/g, (match) => {
      const placeholder = `__CODE_BLOCK_${blockIndex}__`;
      codeBlocks.push({ placeholder, content: match });
      blockIndex++;
      return placeholder;
    });
    
    // Fix inline code that has newlines inside - markdown doesn't support this
    // Convert `text\nmore text` to `text more text` (single line)
    // IMPORTANT: Only process single backticks (not part of triple backticks)
    content = content.replace(/(?<!`)`(?!`)([^`]+?)(?<!`)`(?!`)/g, (match, inner) => {
      // If the content inside backticks has newlines, replace them with spaces
      if (inner.includes('\n')) {
        return `\`${inner.replace(/\n+/g, ' ').trim()}\``;
      }
      return match;
    });
    
    // Restore code blocks
    codeBlocks.forEach(({ placeholder, content: blockContent }) => {
      content = content.replace(placeholder, blockContent);
    });
    
    return content;
  } catch (error) {
    console.error('Error in preprocessMath:', error);
    // Return original content if preprocessing fails
    return content;
  }
}

// Enhanced AI message with spatial layout for code/results
function EnhancedAIMessage({ message, modelName, sidebarOpen }: { message: Message; modelName: string | null; sidebarOpen?: boolean }) {
  const [expandedCode, setExpandedCode] = useState<Set<number>>(new Set());
  const [collapsedResults, setCollapsedResults] = useState<Set<number>>(new Set());
  const [collapsedFailed, setCollapsedFailed] = useState<Set<number>>(new Set());
  
  // Extract code blocks and execution results
  const parsedContent = useMemo(() => {
    const content = message.content || '';
    const parts: Array<{ type: 'text' | 'code' | 'result' | 'chart' | 'failed' | 'skipped'; content: string; index: number; error?: string; skippedBlocks?: Array<{ content: string; index: number }> }> = [];
    
    // Match ONLY execute code blocks (the ones that get executed and have results)
    const codePattern = /```execute\s*\n([\s\S]*?)```/gi;
    // Match execution results - handle variations: timing info, optional json marker, spacing
    // Pattern matches: **Code Execution Result** (24ms):\n```json\n{...}\n``` or variations
    // Made bold markers (**) optional as a pair to handle cases where markdown is stripped after reload
    const resultPattern = /(?:\*\*)?Code Execution Result(?:\*\*)?(?:\s*\([^)]+\))?\s*:?\s*\n?\s*```(?:json)?\s*([\s\S]*?)\s*```/gi;
    // Match execution errors (with or without timing info)
    // Made bold markers (**) optional as a pair to handle cases where markdown is stripped after reload
    const errorPattern = /(?:\*\*)?Code Execution Error(?:\*\*)?(?:\s*\([^)]+\))?\s*:?\s*\n?\s*```\s*([\s\S]*?)\s*```|(?:\*\*)?Execution Error:(?:\*\*)?\s*([\s\S]*?)(?:\n{2,}|$)/gi;
    // Match cancelled executions
    const cancelledPattern = /\*\[Code execution cancelled by user\]\*/g;
    
    let lastIndex = 0;
    let codeIndex = 0;
    
    // First pass: identify all code blocks
    const codeMatches: Array<{ start: number; end: number; content: string; index: number }> = [];
    const allCodeBlocks: Array<{ content: string; index: number }> = []; // Store ALL code blocks for "Code" button lookup
    let match;
    while ((match = codePattern.exec(content)) !== null) {
      const codeBlock = {
        start: match.index,
        end: match.index + match[0].length,
        content: match[1],
        index: codeIndex
      };
      codeMatches.push(codeBlock);
      allCodeBlocks.push({ content: match[1], index: codeIndex }); // Keep reference to all code
      codeIndex++;
    }
    
    // Second pass: identify execution results and errors
    const resultMatches: Array<{ start: number; end: number; content: string; json: any }> = [];
    const errorMatches: Array<{ start: number; end: number; error: string }> = [];
    const cancelledMatches: Array<{ start: number; end: number }> = [];
    codePattern.lastIndex = 0;
    
    // Find execution errors - handle both formats
    while ((match = errorPattern.exec(content)) !== null) {
      // errorPattern can match two groups - use first non-undefined one
      const errorText = match[1] || match[2] || '';
      errorMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        error: errorText
      });
    }
    
    // Find cancelled executions
    while ((match = cancelledPattern.exec(content)) !== null) {
      cancelledMatches.push({
        start: match.index,
        end: match.index + match[0].length
      });
    }
    while ((match = resultPattern.exec(content)) !== null) {
      try {
        const json = JSON.parse(match[1]);
        resultMatches.push({
          start: match.index,
          end: match.index + match[0].length,
          content: match[1],
          json
        });
      } catch (e) {
        // Invalid JSON, skip
      }
    }
    
    // FALLBACK: If no results found in content but message has executionResults property,
    // use that instead. This handles cases where regex fails after reload due to formatting variations.
    if (message.executionResults && resultMatches.length === 0 && codeMatches.length > 0) {
      try {
        const resultsData = message.executionResults;
        let resultsArray = Array.isArray(resultsData) ? resultsData : [resultsData];
        
        // If it's a string, try to parse it
        if (typeof resultsData === 'string') {
          try {
            const parsed = JSON.parse(resultsData);
            resultsArray = Array.isArray(parsed) ? parsed : [parsed];
          } catch {
            resultsArray = [resultsData];
          }
        }
        
        // Create result matches for each stored result
        resultsArray.forEach((result, idx) => {
          const correspondingCodeBlock = codeMatches[idx] || codeMatches[codeMatches.length - 1];
          resultMatches.push({
            start: correspondingCodeBlock.end + 1 + idx,
            end: correspondingCodeBlock.end + 2 + idx,
            content: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            json: typeof result === 'string' ? (function() { try { return JSON.parse(result); } catch { return result; } })() : result
          });
        });
      } catch (e) {
        console.warn('Failed to parse stored executionResults:', e);
      }
    }
    
    // Include code, results, AND errors in allMatches
    // Errors need to be included so we can skip their text (avoid showing duplicate error messages)
    // But errors won't be rendered as separate parts - they're shown as failed code blocks
    const allMatches = [
      ...codeMatches.map(m => ({ ...m, type: 'code' as const })),
      ...resultMatches.map(m => ({ ...m, type: 'result' as const })),
      ...errorMatches.map(m => ({ ...m, type: 'error' as const }))
    ].sort((a, b) => a.start - b.start);
    
    // Track which code blocks have results, errors, or were skipped
    const codeBlocksWithResults = new Set<number>();
    const codeBlocksWithErrors = new Map<number, string>();
    const codeBlocksSkipped = new Map<number, string>(); // Track skipped blocks (orange)
    
    // Mark code blocks with execution results
    // Helper: find nearest preceding code block index for a given position
    const findNearestCodeBefore = (pos: number) => {
      let idx = -1;
      for (let i = 0; i < codeMatches.length; i++) {
        if (codeMatches[i].end <= pos) idx = i;
        else break;
      }
      return idx;
    };
    // SIMPLE SEQUENTIAL MATCHING: Code blocks execute in order, results appear in same order
    // Build combined list of all results/errors in the order they appear
    const allResultsAndErrors = [
      ...resultMatches.map((r, i) => ({
        type: 'result' as const,
        index: i,
        position: r.start,
        json: r.json,
        content: r.content
      })),
      ...errorMatches.map((e, i) => ({
        type: 'error' as const,
        index: i,
        position: e.start,
        error: e.error
      }))
    ].sort((a, b) => a.position - b.position);

    // Match each result/error to code blocks sequentially
    let codeBlockIdx = 0;
    allResultsAndErrors.forEach((item) => {
      // Skip if we've run out of code blocks
      if (codeBlockIdx >= codeMatches.length) return;

      // Mark this code block as having a result
      codeBlocksWithResults.add(codeBlockIdx);

      if (item.type === 'result') {
        // Check if result indicates failure (JSON with success: false)
        if (item.json && item.json.success === false) {
          codeBlocksWithErrors.set(codeBlockIdx, item.json.error || 'Execution failed');
        }
      } else {
        // Error message
        if (item.error.startsWith('Skipped:')) {
          codeBlocksSkipped.set(codeBlockIdx, item.error);
        } else {
          codeBlocksWithErrors.set(codeBlockIdx, item.error);
        }
      }

      codeBlockIdx++;
    });
    
    // Check if execution was cancelled
    const hasCancelled = cancelledMatches.length > 0;
    
    // Build parts array
    allMatches.forEach((match, idx) => {
      // Add text before this match
      if (match.start > lastIndex) {
        parts.push({
          type: 'text',
          content: content.substring(lastIndex, match.start),
          index: idx
        });
      }
      
      // Add this match
      if (match.type === 'code') {
        // Check if this code block has an error or was skipped
        const hasError = codeBlocksWithErrors.has(match.index);
        const isSkipped = codeBlocksSkipped.has(match.index);
        const hasResult = codeBlocksWithResults.has(match.index);
        
        if (hasError) {
          // Show as failed execution box (RED)
          parts.push({
            type: 'failed',
            content: match.content,
            index: match.index,
            error: codeBlocksWithErrors.get(match.index) || 'Execution failed'
          });
          lastIndex = match.end; // Skip this code block in text parsing
        } else if (isSkipped) {
          // Show as skipped execution box (ORANGE) - will be grouped later
          parts.push({
            type: 'skipped',
            content: match.content,
            index: match.index,
            error: codeBlocksSkipped.get(match.index) || 'Skipped'
          });
          lastIndex = match.end; // Skip this code block in text parsing
        } else if (!hasResult) {
          // Only add code blocks that DON'T have results yet (still executing)
          parts.push({
            type: 'code',
            content: match.content,
            index: match.index
          });
          lastIndex = match.end; // Skip this code block in text parsing
        } else {
          // Has result and no error - skip the code block entirely (shown via Code button)
          lastIndex = match.end; // Skip this code block in text parsing
        }
      } else if (match.type === 'error') {
        // Skip error text - errors are already shown as failed code blocks inline
        // Don't render errors as separate parts at the end
        lastIndex = match.end;
      } else if (match.type === 'result') {
        // CRITICAL: Only show results for SUCCESSFUL executions
        // Failed executions are already shown as red boxes when processing code matches
        // Don't duplicate them here
        const resultMatch = resultMatches.find(r => r.start === match.start);
        if (resultMatch) {
          // Find which code block this result belongs to
          let correspondingCodeIdx = -1;
          for (let i = codeMatches.length - 1; i >= 0; i--) {
            if (codeMatches[i].end < match.start) {
              correspondingCodeIdx = i;
              break;
            }
          }

          // Only show result if code block doesn't have error or skip marker
          // If it has error, it's already shown as red/orange box
          const hasError = correspondingCodeIdx >= 0 && codeBlocksWithErrors.has(correspondingCodeIdx);
          const isSkipped = correspondingCodeIdx >= 0 && codeBlocksSkipped.has(correspondingCodeIdx);

          if (!hasError && !isSkipped) {
            // Successful execution - show result
            parts.push({
              type: 'result',
              content: match.content,
              index: correspondingCodeIdx >= 0 ? correspondingCodeIdx : idx
            });

            // Check if there's a chart in the result (check nested objects too)
            const hasChart = (obj: any): boolean => {
              if (!obj || typeof obj !== 'object') return false;
              if (obj.echarts_chart || obj.echartsChart || obj.plotly_chart || obj.plotlyChart) return true;
              // Check nested objects
              for (const key in obj) {
                if (obj[key] && typeof obj[key] === 'object') {
                  if (hasChart(obj[key])) return true;
                }
              }
              return false;
            };

            if (hasChart(match.json)) {
              parts.push({
                type: 'chart',
                content: JSON.stringify(match.json),
                index: idx
              });
            }
          }
          // If has error or skipped, skip this result entirely - already shown as red/orange box
        }
        lastIndex = match.end; // Skip this result in text parsing
      }
      
      // Note: lastIndex is now set inside each match type handler
    });
    
    // Add remaining text
    if (lastIndex < content.length) {
      parts.push({
        type: 'text',
        content: content.substring(lastIndex),
        index: parts.length
      });
    }
    
    return { parts, allCodeBlocks };
  }, [message.content]);
  
  const parsedParts = parsedContent.parts;
  const allCodeBlocks = parsedContent.allCodeBlocks;
  
  const hasCode = parsedParts.some(p => p.type === 'code');
  const hasResults = parsedParts.some(p => p.type === 'result');
  
  // Collect all results for pill display
  const resultParts = parsedParts.filter(p => p.type === 'result');
  
  // State for expanded result in modal
  const [expandedResultIdx, setExpandedResultIdx] = useState<number | null>(null);
  
  // Initialize collapsed results - collapse all execution results by default
  useEffect(() => {
    if (hasResults) {
      const resultIndices = parsedParts
        .map((p, idx) => p.type === 'result' ? idx : -1)
        .filter(idx => idx !== -1);
      
      // Add new result indices to collapsed set (merge, don't replace)
      setCollapsedResults(prev => {
        const newSet = new Set(prev);
        let changed = false;
        for (const idx of resultIndices) {
          if (!newSet.has(idx)) {
            newSet.add(idx);
            changed = true;
          }
        }
        return changed ? newSet : prev;
      });
    }
  }, [parsedParts.length, hasResults]);
  
  const toggleCode = (index: number) => {
    const newExpanded = new Set(expandedCode);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedCode(newExpanded);
  };

  const toggleResult = (index: number) => {
    const newCollapsed = new Set(collapsedResults);
    if (newCollapsed.has(index)) {
      newCollapsed.delete(index);
    } else {
      newCollapsed.add(index);
    }
    setCollapsedResults(newCollapsed);
  };
  
  // If no code/results, use simple layout
  if (!hasCode && !hasResults) {
    return (
      <div className="rounded-lg p-4 prose prose-invert max-w-none bg-chat-assistant">
        <ReactMarkdown
          remarkPlugins={[remarkMath, remarkGfm]}
          rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
          components={markdownComponents}
        >
          {preprocessMath(message.content || '')}
        </ReactMarkdown>
        {modelName && (
          <div className="mt-2 text-xs text-muted-foreground/70">
            Model: {modelName}
          </div>
        )}
      </div>
    );
  }
  
  // Enhanced layout - code buttons on execution results
  return (
    <div className="relative">
      {/* Main content area - full width, no compromise */}
      <div className="rounded-lg p-4 bg-chat-assistant w-full">
        <div className="prose prose-invert max-w-none">
          {parsedParts.map((part, idx) => {
            if (part.type === 'text') {
              return (
                <div key={`text-${idx}`} className="leading-relaxed">
                  <ReactMarkdown
                    remarkPlugins={[remarkMath, remarkGfm]}
                    rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
                    components={markdownComponents}
                  >
                    {preprocessMath(part.content)}
                  </ReactMarkdown>
                </div>
              );
            } else if (part.type === 'result') {
              // Keep results inline in chat
              try {
                const json = JSON.parse(part.content);
                const preview = JSON.stringify(json, null, 2);
                const isCollapsed = collapsedResults.has(idx);
                
                // Find the corresponding code block
                const resultsBefore = parsedParts.slice(0, idx).filter(p => p.type === 'result').length;
                const correspondingCode = allCodeBlocks[resultsBefore];
                const correspondingCodeIndex = correspondingCode?.index;
                
                const toggleResult = () => {
                  setCollapsedResults(prev => {
                    const newSet = new Set(prev);
                    if (newSet.has(idx)) {
                      newSet.delete(idx);
                    } else {
                      newSet.add(idx);
                    }
                    return newSet;
                  });
                };
                
                const isCodeExpanded = correspondingCodeIndex !== undefined && expandedCode.has(correspondingCodeIndex);
                
                return (
                  <div 
                    key={`result-${idx}`} 
                    className={cn(
                      "my-1 rounded border border-primary/30 shadow-sm transition-all",
                      isCollapsed ? "p-1.5 bg-primary/5" : "p-3 bg-primary/10"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div 
                        className="flex items-center gap-2 cursor-pointer flex-1"
                        onClick={toggleResult}
                      >
                        <span className="w-1 h-1 bg-primary rounded-full"></span>
                        <span className="text-xs text-primary font-medium">Result {resultsBefore + 1}</span>
                        <svg 
                          className={cn("w-3 h-3 text-primary transition-transform", !isCollapsed && "rotate-180")} 
                          fill="none" 
                          stroke="currentColor" 
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                      {correspondingCodeIndex !== undefined && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCode(correspondingCodeIndex);
                          }}
                          className="flex items-center gap-1 px-2 py-0.5 bg-primary/20 hover:bg-primary/30 rounded border border-primary/40 transition-all text-xs"
                          title="View executed code"
                        >
                          <Code2 className="w-3 h-3 text-primary" />
                          <span className="text-primary font-medium">Code</span>
                        </button>
                      )}
                    </div>
                    {isCodeExpanded && createPortal(
                      <>
                        <div 
                          className="fixed inset-0 bg-black/50 z-50" 
                          onClick={() => toggleCode(correspondingCodeIndex)}
                        />
                        <div 
                          className="fixed top-0 bottom-0 right-0 z-50 flex items-center justify-center p-4 pointer-events-none"
                          style={{
                            left: sidebarOpen ? '256px' : '0'
                          }}
                        >
                          <div 
                            className="bg-chat-bg rounded-xl shadow-2xl w-full max-w-3xl max-h-[70vh] overflow-hidden border border-border/50 pointer-events-auto"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Code2 className="w-4 h-4 text-primary" />
                                <span className="text-sm font-medium text-primary">Code</span>
                              </div>
                              <button 
                                onClick={() => toggleCode(correspondingCodeIndex)} 
                                className="text-muted-foreground hover:text-white transition-colors p-1 hover:bg-white/10 rounded"
                              >
                                ✕
                              </button>
                            </div>
                            <pre className="p-4 text-sm overflow-auto font-mono bg-black/20 max-h-[calc(70vh-3rem)] mac-code-render">
                              <code>{correspondingCode?.content}</code>
                            </pre>
                          </div>
                        </div>
                      </>,
                      document.body
                    )}
                    {!isCollapsed && (
                      <pre className="mt-2 text-xs text-muted-foreground overflow-auto max-h-64 bg-background/50 p-2 rounded font-mono">
                        {preview}
                      </pre>
                    )}
                  </div>
                );
              } catch (e) {
                return null;
              }
            } else if (part.type === 'chart') {
            return (
              <ErrorBoundary
                key={`chart-${idx}`}
                fallback={
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg my-4">
                    <h3 className="text-red-500 font-semibold mb-2">Chart rendering error</h3>
                  </div>
                }
              >
                <ChartRenderer content="" executionResults={JSON.parse(part.content)} />
              </ErrorBoundary>
            );
          } else if (part.type === 'code') {
            // Do not render a trailing "awaiting execution" block in the assistant message.
            // The approval dialog handles execution; showing this here is redundant and confusing.
            return null;
          } else if (part.type === 'failed') {
            // Show failed executions in red box (collapsed by default)
            const isCollapsed = !collapsedFailed.has(part.index);
            
            return (
              <div key={`failed-${idx}`} className="my-4">
                <div className="bg-red-500/10 rounded-lg border border-red-500/30">
                  <button
                    onClick={() => {
                      const newCollapsed = new Set(collapsedFailed);
                      if (isCollapsed) {
                        newCollapsed.add(part.index);
                      } else {
                        newCollapsed.delete(part.index);
                      }
                      setCollapsedFailed(newCollapsed);
                    }}
                    className="w-full flex items-center justify-between p-3 hover:bg-red-500/5 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-xs text-red-400">
                      <Code2 className="w-4 h-4" />
                      <span className="font-medium">Failed Execution</span>
                      {part.error && (
                        <span className="text-red-300">- {part.error}</span>
                      )}
                    </div>
                    <span className="text-xs text-red-400">
                      {isCollapsed ? 'Show' : 'Hide'}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="px-3 pb-3">
                      <pre className="text-sm overflow-x-auto font-mono mac-code-render bg-black/20 p-3 rounded">
                        <code>{part.content}</code>
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            );
          } else if (part.type === 'skipped') {
            // Group all skipped blocks into one orange box
            // Only render the first skipped block - it will contain all skipped blocks
            const skippedBlocks = parsedParts.filter(p => p.type === 'skipped');
            const isFirstSkipped = skippedBlocks[0] === part;
            
            if (!isFirstSkipped) {
              return null; // Skip rendering for non-first skipped blocks
            }
            
            const isCollapsed = !collapsedFailed.has(part.index);
            
            return (
              <div key={`skipped-${idx}`} className="my-4">
                <div className="bg-orange-500/10 rounded-lg border border-orange-500/30">
                  <button
                    onClick={() => {
                      const newCollapsed = new Set(collapsedFailed);
                      if (isCollapsed) {
                        newCollapsed.add(part.index);
                      } else {
                        newCollapsed.delete(part.index);
                      }
                      setCollapsedFailed(newCollapsed);
                    }}
                    className="w-full flex items-center justify-between p-3 hover:bg-orange-500/5 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-xs text-orange-400">
                      <Code2 className="w-4 h-4" />
                      <span className="font-medium">Didn't Execute</span>
                      <span className="text-orange-300">
                        ({skippedBlocks.length} block{skippedBlocks.length !== 1 ? 's' : ''})
                      </span>
                    </div>
                    <span className="text-xs text-orange-400">
                      {isCollapsed ? 'Show' : 'Hide'}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="px-3 pb-3 space-y-3">
                      {skippedBlocks.map((block, blockIdx) => (
                        <div key={blockIdx} className="bg-black/20 p-3 rounded">
                          <div className="text-xs text-orange-400 mb-2 font-medium">
                            Block {block.index + 1}:
                          </div>
                          <pre className="text-sm overflow-x-auto font-mono mac-code-render">
                            <code>{block.content}</code>
                          </pre>
                          {block.error && (
                            <div className="mt-2 text-xs text-orange-300">
                              {block.error}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          }
          return null;
        })}
        </div>
        {modelName && (
          <div className="mt-2 text-xs text-muted-foreground/70">
            Model: {modelName}
          </div>
        )}
      </div>
    </div>
  );
}

const ChatMessage = memo(({ message, sidebarOpen }: ChatMessageProps) => {
  const isUser = message.role === "user";
  
  // Don't render empty assistant messages (they're being streamed)
  if (!isUser && !message.content) {
    return null;
  }
  
  // Get model display name
  const getModelName = (modelId?: string) => {
    if (!modelId) return null;
    if (modelId === "gpt-image-1") return "Image Generator";
    const model = AVAILABLE_MODELS.find(m => m.id === modelId);
    return model ? model.name : modelId;
  };
  
  const modelName = getModelName(message.model);

  // For user messages, keep simple layout
  if (isUser) {
    return (
      <div className="flex gap-3 flex-row-reverse">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 bg-chat-user text-white">
          U
        </div>
        <div className="flex-1 rounded-lg p-4 prose prose-invert max-w-none overflow-hidden bg-chat-user text-white">
          {message.images && message.images.length > 0 && (
            <div className="flex gap-2 mb-3 flex-wrap">
              {message.images.map((img, idx) => (
                <img
                  key={idx}
                  src={img}
                  alt="Attached"
                  className="max-w-[240px] max-h-[240px] object-cover rounded-lg border border-border"
                />
              ))}
            </div>
          )}
          <ReactMarkdown
            remarkPlugins={[remarkMath, remarkGfm]}
            rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
            components={markdownComponents}
          >
            {preprocessMath(message.content || '')}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  // For AI messages, use enhanced spatial layout
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 bg-chat-assistant-avatar text-white">
        AI
      </div>
      <div className="flex-1 overflow-hidden">
        <EnhancedAIMessage message={message} modelName={modelName} sidebarOpen={sidebarOpen} />
      </div>
    </div>
  );
});


// Extract markdown components to reuse
const markdownComponents = {
  p: ({ children }: any) => <p className="mb-4 last:mb-0 leading-relaxed text-foreground/90">{children}</p>,
  ul: ({ children }: any) => <ul className="list-disc pl-6 mb-4 space-y-2">{children}</ul>,
  ol: ({ children }: any) => <ol className="list-decimal pl-6 mb-4 space-y-2">{children}</ol>,
  li: ({ children }: any) => <li className="leading-relaxed text-foreground/90">{children}</li>,
  h1: ({ children }: any) => <h1 className="text-2xl font-bold mb-4 mt-6 text-foreground border-b border-border/30 pb-2">{children}</h1>,
  h2: ({ children }: any) => <h2 className="text-xl font-bold mb-3 mt-5 text-foreground">{children}</h2>,
  h3: ({ children }: any) => <h3 className="text-lg font-semibold mb-2 mt-4 text-foreground/95">{children}</h3>,
  table: ({ children }: any) => (
    <div className="overflow-x-auto my-4 rounded-lg border border-border/50 shadow-lg">
      <table className="min-w-full border-collapse">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: any) => (
    <thead className="bg-black/40 border-b-2 border-border/70">{children}</thead>
  ),
  tbody: ({ children }: any) => (
    <tbody className="bg-black/10">{children}</tbody>
  ),
  tr: ({ children }: any) => (
    <tr className="border-b border-border/20 hover:bg-black/20 transition-colors duration-150">{children}</tr>
  ),
  th: ({ children }: any) => (
    <th className="px-6 py-3 text-left font-semibold text-sm uppercase tracking-wider text-foreground/90">
      {children}
    </th>
  ),
  td: ({ children }: any) => (
    <td className="px-6 py-4 text-sm text-foreground/80">
      {children}
    </td>
  ),
  pre: ({ children }: any) => (
    <pre className="bg-black/50 p-4 rounded-lg text-sm my-4 overflow-x-auto block w-full font-mono border border-border/40 shadow-md mac-code-render">
      {children}
    </pre>
  ),
  code: ({ children, className, ...props }: any) => {
    // Check if this is a code block by looking for language- prefix or checking if children contains newlines
    const hasLanguageClass = className && className.startsWith('language-');
    const childString = typeof children === 'string' ? children : String(children);
    const hasMultipleLines = childString.includes('\n');

    // It's a code block if it has a language class OR if it contains multiple lines
    const isCodeBlock = hasLanguageClass || hasMultipleLines;

    if (!isCodeBlock) {
      // Inline code - single line, no language class
      return (
        <code
          className="bg-gray-700/70 px-2 py-0.5 rounded text-sm font-mono text-primary-foreground"
          {...props}
        >
          {children}
        </code>
      );
    }

    // Code block - has language class or multiple lines
    return <code className="font-mono text-sm text-foreground/95" {...props}>{children}</code>;
  },
  a: ({ children, href }: any) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 hover:text-blue-300 underline"
    >
      {children}
    </a>
  ),
  strong: ({ children }: any) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }: any) => (
    <em className="italic text-foreground/90">{children}</em>
  ),
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-4 border-primary/50 bg-primary/5 pl-4 pr-4 py-2 my-4 italic text-foreground/80 rounded-r">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-border/30" />,
  img: ({ src, alt }: any) => (
    <img
      src={src}
      alt={alt}
      className="max-w-full h-auto rounded-lg my-2"
    />
  ),
};

ChatMessage.displayName = "ChatMessage";

export default ChatMessage;

