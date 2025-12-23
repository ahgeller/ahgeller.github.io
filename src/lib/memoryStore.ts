// Memory store for managing LangChain memory instances per chat
import { LangChainMemoryManager } from './memoryManager';
import { getApiKey } from './apiKeys';

const memoryManagers = new Map<string, LangChainMemoryManager>();

/**
 * Get or create a memory manager for a chat
 */
export function getOrCreateMemoryManager(chatId: string): LangChainMemoryManager {
  if (!memoryManagers.has(chatId)) {
    const apiKey = getApiKey('openrouter');
    if (!apiKey) {
      throw new Error('OpenRouter API key required for memory management');
    }
    memoryManagers.set(chatId, new LangChainMemoryManager(apiKey));
  }
  return memoryManagers.get(chatId)!;
}

/**
 * Clear memory manager for a chat
 */
export async function clearMemoryManager(chatId: string): Promise<void> {
  const manager = memoryManagers.get(chatId);
  if (manager) {
    await manager.clear();
    memoryManagers.delete(chatId);
  }
}

/**
 * Load existing chat history into LangChain memory
 */
export async function loadChatHistory(chatId: string, messages: any[]): Promise<void> {
  if (!chatId) {
    console.warn('Cannot load history: chatId is required');
    return;
  }
  
  if (!Array.isArray(messages)) {
    console.warn('Cannot load history: messages must be an array');
    return;
  }
  
  try {
    const manager = getOrCreateMemoryManager(chatId);
    await manager.loadHistory(messages);
  } catch (error) {
    console.error('Error loading chat history into LangChain memory:', error);
    // Don't throw - allow app to continue without memory if it fails
  }
}

/**
 * Check if memory manager exists for a chat
 */
export function hasMemoryManager(chatId: string): boolean {
  return memoryManagers.has(chatId);
}

/**
 * Clear all memory managers (useful for cleanup)
 */
export async function clearAllMemoryManagers(): Promise<void> {
  const clearPromises: Promise<void>[] = [];
  for (const [, manager] of memoryManagers.entries()) {
    clearPromises.push(manager.clear());
  }
  await Promise.all(clearPromises);
  memoryManagers.clear();
}

