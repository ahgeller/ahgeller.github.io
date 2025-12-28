import { useState, useEffect, useCallback, useRef } from "react";
import { X, Search, FileText, Database, MessageSquare, Settings, Download, Trash2, Plus, BarChart3, Sparkles } from "lucide-react";

interface Command {
  id: string;
  label: string;
  icon: React.ReactNode;
  keywords: string[];
  action: () => void;
  section: string;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: Command[];
}

export function CommandPalette({ isOpen, onClose, commands }: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedButtonRef = useRef<HTMLButtonElement>(null);

  const filteredCommands = commands.filter((cmd) => {
    const searchLower = search.toLowerCase();
    return (
      cmd.label.toLowerCase().includes(searchLower) ||
      cmd.keywords.some((k) => k.toLowerCase().includes(searchLower))
    );
  });

  // Group commands by section
  const groupedCommands = filteredCommands.reduce((acc, cmd) => {
    if (!acc[cmd.section]) acc[cmd.section] = [];
    acc[cmd.section].push(cmd);
    return acc;
  }, {} as Record<string, Command[]>);

  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  useEffect(() => {
    if (!isOpen) {
      setSearch("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Auto-scroll selected item into view
  useEffect(() => {
    if (selectedButtonRef.current) {
      selectedButtonRef.current.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
    }
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const next = prev + 1;
          return next >= filteredCommands.length ? 0 : next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const next = prev - 1;
          return next < 0 ? filteredCommands.length - 1 : next;
        });
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].action();
          onClose();
        }
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [filteredCommands, selectedIndex, onClose]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-background border border-border rounded-lg shadow-2xl overflow-hidden animate-in slide-in-from-top-4 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center border-b border-border px-4 py-3">
          <Search className="w-5 h-5 text-muted-foreground mr-3" />
          <input
            type="text"
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent border-none outline-none text-base text-foreground placeholder-muted-foreground"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <button
            onClick={onClose}
            className="ml-2 p-1 hover:bg-accent rounded"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Commands List */}
        <div className="max-h-[60vh] overflow-y-auto">
          {filteredCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted-foreground">
              No commands found for "{search}"
            </div>
          ) : (
            <div>
              {filteredCommands.map((cmd, index) => {
                const isSelected = index === selectedIndex;
                // Check if this is the first command in a new section
                const isFirstInSection = index === 0 || filteredCommands[index - 1].section !== cmd.section;
                
                return (
                  <div key={cmd.id}>
                    {isFirstInSection && (
                      <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {cmd.section}
                      </div>
                    )}
                    <button
                      ref={isSelected ? selectedButtonRef : null}
                      className={`w-full flex items-center px-4 py-3 text-left transition-colors ${
                        isSelected
                          ? "bg-accent border-l-2 border-primary"
                          : "hover:bg-accent/50"
                      }`}
                      onClick={() => {
                        cmd.action();
                        onClose();
                      }}
                      onMouseEnter={() => setSelectedIndex(index)}
                    >
                      <div className={`mr-3 ${isSelected ? "text-primary" : "text-muted-foreground"}`}>
                        {cmd.icon}
                      </div>
                      <span className="text-sm text-foreground">{cmd.label}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-2 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>
              <kbd className="px-2 py-1 bg-muted rounded">↑↓</kbd> Navigate
            </span>
            <span>
              <kbd className="px-2 py-1 bg-muted rounded">↵</kbd> Select
            </span>
            <span>
              <kbd className="px-2 py-1 bg-muted rounded">Esc</kbd> Close
            </span>
          </div>
          <span>{filteredCommands.length} commands</span>
        </div>
      </div>
    </div>
  );
}

// Hook to manage command palette
export function useCommandPalette(commands: Command[]) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen((prev) => !prev),
  };
}

// Export types
export type { Command };
