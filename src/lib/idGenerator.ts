import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a guaranteed unique ID
 * Use this instead of Date.now() + Math.random()
 * 
 * @returns A unique UUID string
 * @example
 * const id = generateId();
 * // '110ec58a-a0f2-4ac4-8393-c866d813b8d1'
 */
export function generateId(): string {
  return uuidv4();
}

/**
 * Generate a prefixed unique ID (for readability and debugging)
 * 
 * @param prefix - Prefix for the ID (e.g., "chat", "csv", "chart")
 * @returns A prefixed unique ID
 * @example
 * const chatId = generatePrefixedId('chat');
 * // 'chat-110ec58a-a0f2-4ac4-8393-c866d813b8d1'
 */
export function generatePrefixedId(prefix: string): string {
  return `${prefix}-${uuidv4()}`;
}

/**
 * Generate a short unique ID (first 8 chars of UUID)
 * Use when you need shorter IDs but still want good uniqueness
 * 
 * @returns A short unique ID
 * @example
 * const shortId = generateShortId();
 * // '110ec58a'
 */
export function generateShortId(): string {
  return uuidv4().substring(0, 8);
}
