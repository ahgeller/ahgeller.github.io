import { useState, useEffect, useRef } from "react";
import { Plus, MessageSquare, Trash2, Menu, X, Settings, LogOut, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chat } from "@/types/chat";
import { cn } from "@/lib/utils";
import { initVolleyballDB } from "@/lib/database";
import { AVAILABLE_MODELS } from "@/lib/chatApi";
import { formatDateOnly } from "@/lib/dateFormatter";

interface ChatSidebarProps {
  chats: Chat[];
  activeChat: string | null;
  onNewChat: () => void;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onRenameChat?: (chatId: string, title: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  onSettings: () => void;
  userInfo?: string;
  onLogout?: () => void;
}

const ChatSidebar = ({
  chats,
  activeChat,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
  isOpen,
  onToggle,
  onSettings,
  userInfo,
  onLogout,
}: ChatSidebarProps) => {
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingChatId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingChatId]);

  const handleDoubleClick = (chat: Chat, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChatId(chat.id);
    setEditTitle(chat.title);
  };

  const handleSaveTitle = (chatId: string) => {
    if (onRenameChat) {
      onRenameChat(chatId, editTitle);
    }
    setEditingChatId(null);
    setEditTitle("");
  };

  const handleKeyDown = (e: React.KeyboardEvent, chatId: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveTitle(chatId);
    } else if (e.key === "Escape") {
      setEditingChatId(null);
      setEditTitle("");
    }
  };
  const handleUpdateConnection = async () => {
    await initVolleyballDB();
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onToggle}
        />
      )}

      {/* Sidebar */}
      <div
        className={cn(
          "fixed left-0 top-0 lg:relative z-50 h-full bg-chat-sidebar flex flex-col transition-transform duration-300",
          isOpen ? "translate-x-0 w-64 pointer-events-auto" : "-translate-x-full w-0 pointer-events-none lg:translate-x-0 lg:w-0"
        )}
      >
        {isOpen && (
          <>
            {/* Header */}
            <div className="p-4 border-b border-border/30">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-foreground tracking-tight">Chats</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 hover:bg-chat-hover"
                  onClick={onToggle}
                  title="Close sidebar"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <Button
                onClick={onNewChat}
                className="w-full bg-primary hover:bg-primary/80 text-primary-foreground transition-all shadow-sm hover:shadow-md rounded-lg"
                size="sm"
              >
                <Plus className="h-4 w-4 mr-2" />
                New Chat
              </Button>
            </div>

            {/* Chat List */}
            <div className="flex-1 overflow-y-auto p-3">
              {chats.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm py-12">
                  <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">No chats yet</p>
                  <p className="text-xs mt-1 opacity-60">Start a new conversation</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {chats.map((chat) => (
                    <div
                      key={chat.id}
                      className={cn(
                        "group relative rounded-lg p-3 cursor-pointer transition-all duration-200",
                        "hover:bg-chat-hover border border-transparent hover:border-border/20",
                        activeChat === chat.id && "bg-chat-hover border-border/30 shadow-sm"
                      )}
                      onClick={() => onSelectChat(chat.id)}
                    >
                      <div className="flex items-start gap-3">
                        <MessageSquare className="h-4 w-4 mt-1 flex-shrink-0 text-primary/70" />
                        <div className="flex-1 min-w-0">
                          {editingChatId === chat.id ? (
                            <Input
                              ref={inputRef}
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              onBlur={() => handleSaveTitle(chat.id)}
                              onKeyDown={(e) => handleKeyDown(e, chat.id)}
                              className="h-6 text-sm px-2 py-1"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <p
                              className="text-sm font-medium text-foreground truncate cursor-text"
                              onDoubleClick={(e) => handleDoubleClick(chat, e)}
                            >
                            {chat.title}
                          </p>
                          )}
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <p className="text-xs text-muted-foreground">
                                {formatDateOnly(chat.createdAt)}
                              </p>
                              {chat.model && (() => {
                                const model = AVAILABLE_MODELS.find(m => m.id === chat.model);
                                const modelName = model ? model.name : (chat.model === "gpt-image-1" ? "Image" : chat.model);
                                return (
                                  <>
                                    <span className="text-xs text-muted-foreground/50">•</span>
                                    <p className="text-xs text-muted-foreground truncate">
                                      {modelName}
                                    </p>
                                  </>
                                );
                              })()}
                            </div>
                            {/* Show data source (CSV or database) */}
                            {(chat.selectedCsvFileNames && chat.selectedCsvFileNames.length > 0) && (
                              <p className="text-xs text-primary/60 truncate">
                                📄 {chat.selectedCsvFileNames.length > 1
                                  ? `${chat.selectedCsvFileNames.length} files`
                                  : chat.selectedCsvFileNames[0]}
                              </p>
                            )}
                            {chat.selectedMatch && (
                              <p className="text-xs text-primary/60 truncate">
                                🏐 Database
                              </p>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm("Delete this chat?")) {
                              onDeleteChat(chat.id);
                            }
                          }}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-border/30 space-y-3 bg-chat-sidebar/50">
              {userInfo && (
                <div className="text-xs text-muted-foreground mb-2 px-1">
                  {userInfo}
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-xs hover:bg-chat-hover rounded-lg"
                onClick={onSettings}
                title="Settings"
              >
                <Settings className="h-3.5 w-3.5 mr-2" />
                Settings
              </Button>
              <p className="text-xs text-muted-foreground/60 text-center pt-2">
                AI Analytics Platform
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default ChatSidebar;

