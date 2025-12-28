import { useState, useEffect, useRef } from "react";
import { Plus, MessageSquare, Trash2, Menu, X, Settings, LogOut } from "lucide-react";
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
  onDatabaseSettings?: () => void;
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
  onDatabaseSettings,
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
            <div className="p-3 border-b border-border/50">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-foreground">Github: ahgeller</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onToggle}
                  title="Close sidebar"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <Button
                onClick={onNewChat}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
                size="sm"
              >
                <Plus className="h-4 w-4 mr-2" />
                New Chat
              </Button>
            </div>

            {/* Chat List */}
            <div className="flex-1 overflow-y-auto p-2">
              {chats.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm py-8">
                  <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No chats yet</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {chats.map((chat) => (
                    <div
                      key={chat.id}
                      className={cn(
                        "group relative rounded-lg p-3 cursor-pointer transition-all hover:bg-chat-hover",
                        activeChat === chat.id && "bg-chat-hover"
                      )}
                      onClick={() => onSelectChat(chat.id)}
                    >
                      <div className="flex items-start gap-2">
                        <MessageSquare className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
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
            <div className="p-3 border-t border-border/50 space-y-2">
              {userInfo && (
                <div className="text-xs text-muted-foreground mb-2">
                  {userInfo}
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={onSettings}
                  title="API Keys & Settings"
                >
                  <Settings className="h-3 w-3 mr-1" />
                  API Keys
                </Button>
                {onDatabaseSettings && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 text-xs"
                    onClick={onDatabaseSettings}
                    title="Database Settings"
                >
                  <Settings className="h-3 w-3 mr-1" />
                    DB Settings
                </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Ai Analytics
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default ChatSidebar;

