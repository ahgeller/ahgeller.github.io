// Database utilities for Cloudflare R2 + Workers query layer
// Architecture: R2 caches JSON responses, Workers query Neon Postgres if cache miss

declare global {
  interface Window {
    puter?: any;
  }
}

export interface Match {
  match_id: string;
  home_team: string;
  visiting_team: string;
  total_actions?: number;
  sets_played?: number;
}

let dbConnection: any = null; // Store connection status (true = connected, null = not connected)
let availableMatches: Match[] = [];

// Get API base URL - use relative path for Cloudflare Pages
function getApiBaseUrl(): string {
  // In production, use relative path (works with Cloudflare Pages)
  // In development, you might need to adjust this
  return '/api';
}

// Make API call to Cloudflare Pages Function
async function callDbApi(action: string, params?: any): Promise<any> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/db`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, params }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `API request failed: ${response.status}`);
  }
  
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'API request failed');
  }
  
    return data;
  } catch (error) {
    console.error('Database API call failed:', error);
    throw error;
  }
}

// Execute a SQL query via API
export async function executeDbQuery(query: string, params?: any[]): Promise<any[]> {
  try {
    const tableName = localStorage.getItem("db_table_name") || "combined_dvw";
    const result = await callDbApi('query', { query, params, tableName });
    return result.rows || [];
  } catch (error) {
    console.error('Query execution failed:', error);
    throw error;
  }
}

// Get row count for a table with optional WHERE conditions
export async function getRowCount(tableName: string, whereConditions?: string[]): Promise<number> {
  try {
    const result = await callDbApi('count', { 
      tableName, 
      whereConditions: whereConditions || [] 
    });
    return result.count || 0;
  } catch (error) {
    console.error('Count query failed:', error);
    throw error;
  }
}

// Initialize database connection via R2 + Workers (queries Neon Postgres)
export async function initVolleyballDB(): Promise<boolean> {
  try {
    console.log('Connecting to database via R2 + Workers (Neon Postgres)...');
    
    // Test connection by fetching matches
    const tableName = localStorage.getItem("db_table_name") || "combined_dvw";
    const result = await callDbApi('matches', { tableName });
    
    if (result && result.matches) {
      availableMatches = result.matches.map((row: any) => ({
      match_id: row.match_id,
      home_team: row.home_team,
      visiting_team: row.visiting_team
    }));
    
      dbConnection = true; // Mark as connected
    console.log('✅ Database connected. Matches loaded:', availableMatches.length);
    
    return true;
    } else {
      throw new Error('Failed to fetch matches from database');
    }
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    dbConnection = null;
    
    // Silently fail - connection status will be reflected in the UI
    // No alert shown to avoid interrupting user experience
    
    return false;
  }
}

// Get available matches
export function getAvailableMatches(): Match[] {
  return availableMatches;
}

// Get database connection status (for compatibility)
export function getDbConnection(): any {
  // Return a proxy object that mimics the old Neon API for compatibility
  // This allows existing code to work with minimal changes
  if (!dbConnection) {
    return null;
  }
  
  return {
    // For template literal queries (old Neon style), convert to API calls
    // This is a compatibility layer - new code should use executeDbQuery directly
    async query(strings: TemplateStringsArray, ...values: any[]) {
      // Reconstruct SQL query from template literal
      let query = '';
      for (let i = 0; i < strings.length; i++) {
        query += strings[i];
        if (i < values.length) {
          // For SQLite, use ? placeholders instead of ${} interpolation
          query += '?';
        }
      }
      
      // Execute via API
      return await executeDbQuery(query, values);
    },
    
    // For raw SQL queries
    async raw(query: string) {
      return await executeDbQuery(query);
    }
  };
}

// Load match data
export async function loadMatchData(matchId: string): Promise<any> {
  try {
    console.log('Loading match data for:', matchId);
    
    if (!dbConnection) {
      throw new Error('Database not connected. Please check your database configuration in settings.');
    }
    
    const matchInfo = availableMatches.find(m => m.match_id === matchId);
    if (!matchInfo) {
      throw new Error(`Match ${matchId} not found in available matches`);
    }
    
    // Fetch all actions for this match via API
    const tableName = localStorage.getItem("db_table_name") || "combined_dvw";
    const result = await callDbApi('matchData', { matchId, tableName });
    
    if (!result || !result.data) {
      throw new Error('Failed to fetch match data from database');
    }
    
    const dataResult = result.data;
    
    // Convert database rows to our format - preserving all relevant fields, cleaning booleans
    const data = dataResult.map((row: any) => ({
      match_id: row.match_id,
      point_id: row.point_id,
      video_time: row.video_time || 0,
      team: row.team,
      player_number: row.player_number,
      player_name: row.player_name || `Player ${row.player_number || ''}`,
      skill_type: row.skill_type,
      evaluation_code: row.evaluation_code,
      evaluation: row.evaluation,
      attack_code: row.attack_code,
      attack_description: row.attack_description,
      set_code: row.set_code,
      set_description: row.set_description,
      set_type: row.set_type,
      start_zone: row.start_zone,
      end_zone: row.end_zone,
      end_subzone: row.end_subzone,
      end_cone: row.end_cone,
      skill_subtype: row.skill_subtype,
      set_number: row.set_number,
      home_team_score: row.home_team_score,
      visiting_team_score: row.visiting_team_score,
      home_score: row.home_score,
      visiting_score: row.visiting_score,
      phase: row.phase,
      home_team: row.home_team,
      visiting_team: row.visiting_team,
      point_won_by: row.point_won_by,
      point: row.point ?? 0,
      winning_attack: row.winning_attack ?? 0,
      serving_team: row.serving_team,
      point_phase: row.point_phase,
      attack_phase: row.attack_phase,
      reception_quality: row.reception_quality,
      timeout: row.timeout ?? 0,
      end_of_set: row.end_of_set ?? 0,
      substitution: row.substitution ?? 0,
      num_players: row.num_players,
      num_players_numeric: row.num_players_numeric,
      special_code: row.special_code,
      custom_code: row.custom_code,
      home_setter_position: row.home_setter_position,
      visiting_setter_position: row.visiting_setter_position,
      home_p1: row.home_p1, home_p2: row.home_p2, home_p3: row.home_p3,
      home_p4: row.home_p4, home_p5: row.home_p5, home_p6: row.home_p6,
      visiting_p1: row.visiting_p1, visiting_p2: row.visiting_p2, visiting_p3: row.visiting_p3,
      visiting_p4: row.visiting_p4, visiting_p5: row.visiting_p5, visiting_p6: row.visiting_p6,
      start_coordinate_x: row.start_coordinate_x,
      start_coordinate_y: row.start_coordinate_y,
      mid_coordinate_x: row.mid_coordinate_x,
      mid_coordinate_y: row.mid_coordinate_y,
      end_coordinate_x: row.end_coordinate_x,
      end_coordinate_y: row.end_coordinate_y,
      point_differential: row.point_differential,
      video_timestamp: row.video_time // Keep for backward compatibility
    }));
    
    console.log('✅ Match data loaded:', data.length, 'actions');
    
    // Generate summary
    const summary = generateMatchSummary(data, matchInfo);
    
    return {
      matchId: matchId, // Include matchId for compatibility
      matchInfo,
      data,
      summary
    };
  } catch (error) {
    console.error('❌ Error loading match data:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to load match data: ${errorMessage}`);
  }
}

