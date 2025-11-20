import { useState, useEffect } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatMain from "@/components/chat/ChatMain";
import ApiKeySettings from "@/components/settings/ApiKeySettings";
import DatabaseSettings from "@/components/settings/DatabaseSettings";
import { Chat, Message } from "@/types/chat";
import { initVolleyballDB } from "@/lib/database";
import { DEFAULT_MODEL, cleanupValueInfosForDeletedChats, deleteValueInfoForChat } from "@/lib/chatApi";

const Index = () => {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDatabaseSettings, setShowDatabaseSettings] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [chatsLoaded, setChatsLoaded] = useState(false);

  // Initialize database on mount
  useEffect(() => {
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

  // Load chats from localStorage on mount (only once when authenticated)
  useEffect(() => {
    if (isAuthenticated && !chatsLoaded) {
      const savedChats = localStorage.getItem("volleyball-chats");
      if (savedChats) {
        try {
          const parsedChats: Chat[] = JSON.parse(savedChats);
          // Ensure all chats have a model set
          const chatsWithModels = parsedChats.map(chat => ({
            ...chat,
            model: chat.model || ""
          }));
          setChats(chatsWithModels);
          setChatsLoaded(true);
          if (chatsWithModels.length > 0) {
            setActiveChat(chatsWithModels[0].id);
          }
        } catch (error) {
          console.error("Error loading chats:", error);
          setChatsLoaded(true);
        }
      } else {
        setChatsLoaded(true);
      }
    }
  }, [isAuthenticated, chatsLoaded]);

  // Save chats to localStorage whenever they change
  useEffect(() => {
    if (isAuthenticated && chats.length > 0) {
      localStorage.setItem("volleyball-chats", JSON.stringify(chats));
    }
  }, [chats, isAuthenticated]);

  // No longer need login/logout - just show settings

  const createNewChat = () => {
    // Generate unique ID using timestamp + random to avoid conflicts
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newChat: Chat = {
      id: uniqueId,
      title: "New Chat",
      messages: [],
      createdAt: Date.now(),
      selectedMatch: null,
      model: "",
      reasoningEnabled: true, // Enable reasoning by default
    };
    // Use functional update to avoid stale closure issues
    setChats((prevChats) => {
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

  const deleteChat = (chatId: string) => {
    // Clean up valueInfo for deleted chat
    deleteValueInfoForChat(chatId);
    cleanupValueInfosForDeletedChats();
    
    const updatedChats = chats.filter((chat) => chat.id !== chatId);
    setChats(updatedChats);
    if (activeChat === chatId) {
      setActiveChat(updatedChats.length > 0 ? updatedChats[0].id : null);
    }
    if (updatedChats.length === 0) {
      localStorage.removeItem("volleyball-chats");
    }
  };
  
  // Clean up valueInfos on mount to remove orphaned data
  useEffect(() => {
    if (isAuthenticated) {
      cleanupValueInfosForDeletedChats();
    }
  }, [isAuthenticated]);

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

  const updateChatFilters = (
    chatId: string,
    filters: {
      matchFilterColumns?: string[];
      matchFilterValues?: Record<string, string | null>;
      matchDisplayColumns?: string[];
      matchDisplayValues?: Record<string, string | null>;
      csvFilterColumns?: string[];
      csvFilterValues?: Record<string, string | null>;
      csvDisplayColumns?: string[];
      csvDisplayValues?: Record<string, string | null>;
      selectedCsvId?: string | null;
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
              selectedCsvId: filters.selectedCsvId,
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
          onNewChat={createNewChat}
          onSelectChat={setActiveChat}
          onDeleteChat={deleteChat}
          onRenameChat={updateChatTitle}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          onSettings={() => setShowSettings(true)}
          onDatabaseSettings={() => setShowDatabaseSettings(true)}
        />
        <ChatMain
          chat={currentChat}
          onUpdateMessages={updateChatMessages}
          onUpdateMatch={updateChatMatch}
          onUpdateModel={updateChatModel}
          onUpdateReasoning={updateChatReasoning}
          onUpdateVolleyballContext={updateChatVolleyballContext}
          onUpdateFilters={updateChatFilters}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />
        <ApiKeySettings isOpen={showSettings} onClose={() => setShowSettings(false)} />
        <DatabaseSettings isOpen={showDatabaseSettings} onClose={() => setShowDatabaseSettings(false)} />
      </div>
    </TooltipProvider>
  );
};

export default Index;

