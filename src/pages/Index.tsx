import { useState, useEffect, useMemo } from "react";
import { generatePrefixedId } from "@/lib/idGenerator";
import { TooltipProvider } from "@/components/ui/tooltip";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatMain from "@/components/chat/ChatMain";
import ApiKeySettings from "@/components/settings/ApiKeySettings";
import DatabaseSettings from "@/components/settings/DatabaseSettings";
import { Chat, Message } from "@/types/chat";
import { initVolleyballDB } from "@/lib/database";
import { cleanupValueInfosForDeletedChats, deleteValueInfoForChat } from "@/lib/chatApi";
import { cleanupUnusedDuckDBTables } from "@/lib/duckdb";
import { loadAllChats, saveAllChats, saveChat, deleteChat as deleteChatFromDB, migrateFromLocalStorage } from "@/lib/chatStorage";
import { CommandPalette, useCommandPalette, Command } from "@/components/ui/command-palette";
import { KeyboardShortcuts, useKeyboardShortcuts } from "@/components/ui/keyboard-shortcuts";
import { ChartGallery } from "@/components/chat/ChartGallery";
import { ExportDialog } from "@/components/chat/ExportDialog";
import { AnalysisTemplates } from "@/components/chat/AnalysisTemplates";
import { CustomTemplateManager } from "@/components/chat/CustomTemplateManager";
import { Upload, FileText, Settings, Database, Trash2, BarChart3, Download, Keyboard, Sun, Sparkles, X, Edit } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
// Removed framer-motion to improve performance
// import { motion, AnimatePresence } from "framer-motion";

