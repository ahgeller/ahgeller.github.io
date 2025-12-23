// LangChain memory management for conversation history
// Using a simplified approach with @langchain/core messages
import { AIMessage, HumanMessage, BaseMessage } from "@langchain/core/messages";
import { Message } from "@/types/chat";

/**
 * Simplified memory manager that handles conversation history
 * Uses in-memory storage with message limits to manage token usage
 * Can be upgraded to use LangChain's full memory features when needed
 */
export class LangChainMemoryManager {
  private messages: BaseMessage[] = [];
  private maxMessages: number = 10; // Keep last 10 messages (5 exchanges) with persistent summary
  private summary: string | null = null; // Persistent summary of older messages
  private isProcessing: boolean = false; // Prevent race conditions
  private messageQueue: Array<() => Promise<void>> = []; // Queue for sequential processing
  
  constructor(_apiKey: string) {
    // API key stored but not used in simplified version
    // Can be used later for summarization features
  }
  
  /**
   * Process queued operations sequentially to prevent race conditions
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.messageQueue.length === 0) {
      return;
    }
    
    this.isProcessing = true;
    
    while (this.messageQueue.length > 0) {
      const operation = this.messageQueue.shift();
      if (operation) {
        try {
          await operation();
        } catch (error) {
          console.error('Error processing queued operation:', error);
        }
      }
    }
    
    this.isProcessing = false;
  }
  
  /**
   * Add a message to memory
   */
  async addMessage(role: 'user' | 'assistant', content: string): Promise<void> {
    // Input validation
    if (!role || (role !== 'user' && role !== 'assistant')) {
      throw new Error('Invalid role: must be "user" or "assistant"');
    }
    
    if (typeof content !== 'string') {
      throw new Error('Invalid content: must be a string');
    }
    
    // No truncation - IndexedDB can handle large messages
    
    // Queue the operation to prevent race conditions
    return new Promise((resolve, reject) => {
      this.messageQueue.push(async () => {
        try {
          if (role === 'user') {
            this.messages.push(new HumanMessage(content));
          } else {
            this.messages.push(new AIMessage(content));
          }
          
          // Trim messages if we're over the limit
          await this.trimIfNeeded();
          resolve();
        } catch (error) {
          console.error('Error adding message to memory:', error);
          reject(error);
        }
      });
      
      // Start processing the queue
      this.processQueue();
    });
  }
  
  /**
   * Get conversation context as Message[] format
   * This returns the properly formatted messages for API calls
   * CRITICAL: Always keeps first message (may contain dataset summary), then last 9 messages
   * Total = 10 messages (1 first + 9 recent)
   */
  async getConversationContext(): Promise<Message[]> {
    try {
      if (this.messages.length === 0) {
        return [];
      }
      
      // Always keep the first message (may contain dataset summary or important context)
      const firstMessage = this.messages[0];
      const restMessages = this.messages.slice(1);
      
      // Keep last 9 messages from the rest (so total = 1 first + 9 recent = 10)
      const recentRestMessages = restMessages.slice(-(this.maxMessages - 1));
      
      // Combine: first message + recent messages
      const messagesToReturn = [firstMessage, ...recentRestMessages];
      const convertedMessages = this.convertFromLangChainMessages(messagesToReturn);
      
      return convertedMessages;
    } catch (error) {
      console.error('Error getting conversation context:', error);
      // Return empty array on error to allow app to continue
      return [];
    }
  }
  
  /**
   * Get conversation context with message limit applied
   * Returns only the most recent messages to manage token usage
   * CRITICAL: Always keeps first message (may contain dataset summary)
   */
  async getFullContext(): Promise<{ messages: Message[]; summary?: string }> {
    try {
      if (this.messages.length === 0) {
        return { messages: [] };
      }
      
      // Always keep the first message (may contain dataset summary)
      const firstMessage = this.messages[0];
      const restMessages = this.messages.slice(1);
      
      // Keep last 9 messages from the rest (so total = 1 first + 9 recent = 10)
      const recentRestMessages = restMessages.slice(-(this.maxMessages - 1));
      
      // Combine: first message + recent messages
      const messagesToReturn = [firstMessage, ...recentRestMessages];
      const convertedMessages = this.convertFromLangChainMessages(messagesToReturn);
      
      // Use persistent summary if available
      const summary: string | undefined = this.summary || undefined;
      
      return { messages: convertedMessages, summary };
    } catch (error) {
      console.error('Error getting full context:', error);
      return { messages: [] };
    }
  }
  
  /**
   * Clear memory
   */
  async clear(): Promise<void> {
    try {
      this.messages = [];
      this.summary = null; // Clear summary when clearing memory
    } catch (error) {
      console.error('Error clearing memory:', error);
      throw error;
    }
  }
  
