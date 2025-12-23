export interface ParsedCsvResult {
  headers: string[];
  data: any[];
  rowCount?: number; // Optional for streaming parser
}

const detectDelimiter = (line: string): string => {
  const commaCount = (line.match(/,/g) || []).length;
  const semicolonCount = (line.match(/;/g) || []).length;
  const tabCount = (line.match(/\t/g) || []).length;

  if (semicolonCount > commaCount && semicolonCount > tabCount) {
    return ";";
  }
  if (tabCount > commaCount && tabCount > semicolonCount) {
    return "\t";
  }
  return ",";
};

// Auto-detect and convert types (numbers, booleans, null)
const convertType = (value: string): any => {
  // Empty string
  if (value === '' || value === null || value === undefined) {
    return '';
  }
  
  // Trim whitespace
  const trimmed = value.trim();
  
  // Boolean values
  if (trimmed.toLowerCase() === 'true') return true;
  if (trimmed.toLowerCase() === 'false') return false;
  
  // Null/undefined values
  if (trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') {
    return null;
  }
  
  // Number detection
  // Only convert if it's a valid number and doesn't start with 0 (unless it's "0" or "0.x")
  if (trimmed !== '' && !isNaN(Number(trimmed))) {
    // Don't convert strings like "001" or "01" (likely IDs)
    if (trimmed.startsWith('0') && trimmed.length > 1 && !trimmed.startsWith('0.')) {
      return value; // Keep as string (likely an ID)
    }
    return Number(trimmed);
  }
  
  // Return original value
  return value;
};

// Synchronous version (keep for backward compatibility)
export const parseCsvText = (csvText: string): ParsedCsvResult => {
  if (!csvText || !csvText.trim()) return { headers: [], data: [] };

  const lines = csvText.split(/\r?\n|\r/).filter((line) => line.trim());
  if (lines.length === 0) return { headers: [], data: [] };

  const delimiter = detectDelimiter(lines[0]);

  const parseCsvLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = !inQuotes;
        i++;
        continue;
      }

      if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = "";
        i++;
        continue;
      }

      current += char;
      i++;
    }

    result.push(current.trim());
    return result;
  };

  const headers = parseCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, ""));
  const data = lines
    .slice(1)
    .map((line) => {
      const values = parseCsvLine(line).map((v) => v.replace(/^"|"$/g, ""));
      const row: Record<string, any> = {};
      headers.forEach((header, index) => {
        row[header] = convertType(values[index] || "");
      });
      return row;
    })
    .filter((row) => Object.keys(row).some((key) => row[key] !== "" && row[key] !== null));

  return { headers, data };
};

// Async version with yielding for large files
export const parseCsvTextAsync = async (
  csvText: string,
  onProgress?: (progress: { rows: number; percent: number }) => void
): Promise<ParsedCsvResult> => {
  if (!csvText || !csvText.trim()) return { headers: [], data: [] };

  const lines = csvText.split(/\r?\n|\r/).filter((line) => line.trim());
  if (lines.length === 0) return { headers: [], data: [] };

  const delimiter = detectDelimiter(lines[0]);

  const parseCsvLine = (line: string): string[] => {
    // Fast path for simple CSVs
    if (delimiter === ',' && !line.includes('"')) {
      return line.split(',').map(v => v.trim());
    }
    
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = !inQuotes;
        i++;
        continue;
      }

      if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = "";
        i++;
        continue;
      }

      current += char;
      i++;
    }

    result.push(current.trim());
    return result;
  };

  const headers = parseCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, ""));
  const data: any[] = [];
  
  const YIELD_INTERVAL = 1000; // Yield every 1000 rows
  const totalLines = lines.length - 1;
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const values = parseCsvLine(line).map((v) => v.replace(/^"|"$/g, ""));
    const row: Record<string, any> = {};
    
    headers.forEach((header, index) => {
      row[header] = convertType(values[index] || "");
    });
    
    // Only add non-empty rows
    if (Object.keys(row).some((key) => row[key] !== "" && row[key] !== null)) {
      data.push(row);
    }
    
    // Yield to UI thread periodically
    if (i % YIELD_INTERVAL === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // Report progress
      if (onProgress) {
        onProgress({
          rows: data.length,
          percent: Math.floor((i / totalLines) * 100)
        });
      }
    }
  }

  return { headers, data, rowCount: data.length };
};