const Index = () => {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Debug/safety: overlay control and diagnostics
  const closeAllOverlays = () => {
    setShowSettings(false);
    setShowDatabaseSettings(false);
    setShowExport(false);
    setShowAnalysisTemplates(false);
    setShowCustomTemplates(false);
    try { commandPalette.close(); } catch {}
    try { keyboardShortcuts.close(); } catch {}
  };
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDatabaseSettings, setShowDatabaseSettings] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [chatsLoaded, setChatsLoaded] = useState(false);
  
  // Get chart state from Zustand store
  const { 
    charts, 
    showChartGallery, 
    setShowChartGallery,
    addChart,
    deleteChart 
  } = useAppStore();
  
  // New feature states (keeping these as local state for now)
  const [showExport, setShowExport] = useState(false);
  const [showAnalysisTemplates, setShowAnalysisTemplates] = useState(false);
  const [showCustomTemplates, setShowCustomTemplates] = useState(false);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  
  // Hooks for new features
  const keyboardShortcuts = useKeyboardShortcuts();

  // Initialize database on mount
  useEffect(() => {
    // Safety init: close overlays and ensure sidebar state is sane for mobile
    closeAllOverlays();
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setSidebarOpen(false);
    }

    const init = async () => {
      try {
        await initVolleyballDB();
        // Always set authenticated to true - database connection is optional
        setIsAuthenticated(true);
      } catch (error) {
        console.error("Error initializing database:", error);
        // Still allow app to load even if database fails
        setIsAuthenticated(true);
      } finally {
        setIsLoading(false);
      }
    };

    init();
  }, []);

  // Load chats from IndexedDB on mount (only once when authenticated)
  useEffect(() => {
    if (isAuthenticated && !chatsLoaded) {
      (async () => {
        let loadedChats: Chat[] = [];

        try {
          // First, attempt to migrate from localStorage if needed
          await migrateFromLocalStorage();

          // Load chats from IndexedDB
          loadedChats = await loadAllChats();

          // Filter out any default-chat entries (migration from old system)
          loadedChats = loadedChats.filter(chat => chat.id !== "default-chat");
        } catch (error) {
          console.error("Error loading chats from IndexedDB:", error);
        }

        // Get default model from storage, or use Devstral as fallback
        let defaultModel = "mistralai/devstral-2512:free";
        try {
          const { getDefaultModelId, setDefaultModelId } = await import("@/lib/openRouterModels");
          const storedDefault = getDefaultModelId();
          if (storedDefault) {
            defaultModel = storedDefault;
          } else {
            // Initialize default model if none exists
            setDefaultModelId(defaultModel);
          }
        } catch (error) {
          console.error("Error getting default model:", error);
        }
        
        // Ensure all chats have a model set (use default if missing)
        let chatsWithModels = loadedChats.map(chat => ({
          ...chat,
          model: chat.model || defaultModel
        }));
        
        setChats(chatsWithModels);
        setChatsLoaded(true);
        
        // Initialize LangChain memory for all loaded chats
        try {
          const { loadChatHistory } = await import('@/lib/memoryStore');
          for (const chat of chatsWithModels) {
            if (chat.messages && chat.messages.length > 0) {
              loadChatHistory(chat.id, chat.messages).catch(error => {
                console.warn(`Failed to load LangChain memory for chat ${chat.id}:`, error);
              });
            }
          }
        } catch (error) {
          console.warn('Failed to initialize LangChain memory for chats:', error);
          // Continue even if LangChain initialization fails
        }
        
        // Select first chat if available, otherwise leave empty (user can create manually via "New Chat" button)
        if (chatsWithModels.length > 0) {
          setActiveChat(chatsWithModels[0].id);
        } else {
          // No chats exist - don't auto-create, let user create manually via "New Chat" button
          setActiveChat(null);
        }
      })();
    }
  }, [isAuthenticated, chatsLoaded]);

  // Save chats to IndexedDB whenever they change
  // NO TRUNCATION - IndexedDB can handle large data
  useEffect(() => {
    if (isAuthenticated && chats.length > 0) {
      // Save asynchronously without blocking the UI
      saveAllChats(chats).catch(error => {
        console.error('Error saving chats to IndexedDB:', error);
      });
    }
  }, [chats, isAuthenticated]);

  // Listen for default model updates and update new chats
  useEffect(() => {
    const handleDefaultModelUpdate = async () => {
      try {
        const { getDefaultModelId } = await import("@/lib/openRouterModels");
        const newDefaultModel = getDefaultModelId();
        if (newDefaultModel) {
          // Update any chats that don't have a model set
          setChats(prevChats => {
            return prevChats.map(chat => ({
              ...chat,
              model: chat.model || newDefaultModel
            }));
          });
        }
      } catch (error) {
        console.error('Error handling default model update:', error);
      }
    };
    
    window.addEventListener('default-model-updated', handleDefaultModelUpdate);
    
    return () => {
      window.removeEventListener('default-model-updated', handleDefaultModelUpdate);
    };
  }, []);

  // No longer need login/logout - just show settings

  const createNewChat = async () => {
    // Generate guaranteed unique ID
    const uniqueId = generatePrefixedId('chat');

    // Get default model from storage (use dynamic import for updated values)
    let defaultModel = "mistralai/devstral-2512:free";
    try {
      // Add a small delay to ensure any recent storage updates are reflected
      await new Promise(resolve => setTimeout(resolve, 50));

      const { getDefaultModelId, setDefaultModelId } = await import("@/lib/openRouterModels");
      const storedDefault = getDefaultModelId();
      if (storedDefault) {
        defaultModel = storedDefault;
      } else {
        // Initialize default model if none exists
        setDefaultModelId(defaultModel);
      }
    } catch (error) {
      console.error("Error getting default model:", error);
    }

    setChats((prevChats) => {
      const newChat: Chat = {
        id: uniqueId,
        title: "New Chat",
        messages: [],
        createdAt: Date.now(),
        selectedMatch: null,
        model: defaultModel,
        reasoningEnabled: true, // Enable reasoning by default
      };
      
      // Use functional update to avoid stale closure issues
      // Check if a chat with this ID already exists (shouldn't happen, but safety check)
      const exists = prevChats.some(chat => chat.id === uniqueId);
      if (exists) {
        console.warn('Chat ID collision detected, generating new ID');
        return prevChats; // Return unchanged, will retry on next click
      }
      return [newChat, ...prevChats];
    });
    
    // Set active chat after state update
    setActiveChat(uniqueId);
  };

  // Sync wrapper for the async function (to maintain compatibility)
  const handleNewChat = () => {
    createNewChat()
      .then(() => {
        // Auto-close sidebar on mobile after creating new chat
        if (typeof window !== 'undefined' && window.innerWidth < 1024) {
          setSidebarOpen(false);
        }
      })
      .catch(error => {
        console.error("Error creating new chat:", error);
      });
  };

  // Handle selecting a chat - auto-close sidebar on mobile
  const handleSelectChat = (chatId: string) => {
    setActiveChat(chatId);
    // Auto-close sidebar on mobile after selecting a chat
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  };

  const deleteChat = async (chatId: string) => {
    try {
      // Get the chat being deleted to find its CSV IDs
      const chatToDelete = chats.find((chat) => chat.id === chatId);
      const csvIdsToCheck = chatToDelete?.selectedCsvIds || [];
      
      // Clean up LangChain memory for deleted chat
      try {
        const { clearMemoryManager } = await import('@/lib/memoryStore');
        await clearMemoryManager(chatId);
      } catch (error) {
        console.warn('Failed to clear LangChain memory for deleted chat:', error);
      }
      
      // Clean up valueInfo for deleted chat
      deleteValueInfoForChat(chatId);
      cleanupValueInfosForDeletedChats();
      
      // Clean up DuckDB tables for CSVs no longer used by any chat
      if (csvIdsToCheck.length > 0) {
        try {
          await cleanupUnusedDuckDBTables(csvIdsToCheck);
        } catch (error) {
          console.error("Error cleaning up DuckDB tables:", error);
          // Don't block chat deletion if cleanup fails
        }
      }
      
      // Delete from IndexedDB
      await deleteChatFromDB(chatId);

      const updatedChats = chats.filter((chat) => chat.id !== chatId);

      if (updatedChats.length === 0) {
        // No chats left - don't auto-create, let user create manually
        setChats([]);
        setActiveChat(null);
      } else {
        setChats(updatedChats);
        if (activeChat === chatId) {
          // If deleting active chat, switch to first available chat
          setActiveChat(updatedChats[0].id);
        }
      }
    } catch (error) {
      console.error("Error deleting chat:", error);
      alert("Failed to delete chat. Please try again.");
    }
  };
  
  // Cleanup is already handled when deleting chats (line 282)
  // Don't run on mount - causes race condition where chats haven't loaded yet
  // useEffect(() => {
  //   if (isAuthenticated) {
  //     cleanupValueInfosForDeletedChats();
  //   }
  // }, [isAuthenticated]);

  const updateChatMessages = (chatId: string, messages: Message[] | ((prev: Message[]) => Message[])) => {
    setChats((prevChats) =>
      prevChats.map((chat) => {
        if (chat.id === chatId) {
          // Support both direct array and functional update
          const newMessages = typeof messages === 'function' ? messages(chat.messages) : messages;
          
          // Ensure we never lose messages - if new messages is shorter, something went wrong
          if (newMessages.length < chat.messages.length && chat.messages.length > 0) {
            console.warn(`⚠️ Message count decreased for chat ${chatId}: ${chat.messages.length} -> ${newMessages.length}. Preserving existing messages.`);
            // Keep the longer array (existing messages) but update with any new content
            const mergedMessages = [...chat.messages];
            // Update the last assistant message if it exists and is being updated
            if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'assistant') {
              const lastNewMessage = newMessages[newMessages.length - 1];
              const lastExistingIndex = mergedMessages.length - 1;
              if (lastExistingIndex >= 0 && mergedMessages[lastExistingIndex].role === 'assistant') {
                mergedMessages[lastExistingIndex] = lastNewMessage;
              } else {
                mergedMessages.push(lastNewMessage);
              }
            }
            const title = mergedMessages.length > 0 && chat.title === "New Chat" 
              ? mergedMessages[0].content.substring(0, 50) + (mergedMessages[0].content.length > 50 ? "..." : "")
              : chat.title;
            return { ...chat, messages: mergedMessages, title };
          }
          
          const title = newMessages.length > 0 && chat.title === "New Chat" 
            ? newMessages[0].content.substring(0, 50) + (newMessages[0].content.length > 50 ? "..." : "")
            : chat.title;
          return { ...chat, messages: newMessages, title };
        }
        return chat;
      })
    );
  };

  const updateChatMatch = (chatId: string, matchId: string | null) => {
    setChats((prevChats) =>
      prevChats.map((chat) =>
        chat.id === chatId ? { ...chat, selectedMatch: matchId } : chat
      )
    );
  };

  const updateChatModel = (chatId: string, model: string) => {
    setChats((prevChats) =>
      prevChats.map((chat) =>
        chat.id === chatId ? { ...chat, model } : chat
      )
    );
  };

  const updateChatReasoning = (chatId: string, reasoningEnabled: boolean) => {
    setChats((prevChats) =>
      prevChats.map((chat) =>
        chat.id === chatId ? { ...chat, reasoningEnabled } : chat
      )
    );
  };

  const updateChatVolleyballContext = (chatId: string, volleyballContextEnabled: boolean) => {
    setChats((prevChats) =>
      prevChats.map((chat) =>
        chat.id === chatId ? { ...chat, volleyballContextEnabled } : chat
      )
    );
  };

  const updateChatMaxFollowupDepth = (chatId: string, maxFollowupDepth: number) => {
    setChats((prevChats) =>
      prevChats.map((chat) =>
        chat.id === chatId ? { ...chat, maxFollowupDepth } : chat
      )
    );
  };

  const updateChatFilters = (
    chatId: string,
    filters: {
      matchFilterColumns?: string[];
      matchFilterValues?: Record<string, string | string[] | null>;
      matchDisplayColumns?: string[];
      matchDisplayValues?: Record<string, string | null>;
      csvFilterColumns?: string[];
      csvFilterValues?: Record<string, string | string[] | null>;
      csvDisplayColumns?: string[];
      csvDisplayValues?: Record<string, string | null>;
      selectedCsvIds?: string[];
      selectedContextSectionId?: string | null;
    }
  ) => {
    setChats((prevChats) =>
      prevChats.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              matchFilterColumns: filters.matchFilterColumns,
              matchFilterValues: filters.matchFilterValues,
              matchDisplayColumns: filters.matchDisplayColumns,
              matchDisplayValues: filters.matchDisplayValues,
              csvFilterColumns: filters.csvFilterColumns,
              csvFilterValues: filters.csvFilterValues,
              csvDisplayColumns: filters.csvDisplayColumns,
              csvDisplayValues: filters.csvDisplayValues,
              selectedCsvIds: filters.selectedCsvIds,
              selectedContextSectionId: filters.selectedContextSectionId,
            }
          : chat
      )
    );
  };

  const updateChatTitle = (chatId: string, title: string) => {
    setChats((prevChats) =>
      prevChats.map((chat) =>
        chat.id === chatId ? { ...chat, title: title.trim() || "New Chat" } : chat
      )
    );
  };

  const currentChat = chats.find((chat) => chat.id === activeChat);

  // Command palette commands
  const commands: Command[] = useMemo(() => [
    {
      id: 'new-chat',
      label: 'New Chat',
      icon: <FileText className="w-4 h-4" />,
      keywords: ['new', 'chat', 'conversation', 'start', 'create'],
      action: handleNewChat,
      section: 'General'
    },
    {
      id: 'chart-gallery',
      label: 'Open Chart Gallery',
      icon: <BarChart3 className="w-4 h-4" />,
      keywords: ['chart', 'gallery', 'visualizations', 'graphs', 'view'],
      action: () => setShowChartGallery(true),
      section: 'Visualization'
    },
    {
      id: 'export',
      label: 'Export Analysis',
      icon: <Download className="w-4 h-4" />,
      keywords: ['export', 'download', 'save', 'report', 'pdf', 'html'],
      action: () => setShowExport(true),
      section: 'General'
    },
    {
      id: 'settings',
      label: 'API Key Settings',
      icon: <Settings className="w-4 h-4" />,
      keywords: ['settings', 'api', 'key', 'config', 'configure'],
      action: () => setShowSettings(true),
      section: 'Settings'
    },
    {
      id: 'database',
      label: 'Database Settings',
      icon: <Database className="w-4 h-4" />,
      keywords: ['database', 'db', 'connection', 'data', 'settings'],
      action: () => setShowDatabaseSettings(true),
      section: 'Settings'
    },
    {
      id: 'analysis-templates',
      label: 'Analysis Templates',
      icon: <Sparkles className="w-4 h-4" />,
      keywords: ['analysis', 'templates', 'guide', 'workflow', 'recipes', 'examples'],
      action: () => setShowAnalysisTemplates(true),
      section: 'Analysis'
    },
    {
      id: 'custom-templates',
      label: 'Custom Templates',
      icon: <Edit className="w-4 h-4" />,
      keywords: ['custom', 'templates', 'create', 'my', 'own', 'personal'],
      action: () => setShowCustomTemplates(true),
      section: 'Analysis'
    },
    {
      id: 'shortcuts',
      label: 'Keyboard Shortcuts',
      icon: <Keyboard className="w-4 h-4" />,
      keywords: ['keyboard', 'shortcuts', 'hotkeys', 'help'],
      action: () => keyboardShortcuts.open(),
      section: 'Help'
    },
    {
      id: 'toggle-sidebar',
      label: sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar',
      icon: <FileText className="w-4 h-4" />,
      keywords: ['sidebar', 'toggle', 'hide', 'show'],
      action: () => setSidebarOpen(!sidebarOpen),
      section: 'View'
    },
    ...(activeChat ? [{
      id: 'delete-chat',
      label: 'Delete Current Chat',
      icon: <Trash2 className="w-4 h-4" />,
      keywords: ['delete', 'remove', 'clear', 'chat'],
      action: () => {
        if (confirm('Are you sure you want to delete this chat?')) {
          deleteChat(activeChat);
        }
      },
      section: 'General'
    }] : [])
  ], [sidebarOpen, activeChat, handleNewChat, keyboardShortcuts]);

  const commandPalette = useCommandPalette(commands);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Show settings page on first load, but allow closing
  if (!isAuthenticated && !isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-chat-bg">
        <ApiKeySettings 
          isOpen={true} 
          onClose={() => {
            setIsAuthenticated(true);
            // Don't auto-create chat here - let user create it manually
          }} 
        />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex h-full overflow-hidden bg-chat-bg">
        <ChatSidebar
          chats={chats}
          activeChat={activeChat}
          onNewChat={handleNewChat}
          onSelectChat={handleSelectChat}
          onDeleteChat={deleteChat}
          onRenameChat={updateChatTitle}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          onSettings={() => setShowSettings(true)}
          onDatabaseSettings={() => setShowDatabaseSettings(true)}
        />

        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Command Palette Hint - Hidden on mobile, bottom-right on desktop */}
          <button
            onClick={() => commandPalette.open()}
            className="fixed bottom-6 right-6 z-50 p-2 bg-primary/90 hover:bg-primary text-primary-foreground rounded-full shadow-lg hover:shadow-xl transition-all group hidden md:block"
            title="Press Ctrl+K for quick actions"
          >
            <Keyboard className="w-5 h-5" />
          </button>

          <ChatMain
            key={currentChat?.id} // Force remount when chat changes
            chat={currentChat}
            pendingQuery={pendingQuery}
            onQueryProcessed={() => setPendingQuery(null)}
            onUpdateMessages={(chatId, messages) => {
              updateChatMessages(chatId, messages);
              
              // Track charts when messages update
              if (currentChat && chatId === currentChat.id) {
                const msgs = typeof messages === 'function' ? messages(currentChat.messages) : messages;
                
                // Extract charts from messages
                msgs.forEach((msg, msgIndex) => {
                  if (msg.role === 'assistant' && msg.executionResults) {
                    const results = msg.executionResults;
                    
                    // Handle array of results
                    const resultsArray = Array.isArray(results) ? results : [results];
                    
                    resultsArray.forEach((result, resultIndex) => {
                      // Check for ECharts
                      // Charts are no longer auto-added to gallery
                      // Users can manually add them via the "Add to Gallery" button on each chart
                    });
                  }
                });
              }
            }}
            onUpdateMatch={updateChatMatch}
            onUpdateModel={updateChatModel}
            onUpdateReasoning={updateChatReasoning}
            onUpdateVolleyballContext={updateChatVolleyballContext}
            onUpdateMaxFollowupDepth={updateChatMaxFollowupDepth}
            onUpdateFilters={updateChatFilters}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          />
        </div>

        {/* Settings Dialogs */}
        <ApiKeySettings isOpen={showSettings} onClose={() => setShowSettings(false)} />
        <DatabaseSettings isOpen={showDatabaseSettings} onClose={() => setShowDatabaseSettings(false)} />

        {/* New Feature Components */}
        <CommandPalette 
          isOpen={commandPalette.isOpen} 
          onClose={commandPalette.close} 
          commands={commands} 
        />
        
        <KeyboardShortcuts 
          isOpen={keyboardShortcuts.isOpen} 
          onClose={keyboardShortcuts.close} 
        />

        {showChartGallery && (
          <ChartGallery
            onClose={() => setShowChartGallery(false)}
            onSelectChart={(chartId) => {
              // Could scroll to chart in conversation here
            }}
          />
        )}

        {showExport && currentChat && (
          <div>
            <ExportDialog
              isOpen={showExport}
              onClose={() => setShowExport(false)}
              chatHistory={currentChat.messages}
              charts={charts}
              chatTitle={currentChat.title}
            />
          </div>
        )}

        {showCustomTemplates && (
          <div>
            <CustomTemplateManager
              onClose={() => setShowCustomTemplates(false)}
              onSelectTemplate={(queries) => {
            // Run the custom template queries
            if (!currentChat) {
              handleNewChat();
              setTimeout(() => {
                queries.forEach((query, idx) => {
                  setTimeout(() => {
                    setPendingQuery(query);
                  }, idx * 100);
                });
              }, 500);
            } else {
              queries.forEach((query, idx) => {
                setTimeout(() => {
                  setPendingQuery(query);
                }, idx * 100);
              });
            }
          }}
        />
          </div>
        )}

        {showAnalysisTemplates && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-background border border-border rounded-lg max-w-6xl w-full max-h-[90vh] overflow-hidden">
              <div className="p-6 border-b border-border flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold text-foreground">Analysis Templates</h2>
                  <p className="text-sm text-muted-foreground mt-1">Pre-built workflows to analyze any dataset</p>
                </div>
                <button 
                  onClick={() => setShowAnalysisTemplates(false)}
                  className="p-2 hover:bg-accent rounded transition-colors"
                >
                  <X className="w-5 h-5 text-muted-foreground" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
                <AnalysisTemplates
                  onSelectTemplate={(template) => {
                    setShowAnalysisTemplates(false);
                    
                    // Make sure we have an active chat
                    if (!currentChat) {
                      // Create a new chat first
                      handleNewChat();
                      // Wait a bit for chat to be created, then send first query
                      setTimeout(() => {
                        setPendingQuery(template.queries[0]);
                        // Queue remaining queries
                        template.queries.slice(1).forEach((query, idx) => {
                          setTimeout(() => {
                            setPendingQuery(query);
                          }, (idx + 1) * 2000);
                        });
                      }, 500);
                    } else {
                      // Send queries one by one
                      template.queries.forEach((query, idx) => {
                        setTimeout(() => {
                          setPendingQuery(query);
                        }, idx * 100); // Small delay to ensure they're processed in order
                      });
                    }
                  }}
                  onSelectQuery={(query) => {
                    setShowAnalysisTemplates(false);
                    
                    // Make sure we have an active chat
                    if (!currentChat) {
                      handleNewChat();
                      setTimeout(() => {
                        setPendingQuery(query);
                      }, 500);
                    } else {
                      setPendingQuery(query);
                    }
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};

export default Index;

