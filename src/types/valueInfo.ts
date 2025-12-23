// TypeScript interfaces for ValueInfo data structure

export interface ColumnInfo {
  name: string;
  type: string;
  uniqueValues?: any[];
  nullCount?: number;
}

export interface ValueInfo {
  id: string;
  type: 'match' | 'csv';
  columns: ColumnInfo[];
  data?: any[];
  filterColumns?: string[];
  filterValues?: Record<string, string | string[] | null>;
  timestamp?: number;
  referencedValueInfoId?: string;
  chatId?: string;
  fileName?: string;
  // Additional properties used throughout the codebase
  name?: string;
  description?: string;
  summary?: string;
  hasData?: boolean;
  dataLength?: number;
  uniqueId?: string;
  usedByChats?: string[];
  generatedAt?: number;
}

export interface DataInfo {
  id?: string;
  [key: string]: any;
}

export interface CsvFile {
  id: string;
  name: string;
  data?: any[];
  columns?: ColumnInfo[];
  [key: string]: any;
}
