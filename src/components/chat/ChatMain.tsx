import { useState, useRef, useEffect } from "react";
import { Menu, Send, Image as ImageIcon, Brain, X, Target, Eye, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Chat, Message, MatchData } from "@/types/chat";
import { sendChatMessage, DEFAULT_MODEL, getValueInfo } from "@/lib/chatApi";
import { loadMatchData, isDatabaseConnected } from "@/lib/database";
import MatchSelector from "./MatchSelector";
import CSVSelector from "./CSVSelector";
import WelcomeScreen from "./WelcomeScreen";
import ModelSelector from "./ModelSelector";
import { DataPreview } from "./DataPreview";
import { cn } from "@/lib/utils";
import { VirtualizedMessages } from "./VirtualizedMessages";
import { CodeExecutionDialog } from "./CodeExecutionDialog";
import { CodeBlock } from "@/lib/codeExecutorV2";

interface ChatMainProps {
  chat: Chat | undefined;
  pendingQuery?: string | null;
  onQueryProcessed?: () => void;
  onUpdateMessages: (chatId: string, messages: Message[] | ((prev: Message[]) => Message[])) => void;
  onUpdateMatch: (chatId: string, matchId: string | null) => void;
  onUpdateModel?: (chatId: string, model: string) => void;
  onUpdateReasoning?: (chatId: string, reasoningEnabled: boolean) => void;
  onUpdateVolleyballContext?: (chatId: string, volleyballContextEnabled: boolean) => void;
  onUpdateMaxFollowupDepth?: (chatId: string, maxFollowupDepth: number) => void;
  onUpdateFilters?: (
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
  ) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

const ChatMain = ({
  chat,
  pendingQuery,
  onQueryProcessed,
  onUpdateMessages,
  onUpdateMatch,
  onUpdateModel,
  onUpdateReasoning,
  onUpdateVolleyballContext,
  onUpdateMaxFollowupDepth,
  onUpdateFilters,
  sidebarOpen,
  onToggleSidebar,
}: ChatMainProps) => {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // Code execution approval state
  const [pendingCodeBlocks, setPendingCodeBlocks] = useState<CodeBlock[] | null>(null);
  const [codeApprovalResolver, setCodeApprovalResolver] = useState<((result: { approved: boolean; editedBlocks?: CodeBlock[] }) => void) | null>(null);
  
  // Handle pending queries from templates
  useEffect(() => {
    if (pendingQuery && !isLoading && chat) {
      setInput(pendingQuery);
      onQueryProcessed?.();
      // Trigger send after a short delay to ensure input is set
      setTimeout(() => {
        const sendButton = document.querySelector<HTMLButtonElement>('[data-send-button]');
        if (sendButton && !sendButton.disabled) {
          sendButton.click();
        }
      }, 100);
    }
  }, [pendingQuery, isLoading, chat, onQueryProcessed]);
  const [csvLoadingProgress, setCsvLoadingProgress] = useState<{ file: string; percent: number; rows?: number; error?: string } | null>(null);

  // Track previous chat ID to detect actual chat changes (not just object reference changes)
  const prevChatIdRef = useRef<string | undefined>(undefined);

  // Ensure any transient overlays/dialogs are cleared when switching/creating chats
  useEffect(() => {
    const currentChatId = chat?.id;
    // Only clear state if the chat ID actually changed (not just the object reference)
    if (prevChatIdRef.current !== currentChatId) {
      // Clear any pending overlays when a new chat is mounted
      setPendingCodeBlocks(null);
      setCodeApprovalResolver(null);
      setIsPreviewOpen(false);
      setPreviewData(null);
      // Reset loading states to ensure CSV selector isn't stuck disabled
      setIsLoading(false);
      setCsvLoadingProgress(null);
      prevChatIdRef.current = currentChatId;
    }
  }, [chat?.id]);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [matchData, setMatchData] = useState<MatchData | null>(null);
  const [selectedCsvIds, setSelectedCsvIds] = useState<string[]>([]);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{ data: any[]; fileName: string; headers: string[]; csvId?: string; totalRowCount?: number } | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [csvFilterColumns, setCsvFilterColumns] = useState<string[]>([]);
  const [csvFilterValues, setCsvFilterValues] = useState<Record<string, string | string[] | null>>({});
  const [csvDisplayColumns, setCsvDisplayColumns] = useState<string[]>([]);
  const [csvDisplayValues, setCsvDisplayValues] = useState<Record<string, string | null>>({});
  const [matchFilterColumns, setMatchFilterColumns] = useState<string[]>([]);
  const [matchFilterValues, setMatchFilterValues] = useState<Record<string, string | string[] | null>>({});
  const [matchDisplayColumns, setMatchDisplayColumns] = useState<string[]>([]);
  const [matchDisplayValues, setMatchDisplayValues] = useState<Record<string, string | null>>({});
  const [selectedContextSectionId, setSelectedContextSectionId] = useState<string | null>("none");
  const [contextSections, setContextSections] = useState<Array<{id: string, title: string, content: string}>>([]);
  const [dbConnected, setDbConnected] = useState(false);
  const maxFollowupDepth = chat?.maxFollowupDepth ?? 0; // 0 = no limit
  
  // Code execution approval handler
  const handleCodeExecutionRequest = (blocks: CodeBlock[]) => {
    return new Promise<{ approved: boolean; editedBlocks?: CodeBlock[] }>((resolve) => {
      const resolverWrapper = (result: { approved: boolean; editedBlocks?: CodeBlock[] }) => {
        resolve(result);
      };
      // CRITICAL: Use setTimeout to ensure React state update happens asynchronously
      // This prevents the Promise from resolving immediately if the state update is synchronous
      setTimeout(() => {
        setPendingCodeBlocks(blocks);
        setCodeApprovalResolver(() => resolverWrapper);
      }, 0); // Small delay to ensure state is set before Promise is awaited
    });
  };

  const handleCodeApproval = (editedBlocks?: CodeBlock[]) => {
    if (codeApprovalResolver) {
      const resolver = codeApprovalResolver;
      setPendingCodeBlocks(null);
      setCodeApprovalResolver(null);
      resolver({ approved: true, editedBlocks });
    } else {
      console.warn('⚠️ handleCodeApproval called but no resolver exists - execution should not proceed');
    }
  };

  const handleCodeRejection = () => {
    if (codeApprovalResolver) {
      const resolver = codeApprovalResolver;
      setPendingCodeBlocks(null);
      setCodeApprovalResolver(null);
      resolver({ approved: false });
    } else {
      console.warn('⚠️ handleCodeRejection called but no resolver exists');
    }
  };
  
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

    // Poll periodically if not connected (reduced from 1s to 5s to reduce CPU usage)
    // Keep running even when tab is hidden to allow background processing
    const interval = setInterval(() => {
      if (!dbConnected) {
        checkConnection();
      }
    }, 5000);

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
            setContextSections(parsed);
          } else {
            setContextSections([]);
          }
        } else {
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
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('contextSectionsUpdated', handleContextSectionsUpdate);
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
      // Restore CSV filter values - handle both string and array types
      const filteredRestoredValues: Record<string, string | string[] | null> = {};
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
      // Restore CSV filter values - handle both string and array types
      const restoredCsvValues: Record<string, string | string[] | null> = {};
      if (chat.csvFilterValues) {
        Object.keys(chat.csvFilterValues).forEach(col => {
          const val = chat.csvFilterValues![col];
          if (val != null) {
            restoredCsvValues[col] = val;
          }
        });
      }
      setCsvFilterValues(restoredCsvValues);
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
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isUserScrollingRef = useRef(false);
  const shouldAutoScrollRef = useRef(true);
  const { toast } = useToast();

  // Check if current model supports reasoning
  // Load default model from storage if no model is set
  const [defaultModel, setDefaultModel] = useState<string>("");
  
  useEffect(() => {
    const loadDefaultModel = async () => {
      try {
        // First, try to get the explicitly set default model
        const { getDefaultModelId } = await import("@/lib/openRouterModels");
        const defaultModelId = getDefaultModelId();
        if (defaultModelId) {
          setDefaultModel(defaultModelId);
          return;
        }

        // If no default model, try to get first model from default API provider
        const { getDefaultModelFromDefaultProvider } = await import("@/lib/apiKeys");
        const providerModel = getDefaultModelFromDefaultProvider();
        if (providerModel) {
          setDefaultModel(providerModel);
          return;
        }
      } catch (error) {
        // Ignore errors
      }
      setDefaultModel("");
    };

    loadDefaultModel();

    // Listen for default model updates so new chats get the updated default
    const handleDefaultModelUpdate = () => {
      loadDefaultModel();
    };

    window.addEventListener('default-model-updated', handleDefaultModelUpdate);

    return () => {
      window.removeEventListener('default-model-updated', handleDefaultModelUpdate);
    };
  }, []);
  
  const currentModel = chat?.model || defaultModel || DEFAULT_MODEL || "";
  const supportsReasoning = currentModel.includes('sherlock-think') || currentModel.includes('think') || currentModel.includes('deepseek-r1');
  const reasoningEnabled = chat?.reasoningEnabled ?? true; // Default to true for new chats
  
  // Auto-select default model if chat doesn't have one or if it's empty
  useEffect(() => {
    if (chat && onUpdateModel && defaultModel) {
      const currentModel = chat.model || "";
      // If chat has no model or empty model, set the default
      if (!currentModel) {
        onUpdateModel(chat.id, defaultModel);
      }
    }
  }, [chat?.id, chat?.model, onUpdateModel, defaultModel]);
  
  // Helper to check if a value is actually set (not null, not empty array)
  const hasValue = (val: any): boolean => {
    if (val == null) return false;
    if (Array.isArray(val)) return val.length > 0;
    return true;
  };
  
  // Check if current_selection exists (grouped data selection) - for both match and CSV
  const [hasCurrentSelection, setHasCurrentSelection] = useState(false);
  const [currentSelectionValueInfo, setCurrentSelectionValueInfo] = useState<any | null>(null);
  useEffect(() => {
    const checkCurrentSelection = () => {
      // Check for match filter selections
      const hasMatchFilterSelection = matchFilterColumns.length > 0 && Object.keys(matchFilterValues).some(col => hasValue(matchFilterValues[col]));
      // Check for CSV filter selections
      const hasCsvFilterSelection = csvFilterColumns.length > 0 && Object.keys(csvFilterValues).some(col => hasValue(csvFilterValues[col]));
      
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
        const currentGroupColumns = filterColumns.filter(col => hasValue(filterValues[col])).sort();
        const storedGroupColumns = (currentSelection.filterColumns || []).sort();
        
        // Check if columns match
        if (currentGroupColumns.length === storedGroupColumns.length &&
            currentGroupColumns.every((col, idx) => col === storedGroupColumns[idx])) {
          // Check if values match (handle arrays properly)
          matchesCurrentSelection = currentGroupColumns.every(col => {
            const storedValue = currentSelection.filterValues?.[col];
            const currentValue = filterValues[col];
            
            // Handle arrays - compare contents, not references
            if (Array.isArray(storedValue) && Array.isArray(currentValue)) {
              if (storedValue.length !== currentValue.length) return false;
              // Sort and compare as strings to handle order differences
              const storedSorted = [...storedValue].map(v => String(v)).sort().join(',');
              const currentSorted = [...currentValue].map(v => String(v)).sort().join(',');
              return storedSorted === currentSorted;
            }
            
            // Handle case where one is array and one is not
            if (Array.isArray(storedValue) && !Array.isArray(currentValue)) {
              // Array should contain the single value
              return storedValue.length === 1 && String(storedValue[0]) === String(currentValue);
            }
            if (!Array.isArray(storedValue) && Array.isArray(currentValue)) {
              // Array should contain the single value
              return currentValue.length === 1 && String(currentValue[0]) === String(storedValue);
            }
            
            // For non-arrays, use strict equality
            return storedValue === currentValue;
          });
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
    
    // No need for visibility change listener or polling - value info is already in localStorage
    // and will be loaded when component mounts. Excessive checking causes performance issues.
  }, [matchFilterColumns, matchFilterValues, csvFilterColumns, csvFilterValues, chat?.id]);
  
  // Check if user has made filter selections (even if Value Info hasn't been created yet)
  const hasFilterSelections = (matchFilterColumns.length > 0 && Object.keys(matchFilterValues).some(col => hasValue(matchFilterValues[col]))) ||
                              (csvFilterColumns.length > 0 && Object.keys(csvFilterValues).some(col => hasValue(csvFilterValues[col])));
  
  // Enable volleyball context if match data is loaded OR if grouped data is selected
  // IMPORTANT: hasCurrentSelection already verifies the Value Info belongs to the current chat
  // Also check if user has filter selections (they might be in the process of selecting)
  const hasData = matchData || hasCurrentSelection || hasFilterSelections;
  // Only enable VB if we have data AND it belongs to this chat
  const volleyballContextEnabled = hasData ? (chat?.volleyballContextEnabled ?? true) : false;
  
  // Auto-enable VB when data becomes available (only if never set before)
  useEffect(() => {
    if (hasData && chat && onUpdateVolleyballContext) {
      // Auto-enable ONLY when data becomes available AND setting is undefined (never been set)
      // This ensures VB is on by default when data is selected, but respects user's explicit choice to turn it off
      if (chat.volleyballContextEnabled === undefined) {
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

    let lastScrollTop = container.scrollTop;

    const handleScroll = () => {
      const currentScrollTop = container.scrollTop;

      // Detect if user is scrolling UP (not down or programmatic)
      if (currentScrollTop < lastScrollTop) {
        // User is actively scrolling UP - disable auto-scroll
        isUserScrollingRef.current = true;
        shouldAutoScrollRef.current = false;
      } else {
        // User scrolled down or programmatic scroll - check if near bottom
        shouldAutoScrollRef.current = isNearBottom();
      }

      lastScrollTop = currentScrollTop;
    };

    container.addEventListener('scroll', handleScroll, { passive: true });

    // Detect wheel/touch events to know when user is actively scrolling
    const handleWheel = (e: WheelEvent) => {
      // If scrolling up (negative deltaY), disable auto-scroll
      if (e.deltaY < 0) {
        isUserScrollingRef.current = true;
        shouldAutoScrollRef.current = false;
      }

      // Re-enable auto-scroll after 2 seconds of no scrolling
      setTimeout(() => {
        isUserScrollingRef.current = false;
        // Check if we're at bottom now
        if (isNearBottom()) {
          shouldAutoScrollRef.current = true;
        }
      }, 2000);
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
        })
        .catch(error => {
          console.error("Error loading match data:", error);
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          toast({
            title: "Error Loading Match Data",
            description: errorMessage,
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

  // Calculate current followup depth: count assistant messages after last user message
  const calculateFollowupDepth = (messages: Message[]): number => {
    if (messages.length === 0) return 0;
    
    // Find the last user message
    let lastUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserIndex = i;
        break;
      }
    }
    
    // If no user message found, or last message is user, depth is 0
    if (lastUserIndex === -1 || lastUserIndex === messages.length - 1) {
      return 0;
    }
    
    // Count assistant messages after the last user message
    let depth = 0;
    for (let i = lastUserIndex + 1; i < messages.length; i++) {
      if (messages[i].role === 'assistant') {
        depth++;
      }
    }
    
    return depth;
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
      setCsvLoadingProgress(null);
      toast({
        title: "Stopped",
        description: "AI response stopped",
      });
    }
  };

  const handleSend = async () => {
    // Allow sending if there's an error in progress (user can still send)
    const isProgressError = csvLoadingProgress && (csvLoadingProgress as any).error;
    if ((!input.trim() && selectedImages.length === 0) || !chat || isLoading || (csvLoadingProgress && !isProgressError)) return;

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
    
    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    // Regular chat message
    // IMPORTANT: Use functional update pattern to ensure we always have the latest messages
    // Store the initial message count to track what we've added
    const initialMessageCount = chat.messages.length;
    const updatedMessages = [...chat.messages, userMessage];
    let assistantContent = "";
    
    // Calculate current followup depth (before adding user message, so we're counting previous followups)
    const currentFollowupDepth = calculateFollowupDepth(chat.messages);
    const isLastFollowup = maxFollowupDepth > 0 && currentFollowupDepth >= maxFollowupDepth - 1;
    
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
        maxFollowupDepth,
        currentFollowupDepth,
        isLastFollowup,
    (chunk) => {
          assistantContent += chunk;
          
          // Update message in real-time as content streams
          // Extract execution results from current content
          let executionResultsData: any = null;
          const executionResultPattern = /Code Execution Result[^`]*```json\s*([\s\S]*?)\s*```/;
          const executionResultMatch = assistantContent.match(executionResultPattern);
          if (executionResultMatch) {
            try {
              const jsonData = JSON.parse(executionResultMatch[1]);
              if (jsonData && typeof jsonData === 'object' && Object.keys(jsonData).length > 0) {
                executionResultsData = jsonData;
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
                    if (jsonData && typeof jsonData === 'object') {
                      // Check for chart data (echarts_chart, plotly_chart) or other execution results
                      const hasChartData = jsonData.echarts_chart || jsonData.plotly_chart || 
                                          jsonData.echartsChart || jsonData.plotlyChart;
                      const hasExecutionData = jsonData.teamStats || jsonData.ucsdTopPlayers || 
                                              jsonData.nauTopPlayers || Object.keys(jsonData).length > 3;
                      
                      if (hasChartData || hasExecutionData) {
                        executionResultsData = jsonData;
                        break;
                      }
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
          
          // Update message in real-time
          onUpdateMessages(chat.id, (prevMessages) => {
            // Use the base messages (user + previous messages) and update/append assistant message
            const baseMessages = prevMessages.length >= initialMessageCount + 1 
              ? prevMessages.slice(0, initialMessageCount + 1)
              : [...chat.messages, userMessage];
            
            return [...baseMessages, assistantMessage];
          });
        },
        () => {
          setIsLoading(false);
          abortControllerRef.current = null;
          // Ensure csvLoadingProgress is cleared when done
          setCsvLoadingProgress(null);
        },
        (error) => {
          setIsLoading(false);
          abortControllerRef.current = null;
          setCsvLoadingProgress(null); // Clear progress on error
          // Don't show error toast if it was aborted by user
          if (!error.includes('aborted') && !error.includes('cancelled')) {
            toast({
              title: "Error",
              description: error,
              variant: "destructive",
            });
          }
        },
        selectedCsvIds,
        csvFilterColumns,
        csvFilterValues,
        chat.id,
        matchFilterColumns,
        matchFilterValues,
        selectedContextSectionId,
        (() => {
          // Debounce progress display - only show if loading takes > 300ms
          let progressStartTime: number | null = null;
          let progressTimeout: NodeJS.Timeout | null = null;
          let lastProgress: { file: string; percent: number; rows?: number } | null = null;
          
          let completed = false;
          return (progress: { file: string; percent: number; rows?: number }) => {
            lastProgress = progress;
            
            // Clear progress when complete or on error
            if (progress.percent >= 100 || (progress as any).error) {
              if (progressTimeout) {
                clearTimeout(progressTimeout);
                progressTimeout = null;
              }
              // Clear immediately when complete, or after delay for errors
              if (progress.percent >= 100) {
                setCsvLoadingProgress(null);
                completed = true;
              } else {
                setCsvLoadingProgress(progress); // Show errors immediately
                setTimeout(() => {
                  setCsvLoadingProgress(null);
                }, 3000);
              }
              progressStartTime = null;
              return;
            }
            
            // Start tracking time on first progress
            if (progressStartTime === null) {
              progressStartTime = Date.now();
              // Only show progress bar if loading takes > 300ms
              progressTimeout = setTimeout(() => {
                if (lastProgress && lastProgress.percent < 100) {
                  setCsvLoadingProgress(lastProgress);
                }
              }, 300);
            } else if (Date.now() - progressStartTime > 300) {
              // Already past threshold, update immediately
              if (!completed) setCsvLoadingProgress(progress);
            }
          };
        })(),
        abortControllerRef.current?.signal,
        handleCodeExecutionRequest
      );
    } catch (error) {
      setIsLoading(false);
      abortControllerRef.current = null;
      setCsvLoadingProgress(null); // Always clear progress on error
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      // Don't show error toast if it was aborted by user
      if (!errorMessage.includes('aborted') && !errorMessage.includes('cancelled')) {
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
      }
    }
  };

  const handleToggleReasoning = () => {
    if (!chat || !onUpdateReasoning) return;
    onUpdateReasoning(chat.id, !reasoningEnabled);
  };

  const handleToggleVolleyballContext = () => {
    if (!chat || !onUpdateVolleyballContext) return;
    // Allow toggling if we have match data OR grouped selection OR filter selections (CSV data)
    if (!matchData && !hasCurrentSelection && !hasFilterSelections) return;
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
      <div className="flex-1 flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center relative">
          {!sidebarOpen && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleSidebar}
              className="absolute top-4 left-4"
              title="Toggle sidebar"
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          <div className="text-center text-muted-foreground">
            <p className="text-lg mb-4">No chat selected</p>
            <p className="text-sm">Create a new chat to get started</p>
          </div>
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
              {/* Show grouped selection if it exists and matches current filters (takes precedence) */}
              {hasCurrentSelection && currentSelectionValueInfo && currentSelectionValueInfo.name ? (
                <>
                  <span className="text-muted-foreground">Active Dataset:</span>
                  <span className="text-foreground">{currentSelectionValueInfo.name}</span>
                  {(currentSelectionValueInfo.data && Array.isArray(currentSelectionValueInfo.data)) || currentSelectionValueInfo.rowCount ? (
                    <span className="text-muted-foreground">
                      <span className="ml-1">|</span>
                      <span className="ml-1">Rows:</span>
                      <span className="font-mono text-xs ml-1">
                        {(() => {
                    const totalCount = currentSelectionValueInfo.totalRowCount;
                    const limitedCount = currentSelectionValueInfo.data?.length || currentSelectionValueInfo.rowCount;
                    const isLimited = currentSelectionValueInfo.isLimited && totalCount && totalCount > limitedCount;
                    return isLimited ? `${totalCount.toLocaleString()} (${limitedCount.toLocaleString()} loaded)` : (limitedCount || totalCount || 'N/A');
                  })()}
                      </span>
                    </span>
                  ) : null}
                </>
              ) : (() => {
                // Check which type has selections (match takes precedence)
                const hasMatchSelections = matchFilterColumns.length > 0 && Object.keys(matchFilterValues).some(col => hasValue(matchFilterValues[col]));
                const hasCsvSelections = csvFilterColumns.length > 0 && Object.keys(csvFilterValues).some(col => hasValue(csvFilterValues[col]));

                if (hasMatchSelections) {
                  // Show match filter selections
                  const groupCols = matchFilterColumns.filter(col => hasValue(matchFilterValues[col]));
                  if (groupCols.length > 0) {
                    return (
                      <>
                        <span className="text-muted-foreground">Active Dataset:</span>
                        <span className="text-foreground">
                          {groupCols
                            .map(col => {
                              const value = matchFilterValues[col];
                              if (Array.isArray(value)) {
                                const maxDisplay = 3; // Show first 3 values
                                if (value.length > maxDisplay) {
                                  const displayed = value.slice(0, maxDisplay).join(', ');
                                  return `${col}=${displayed}... (${value.length} total)`;
                                }
                                return `${col}=${value.join(', ')}`;
                              }
                              return `${col}=${value}`;
                            })
                            .join(', ')}
                        </span>
                      </>
                    );
                  }
                } else if (hasCsvSelections) {
                  // Show CSV filter selections with CSV filename
                  const groupCols = csvFilterColumns.filter(col => hasValue(csvFilterValues[col]));

                  if (groupCols.length > 0) {
                    // Get CSV filename(s)
                    let csvFileNames: string[] = [];
                    try {
                      const saved = localStorage.getItem("db_csv_files");
                      if (saved) {
                        const parsed = JSON.parse(saved);
                        const files = Array.isArray(parsed) ? parsed : [];
                        csvFileNames = selectedCsvIds
                          .map(id => {
                            const file = files.find((f: any) => f.id === id);
                            return file ? file.name : null;
                          })
                          .filter((name): name is string => name !== null);
                      }
                    } catch (e) {
                      // Ignore errors
                    }

                    return (
                      <>
                        <span className="text-muted-foreground">Active Dataset:</span>
                        <span className="text-foreground">
                          {groupCols
                            .map(col => {
                              const value = csvFilterValues[col];
                              if (value === '__SELECT_ALL__') {
                                return `${col}=All`;
                              }
                              if (Array.isArray(value)) {
                                const maxDisplay = 3; // Show first 3 values
                                if (value.length > maxDisplay) {
                                  const displayed = value.slice(0, maxDisplay).join(', ');
                                  return `${col}=${displayed}... (${value.length} total)`;
                                }
                                return `${col}=${value.join(', ')}`;
                              }
                              return `${col}=${value}`;
                            })
                            .join(', ')}
                          {csvFileNames.length > 0 && (
                            <span>
                              {' | CSV: '}
                              {csvFileNames.length === 1
                                ? csvFileNames[0]
                                : csvFileNames.length === 2
                                  ? csvFileNames.join(', ')
                                  : `${csvFileNames.slice(0, 2).join(', ')}... (${csvFileNames.length} total)`}
                            </span>
                          )}
                        </span>
                      </>
                    );
                  }
                }
                return null;
              })()}
              
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
          <div className="md:py-2 md:px-4 py-1 px-3">
            <div className="md:block">
              <div className="flex gap-2 items-end md:flex-row flex-col">
                {!sidebarOpen && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onToggleSidebar}
                    className="hover:bg-chat-hover md:h-10 md:w-10 h-8 w-8 flex-shrink-0"
                    title="Toggle sidebar"
                  >
                    <Menu className="md:h-5 md:w-5 h-4 w-4" />
                  </Button>
                )}
                {/* SQL Group By - appears when database is connected */}
                {(dbConnected || isDatabaseConnected()) && (
                  <div className="flex-1 w-full">
                    <MatchSelector
                      selectedMatch={chat.selectedMatch}
                      selectedFilterColumns={[...matchFilterColumns, ...matchDisplayColumns]}
                      selectedFilterValues={matchFilterValues}
                      chatId={chat.id}
                      disabled={csvFilterColumns.length > 0 && Object.keys(csvFilterValues).some(col => csvFilterValues[col] != null)}
                      onSelectMatch={(matchId, filterColumns, filterValues, displayColumns, displayValues) => {
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
                    const filteredNewValues: Record<string, string | string[] | null> = {};
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
                  }}
                    />
                  </div>
                )}
                {/* CSV Group By - appears when CSV files are uploaded */}
                {/* CSV File Upload/Selection with Group By - always visible */}
                <div className="flex-1 w-full">
                  <CSVSelector
                      selectedCsvIds={selectedCsvIds}
                      selectedFilterColumns={[...csvFilterColumns, ...csvDisplayColumns]}
                      selectedFilterValues={csvFilterValues}
                      chatId={chat.id}
                      showGroupBy={false}
                      disabled={matchFilterColumns.length > 0 && Object.keys(matchFilterValues).some(col => matchFilterValues[col] != null) || isLoading || (!!csvLoadingProgress && !(csvLoadingProgress as any).error)}
                      onSelectCsv={(csvIds, filterColumns, filterValues, displayColumns, displayValues) => {
                      const newCsvIds = csvIds || [];
                      const newColumns = filterColumns || [];
                      const newValues = filterValues || {};
                      // Preserve existing display columns/values if not provided
                      const newDisplayColumns = displayColumns !== undefined ? displayColumns : csvDisplayColumns;
                      const newDisplayValues = displayValues !== undefined ? displayValues : csvDisplayValues;
                      
                      const filteredNewValues: Record<string, string | string[] | null> = {};
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
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
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
          <>
            <ModelSelector
              selectedModel={chat.model || defaultModel || DEFAULT_MODEL || ""}
              onSelectModel={(modelId) => onUpdateModel(chat.id, modelId)}
            />
          </>
        )}
      </div>
      
      {/* Messages */}
      <div className="flex-1 overflow-y-auto" ref={messagesContainerRef}>
        {showWelcome ? (
          <WelcomeScreen />
        ) : (
          <VirtualizedMessages
            messages={chat.messages}
            parentRef={messagesContainerRef}
            isLoading={isLoading}
            csvLoadingProgress={csvLoadingProgress}
            sidebarOpen={sidebarOpen}
          />
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border/50 md:p-4 md:pb-4 p-2 pb-1 bg-background">
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
          <div className="md:mb-3 mb-1.5 flex items-center gap-2 md:flex-row flex-col md:items-center items-stretch">
            <label className="text-sm text-muted-foreground whitespace-nowrap md:inline hidden">Context Section:</label>
            <div className="md:w-48 w-full">
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
              className="md:h-[60px] md:w-[60px] h-[50px] w-[50px] flex-shrink-0"
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
                placeholder={typeof window !== 'undefined' && window.innerWidth < 768 ? "Ask about your data..." : "Ask about your data... (Paste images with Ctrl+V)"}
                className={cn(
                  "md:min-h-[60px] min-h-[50px] max-h-[200px] resize-none bg-secondary border-border/50 focus:border-primary",
                  ((supportsReasoning && onUpdateReasoning) || onUpdateVolleyballContext) ? "pr-48" : "pr-2"
                )}
                disabled={isLoading || (!!csvLoadingProgress && !(csvLoadingProgress as any).error && csvLoadingProgress.percent < 100)}
              />
              <div className="absolute right-2 bottom-2 flex gap-1">
                {/* Data Preview Button - only show when CSV is selected */}
                {selectedCsvIds.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isLoadingPreview}
                    onClick={async () => {
                      if (isLoadingPreview) return;
                      
                      setIsLoadingPreview(true);
                      try {
                        const { getCsvDataRows, getAllCsvFileMetadata } = await import('@/lib/csvStorage');
                        const allFiles = await getAllCsvFileMetadata();
                        const selectedFile = allFiles.find(f => f.id === selectedCsvIds[0]);
                        
                        if (!selectedFile) {
                          throw new Error('Selected file not found. Please re-select the CSV file.');
                        }
                        
                        let data: any[] = [];
                        const totalRows = selectedFile.rowCount || 0;
                        
                        try {
                          // Try to get filtered data if filters are applied
                          const filterCols = [...csvFilterColumns, ...csvDisplayColumns];
                          const hasFilters = filterCols.length > 0 && Object.keys(csvFilterValues).some(col => csvFilterValues[col] != null);
                          
                          if (hasFilters) {
                            const { queryCSVWithDuckDB } = await import('@/lib/duckdb');
                            // Load filtered data (limited) - search can find more
                            const fullData = await queryCSVWithDuckDB(selectedCsvIds[0], filterCols, csvFilterValues);
                            data = fullData?.slice(0, 500) || [];
                          } else {
                            // Load first 500 rows for fast initial display
                            // DataPreview will load more on-demand via DuckDB
                            const { executeDuckDBSql, isDuckDBInitialized } = await import('@/lib/duckdb');
                            if (isDuckDBInitialized()) {
                              try {
                                data = await executeDuckDBSql(selectedCsvIds[0], 'SELECT * FROM csvData LIMIT 500') || [];
                              } catch {
                                data = await getCsvDataRows(selectedFile, undefined, true);
                                data = data.slice(0, 500);
                              }
                            } else {
                              data = await getCsvDataRows(selectedFile, undefined, true);
                              data = data.slice(0, 500);
                            }
                          }
                        } catch (error) {
                          console.warn('Preview: Initial load failed, trying fallback:', error);
                          try {
                            data = await getCsvDataRows(selectedFile, undefined, true);
                            data = data.slice(0, 500);
                          } catch (fallbackError) {
                            console.error('Preview: Fallback also failed:', fallbackError);
                            throw new Error('Unable to load data. The file may need to be re-uploaded.');
                          }
                        }
                        
                        // Validate we have data
                        if (!data || !Array.isArray(data)) {
                          throw new Error('Failed to load data from file');
                        }
                        
                        // Get headers - from file metadata or from first row
                        let headers = selectedFile.headers || [];
                        if (headers.length === 0 && data.length > 0) {
                          headers = Object.keys(data[0]);
                        }
                        
                        setPreviewData({
                          data: data,
                          fileName: selectedFile.name || 'Unknown',
                          headers: headers,
                          csvId: selectedCsvIds[0], // For loading more data
                          totalRowCount: totalRows > data.length ? totalRows : undefined
                        });
                        setIsPreviewOpen(true);
                      } catch (error: any) {
                        console.error('Preview failed:', error);
                        toast({
                          title: "Preview Error",
                          description: error?.message || "Failed to load dataset preview",
                          variant: "destructive"
                        });
                      } finally {
                        setIsLoadingPreview(false);
                      }
                    }}
                    className="h-8 px-2 text-xs flex items-center gap-1"
                    title="Preview dataset"
                  >
                    {isLoadingPreview ? (
                      <span className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Eye className="h-3 w-3" />
                    )}
                  </Button>
                )}
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
            {isLoading ? (
              <Button
                onClick={handleStop}
                className="md:h-[60px] md:px-6 h-[50px] px-4 bg-red-600 hover:bg-red-700 text-white"
                title="Stop AI response"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                data-send-button
                onClick={handleSend}
                disabled={(!input.trim() && selectedImages.length === 0) || isLoading || (!!csvLoadingProgress && !(csvLoadingProgress as any).error)}
                className="md:h-[60px] md:px-6 h-[50px] px-4 bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="flex items-center justify-between md:mt-2 mt-0.5 md:mb-0 mb-0 px-2 md:flex-row flex-col gap-1">
            <p className="text-xs text-muted-foreground md:block hidden">
              Press Enter to send, Shift+Enter for new line
            </p>
            <div className="flex items-center gap-2 md:ml-0 ml-auto">
              <label className="text-xs text-muted-foreground md:inline hidden">Max Followups:</label>
              <Select
                value={maxFollowupDepth.toString()}
                onValueChange={(value) => {
                  const depth = parseInt(value, 10);
                  if (chat && onUpdateMaxFollowupDepth) {
                    onUpdateMaxFollowupDepth(chat.id, depth);
                  }
                }}
              >
                <SelectTrigger className="h-7 w-20 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Unlimited</SelectItem>
                  <SelectItem value="1">1</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="4">4</SelectItem>
                  <SelectItem value="5">5</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>
      
      {/* Data Preview Modal */}
      {previewData && isPreviewOpen && (
        <DataPreview
          isOpen={isPreviewOpen}
          onClose={() => {
            setIsPreviewOpen(false);
            // Clear preview data after closing to prevent any lingering state
            setTimeout(() => setPreviewData(null), 300);
          }}
          data={previewData.data}
          fileName={previewData.fileName}
          headers={previewData.headers}
          csvId={previewData.csvId}
          totalRowCount={previewData.totalRowCount}
        />
      )}
      
      {/* Code Execution Approval Dialog */}
      {pendingCodeBlocks && (
        <CodeExecutionDialog
          blocks={pendingCodeBlocks}
          onApprove={handleCodeApproval}
          onReject={handleCodeRejection}
        />
      )}
    </div>
  );
};

export default ChatMain;