// Generate match summary statistics
// Evaluation code mapping:
// # = really good action (4 grade) - kill/ace when used with attacks or serves
// + = positive action (3 grade)
// ! = medium action (2 grade)
// - = poor action (1 grade)
// = = error
function generateMatchSummary(data: any[], matchInfo: Match): {
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
} {
  // Filter by skill_type - match case-insensitive and allow partial matches
  const attacks = data.filter(d => d.skill_type && d.skill_type.toLowerCase().includes('attack'));
  const serves = data.filter(d => d.skill_type && d.skill_type.toLowerCase().includes('serve'));
  const receptions = data.filter(d => d.skill_type && d.skill_type.toLowerCase().includes('reception'));
  const blocks = data.filter(d => d.skill_type && d.skill_type.toLowerCase().includes('block'));
  const setSkills = data.filter(d => d.skill_type && d.skill_type.toLowerCase().includes('set') && !d.skill_type.toLowerCase().includes('attack'));
  const digs = data.filter(d => d.skill_type && d.skill_type.toLowerCase().includes('dig'));
  
  // Helper function to normalize team names for comparison (case-insensitive, trim whitespace)
  const normalizeTeamName = (name: string) => (name || '').trim().toLowerCase();
  const homeTeamNormalized = normalizeTeamName(matchInfo.home_team);
  const visitingTeamNormalized = normalizeTeamName(matchInfo.visiting_team);
  
  // Get unique team names from data for debugging
  const uniqueTeams = [...new Set(data.map(d => d.team).filter(Boolean))];
  console.log('Teams in data:', uniqueTeams);
  console.log('Looking for home team:', matchInfo.home_team, 'normalized:', homeTeamNormalized);
  console.log('Looking for visiting team:', matchInfo.visiting_team, 'normalized:', visitingTeamNormalized);
  
  const homeAttacks = attacks.filter(a => normalizeTeamName(a.team) === homeTeamNormalized);
  const visitingAttacks = attacks.filter(a => normalizeTeamName(a.team) === visitingTeamNormalized);
  const homeServes = serves.filter(s => normalizeTeamName(s.team) === homeTeamNormalized);
  const visitingServes = serves.filter(s => normalizeTeamName(s.team) === visitingTeamNormalized);
  const homeReceptions = receptions.filter(r => normalizeTeamName(r.team) === homeTeamNormalized);
  const visitingReceptions = receptions.filter(r => normalizeTeamName(r.team) === visitingTeamNormalized);
  
  console.log('Attack counts:', {
    total: attacks.length,
    home: homeAttacks.length,
    visiting: visitingAttacks.length,
    unmatched: attacks.length - homeAttacks.length - visitingAttacks.length
  });
  
  // Debug: Check what evaluation_code values actually exist
  const allEvaluationCodes = [...new Set(attacks.map(a => a.evaluation_code).filter(Boolean))];
  console.log('All evaluation_code values in attacks:', allEvaluationCodes);
  
  // Debug: Check sample attack data
  if (attacks.length > 0) {
    console.log('Sample attack data (first 5):', attacks.slice(0, 5).map(a => ({
      team: a.team,
      player: a.player_name,
      evaluation_code: a.evaluation_code,
      evaluation: a.evaluation,
      winning_attack: a.winning_attack,
      skill_type: a.skill_type
    })));
  }
  
  // Debug: Check for winning_attack field
  const attacksWithWinningAttack = attacks.filter(a => a.winning_attack === true || a.winning_attack === 1);
  console.log('Attacks with winning_attack=true:', attacksWithWinningAttack.length);
  
  // Use evaluation_code for kill detection
  // # = really good action (4 grade) - kill/ace when used with attacks or serves
  // + = positive action (3 grade) - positive attack, NOT a kill
  // ! = medium action (2 grade)
  // - = poor action (1 grade)
  // = = error
  // Kills are ONLY attacks with evaluation_code '#'
  
  // Kills are identified by evaluation_code '#'
  
  // Show all attacks with evaluation_code '#'
  const allKills = attacks.filter(a => a.evaluation_code === '#');
  console.log('All attacks with evaluation_code="#":', allKills.length);
  if (allKills.length > 0) {
    console.log('Sample kills (first 5):', allKills.slice(0, 5).map(a => ({
      team: a.team,
      player: a.player_name,
      evaluation_code: a.evaluation_code,
      skill_type: a.skill_type
    })));
  }
  
  // Show attacks by evaluation_code
  const killsByCode = attacks.filter(a => a.evaluation_code === '#');
  const positiveByCode = attacks.filter(a => a.evaluation_code === '+');
  const errorByCode = attacks.filter(a => a.evaluation_code === '=');
  console.log('Attacks by evaluation_code:', {
    '# (kills)': killsByCode.length,
    '+ (positive)': positiveByCode.length,
    '= (errors)': errorByCode.length,
    'null/undefined': attacks.filter(a => !a.evaluation_code).length,
    'other': attacks.filter(a => a.evaluation_code && a.evaluation_code !== '#' && a.evaluation_code !== '+' && a.evaluation_code !== '=').length
  });
  
  const homeKills = homeAttacks.filter(a => a.evaluation_code === '#').length;
  const visitingKills = visitingAttacks.filter(a => a.evaluation_code === '#').length;
  
  console.log('Final kill counts:', {
    homeKills,
    visitingKills,
    totalKills: homeKills + visitingKills,
    homeAttacks: homeAttacks.length,
    visitingAttacks: visitingAttacks.length
  });
  
  const homeAttackErrors = homeAttacks.filter(a => a.evaluation_code === '=').length;
  const visitingAttackErrors = visitingAttacks.filter(a => a.evaluation_code === '=').length;
  
  // Efficiency: kills / total attacks (excluding errors from denominator for attack efficiency)
  const homeAttackEfficiency = homeAttacks.length > 0 ? ((homeKills / homeAttacks.length) * 100).toFixed(1) : '0';
  const visitingAttackEfficiency = visitingAttacks.length > 0 ? ((visitingKills / visitingAttacks.length) * 100).toFixed(1) : '0';
  
  // Aces are serves with evaluation_code '#'
  const homeAces = homeServes.filter(s => s.evaluation_code === '#').length;
  const visitingAces = visitingServes.filter(s => s.evaluation_code === '#').length;
  const homeServeErrors = homeServes.filter(s => s.evaluation_code === '=').length;
  const visitingServeErrors = visitingServes.filter(s => s.evaluation_code === '=').length;
  
  // Perfect receptions: evaluation_code '#' or '+' (really good or positive)
  const homePerfectReceptions = homeReceptions.filter(r => 
    r.reception_quality === 'Perfect' || 
    r.evaluation_code === '#' || 
    r.evaluation_code === '+'
  ).length;
  const visitingPerfectReceptions = visitingReceptions.filter(r => 
    r.reception_quality === 'Perfect' || 
    r.evaluation_code === '#' || 
    r.evaluation_code === '+'
  ).length;
  const homeReceptionEfficiency = homeReceptions.length > 0 ? ((homePerfectReceptions / homeReceptions.length) * 100).toFixed(1) : '0';
  const visitingReceptionEfficiency = visitingReceptions.length > 0 ? ((visitingPerfectReceptions / visitingReceptions.length) * 100).toFixed(1) : '0';
  
  // Calculate set scores using actual score data from the database
  const setScores: Record<string, { home: number; visiting: number }> = {};
  const sets = [...new Set(data.map(d => d.set_number))].sort();
  let homeTotalPoints = 0;
  let visitingTotalPoints = 0;
  
  sets.forEach(setNum => {
    const setData = data.filter(d => d.set_number === setNum);
    // Get max scores for each set - prefer home_score/visiting_score, fallback to home_team_score/visiting_team_score
    let homeScore = 0;
    let visitingScore = 0;
    setData.forEach(d => {
      // Use home_score/visiting_score if available, otherwise use home_team_score/visiting_team_score
      const home = d.home_score !== null && d.home_score !== undefined ? d.home_score : d.home_team_score;
      const visiting = d.visiting_score !== null && d.visiting_score !== undefined ? d.visiting_score : d.visiting_team_score;
      
      if (home !== null && home !== undefined) {
        homeScore = Math.max(homeScore, home);
      }
      if (visiting !== null && visiting !== undefined) {
        visitingScore = Math.max(visitingScore, visiting);
      }
      // Count total points won using point boolean and point_won_by
      if (d.point && d.point_won_by === matchInfo.home_team) {
        homeTotalPoints++;
      } else if (d.point && d.point_won_by === matchInfo.visiting_team) {
        visitingTotalPoints++;
      }
    });
    setScores[setNum.toString()] = { home: homeScore, visiting: visitingScore };
  });
  
  // Calculate set wins based on actual scores
  let homeSetWins = 0;
  let visitingSetWins = 0;
  Object.values(setScores).forEach(set => {
    if (set.home > set.visiting) {
      homeSetWins++;
    } else if (set.visiting > set.home) {
      visitingSetWins++;
    }
  });
  
  return {
    totalActions: data.length,
    totalSets: sets.length,
    homeSetWins,
    visitingSetWins,
    homeTotalPoints,
    visitingTotalPoints,
    homeAttacks: homeAttacks.length,
    visitingAttacks: visitingAttacks.length,
    homeKills,
    visitingKills,
    homeAttackEfficiency,
    visitingAttackEfficiency,
    homeAttackErrors,
    visitingAttackErrors,
    homeAces,
    visitingAces,
    homeServeErrors,
    visitingServeErrors,
    homeReceptions: homeReceptions.length,
    visitingReceptions: visitingReceptions.length,
    homeReceptionEfficiency,
    visitingReceptionEfficiency,
    totalAttacks: attacks.length,
    totalServes: serves.length,
    totalReceptions: receptions.length,
    totalBlocks: blocks.length,
    totalDigs: digs.length,
    totalSetSkills: setSkills.length,
    setScores
  };
}

// Check if database is connected
export function isDatabaseConnected(): boolean {
  return dbConnection !== null;
}

// Legacy function for compatibility (no longer needed with D1, but kept for API compatibility)
export async function getNeonConnectionString(): Promise<string | null> {
  // D1 doesn't use connection strings - return null
  return null;
}

// Legacy function for compatibility
export async function updateNeonConnectionString(): Promise<boolean> {
  // D1 doesn't use connection strings - just reinitialize
  return await initVolleyballDB();
}

// Clean connection string (legacy - no longer used with D1)
export function cleanConnectionString(connString: string): string {
  // D1 doesn't use connection strings, but keep for compatibility
  return connString;
}

