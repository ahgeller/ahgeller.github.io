import { useState, useRef, useEffect } from "react";
import { Menu, Send, Image as ImageIcon, Brain, X, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Chat, Message, MatchData } from "@/types/chat";
import { sendChatMessage, DEFAULT_MODEL, getValueInfo, autoInspectData, getCsvFileData } from "@/lib/chatApi";
import { loadMatchData, isDatabaseConnected } from "@/lib/database";
import ChatMessage from "./ChatMessage";
import MatchSelector from "./MatchSelector";
import CSVSelector from "./CSVSelector";
import WelcomeScreen from "./WelcomeScreen";
import ModelSelector from "./ModelSelector";
import { cn } from "@/lib/utils";

interface ChatMainProps {
  chat: Chat | undefined;
  onUpdateMessages: (chatId: string, messages: Message[] | ((prev: Message[]) => Message[])) => void;
  onUpdateMatch: (chatId: string, matchId: string | null) => void;
  onUpdateModel?: (chatId: string, model: string) => void;
  onUpdateReasoning?: (chatId: string, reasoningEnabled: boolean) => void;
  onUpdateVolleyballContext?: (chatId: string, volleyballContextEnabled: boolean) => void;
  onUpdateFilters?: (
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
      selectedCsvIds?: string[];
      selectedContextSectionId?: string | null;
    }
  ) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

