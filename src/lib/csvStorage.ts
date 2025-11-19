import { parseCsvText, stringifyCsv } from "@/lib/csvUtils";

const CSV_DATA_PREFIX = "db_csv_data_";
const csvDataCache = new Map<string, any[]>();

export const saveCsvDataText = (fileId: string, csvText: string, parsedData?: any[]): void => {
  localStorage.setItem(`${CSV_DATA_PREFIX}${fileId}`, csvText);
  if (parsedData) {
    csvDataCache.set(fileId, parsedData);
  } else {
    const { data } = parseCsvText(csvText);
    csvDataCache.set(fileId, data);
  }
};

export const getCsvDataRows = (file: any): any[] | null => {
  if (!file || !file.id) return null;

  if (Array.isArray(file.data)) {
    csvDataCache.set(file.id, file.data);
    return file.data;
  }

  if (csvDataCache.has(file.id)) {
    return csvDataCache.get(file.id)!;
  }

  const csvText = localStorage.getItem(`${CSV_DATA_PREFIX}${file.id}`);
  if (!csvText) return null;

  const { data } = parseCsvText(csvText);
  csvDataCache.set(file.id, data);
  return data;
};

export const getAllCsvDataRows = (files: any[], csvId?: string | null): any[] => {
  if (csvId) {
    const file = files.find((f: any) => f.id === csvId);
    return file ? getCsvDataRows(file) || [] : [];
  }

  const combined: any[] = [];
  files.forEach((file: any) => {
    const data = getCsvDataRows(file);
    if (data && data.length > 0) {
      combined.push(...data);
    }
  });
  return combined;
};

export const deleteCsvData = (fileId: string): void => {
  localStorage.removeItem(`${CSV_DATA_PREFIX}${fileId}`);
  csvDataCache.delete(fileId);
};

export const migrateLegacyCsvFile = (file: any): { updatedFile: any; migrated: boolean } => {
  if (file && Array.isArray(file.data) && file.id) {
    try {
      const headers =
        (file.headers && file.headers.length > 0 ? file.headers : Object.keys(file.data[0] || {})) || [];
      const csvText = stringifyCsv(headers, file.data);
      saveCsvDataText(file.id, csvText, file.data);
      const updatedFile = { ...file, rowCount: file.rowCount ?? file.data.length };
      delete updatedFile.data;
      return { updatedFile, migrated: true };
    } catch (error) {
      console.error("Error migrating CSV file data:", error);
    }
  }
  return { updatedFile: file, migrated: false };
};

