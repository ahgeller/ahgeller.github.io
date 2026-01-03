export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  images?: string[]; // Base64 image data
  model?: string; // AI model used for this message
  executionResults?: any; // JSON data from code execution for reference
  executionStatus?: Array<{ // Which code blocks succeeded/failed - PRIMARY source for red/green boxes
    index: number;          // Code block index (0-based)
    success: boolean;       // true = green box, false = red/orange box
    error?: string;         // Error message if failed (red if regular error, orange if starts with "Skipped:")
  }>;
}

export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  selectedMatch: string | null;
  model?: string;
  reasoningEnabled?: boolean; // Whether reasoning is enabled for reasoning models
  volleyballContextEnabled?: boolean; // Whether volleyball context is enabled (default: true)
  // Filter selections - stored per chat
  matchFilterColumns?: string[];
  matchFilterValues?: Record<string, string | string[] | null>;
  matchDisplayColumns?: string[]; // Columns set to display mode
  matchDisplayValues?: Record<string, string | null>; // Display values for the selected group
  csvFilterColumns?: string[];
  csvFilterValues?: Record<string, string | string[] | null>;
  csvDisplayColumns?: string[]; // Columns set to display mode for CSV
  csvDisplayValues?: Record<string, string | null>; // Display values for the selected CSV group
  selectedCsvIds?: string[]; // Array of CSV IDs to combine into a table
  selectedCsvFileNames?: string[]; // Array of CSV file names corresponding to selectedCsvIds
  selectedContextSectionId?: string | null; // Selected context section ID for this chat
  maxFollowupDepth?: number; // Maximum number of followup exchanges (default: 0 = no limit)
}

export interface Match {
  match_id: string;
  home_team: string;
  visiting_team: string;
  total_actions: number;
  sets_played: number;
}

export interface MatchData {
  matchInfo: {
    match_id: string;
    home_team: string;
    visiting_team: string;
    total_actions: number;
    sets_played: number;
  };
  data: any[];
  summary: {
    totalActions: number;
    totalSets: number;
    homeSetWins: number;
    visitingSetWins: number;
    homeTotalPoints: number;
    visitingTotalPoints: number;
    homeAttacks: number;
    visitingAttacks: number;
    homeKills: number;
    visitingKills: number;
    homeAttackEfficiency: string;
    visitingAttackEfficiency: string;
    homeAttackErrors: number;
    visitingAttackErrors: number;
    homeAces: number;
    visitingAces: number;
    homeServeErrors: number;
    visitingServeErrors: number;
    homeReceptions: number;
    visitingReceptions: number;
    homeReceptionEfficiency: string;
    visitingReceptionEfficiency: string;
    totalAttacks: number;
    totalServes: number;
    totalReceptions: number;
    totalBlocks: number;
    totalDigs: number;
    totalSetSkills: number;
    setScores: Record<string, { home: number; visiting: number }>;
  };
}

