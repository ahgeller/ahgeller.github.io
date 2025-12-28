import { formatDistanceToNow, format, isToday, isYesterday } from 'date-fns';

/**
 * Format timestamp for display with relative time
 * 
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted string
 * @example
 * formatTimestamp(Date.now() - 120000) // "2 minutes ago"
 * formatTimestamp(Date.now() - 86400000) // "Yesterday at 2:30 PM"
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  
  // If within last hour, show relative time
  if (Date.now() - timestamp < 3600000) {
    return formatDistanceToNow(date, { addSuffix: true });
    // "2 minutes ago"
  }
  
  // If today, show time only
  if (isToday(date)) {
    return `Today at ${format(date, 'h:mm a')}`;
    // "Today at 2:30 PM"
  }
  
  // If yesterday
  if (isYesterday(date)) {
    return `Yesterday at ${format(date, 'h:mm a')}`;
    // "Yesterday at 2:30 PM"
  }
  
  // Otherwise show full date
  return format(date, 'MMM dd, yyyy h:mm a');
  // "Jan 15, 2025 2:30 PM"
}

/**
 * Format for exports (consistent format)
 * 
 * @param timestamp - Unix timestamp in milliseconds
 * @returns ISO-like format string
 * @example
 * formatForExport(Date.now()) // "2025-01-15 14:30:00"
 */
export function formatForExport(timestamp: number): string {
  return format(new Date(timestamp), 'yyyy-MM-dd HH:mm:ss');
}

/**
 * Format for chart display (shorter format)
 * 
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Short formatted string
 * @example
 * formatChartTime(Date.now()) // "2:30 PM" (today) or "Jan 15, 2:30 PM"
 */
export function formatChartTime(timestamp: number): string {
  const date = new Date(timestamp);
  
  if (isToday(date)) {
    return format(date, 'h:mm a');
    // "2:30 PM"
  }
  
  return format(date, 'MMM dd, h:mm a');
  // "Jan 15, 2:30 PM"
}

/**
 * Format date only (no time)
 * 
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Date string
 * @example
 * formatDateOnly(Date.now()) // "Jan 15, 2025"
 */
export function formatDateOnly(timestamp: number): string {
  return format(new Date(timestamp), 'MMM dd, yyyy');
}

/**
 * Format for file names (safe for filesystem)
 * 
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Filesystem-safe date string
 * @example
 * formatForFilename(Date.now()) // "2025-01-15"
 */
export function formatForFilename(timestamp: number): string {
  return format(new Date(timestamp), 'yyyy-MM-dd');
}