const ChatMain = ({
  chat,
  onUpdateMessages,
  onUpdateMatch,
  onUpdateModel,
  onUpdateReasoning,
  onUpdateVolleyballContext,
  onUpdateFilters,
  sidebarOpen,
  onToggleSidebar,
}: ChatMainProps) => {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [matchData, setMatchData] = useState<MatchData | null>(null);
  const [selectedCsvIds, setSelectedCsvIds] = useState<string[]>([]);
  const [csvFilterColumns, setCsvFilterColumns] = useState<string[]>([]);
  const [csvFilterValues, setCsvFilterValues] = useState<Record<string, string | null>>({});
  const [csvDisplayColumns, setCsvDisplayColumns] = useState<string[]>([]);
  const [csvDisplayValues, setCsvDisplayValues] = useState<Record<string, string | null>>({});
  const [matchFilterColumns, setMatchFilterColumns] = useState<string[]>([]);
  const [matchFilterValues, setMatchFilterValues] = useState<Record<string, string | null>>({});
  const [matchDisplayColumns, setMatchDisplayColumns] = useState<string[]>([]);
  const [matchDisplayValues, setMatchDisplayValues] = useState<Record<string, string | null>>({});
  const [selectedContextSectionId, setSelectedContextSectionId] = useState<string | null>("none");
  const [contextSections, setContextSections] = useState<Array<{id: string, title: string, content: string}>>([]);
  const [dbConnected, setDbConnected] = useState(false);
  const [hasCsvFiles, setHasCsvFiles] = useState(false);
  
  // Check for CSV files and listen for changes
  useEffect(() => {
    const checkCsvFiles = () => {
      try {
        const saved = localStorage.getItem("db_csv_files");
        if (saved) {
          const parsed = JSON.parse(saved);
          const files = Array.isArray(parsed) ? parsed : [];
          // Check if any files have headers (columns available)
          const hasColumns = files.some((f: any) => f.headers && Array.isArray(f.headers) && f.headers.length > 0);
          setHasCsvFiles(files.length > 0 && hasColumns);
        } else {
          setHasCsvFiles(false);
        }
      } catch (e) {
        setHasCsvFiles(false);
      }
    };
    
    checkCsvFiles();
    
    // Listen for storage changes
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'db_csv_files') {
        checkCsvFiles();
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    const interval = setInterval(checkCsvFiles, 1000);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);
  
  // Check database connection status and listen for changes
  useEffect(() => {
    const checkConnection = () => {
      setDbConnected(isDatabaseConnected());
    };
    
    // Initial check
    checkConnection();
    
    // Listen for database updates
    const handleDatabaseUpdate = () => {
      // Small delay to ensure database is initialized
      setTimeout(checkConnection, 200);
    };
    
    window.addEventListener('databaseUpdated', handleDatabaseUpdate);
    
    // Also poll periodically if not connected (to catch async initialization)
    const interval = setInterval(() => {
      if (!dbConnected) {
        checkConnection();
      }
    }, 1000);
    
    return () => {
      window.removeEventListener('databaseUpdated', handleDatabaseUpdate);
      clearInterval(interval);
    };
  }, [dbConnected]);
  
  // Load context sections from localStorage
  useEffect(() => {
    const loadContextSections = () => {
      try {
        const saved = localStorage.getItem("db_context_sections");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log('ChatMain: Loaded context sections:', parsed.length);
            setContextSections(parsed);
          } else {
            console.log('ChatMain: No context sections found or empty array');
            setContextSections([]);
          }
        } else {
          console.log('ChatMain: No context sections in localStorage');
          setContextSections([]);
        }
      } catch (e) {
        console.error('Error loading context sections:', e);
        setContextSections([]);
      }
    };
    
    loadContextSections();
    
    // Listen for storage changes (when context sections are updated in settings)
    const handleStorageChange = () => {
      loadContextSections();
    };
    
    // Listen for custom event when context sections are updated in same window
    const handleContextSectionsUpdate = () => {
      loadContextSections();
    };
    
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('contextSectionsUpdated', handleContextSectionsUpdate);
    
    // Also check periodically in case of same-window updates (faster polling)
    const interval = setInterval(loadContextSections, 500);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('contextSectionsUpdated', handleContextSectionsUpdate);
      clearInterval(interval);
    };
  }, []);
  
  // Restore filter selections when switching chats
  useEffect(() => {
    if (chat?.id) {
      // Restore selections from chat object
      const restoredColumns = chat.matchFilterColumns || [];
      const restoredValues = chat.matchFilterValues || {};
      
      // IMPORTANT: Filter out any values for columns not in matchFilterColumns
      // This ensures display columns are never included in the restored values
      const filteredRestoredValues: Record<string, string | null> = {};
      restoredColumns.forEach(col => {
        if (restoredValues[col] != null) {
          filteredRestoredValues[col] = restoredValues[col];
        }
      });
      
      setMatchFilterColumns(restoredColumns);
      setMatchFilterValues(filteredRestoredValues);
      setMatchDisplayColumns(chat.matchDisplayColumns || []);
      setMatchDisplayValues(chat.matchDisplayValues || {});
      setCsvFilterColumns(chat.csvFilterColumns || []);
      setCsvFilterValues(chat.csvFilterValues || {});
      setCsvDisplayColumns(chat.csvDisplayColumns || []);
      setCsvDisplayValues(chat.csvDisplayValues || {});
      setSelectedCsvIds(chat.selectedCsvIds || []);
      setSelectedContextSectionId(chat.selectedContextSectionId !== undefined ? chat.selectedContextSectionId : "none");
    } else {
      // Reset when no chat is selected
      setMatchFilterColumns([]);
      setMatchFilterValues({});
      setMatchDisplayColumns([]);
      setMatchDisplayValues({});
      setCsvFilterColumns([]);
      setCsvFilterValues({});
      setCsvDisplayColumns([]);
      setCsvDisplayValues({});
      setSelectedCsvIds([]);
      setSelectedContextSectionId("none");
    }
  }, [chat?.id]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isUserScrollingRef = useRef(false);
  const shouldAutoScrollRef = useRef(true);
  const { toast } = useToast();

  // Check if current model supports reasoning
  const currentModel = chat?.model || (DEFAULT_MODEL || "");
  const supportsReasoning = currentModel.includes('sherlock-think') || currentModel.includes('think') || currentModel.includes('deepseek-r1');
  const reasoningEnabled = chat?.reasoningEnabled ?? true; // Default to true for new chats
  
  // Check if current_selection exists (grouped data selection) - for both match and CSV
  const [hasCurrentSelection, setHasCurrentSelection] = useState(false);
  const [currentSelectionValueInfo, setCurrentSelectionValueInfo] = useState<any | null>(null);
  useEffect(() => {
    const checkCurrentSelection = () => {
      // Check for match filter selections
      const hasMatchFilterSelection = matchFilterColumns.length > 0 && Object.keys(matchFilterValues).some(col => matchFilterValues[col] !== null);
      // Check for CSV filter selections
      const hasCsvFilterSelection = csvFilterColumns.length > 0 && Object.keys(csvFilterValues).some(col => csvFilterValues[col] !== null);
      
      // Determine which type to check (match takes precedence if both exist)
      const typeToCheck = hasMatchFilterSelection ? 'match' : (hasCsvFilterSelection ? 'csv' : null);
      const filterColumns = hasMatchFilterSelection ? matchFilterColumns : csvFilterColumns;
      const filterValues = hasMatchFilterSelection ? matchFilterValues : csvFilterValues;
      
      if (!typeToCheck || filterColumns.length === 0) {
        // No filter selection means no current_selection for this chat
        setHasCurrentSelection(false);
        setCurrentSelectionValueInfo(null);
        return;
      }
      
      // Pass chatId to getValueInfo so it can find the correct current_selection for this chat
      const currentSelection = getValueInfo('current_selection', typeToCheck, chat?.id);
      
      // Verify this selection belongs to the current chat (check chatId or usedByChats)
      const belongsToCurrentChat = !chat?.id || 
        !currentSelection ||
        currentSelection.chatId === chat.id || 
        (currentSelection.usedByChats && currentSelection.usedByChats.includes(chat.id));
      
      // Check if Value Info exists and matches current filter selection
      // We don't require data to exist (it can be re-queried), but we check if filterColumns/filterValues match
      let matchesCurrentSelection = false;
      if (currentSelection && belongsToCurrentChat) {
        // Get current group columns (columns with values)
        const currentGroupColumns = filterColumns.filter(col => filterValues[col] != null).sort();
        const storedGroupColumns = (currentSelection.filterColumns || []).sort();
        
        // Check if columns match
        if (currentGroupColumns.length === storedGroupColumns.length &&
            currentGroupColumns.every((col, idx) => col === storedGroupColumns[idx])) {
          // Check if values match
          matchesCurrentSelection = currentGroupColumns.every(col => 
            currentSelection.filterValues?.[col] === filterValues[col]
          );
        }
      }
      
      if (currentSelection && belongsToCurrentChat && matchesCurrentSelection) {
        setHasCurrentSelection(true);
        setCurrentSelectionValueInfo(currentSelection);
      } else {
        setHasCurrentSelection(false);
        setCurrentSelectionValueInfo(null);
      }
    };
    checkCurrentSelection();
    // Check more frequently to catch changes and keep banner visible
    const interval = setInterval(checkCurrentSelection, 500);
    return () => clearInterval(interval);
  }, [matchFilterColumns, matchFilterValues, csvFilterColumns, csvFilterValues, chat?.id]);
  
  // Check if user has made filter selections (even if Value Info hasn't been created yet)
  const hasFilterSelections = (matchFilterColumns.length > 0 && Object.keys(matchFilterValues).some(col => matchFilterValues[col] !== null)) ||
                              (csvFilterColumns.length > 0 && Object.keys(csvFilterValues).some(col => csvFilterValues[col] !== null));
  
  // Enable volleyball context if match data is loaded OR if grouped data is selected
  // IMPORTANT: hasCurrentSelection already verifies the Value Info belongs to the current chat
  // Also check if user has filter selections (they might be in the process of selecting)
  const hasData = matchData || hasCurrentSelection || hasFilterSelections;
  // Only enable VB if we have data AND it belongs to this chat
  const volleyballContextEnabled = hasData ? (chat?.volleyballContextEnabled ?? true) : false;
  
  // Auto-enable VB when data becomes available
  useEffect(() => {
    if (hasData && chat && onUpdateVolleyballContext) {
      // Auto-enable when data becomes available (if setting is undefined or false)
      // This ensures VB is on when data is selected
      if (chat.volleyballContextEnabled === undefined || chat.volleyballContextEnabled === false) {
        onUpdateVolleyballContext(chat.id, true);
      }
    }
    // Note: If no chat exists yet, VB will still show as enabled if hasData is true
    // The button will be enabled once a chat is created
  }, [hasData, chat?.id, chat?.volleyballContextEnabled, onUpdateVolleyballContext]);

  // Check if user is near bottom of scroll container
  const isNearBottom = (): boolean => {
    if (!messagesContainerRef.current) return true;
    const container = messagesContainerRef.current;
    const threshold = 150; // pixels from bottom
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceFromBottom < threshold;
  };

  const scrollToBottom = (force: boolean = false) => {
    // Only auto-scroll if user is near bottom or if forced
    if (!force && !shouldAutoScrollRef.current) {
      return;
    }
    
    // Use setTimeout to ensure DOM has updated
    setTimeout(() => {
      if (messagesContainerRef.current) {
        // Scroll the messages container, not the whole page
        messagesContainerRef.current.scrollTo({
          top: messagesContainerRef.current.scrollHeight,
          behavior: "smooth"
        });
        // Update ref to indicate we're at bottom
        shouldAutoScrollRef.current = true;
      }
    }, 100);
  };

  // Track scroll position to determine if we should auto-scroll
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Check if user manually scrolled
      if (isUserScrollingRef.current) {
        // User is manually scrolling - check if they're near bottom
        shouldAutoScrollRef.current = isNearBottom();
      } else {
        // Programmatic scroll - assume we're at bottom
        shouldAutoScrollRef.current = isNearBottom();
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    
    // Also check on wheel and touch events to detect manual scrolling
    const handleWheel = () => {
      isUserScrollingRef.current = true;
      setTimeout(() => {
        isUserScrollingRef.current = false;
      }, 1000);
    };

    const handleTouchStart = () => {
      isUserScrollingRef.current = true;
    };

    const handleTouchEnd = () => {
      setTimeout(() => {
        isUserScrollingRef.current = false;
        // Check position after touch ends
        shouldAutoScrollRef.current = isNearBottom();
      }, 100);
    };

    container.addEventListener('wheel', handleWheel, { passive: true });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);

  // Auto-scroll only if user is near bottom (smart scrolling)
  useEffect(() => {
    // Check if we should auto-scroll before scrolling
    if (shouldAutoScrollRef.current || isNearBottom()) {
      scrollToBottom(false);
    } else {
      // User has scrolled up - don't auto-scroll, but update ref
      shouldAutoScrollRef.current = false;
    }
  }, [chat?.messages]);

  // Load match data when match is selected
  useEffect(() => {
    if (chat?.selectedMatch) {
      // Reset match data first to trigger reload
      setMatchData(null);
      
      loadMatchData(chat.selectedMatch)
        .then(data => {
          setMatchData(data);
          console.log("Match data loaded successfully:", data);
        })
        .catch(error => {
          console.error("Error loading match data:", error);
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          toast({
            title: "Error Loading Match Data",
            description: errorMessage,
            variant: "destructive",
          });
        });
    } else {
      setMatchData(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.selectedMatch]);

  // Don't auto-inspect CSV data when selected - only inspect when group by values are selected
  // This prevents CSVs from being set as active dataset until group by is used

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Clear previous images (only one at a time)
    setSelectedImages([]);

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (result) {
        setSelectedImages([result]);
      }
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePaste = async (event: React.ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    // Look for image in clipboard
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf('image') !== -1) {
        event.preventDefault(); // Prevent pasting image as text
        
        const file = item.getAsFile();
        if (!file) continue;

        // Clear previous images (only one at a time)
        setSelectedImages([]);

        const reader = new FileReader();
        reader.onload = (e) => {
          const result = e.target?.result as string;
          if (result) {
            setSelectedImages([result]);
            toast({
              title: "Image pasted",
              description: "Image ready to send",
            });
          }
        };
        reader.readAsDataURL(file);
        return;
      }
    }
  };

  const removeImage = () => {
    setSelectedImages([]);
  };

  const handleSend = async () => {
    if ((!input.trim() && selectedImages.length === 0) || !chat || isLoading) return;

    const originalUserInput = input.trim();
    const imagesToSend = [...selectedImages];

    const userMessage: Message = {
      role: "user",
      content: originalUserInput || "",
      timestamp: Date.now(),
      images: imagesToSend.length > 0 ? imagesToSend : undefined,
      model: currentModel,
    };

    setInput("");
    setSelectedImages([]);
    setIsLoading(true);

    // Regular chat message
    // IMPORTANT: Use functional update pattern to ensure we always have the latest messages
    // Store the initial message count to track what we've added
    const initialMessageCount = chat.messages.length;
    const updatedMessages = [...chat.messages, userMessage];
    let assistantContent = "";
    
    // Create initial assistant message
    const initialAssistantMessage: Message = {
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      model: currentModel,
    };
    onUpdateMessages(chat.id, [...updatedMessages, initialAssistantMessage]);

    try {
      await sendChatMessage(
        userMessage.content,
        userMessage.images || [],
        chat.messages, // Pass all previous messages (excluding the one we just added, which is passed as 'message')
        matchData,
        currentModel,
        reasoningEnabled,
        volleyballContextEnabled,
    (chunk) => {
          assistantContent += chunk;
          
          // Try to extract execution results from code execution result blocks
          // Look for "Code Execution Result" followed by JSON code blocks
          let executionResultsData: any = null;
      const executionResultPattern = /Code Execution Result[^`]*```json\s*([\s\S]*?)\s*```/;
          const executionResultMatch = assistantContent.match(executionResultPattern);
          if (executionResultMatch) {
            try {
              const jsonData = JSON.parse(executionResultMatch[1]);
              // Check if it looks like team stats or player data (or any structured data)
              if (jsonData && typeof jsonData === 'object' && Object.keys(jsonData).length > 0) {
                executionResultsData = jsonData;
      }
      
      // Helper to extract JSON that appears directly after "Code Execution Result"
      const extractJsonAfterMarker = (text: string, marker: string) => {
        const markerIndex = text.lastIndexOf(marker);
        if (markerIndex === -1) return null;
        
        const braceStart = text.indexOf('{', markerIndex);
        const bracketStart = text.indexOf('[', markerIndex);
        
        let start = -1;
        let opener = '';
        let closer = '';
        
        if (braceStart === -1 && bracketStart === -1) return null;
        
        if (braceStart !== -1 && (bracketStart === -1 || braceStart < bracketStart)) {
          start = braceStart;
          opener = '{';
          closer = '}';
        } else {
          start = bracketStart;
          opener = '[';
          closer = ']';
        }
        
        let depth = 0;
        for (let i = start; i < text.length; i++) {
          const char = text[i];
          if (char === opener) {
            depth++;
          } else if (char === closer) {
            depth--;
            if (depth === 0) {
              const jsonStr = text.slice(start, i + 1);
              try {
                return JSON.parse(jsonStr);
              } catch (e) {
                return null;
              }
            }
          }
        }
        return null;
      };
      
      if (!executionResultsData) {
        const parsed = extractJsonAfterMarker(assistantContent, 'Code Execution Result');
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          executionResultsData = parsed;
        }
      }
            } catch (e) {
              // Not valid JSON, ignore
            }
          }
          
          // Also try to find any JSON blocks that look like execution results
          if (!executionResultsData) {
            const allJsonBlocks = assistantContent.match(/```json\s*([\s\S]*?)\s*```/g);
            if (allJsonBlocks) {
              for (const block of allJsonBlocks) {
                const jsonMatch = block.match(/```json\s*([\s\S]*?)\s*```/);
                if (jsonMatch) {
                  try {
                    const jsonData = JSON.parse(jsonMatch[1]);
                    // Check if it looks like structured data (team stats, player data, etc.)
                    if (jsonData && typeof jsonData === 'object' && 
                        (jsonData.teamStats || jsonData.ucsdTopPlayers || jsonData.nauTopPlayers || 
                         Object.keys(jsonData).length > 3)) {
                      executionResultsData = jsonData;
                      break;
                    }
                  } catch (e) {
                    // Not valid JSON, continue
                  }
                }
              }
            }
          }
          
          const assistantMessage: Message = {
            role: "assistant",
            content: assistantContent,
            timestamp: initialAssistantMessage.timestamp,
            model: currentModel,
            executionResults: executionResultsData || undefined
          };
          
          // CRITICAL: Always get the latest messages from state to avoid losing messages
          // Use functional update to ensure we have the most recent messages
          onUpdateMessages(chat.id, (prevMessages) => {
            // Ensure we have at least the initial messages + user message
            // If prevMessages is shorter than expected, use updatedMessages as base
            const baseMessages = prevMessages.length >= initialMessageCount + 1 
              ? prevMessages.slice(0, initialMessageCount + 1) // Keep user message, remove any incomplete assistant messages
              : updatedMessages;
            
            // Check for duplicate summaries and remove old ones
            const isSummaryLike = (content: string) => {
              const summaryKeywords = ['summary', 'match summary', 'comprehensive', 'team stats', 'player performance', 'strategies'];
              const lowerContent = content.toLowerCase();
              return summaryKeywords.some(keyword => lowerContent.includes(keyword)) && 
                     (lowerContent.includes('ucsd') || lowerContent.includes('nau') || lowerContent.includes('northern arizona'));
            };
            
            let messagesToUpdate = [...baseMessages, assistantMessage];
            
            // If this looks like a summary, remove older duplicate summaries
            if (isSummaryLike(assistantContent)) {
              messagesToUpdate = messagesToUpdate.filter((msg, idx) => {
                // Keep the current message (last one)
                if (idx === messagesToUpdate.length - 1) return true;
                // Remove older assistant messages that are summaries
                if (msg.role === 'assistant' && isSummaryLike(msg.content)) {
                  return false;
                }
                return true;
              });
            }
            
            return messagesToUpdate;
          });
        },
        () => {
          setIsLoading(false);
        },
        (error) => {
          setIsLoading(false);
          toast({
            title: "Error",
            description: error,
            variant: "destructive",
          });
        },
        selectedCsvIds,
        csvFilterColumns,
        csvFilterValues,
        chat.id,
        matchFilterColumns,
        matchFilterValues,
        selectedContextSectionId
      );
    } catch (error) {
      setIsLoading(false);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleToggleReasoning = () => {
    if (!chat || !onUpdateReasoning) return;
    onUpdateReasoning(chat.id, !reasoningEnabled);
  };

  const handleToggleVolleyballContext = () => {
    if (!chat || !onUpdateVolleyballContext) return;
    // Allow toggling if we have match data OR grouped selection
    if (!matchData && !hasCurrentSelection) return;
    onUpdateVolleyballContext(chat.id, !volleyballContextEnabled);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!chat) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p className="text-lg mb-4">No chat selected</p>
          <p className="text-sm">Create a new chat to get started</p>
        </div>
      </div>
    );
  }

  const showWelcome = chat && chat.messages.length === 0;

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border/50">
        {/* Dataset Info Banner - always show what data is being used, or context section if selected */}
        {/* Only show banner when there's actual data selected (not just CSVs without group by) */}
        {(chat && chat.selectedMatch && matchData) || hasCurrentSelection || hasFilterSelections || (selectedContextSectionId && selectedContextSectionId !== "none" && contextSections.length > 0) ? (
          <div className="px-4 py-2 bg-muted/50 border-b border-border/30">
            <div className="text-sm font-medium text-foreground flex items-center justify-between gap-4 flex-wrap">
              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                {(chat && chat.selectedMatch && matchData) || hasCurrentSelection || hasFilterSelections ? (
                  <span className="text-muted-foreground">Active Dataset:</span>
                ) : (
                  <span className="text-muted-foreground">Active Context:</span>
                )}
              
              {/* Show grouped selection if it exists and matches current filters (takes precedence) */}
              {hasCurrentSelection && currentSelectionValueInfo && currentSelectionValueInfo.name ? (
                <>
                  <span className="text-foreground">{currentSelectionValueInfo.name}</span>
                  {(currentSelectionValueInfo.data && Array.isArray(currentSelectionValueInfo.data)) || currentSelectionValueInfo.rowCount ? (
                    <span className="text-muted-foreground">
                      <span className="ml-1">|</span>
                      <span className="ml-1">Rows:</span>
                      <span className="font-mono text-xs ml-1">
                        {currentSelectionValueInfo.data?.length || currentSelectionValueInfo.rowCount || 'N/A'}
                      </span>
                    </span>
                  ) : null}
                </>
              ) : hasFilterSelections ? (
                // Show filter selections even if Value Info hasn't been created yet
                // Only show columns that are in matchFilterColumns AND have values (excludes display columns)
                <>
                  <span className="text-foreground">
                    Selected Group: {matchFilterColumns
                      .filter(col => matchFilterValues[col] != null)
                      .map(col => `${col}=${matchFilterValues[col]}`)
                      .join(', ')}
                  </span>
                </>
              ) : (csvFilterColumns.length > 0 && Object.keys(csvFilterValues).some(col => csvFilterValues[col] != null)) ? (
                // Show CSV filter selections (grouped CSV data)
                <>
                  <span className="text-foreground">
                    Selected Group: {csvFilterColumns
                      .filter(col => csvFilterValues[col] != null)
                      .map(col => `${col}=${csvFilterValues[col]}`)
                      .join(', ')}
                  </span>
                </>
              ) : null}
              
              {/* Show match data if no grouped selection */}
              {!hasCurrentSelection && !hasFilterSelections && chat.selectedMatch && matchData && (
                <>
                  <span className="text-foreground">{matchData.matchInfo.home_team} vs {matchData.matchInfo.visiting_team}</span>
                  <span className="text-muted-foreground">
                    <span className="ml-1">|</span>
                    <span className="ml-1">ID:</span>
                    <span className="font-mono text-xs ml-1">{chat.selectedMatch}</span>
                  </span>
                </>
              )}
              
              {/* Show CSV files if selected - but only if there's a group by selection, otherwise don't show in banner */}
              {/* CSV files are just the "table" - they don't become active dataset until group by is used */}
              
              {/* Show context section in main banner if no data but context is selected */}
              {!hasCurrentSelection && !hasFilterSelections && !chat.selectedMatch && selectedContextSectionId && selectedContextSectionId !== "none" && contextSections.length > 0 && (
                <span className="text-foreground">
                  {(() => {
                    const section = contextSections.find(s => s.id === selectedContextSectionId);
                    return section?.title || `Section ${selectedContextSectionId}`;
                  })()}
                </span>
              )}
              </div>
              
              {/* Display Values and Context Section - shown on the right side */}
              {((matchDisplayColumns.length > 0 && Object.keys(matchDisplayValues).some(col => matchDisplayValues[col] != null)) ||
                (csvDisplayColumns.length > 0 && Object.keys(csvDisplayValues).some(col => csvDisplayValues[col] != null)) ||
                (selectedContextSectionId && selectedContextSectionId !== "none" && contextSections.length > 0 && ((chat && chat.selectedMatch && matchData) || hasCurrentSelection || hasFilterSelections))) && (
                <div className="flex items-center gap-2 flex-shrink-0 text-xs text-muted-foreground whitespace-nowrap">
                  {/* Match display values */}
                  {matchDisplayColumns
                    .filter(col => matchDisplayValues[col] != null)
                    .map((col, idx) => (
                      <span key={`match-${col}`} className="flex items-center">
                        {idx > 0 && <span className="mx-1.5">•</span>}
                        <span className="font-medium">{col}:</span>
                        <span className="ml-1">{matchDisplayValues[col]}</span>
                      </span>
                    ))}
                  {/* CSV display values */}
                  {csvDisplayColumns
                    .filter(col => csvDisplayValues[col] != null)
                    .map((col, idx) => (
                      <span key={`csv-${col}`} className="flex items-center">
                        {(matchDisplayColumns.length > 0 || idx > 0) && <span className="mx-1.5">•</span>}
                        <span className="font-medium">{col}:</span>
                        <span className="ml-1">{csvDisplayValues[col]}</span>
                      </span>
                    ))}
                  {/* Context Section */}
                  {selectedContextSectionId && contextSections.length > 0 && (
                    <span className="flex items-center">
                      {(matchDisplayColumns.length > 0 || csvDisplayColumns.length > 0) && <span className="mx-1.5">•</span>}
                      <span className="font-medium">Context:</span>
                      <span className="ml-1">
                        {selectedContextSectionId === "none" 
                          ? "None" 
                          : selectedContextSectionId === null || selectedContextSectionId === "all"
                          ? "All Sections"
                          : (() => {
                              const section = contextSections.find(s => s.id === selectedContextSectionId);
                              return section?.title || `Section ${selectedContextSectionId}`;
                            })()}
                      </span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : null}
        {/* Only show selectors before first message */}
        {chat && chat.messages.length === 0 && (
          <div className="p-4 flex items-center gap-3">
            {!sidebarOpen && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleSidebar}
                className="hover:bg-chat-hover"
              >
                <Menu className="h-5 w-5" />
              </Button>
            )}
            <div className="flex-1">
              <div className="flex gap-2 items-end">
                {/* SQL Group By - appears when database is connected */}
                {(dbConnected || isDatabaseConnected()) && (
                  <div className="flex-1">
                    <MatchSelector
                      selectedMatch={chat.selectedMatch}
                      selectedFilterColumns={matchFilterColumns}
                      selectedFilterValues={matchFilterValues}
                      chatId={chat.id}
                      disabled={csvFilterColumns.length > 0 && Object.keys(csvFilterValues).some(col => csvFilterValues[col] != null)}
                      onSelectMatch={(matchId, filterColumns, filterValues, displayColumns, displayValues) => {
                    console.log('ChatMain onSelectMatch called with:', { matchId, filterColumns, filterValues, displayColumns, displayValues });
                    // If matchId is null, we're using grouped selection - clear match selection
                    if (matchId === null) {
                      onUpdateMatch(chat.id, null);
                      setMatchData(null); // Clear match data so current_selection takes precedence
                    } else {
                      onUpdateMatch(chat.id, matchId);
                      setMatchData(null); // Reset match data to trigger reload
                    }
                    const newColumns = filterColumns || [];
                    const newValues = filterValues || {};
                    const newDisplayColumns = displayColumns || [];
                    const newDisplayValues = displayValues || {};
                    // IMPORTANT: newColumns should already only contain group columns (no display columns)
                    // But we still filter to ensure only columns in newColumns with non-null values are included
                    // This ensures display columns are completely removed
                    const filteredNewValues: Record<string, string | null> = {};
                    newColumns.forEach(col => {
                      if (newValues[col] != null) {
                        filteredNewValues[col] = newValues[col];
                      }
                    });
                    // Also explicitly remove any values for columns NOT in newColumns (safety check)
                    // This ensures display columns are completely removed from state
                    Object.keys(matchFilterValues).forEach(col => {
                      if (!newColumns.includes(col) && matchFilterValues[col] != null) {
                        // This column is not in newColumns, remove it (might be a display column)
                        console.log('ChatMain: Removing value for column not in newColumns:', col);
                        delete filteredNewValues[col]; // Explicitly remove it
                      }
                    });
                    setMatchFilterColumns(newColumns);
                    setMatchFilterValues(filteredNewValues);
                    setMatchDisplayColumns(newDisplayColumns);
                    setMatchDisplayValues(newDisplayValues);
                    
                    // Clear CSV grouped selection when SQL selection is made (but keep CSV files selected)
                    if (newColumns.length > 0 && Object.keys(filteredNewValues).some(col => filteredNewValues[col] != null)) {
                      // Don't clear selectedCsvIds - keep CSV files selected so UI remains visible
                      // Only clear the filter columns/values (grouped selection)
                      setCsvFilterColumns([]);
                      setCsvFilterValues({});
                      setCsvDisplayColumns([]);
                      setCsvDisplayValues({});
                    }
                    
                    // Save to chat object
                    if (onUpdateFilters) {
                      onUpdateFilters(chat.id, {
                        matchFilterColumns: newColumns,
                        matchFilterValues: filteredNewValues,
                        matchDisplayColumns: newDisplayColumns,
                        matchDisplayValues: newDisplayValues,
                        csvFilterColumns: newColumns.length > 0 && Object.keys(filteredNewValues).some(col => filteredNewValues[col] != null) ? [] : csvFilterColumns,
                        csvFilterValues: newColumns.length > 0 && Object.keys(filteredNewValues).some(col => filteredNewValues[col] != null) ? {} : csvFilterValues,
                        csvDisplayColumns: newColumns.length > 0 && Object.keys(filteredNewValues).some(col => filteredNewValues[col] != null) ? [] : csvDisplayColumns,
                        csvDisplayValues: newColumns.length > 0 && Object.keys(filteredNewValues).some(col => filteredNewValues[col] != null) ? {} : csvDisplayValues,
                        selectedCsvIds: selectedCsvIds, // Keep CSV files selected even when SQL has grouped selection
                        selectedContextSectionId,
                      });
                    }
                    console.log('State updated - matchFilterColumns:', newColumns, 'matchFilterValues:', filteredNewValues);
                  }}
                    />
                  </div>
                )}
                {/* CSV Group By - appears when CSV files are uploaded */}
                {/* CSV File Upload/Selection with Group By - always visible */}
                <div className="flex-1">
                  <CSVSelector
                    selectedCsvIds={selectedCsvIds}
                    selectedFilterColumns={csvFilterColumns}
                    selectedFilterValues={csvFilterValues}
                    chatId={chat.id}
                    showGroupBy={false}
                    disabled={matchFilterColumns.length > 0 && Object.keys(matchFilterValues).some(col => matchFilterValues[col] != null)}
                    onSelectCsv={(csvIds, filterColumns, filterValues, displayColumns, displayValues) => {
                      console.log('ChatMain onSelectCsv called with:', { csvIds, filterColumns, filterValues, displayColumns, displayValues });
                      const newCsvIds = csvIds || [];
                      const newColumns = filterColumns || [];
                      const newValues = filterValues || {};
                      const newDisplayColumns = displayColumns || [];
                      const newDisplayValues = displayValues || {};
                      
                      // Filter to only include group columns with values
                      const filteredNewValues: Record<string, string | null> = {};
                      newColumns.forEach(col => {
                        if (newValues[col] != null) {
                          filteredNewValues[col] = newValues[col];
                        }
                      });
                      
                      setSelectedCsvIds(newCsvIds);
                      setCsvFilterColumns(newColumns);
                      setCsvFilterValues(filteredNewValues);
                      setCsvDisplayColumns(newDisplayColumns);
                      setCsvDisplayValues(newDisplayValues);
                      
                      // Clear SQL grouped selection when CSV selection is made (but keep match selected if it exists)
                      if (newColumns.length > 0 && Object.keys(filteredNewValues).some(col => filteredNewValues[col] != null)) {
                        // Only clear the filter columns/values (grouped selection), not the match itself
                        setMatchFilterColumns([]);
                        setMatchFilterValues({});
                        setMatchDisplayColumns([]);
                        setMatchDisplayValues({});
                        // Don't clear chat.selectedMatch - keep it so UI remains visible
                      }
                      
                      // Save to chat object
                      if (onUpdateFilters) {
                        onUpdateFilters(chat.id, {
                          matchFilterColumns: newColumns.length > 0 && Object.keys(filteredNewValues).some(col => filteredNewValues[col] != null) ? [] : matchFilterColumns,
                          matchFilterValues: newColumns.length > 0 && Object.keys(filteredNewValues).some(col => filteredNewValues[col] != null) ? {} : matchFilterValues,
                          matchDisplayColumns: newColumns.length > 0 && Object.keys(filteredNewValues).some(col => filteredNewValues[col] != null) ? [] : matchDisplayColumns,
                          matchDisplayValues: newColumns.length > 0 && Object.keys(filteredNewValues).some(col => filteredNewValues[col] != null) ? {} : matchDisplayValues,
                          csvFilterColumns: newColumns,
                          csvFilterValues: filteredNewValues,
                          csvDisplayColumns: newDisplayColumns,
                          csvDisplayValues: newDisplayValues,
                          selectedCsvIds: newCsvIds,
                          selectedContextSectionId,
                        });
                      }
                      console.log('State updated - csvFilterColumns:', newColumns, 'selectedCsvIds:', newCsvIds);
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Show menu button when messages exist but selectors are hidden */}
        {chat.messages.length > 0 && !sidebarOpen && (
          <div className="p-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleSidebar}
              className="hover:bg-chat-hover"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        )}
        {chat && chat.messages.length === 0 && onUpdateModel && (
          <ModelSelector
            selectedModel={chat.model || (DEFAULT_MODEL || "")}
            onSelectModel={(modelId) => onUpdateModel(chat.id, modelId)}
          />
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto" ref={messagesContainerRef}>
        {showWelcome ? (
          <WelcomeScreen />
        ) : (
          <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
            {/* Only render last 100 messages for performance, show indicator if more exist */}
            {chat.messages.length > 100 && (
              <div className="text-center text-sm text-muted-foreground py-2">
                Showing last 100 messages ({chat.messages.length - 100} older messages hidden)
              </div>
            )}
            {chat.messages.slice(-100).map((message, index) => (
              <ChatMessage key={`${message.timestamp}-${index}`} message={message} />
            ))}
            {isLoading && (
              <div className="flex gap-3 animation-fade-in">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-semibold flex-shrink-0">
                  AI
                </div>
                <div className="flex-1 bg-chat-assistant rounded-lg p-4">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border/50 p-4">
        <div className="max-w-6xl mx-auto">
          {selectedImages.length > 0 && (
            <div className="mb-2 flex gap-2">
              {selectedImages.map((img, idx) => (
                <div key={idx} className="relative">
                  <img
                    src={img}
                    alt="Preview"
                    className="w-20 h-20 object-cover rounded-lg border border-border"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute -top-2 -right-2 h-6 w-6 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={removeImage}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          {/* Context Section Selector - always visible */}
          <div className="mb-3 flex items-center gap-2">
            <label className="text-sm text-muted-foreground whitespace-nowrap">Context Section:</label>
            <div className="w-48">
              <Select
                value={selectedContextSectionId === null || selectedContextSectionId === undefined ? "none" : selectedContextSectionId}
                onValueChange={(value: string) => {
                  // "all" = null (combine all sections), "none" = "none" (no sections), otherwise = section id
                  const newId = value === "all" ? null : value;
                  setSelectedContextSectionId(newId);
                  if (onUpdateFilters && chat) {
                    onUpdateFilters(chat.id, {
                      matchFilterColumns,
                      matchFilterValues,
                      matchDisplayColumns,
                      matchDisplayValues,
                      csvFilterColumns,
                      csvFilterValues,
                      csvDisplayColumns,
                      csvDisplayValues,
                      selectedCsvIds,
                      selectedContextSectionId: newId,
                    });
                  }
                }}
                disabled={contextSections.length === 0}
              >
                <SelectTrigger className="h-9 bg-secondary">
                  <SelectValue placeholder={contextSections.length === 0 ? "No context sections" : "Context Section"} />
                </SelectTrigger>
                <SelectContent>
                  {contextSections.length > 0 ? (
                    <>
                      <SelectItem value="all">All Sections</SelectItem>
                      <SelectItem value="none">None</SelectItem>
                      {contextSections.map((section) => (
                        <SelectItem key={section.id} value={section.id}>
                          {section.title || `Section ${section.id}`}
                        </SelectItem>
                      ))}
                    </>
                  ) : (
                    <SelectItem value="none" disabled>
                      Configure in Settings
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 items-end">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageSelect}
              className="hidden"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              className="h-[60px] w-[60px] flex-shrink-0"
            >
              <ImageIcon className="h-4 w-4" />
            </Button>
            <div className="relative flex-1">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Ask about your data... (Paste images with Ctrl+V)"
                className={cn(
                  "min-h-[60px] max-h-[200px] resize-none bg-secondary border-border/50 focus:border-primary",
                  ((supportsReasoning && onUpdateReasoning) || onUpdateVolleyballContext) ? "pr-48" : "pr-2"
                )}
                disabled={isLoading}
              />
              <div className="absolute right-2 bottom-2 flex gap-1">
                {onUpdateVolleyballContext && (
                  <Button
                    type="button"
                    variant={volleyballContextEnabled ? "default" : "outline"}
                    size="sm"
                    onClick={handleToggleVolleyballContext}
                    disabled={!matchData && !hasCurrentSelection && !hasFilterSelections}
                    className={cn(
                      "h-8 px-2 text-xs flex items-center gap-1",
                      volleyballContextEnabled && "bg-primary text-primary-foreground",
                      !matchData && !hasCurrentSelection && !hasFilterSelections && "opacity-50 cursor-not-allowed"
                    )}
                    title={!matchData && !hasCurrentSelection && !hasFilterSelections ? "Select data first to enable volleyball context" : (volleyballContextEnabled ? "Volleyball context enabled" : "Volleyball context disabled - use as regular AI")}
                  >
                    <Target className="h-3 w-3" />
                    VB
                  </Button>
                )}
                {supportsReasoning && onUpdateReasoning && (
                  <Button
                    type="button"
                    variant={reasoningEnabled ? "default" : "outline"}
                    size="sm"
                    onClick={handleToggleReasoning}
                    className={cn(
                      "h-8 px-2 text-xs flex items-center gap-1",
                      reasoningEnabled && "bg-primary text-primary-foreground"
                    )}
                    title="Enable step-by-step reasoning (shows model's thinking process)"
                  >
                    <Brain className="h-3 w-3" />
                    Reasoning
                  </Button>
                )}
              </div>
            </div>
            <Button
              onClick={handleSend}
              disabled={(!input.trim() && selectedImages.length === 0) || isLoading}
              className="h-[60px] px-6 bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
};

export default ChatMain;