// Streaming CSV parser for very large files
// Processes chunks incrementally to avoid string length limits
// Streaming CSV parser for very large files
// Processes chunks incrementally to avoid string length limits
export class StreamingCsvParser {
  private headers: string[] = [];
  private data: any[] = [];
  private buffer: string = "";
  private isFirstChunk: boolean = true;
  private headersDetected: boolean = false;
  private delimiter: string = ',';
  private rowCount: number = 0;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.headers = [];
    this.data = [];
    this.buffer = "";
    this.isFirstChunk = true;
    this.headersDetected = false;
    this.delimiter = ',';
    this.rowCount = 0;
  }

  processChunk(chunk: string, onProgress?: (rows: number) => void): void {
    // Add chunk to buffer
    this.buffer += chunk;

    // Split by newlines, but keep the last incomplete line in buffer
    const lines = this.buffer.split(/\r?\n|\r/);
    
    // Keep the last line in buffer (it might be incomplete)
    if (lines.length > 0) {
      this.buffer = lines.pop() || "";
    }

    // Process complete lines
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      if (this.isFirstChunk && !this.headersDetected) {
        // Detect delimiter from first line
        this.delimiter = detectDelimiter(line);
        this.headers = this.parseCsvLine(line).map((h) => h.replace(/^"|"$/g, ""));
        this.headersDetected = true;
        this.isFirstChunk = false;
        continue;
      }

      if (!this.headersDetected) continue;

      // Parse data row
      const values = this.parseCsvLine(line).map((v) => v.replace(/^"|"$/g, ""));
      const row: Record<string, any> = {};
      
      this.headers.forEach((header, index) => {
        row[header] = convertType(values[index] || "");
      });

      // Only add non-empty rows
      if (Object.keys(row).some((key) => row[key] !== "" && row[key] !== null)) {
        this.data.push(row);
        this.rowCount++;
      }
    }
    
    // Report progress after processing all lines in chunk
    if (onProgress && this.rowCount > 0) {
      onProgress(this.rowCount);
    }
  }

  finalize(): ParsedCsvResult {
    // Process any remaining buffer
    if (this.buffer.trim()) {
      const values = this.parseCsvLine(this.buffer).map((v) => v.replace(/^"|"$/g, ""));
      if (values.length > 0 && values.some(v => v.trim())) {
        const row: Record<string, any> = {};
        this.headers.forEach((header, index) => {
          row[header] = convertType(values[index] || "");
        });
        if (Object.keys(row).some((key) => row[key] !== "" && row[key] !== null)) {
          this.data.push(row);
          this.rowCount++;
        }
      }
    }

    return {
      headers: this.headers,
      data: this.data,
      rowCount: this.rowCount
    };
  }

  private parseCsvLine(line: string): string[] {
    if (this.delimiter === ',' && !line.includes('"')) {
      // Fast path for simple comma-separated values without quotes
      return line.split(',').map(v => v.trim());
    }
    
    // Handle quoted fields and custom delimiters
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote
          current += '"';
          i += 2;
        } else {
          // Toggle quote mode
          inQuotes = !inQuotes;
          i++;
        }
      } else if (char === this.delimiter && !inQuotes) {
        // Field separator - trim before pushing
        result.push(current.trim());
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }

    result.push(current.trim());
    return result;
  }
}

const escapeCsvValue = (value: any): string => {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  if (stringValue.includes('"') || stringValue.includes(",") || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

export const stringifyCsv = (headers: string[], data: any[]): string => {
  if (!headers || headers.length === 0) {
    headers = data.length > 0 ? Object.keys(data[0]) : [];
  }

  // Safety check: Don't create strings that might exceed JavaScript's max string length
  const MAX_SAFE_ROWS = 50000;
  if (data.length > MAX_SAFE_ROWS) {
    throw new Error(`Dataset too large to stringify (${data.length.toLocaleString()} rows). Use blob storage instead.`);
  }

  const sanitizedHeaders = headers.map((header) => header ?? "");
  
  // Pre-allocate array with known size for better performance
  const lines: string[] = new Array(data.length + 1);
  lines[0] = sanitizedHeaders.map(escapeCsvValue).join(",");

  // Process rows directly into pre-allocated array
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const line = sanitizedHeaders
      .map((header) => escapeCsvValue(row?.[header] ?? ""))
      .join(",");
    lines[i + 1] = line;
  }

  return lines.join("\n");
};

// Async version for very large datasets (with yielding)
export const stringifyCsvAsync = async (
  headers: string[],
  data: any[],
  onProgress?: (progress: { rows: number; percent: number }) => void
): Promise<string> => {
  if (!headers || headers.length === 0) {
    headers = data.length > 0 ? Object.keys(data[0]) : [];
  }

  const MAX_SAFE_ROWS = 50000;
  if (data.length > MAX_SAFE_ROWS) {
    throw new Error(`Dataset too large to stringify (${data.length.toLocaleString()} rows). Use blob storage instead.`);
  }

  const sanitizedHeaders = headers.map((header) => header ?? "");
  const lines: string[] = new Array(data.length + 1);
  lines[0] = sanitizedHeaders.map(escapeCsvValue).join(",");

  const YIELD_INTERVAL = 1000; // Yield every 1000 rows

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const line = sanitizedHeaders
      .map((header) => escapeCsvValue(row?.[header] ?? ""))
      .join(",");
    lines[i + 1] = line;

    // Yield to UI thread periodically
    if (i % YIELD_INTERVAL === 0 && i > 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
      
      if (onProgress) {
        onProgress({
          rows: i + 1,
          percent: Math.floor((i / data.length) * 100)
        });
      }
    }
  }

  return lines.join("\n");
};