  /**
   * Load existing conversation history into memory
   * This is used when opening an existing chat
   */
  async loadHistory(messages: Message[]): Promise<void> {
    // Input validation
    if (!Array.isArray(messages)) {
      throw new Error('Invalid messages: must be an array');
    }
    
    try {
      // Clear existing memory
      await this.clear();
      
      // Limit total messages loaded to prevent memory issues
      const MAX_LOAD_MESSAGES = 200;
      const messagesToLoad = messages.length > MAX_LOAD_MESSAGES 
        ? messages.slice(-MAX_LOAD_MESSAGES) 
        : messages;
      
      if (messages.length > MAX_LOAD_MESSAGES) {
        console.warn(`Truncated history: ${messages.length} messages > ${MAX_LOAD_MESSAGES} limit`);
      }
      
      // Add all messages to memory
      // Include execution results in message content for better context
      for (const msg of messagesToLoad) {
        // Validate message structure
        if (!msg || typeof msg !== 'object' || !msg.role) {
          console.warn('Skipping invalid message:', msg);
          continue;
        }
        
        let content = msg.content || '';
        
        // Include execution results in content if present
        // This ensures memory has full context including code execution results
        if (msg.executionResults) {
          const resultsStr = typeof msg.executionResults === 'string' 
            ? msg.executionResults 
            : JSON.stringify(msg.executionResults, null, 2);
          content += `\n\n[Execution Results]\n${resultsStr}`;
        }
        
        // No truncation - IndexedDB can handle large messages
        
        if (msg.role === 'user') {
          this.messages.push(new HumanMessage(content));
        } else if (msg.role === 'assistant') {
          this.messages.push(new AIMessage(content));
        } else {
          console.warn('Unknown message role:', msg.role);
        }
      }
      
      // Trim to max messages if we have too many
      // CRITICAL: Always keep first message (may contain dataset summary)
      // Keep: first message + last 9 messages = 10 total
      if (this.messages.length > this.maxMessages) {
        const firstMessage = this.messages[0];
        const restMessages = this.messages.slice(1);
        
        if (restMessages.length > (this.maxMessages - 1)) {
          const messagesToSummarize = restMessages.slice(0, -(this.maxMessages - 1));
          const summaryContent = this.createSummary(messagesToSummarize);
          this.summary = `[Earlier conversation: ${messagesToSummarize.length} messages]\n${summaryContent}`;
          
          // Keep: first message + last 9 messages
          const recentRestMessages = restMessages.slice(-(this.maxMessages - 1));
          this.messages = [firstMessage, ...recentRestMessages];
        }
      }
    } catch (error) {
      console.error('Error loading history into memory:', error);
      throw error;
    }
  }
  
  /**
   * Convert LangChain messages to our Message[] format
   */
  private convertFromLangChainMessages(messages: BaseMessage[]): Message[] {
    return messages.map((msg, index) => {
      let role: 'user' | 'assistant';
      if (msg instanceof HumanMessage) {
        role = 'user';
      } else if (msg instanceof AIMessage) {
        role = 'assistant';
      } else {
        // Default to assistant for other message types
        role = 'assistant';
      }
      
      // Generate sequential timestamps to preserve order
      // Use a base timestamp and add index to maintain chronological order
      const baseTimestamp = Date.now() - (messages.length - index) * 1000;
      
      return {
        role,
        content: msg.content as string,
        timestamp: baseTimestamp,
      };
    });
  }
  
  /**
   * Get memory statistics (useful for debugging)
   */
  async getStats(): Promise<{ messageCount: number; maxMessages: number }> {
    try {
      return {
        messageCount: this.messages.length,
        maxMessages: this.maxMessages
      };
    } catch (error) {
      console.error('Error getting memory stats:', error);
      return { messageCount: 0, maxMessages: this.maxMessages };
    }
  }
  
  /**
   * Trim messages to max limit if needed
   */
  async trimIfNeeded(): Promise<void> {
    try {
      // CRITICAL: Always keep first message (may contain dataset summary)
      // Keep: first message + last 9 messages = 10 total
      if (this.messages.length > this.maxMessages) {
        const firstMessage = this.messages[0];
        const restMessages = this.messages.slice(1);
        
        // If we have more than maxMessages, trim the middle messages
        if (restMessages.length > (this.maxMessages - 1)) {
          // Create summary of messages that will be removed (skip first message)
          const messagesToSummarize = restMessages.slice(0, -(this.maxMessages - 1));
          const summaryContent = this.createSummary(messagesToSummarize);
          
          // Update persistent summary (merge with existing if it exists)
          if (this.summary) {
            this.summary = `${this.summary}\n\n[Additional earlier conversation: ${messagesToSummarize.length} messages]\n${summaryContent}`;
          } else {
            this.summary = `[Earlier conversation: ${messagesToSummarize.length} messages]\n${summaryContent}`;
          }
          
          // Keep: first message + last 9 messages
          const recentRestMessages = restMessages.slice(-(this.maxMessages - 1));
          this.messages = [firstMessage, ...recentRestMessages];
        }
      }
    } catch (error) {
      console.error('Error trimming messages:', error);
    }
  }
  
  /**
   * Create a summary from messages
   */
  private createSummary(messages: BaseMessage[]): string {
    if (messages.length === 0) return '';
    
    // Extract key information from messages
    const summaries: string[] = [];
    for (const msg of messages) {
      const content = msg.content as string;
      if (!content) continue;
      
      // Extract key findings (look for patterns like "found", "discovered", numbers, etc.)
      const keyPatterns = [
        /(?:found|discovered|identified|shows?|indicates?|reveals?|concludes?)[:\s]+([^.\n]{1,100})/gi,
        /(?:key|important|notable|significant)[:\s]+([^.\n]{1,100})/gi,
        /\b\d+(?:\.\d+)?%?\b/g, // Numbers
      ];
      
      const findings: string[] = [];
      keyPatterns.forEach(pattern => {
        const matches = content.matchAll(pattern);
        for (const match of matches) {
          if (match[1] && match[1].length < 100) {
            findings.push(match[1].trim());
          }
        }
      });
      
      if (findings.length > 0) {
        summaries.push(findings.slice(0, 3).join('; '));
      }
    }
    
    return summaries.slice(0, 5).join('\n');
  }
}

