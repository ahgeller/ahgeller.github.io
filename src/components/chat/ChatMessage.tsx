import { Message } from "@/types/chat";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { cn } from "@/lib/utils";
import { AVAILABLE_MODELS } from "@/lib/chatApi";
import { memo } from "react";
import "katex/dist/katex.min.css";
import { ChartRenderer } from "./ChartRenderer";

interface ChatMessageProps {
  message: Message;
}

// Simple preprocessor to wrap unwrapped LaTeX block environments and math in parentheses
function preprocessMath(content: string): string {
  // Always process to protect tables, even if no math is present
  
  let processed = content;
  const placeholders: string[] = [];
  
  // Protect code blocks first
  processed = processed.replace(/```[\s\S]*?```/g, (match) => {
    const id = `__CODE_${placeholders.length}__`;
    placeholders.push(match);
    return id;
  });
  
  processed = processed.replace(/`[^`]+`/g, (match) => {
    const id = `__CODE_${placeholders.length}__`;
    placeholders.push(match);
    return id;
  });
  
  // Protect markdown tables (lines starting with |)
  processed = processed.replace(/^(\|.+\|(?:\r?\n\|[:\-| ]+\|)?(?:\r?\n\|.+\|)*)/gm, (match) => {
    const id = `__TABLE_${placeholders.length}__`;
    placeholders.push(match);
    return id;
  });
  
  // Convert LaTeX math delimiters to KaTeX format
  // Convert \( ... \) to $ ... $ (non-greedy match to handle multiple instances)
  processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, (match, content) => `$${content}$`);
  
  // Convert \[ ... \] to $$ ... $$
  processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, (match, content) => `$$${content}$$`);
  
  // Protect already-wrapped math
  processed = processed.replace(/\$\$[\s\S]*?\$\$/g, (match) => {
    const id = `__MATH_${placeholders.length}__`;
    placeholders.push(match);
    return id;
  });
  
  processed = processed.replace(/\$[^$\n]+\$/g, (match) => {
    const id = `__MATH_${placeholders.length}__`;
    placeholders.push(match);
    return id;
  });
  
  // Only wrap \begin{...}...\end{...} blocks that aren't already wrapped
  // This is the safest pattern - complete LaTeX environments
  processed = processed.replace(/\\begin\{([^}]+)\}[\s\S]*?\\end\{\1\}/g, (match) => {
    if (match.includes('__MATH_') || match.includes('__CODE_')) {
      return match;
    }
    return `$$${match}$$`;
  });
  
  // Wrap math expressions in parentheses that contain LaTeX commands or math operators
  // Pattern: ( expression ) where expression contains \command, subscripts, or math operators
  // Be very careful to only match actual math, not regular text in parentheses
  processed = processed.replace(/\(([^)]*)\)/g, (match, inner) => {
    // Skip if already protected or contains $
    if (inner.includes('__MATH_') || inner.includes('__CODE_') || inner.includes('$')) {
      return match;
    }
    
    // Skip if it contains % without newline (LaTeX comment issue)
    if (inner.includes('%') && !inner.includes('\n')) {
      return match;
    }
    
    // Check if it contains math indicators
    const hasLaTeX = /\\[a-zA-Z]+/.test(inner);
    const hasSubscript = /[a-zA-Z]_[0-9]/.test(inner);
    const hasSuperscript = /[a-zA-Z]\^[0-9]/.test(inner);
    const hasMathOperators = /[+\-*/=<>≠·]/.test(inner);
    const hasMathSymbols = /[α-ωΑ-Ωπσλμ]/i.test(inner) || inner.includes('⟨') || inner.includes('⟩');
    
    // Check for numeric expressions with operators (like "1 - 4 = -3")
    const hasNumericMath = /\d+\s*[+\-*/=<>≠]\s*\d+/.test(inner);
    
    // Only wrap if it clearly contains math
    // Must have at least one of: LaTeX, subscripts, superscripts, or numeric math expressions
    if (hasLaTeX || hasSubscript || hasSuperscript || hasMathSymbols || hasNumericMath) {
      return `($${inner.trim()}$)`;
    }
    return match;
  });
  
  // Restore protected content
  placeholders.forEach((placeholder, i) => {
    processed = processed.replace(`__MATH_${i}__`, placeholder);
    processed = processed.replace(`__CODE_${i}__`, placeholder);
    processed = processed.replace(`__TABLE_${i}__`, placeholder);
  });
  
  return processed;
}

const ChatMessage = memo(({ message }: ChatMessageProps) => {
  const isUser = message.role === "user";
  
  // Get model display name
  const getModelName = (modelId?: string) => {
    if (!modelId) return null;
    if (modelId === "gpt-image-1") return "Image Generator";
    const model = AVAILABLE_MODELS.find(m => m.id === modelId);
    return model ? model.name : modelId;
  };
  
  const modelName = getModelName(message.model);

  return (
    <div className={cn("flex gap-3 animation-fade-in", isUser && "flex-row-reverse")}>
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0",
        isUser ? "bg-chat-user text-white" : "bg-chat-assistant-avatar text-white"
      )}>
        {isUser ? "U" : "AI"}
      </div>
      <div className={cn(
        "flex-1 rounded-lg p-4 prose prose-invert max-w-none overflow-hidden",
        isUser ? "bg-chat-user text-white" : "bg-chat-assistant"
      )}>
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
        <ChartRenderer 
          content={message.content || ''} 
          executionResults={message.executionResults}
        />
        <ReactMarkdown
          remarkPlugins={[remarkMath, remarkGfm]}
          rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
          components={{
            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
            ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
            li: ({ children }) => <li className="mb-1">{children}</li>,
            h1: ({ children }) => <h1 className="text-xl font-bold mb-2">{children}</h1>,
            h2: ({ children }) => <h2 className="text-lg font-bold mb-2">{children}</h2>,
            h3: ({ children }) => <h3 className="text-base font-bold mb-2">{children}</h3>,
            table: ({ children }) => (
              <div className="overflow-x-auto my-4">
                <table className="min-w-full border-collapse border border-border/50">
                  {children}
                </table>
              </div>
            ),
            thead: ({ children }) => (
              <thead className="bg-black/20">{children}</thead>
            ),
            tbody: ({ children }) => (
              <tbody>{children}</tbody>
            ),
            tr: ({ children }) => (
              <tr className="border-b border-border/30 hover:bg-black/10">{children}</tr>
            ),
            th: ({ children }) => (
              <th className="border border-border/50 px-4 py-2 text-left font-semibold bg-black/30">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border border-border/50 px-4 py-2">
                {children}
              </td>
            ),
            pre: ({ children }) => (
              <pre className="bg-black/30 p-3 rounded text-sm my-2 overflow-auto block w-full max-h-[800px] font-mono" style={{ 
                maxWidth: '100%',
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(255, 255, 255, 0.3) rgba(0, 0, 0, 0.1)'
              }}>
                {children}
              </pre>
            ),
            code: ({ children, className }) => {
              const isInline = !className;
              return isInline ? (
                <code className="bg-black/30 px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>
              ) : (
                <code className="block bg-black/30 p-3 rounded text-sm overflow-auto whitespace-pre font-mono max-h-[800px]" style={{ 
                  maxWidth: '100%',
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'rgba(255, 255, 255, 0.3) rgba(0, 0, 0, 0.1)'
                }}>
                  {children}
                </code>
              );
            },
            a: ({ children, href }) => (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                {children}
              </a>
            ),
          }}
        >
          {message.content ? preprocessMath(message.content) : ''}
        </ReactMarkdown>
        {modelName && (
          <div className="mt-2 text-xs text-muted-foreground/70">
            Model: {modelName}
          </div>
        )}
      </div>
    </div>
  );
});

ChatMessage.displayName = "ChatMessage";

export default ChatMessage;

