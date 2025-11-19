export interface ParsedCsvResult {
  headers: string[];
  data: any[];
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
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || "";
      });
      return row;
    })
    .filter((row) => Object.keys(row).some((key) => row[key] !== ""));

  return { headers, data };
};

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

  const sanitizedHeaders = headers.map((header) => header ?? "");
  const lines: string[] = [];
  lines.push(sanitizedHeaders.map(escapeCsvValue).join(","));

  data.forEach((row) => {
    const line = sanitizedHeaders
      .map((header) => escapeCsvValue(row?.[header] ?? ""))
      .join(",");
    lines.push(line);
  });

  return lines.join("\n");
};

