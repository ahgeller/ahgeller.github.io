import { useState } from 'react';
import { CodeBlock } from '@/lib/codeExecutorV2';
import { Code2, Play, X, AlertTriangle, Edit3 } from 'lucide-react';

interface CodeExecutionDialogProps {
  blocks: CodeBlock[];
  onApprove: (editedBlocks?: CodeBlock[]) => void;
  onReject: () => void;
}

export function CodeExecutionDialog({ blocks, onApprove, onReject }: CodeExecutionDialogProps) {
  const [selectedBlock, setSelectedBlock] = useState(0);
  const [editedBlocks, setEditedBlocks] = useState<CodeBlock[]>(blocks);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedBlockIndices, setSelectedBlockIndices] = useState<Set<number>>(
    new Set(blocks.map((_, idx) => idx)) // All selected by default
  );

  const handleCodeChange = (value: string) => {
    const newBlocks = [...editedBlocks];
    newBlocks[selectedBlock] = { ...newBlocks[selectedBlock], code: value };
    setEditedBlocks(newBlocks);
  };

  const toggleBlockSelection = (idx: number) => {
    const newSelected = new Set(selectedBlockIndices);
    if (newSelected.has(idx)) {
      newSelected.delete(idx);
    } else {
      newSelected.add(idx);
    }
    setSelectedBlockIndices(newSelected);
  };

  const handleApprove = () => {
    // Filter to only selected blocks
    const selectedBlocks = editedBlocks.filter((_, idx) => selectedBlockIndices.has(idx));
    if (selectedBlocks.length === 0) return; // Don't execute if nothing selected

    // Pass edited blocks if they were modified
    const hasChanges = selectedBlocks.some((block) => {
      const originalIdx = editedBlocks.indexOf(block);
      return block.code !== blocks[originalIdx].code;
    });
    onApprove(hasChanges ? selectedBlocks : undefined);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-chat-bg rounded-lg shadow-2xl w-full max-w-3xl max-h-[75vh] overflow-hidden border border-border/50 flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between bg-gradient-to-r from-primary/10 to-transparent">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-primary" />
            <div>
              <h2 className="text-base font-semibold text-white">Review & Execute Code</h2>
              <p className="text-xs text-muted-foreground">
                {selectedBlockIndices.size} of {blocks.length} block{blocks.length > 1 ? 's' : ''} selected
              </p>
            </div>
          </div>
          <button
            onClick={onReject}
            className="text-muted-foreground hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded"
            title="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Code Preview */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Tab selector if multiple blocks */}
          {blocks.length > 1 && (
            <div className="px-4 pt-3 pb-2 border-b border-border/30">
              <div className="flex gap-1.5 overflow-x-auto">
                {blocks.map((block, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={selectedBlockIndices.has(idx)}
                      onChange={() => toggleBlockSelection(idx)}
                      className="w-3.5 h-3.5 rounded border-border/50 bg-white/5 checked:bg-primary checked:border-primary cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                    />
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
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Code display/editor */}
          <div className="flex-1 overflow-auto p-4">
            <div className="bg-black/40 rounded border border-border/30 overflow-hidden">
              <div className="px-3 py-1.5 bg-black/30 border-b border-border/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {editedBlocks[selectedBlock].type}
                  </span>
                  {editedBlocks[selectedBlock].code !== blocks[selectedBlock].code && (
                    <span className="text-xs bg-yellow-500/20 text-yellow-500 px-1.5 py-0.5 rounded">
                      Modified
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {editedBlocks[selectedBlock].code.split('\n').length} lines
                  </span>
                  <button
                    onClick={() => setIsEditing(!isEditing)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all ${
                      isEditing
                        ? 'bg-primary text-white'
                        : 'bg-white/10 text-muted-foreground hover:bg-white/20'
                    }`}
                    title={isEditing ? 'View mode' : 'Edit code'}
                  >
                    <Edit3 className="w-3 h-3" />
                    {isEditing ? 'Editing' : 'Edit'}
                  </button>
                </div>
              </div>
              {isEditing ? (
                <textarea
                  value={editedBlocks[selectedBlock].code}
                  onChange={(e) => handleCodeChange(e.target.value)}
                  className="w-full p-3 text-sm font-mono bg-black/20 text-gray-300 border-none outline-none resize-none min-h-[300px] max-h-[300px] mac-code-render"
                  spellCheck={false}
                  style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', tabSize: 2 }}
                />
              ) : (
                <pre className="p-3 text-sm overflow-auto font-mono max-h-[300px] mac-code-render">
                  <code className="text-gray-300">{editedBlocks[selectedBlock].code}</code>
                </pre>
              )}
            </div>

            {/* Warning message */}
            <div className="mt-3 p-2.5 bg-yellow-500/10 border border-yellow-500/30 rounded flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Review code carefully - it will access your data and execute in your browser.
              </p>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-2.5 border-t border-border/50 flex items-center justify-between bg-black/20">
          <div className="flex items-center gap-2">
            <button
              onClick={onReject}
              className="px-3 py-1.5 rounded text-xs font-medium text-muted-foreground hover:text-white hover:bg-white/10 transition-all"
            >
              Cancel
            </button>
            {editedBlocks.some((block, idx) => block.code !== blocks[idx].code) && (
              <span className="text-xs text-yellow-500 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Modified
              </span>
            )}
          </div>
          <button
            onClick={handleApprove}
            disabled={selectedBlockIndices.size === 0}
            className={`px-4 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-1.5 shadow-lg ${
              selectedBlockIndices.size === 0
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-primary hover:bg-primary/80 text-white shadow-primary/20'
            }`}
          >
            <Play className="w-3 h-3" />
            Run {selectedBlockIndices.size > 0 ? `${selectedBlockIndices.size} ` : ''}Block{selectedBlockIndices.size !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
