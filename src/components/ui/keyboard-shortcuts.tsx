import { X, Keyboard } from "lucide-react";
import { useState, useEffect } from "react";

interface Shortcut {
  keys: string[];
  description: string;
  category: string;
}

const shortcuts: Shortcut[] = [
  { keys: ['Ctrl', 'K'], description: 'Open command palette', category: 'General' },
  { keys: ['Ctrl', 'N'], description: 'New chat', category: 'General' },
  { keys: ['Ctrl', 'U'], description: 'Upload CSV', category: 'Data' },
  { keys: ['Ctrl', 'G'], description: 'Open chart gallery', category: 'Visualization' },
  { keys: ['Ctrl', '/'], description: 'Show keyboard shortcuts', category: 'General' },
  { keys: ['Esc'], description: 'Close dialog/cancel', category: 'General' },
  { keys: ['Enter'], description: 'Send message', category: 'Chat' },
  { keys: ['Shift', 'Enter'], description: 'New line in message', category: 'Chat' },
  { keys: ['↑'], description: 'Edit last message', category: 'Chat' },
  { keys: ['Ctrl', 'L'], description: 'Clear chat', category: 'Chat' },
];

interface KeyboardShortcutsProps {
  isOpen: boolean;
  onClose: () => void;
}

export function KeyboardShortcuts({ isOpen, onClose }: KeyboardShortcutsProps) {
  if (!isOpen) return null;

  const categories = [...new Set(shortcuts.map(s => s.category))];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-background border border-border rounded-lg shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <Keyboard className="w-6 h-6 text-primary" />
            <h2 className="text-xl font-bold text-foreground">
              Keyboard Shortcuts
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-accent rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[70vh] overflow-y-auto">
          {categories.map((category) => (
            <div key={category} className="mb-6 last:mb-0">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                {category}
              </h3>
              <div className="space-y-2">
                {shortcuts
                  .filter((s) => s.category === category)
                  .map((shortcut, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-accent transition-colors"
                    >
                      <span className="text-sm text-foreground">
                        {shortcut.description}
                      </span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, keyIdx) => (
                          <span key={keyIdx} className="flex items-center">
                            <kbd className="px-2 py-1 text-xs font-semibold text-foreground bg-muted border border-border rounded shadow-sm">
                              {key}
                            </kbd>
                            {keyIdx < shortcut.keys.length - 1 && (
                              <span className="mx-1 text-muted-foreground">+</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 bg-muted/30 border-t border-border">
          <p className="text-sm text-muted-foreground text-center">
            Press <kbd className="px-2 py-1 text-xs font-semibold bg-background border border-border rounded">Ctrl</kbd> + <kbd className="px-2 py-1 text-xs font-semibold bg-background border border-border rounded">/</kbd> anytime to show this dialog
          </p>
        </div>
      </div>
    </div>
  );
}

// Hook to manage keyboard shortcuts dialog
export function useKeyboardShortcuts() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}
