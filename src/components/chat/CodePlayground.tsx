import { useState } from 'react';
import { Code2, Play, X, AlertCircle, Plus, Trash2 } from 'lucide-react';
import { CodeExecutor, CodeBlock } from '@/lib/codeExecutorV2';

interface CodePlaygroundProps {
  isOpen: boolean;
  onClose: () => void;
  csvId?: string | string[] | null;
  csvFilterColumns?: string[] | null;
  csvFilterValues?: Record<string, string | string[] | null> | null;
}

interface PlaygroundBlock {
  code: string;
  output: string;
  error: string | null;
}

export function CodePlayground({
  isOpen,
  onClose,
  csvId,
  csvFilterColumns,
  csvFilterValues
}: CodePlaygroundProps) {
  const [blocks, setBlocks] = useState<PlaygroundBlock[]>([{ code: '', output: '', error: null }]);
  const [selectedBlock, setSelectedBlock] = useState(0);
  const [isExecuting, setIsExecuting] = useState(false);

  const addBlock = () => {
    setBlocks([...blocks, { code: '', output: '', error: null }]);
    setSelectedBlock(blocks.length);
  };

  const removeBlock = (idx: number) => {
    if (blocks.length === 1) return; // Keep at least one block
    const newBlocks = blocks.filter((_, i) => i !== idx);
    setBlocks(newBlocks);
    if (selectedBlock >= newBlocks.length) {
      setSelectedBlock(newBlocks.length - 1);
    }
  };

  const updateCode = (code: string) => {
    const newBlocks = [...blocks];
    newBlocks[selectedBlock] = { ...newBlocks[selectedBlock], code };
    setBlocks(newBlocks);
  };

  const handleExecute = async () => {
    setIsExecuting(true);

    // Execute current block
    const currentBlock = blocks[selectedBlock];
    const newBlocks = [...blocks];
    newBlocks[selectedBlock] = { ...currentBlock, output: '', error: null };
    setBlocks(newBlocks);

    try {
      // Security: Basic code validation
      const dangerousPatterns = [
        /\beval\s*\(/i,
        /Function\s*\(/i,
        /\bsetTimeout\s*\(/i,
        /\bsetInterval\s*\(/i,
        /localStorage/i,
        /sessionStorage/i,
        /\bcookie/i,
        /XMLHttpRequest/i,
        /\bfetch\s*\(/i,
        /\.postMessage\s*\(/i,
        /window\.location/i,
        /document\.location/i,
        /\.innerHTML/i,
        /\.outerHTML/i,
        /importScripts/i,
        /Worker\s*\(/i
      ];

      const code = currentBlock.code.trim();

      // Check for dangerous patterns
      for (const pattern of dangerousPatterns) {
        if (pattern.test(code)) {
          throw new Error(`Security: Code contains potentially dangerous pattern: ${pattern.source}`);
        }
      }

      // Check code length (prevent DoS)
      if (code.length > 50000) {
        throw new Error('Code too long (max 50,000 characters)');
      }

      // Initialize executor with proper parameters
      // Parameters: matchData, executionData, filterColumns, filterValues, allowSql, csvId
      const executor = new CodeExecutor(
        null, // matchData
        null, // executionData (will be loaded from csvId)
        csvFilterColumns || null,
        csvFilterValues || null,
        true, // allowSql - enable SQL queries
        csvId || null
      );

      // Execute the code using the correct method
      const result = await executor.executeCode(code);

      if (result.success) {
        const resultStr = typeof result.result === 'object'
          ? JSON.stringify(result.result, null, 2)
          : String(result.result);
        newBlocks[selectedBlock] = { ...currentBlock, output: resultStr, error: null };
      } else {
        newBlocks[selectedBlock] = { ...currentBlock, output: '', error: result.error || 'Execution failed' };
      }
    } catch (err: any) {
      newBlocks[selectedBlock] = { ...currentBlock, output: '', error: err.message || 'Unknown error' };
    } finally {
      setBlocks(newBlocks);
      setIsExecuting(false);
    }
  };

  if (!isOpen) return null;

  const currentBlock = blocks[selectedBlock];

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-chat-bg rounded-lg shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden border border-border/50 flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between bg-gradient-to-r from-primary/10 to-transparent">
          <div className="flex items-center gap-2">
            <Code2 className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold text-white">Code Playground</h2>
              <p className="text-xs text-muted-foreground">
                Execute JavaScript/SQL code manually
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Code Editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Block tabs */}
          {blocks.length > 1 && (
            <div className="px-4 pt-3 pb-2 border-b border-border/30">
              <div className="flex gap-1.5 overflow-x-auto items-center">
                {blocks.map((_, idx) => (
                  <div key={idx} className="flex items-center gap-1">
                    <button
                      onClick={() => setSelectedBlock(idx)}
                      className={`px-3 py-1.5 rounded text-xs font-medium transition-all whitespace-nowrap ${
                        selectedBlock === idx
                          ? 'bg-primary text-white'
                          : 'bg-white/5 text-muted-foreground hover:bg-white/10'
                      }`}
                    >
                      Block {idx + 1}
                    </button>
                    {blocks.length > 1 && (
                      <button
                        onClick={() => removeBlock(idx)}
                        className="p-1 hover:bg-red-500/20 rounded text-red-400 hover:text-red-300 transition-colors"
                        title="Delete block"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={addBlock}
                  className="p-1.5 hover:bg-primary/20 rounded text-primary hover:text-primary/80 transition-colors ml-2"
                  title="Add block"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 p-4 overflow-auto">
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Code Editor - Block {selectedBlock + 1} of {blocks.length}
                </label>
                {blocks.length === 1 && (
                  <button
                    onClick={addBlock}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-primary/20 hover:bg-primary/30 text-primary rounded transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Add Block
                  </button>
                )}
              </div>
              <textarea
                value={currentBlock.code}
                onChange={(e) => updateCode(e.target.value)}
                className="w-full p-3 text-sm font-mono bg-black/40 text-gray-300 border border-border/30 rounded outline-none resize-none min-h-[200px] focus:border-primary/50"
                spellCheck={false}
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', tabSize: 2 }}
                placeholder="// Write your JavaScript/SQL code here&#10;const result = await query(&quot;SELECT * FROM csvData LIMIT 10&quot;);&#10;return result;"
              />
            </div>

            {/* Output */}
            {(currentBlock.output || currentBlock.error) && (
              <div className="mb-3">
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  {currentBlock.error ? 'Error' : 'Output'}
                </label>
                <div className={`p-3 text-sm font-mono rounded border overflow-auto max-h-[300px] ${
                  currentBlock.error
                    ? 'bg-red-500/10 border-red-500/30 text-red-400'
                    : 'bg-black/40 border-border/30 text-gray-300'
                }`}>
                  {currentBlock.error ? (
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <pre className="whitespace-pre-wrap">{currentBlock.error}</pre>
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap">{currentBlock.output}</pre>
                  )}
                </div>
              </div>
            )}

            {/* Help Text */}
            <div className="mt-3 p-2.5 bg-blue-500/10 border border-blue-500/30 rounded text-xs text-muted-foreground">
              <p className="font-medium text-blue-400 mb-1">Tips:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Use <code className="bg-black/30 px-1 rounded">await query("SELECT ...")</code> for SQL queries on CSV data</li>
                <li>Access data with <code className="bg-black/30 px-1 rounded">csvData</code> variable (if loaded)</li>
                <li>Use <code className="bg-black/30 px-1 rounded">return</code> to output results</li>
              </ul>
            </div>

            {/* Security Notice */}
            <div className="mt-2 p-2.5 bg-yellow-500/10 border border-yellow-500/30 rounded text-xs text-muted-foreground">
              <p className="font-medium text-yellow-400 mb-1">🔒 Security:</p>
              <p>Code execution is sandboxed and blocks dangerous operations (eval, fetch, DOM manipulation, storage access, etc.). Max 50KB code length.</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border/50 flex items-center justify-between bg-black/20">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs font-medium text-muted-foreground hover:text-white hover:bg-white/10 transition-all"
          >
            Close
          </button>
          <button
            onClick={handleExecute}
            disabled={isExecuting || !currentBlock.code.trim()}
            className={`px-4 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-1.5 ${
              isExecuting || !currentBlock.code.trim()
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-primary hover:bg-primary/80 text-white shadow-lg shadow-primary/20'
            }`}
          >
            <Play className="w-3 h-3" />
            {isExecuting ? 'Running...' : 'Run Code'}
          </button>
        </div>
      </div>
    </div>
  );
}
