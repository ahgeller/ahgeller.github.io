// Database utilities for Neon Postgres connection

declare global {
  interface Window {
    neon?: any;
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

let dbConnection: any = null;
let availableMatches: Match[] = [];

// Clean connection string - remove psql command syntax if present
export function cleanConnectionString(connString: string): string {
  if (!connString) throw new Error("Connection string is required");
  
  let cleaned = connString.trim();
  
  // Remove 'psql ' prefix if present
  if (cleaned.startsWith('psql ')) {
    cleaned = cleaned.substring(5).trim();
  }
  
  // Remove surrounding quotes
  if ((cleaned.startsWith("'") && cleaned.endsWith("'")) ||
      (cleaned.startsWith('"') && cleaned.endsWith('"'))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  
  // Ensure it starts with postgresql://
  if (!cleaned.startsWith('postgresql://')) {
    throw new Error('Connection string must start with postgresql://');
  }
  
  return cleaned;
}

// Get or store Neon connection string in localStorage
export async function getNeonConnectionString(): Promise<string | null> {
  try {
    // Try to get existing connection string from localStorage (check both keys)
    let connString = localStorage.getItem('db_connection_string') || localStorage.getItem('neon_connection_string');
    
    if (connString) {
      connString = cleanConnectionString(connString);
      console.log('✅ Found stored connection string');
      return connString;
    }
    
    // If not found, return null instead of prompting
    // User can configure it in settings if needed
    console.log('No connection string found. User can configure it in settings.');
    return null;
  } catch (error) {
    console.error('Error managing connection string:', error);
    return null;
  }
}

// Update/change connection string
export async function updateNeonConnectionString(): Promise<boolean> {
  try {
    const newConnString = prompt(
      'Enter your new Neon connection string:\n\n' +
      'This will replace your existing stored connection string.\n\n' +
      'You can paste the full psql command - it will be cleaned automatically.'
    );
    
    if (!newConnString || newConnString.trim() === '') {
      alert('Connection string cannot be empty');
      return false;
    }
    
    const cleaned = cleanConnectionString(newConnString);
    localStorage.setItem('neon_connection_string', cleaned);
    console.log('✅ Connection string updated');
    
    // Reconnect to database
    await initVolleyballDB();
    return true;
  } catch (error) {
    console.error('Error updating connection string:', error);
    alert('Failed to update connection string: ' + (error instanceof Error ? error.message : 'Unknown error'));
    return false;
  }
}

// Initialize database connection to Neon Postgres
export async function initVolleyballDB(): Promise<boolean> {
  try {
    console.log('Connecting to Neon Postgres...');
    
    const connectionString = await getNeonConnectionString();
    
    if (!connectionString) {
      console.log('No connection string configured. Database features will be unavailable until configured in settings.');
      return false;
    }
    
    if (!window.neon) {
      throw new Error('Neon driver not loaded. Make sure the script tag is in the head.');
    }
    
    const sql = window.neon(connectionString);
    
    // Fetch unique matches from combined_dvw table
    const matchesResult = await sql`
      SELECT DISTINCT match_id, home_team, visiting_team 
      FROM combined_dvw 
      WHERE match_id IS NOT NULL 
      AND home_team IS NOT NULL 
      AND visiting_team IS NOT NULL
      ORDER BY match_id
    `;
    
    availableMatches = matchesResult.map((row: any) => ({
      match_id: row.match_id,
      home_team: row.home_team,
      visiting_team: row.visiting_team
    }));
    
    dbConnection = sql;
    console.log('✅ Database connected. Matches loaded:', availableMatches.length);
    
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    dbConnection = null;
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage.includes('connection') || errorMessage.includes('authentication') || errorMessage.includes('ECONNREFUSED')) {
      const retry = confirm(
        'Failed to connect to database.\n\n' +
        'Error: ' + errorMessage + '\n\n' +
        'Would you like to update your connection string?'
      );
      if (retry) {
        await updateNeonConnectionString();
      }
    } else {
      alert('Failed to connect to database: ' + errorMessage);
    }
    
    return false;
  }
}

// Get available matches
export function getAvailableMatches(): Match[] {
  return availableMatches;
}

// Get database connection (for direct queries)
export function getDbConnection(): any {
  return dbConnection;
}

// Load match data
export async function loadMatchData(matchId: string): Promise<any> {
  try {
    console.log('Loading match data for:', matchId);
    
    if (!dbConnection) {
      throw new Error('Database not connected. Please check your connection string in settings.');
    }
    
    const matchInfo = availableMatches.find(m => m.match_id === matchId);
    if (!matchInfo) {
      throw new Error(`Match ${matchId} not found in available matches`);
    }
    
    // Fetch all actions for this match - using explicit column selection matching the database schema
    const dataResult = await dbConnection`
      SELECT 
        match_id,
        point_id,
        video_time,
        team,
        player_number,
        player_name,
        player_id,
        skill_type,
        evaluation_code,
        evaluation,
        attack_code,
        attack_description,
        set_code,
        set_description,
        set_type,
        start_zone,
        end_zone,
        end_subzone,
        end_cone,
        skill_subtype,
        set_number,
        home_team_score,
        visiting_team_score,
        home_score,
        visiting_score,
        phase,
        home_team,
        visiting_team,
        point_won_by,
        point,
        winning_attack,
        serving_team,
        point_phase,
        attack_phase,
        reception_quality,
        timeout,
        end_of_set,
        substitution,
        num_players,
        num_players_numeric,
        special_code,
        custom_code,
        home_setter_position,
        visiting_setter_position,
        home_p1, home_p2, home_p3, home_p4, home_p5, home_p6,
        visiting_p1, visiting_p2, visiting_p3, visiting_p4, visiting_p5, visiting_p6,
        start_coordinate_x, start_coordinate_y,
        mid_coordinate_x, mid_coordinate_y,
        end_coordinate_x, end_coordinate_y,
        point_differential
      FROM combined_dvw 
      WHERE match_id = ${matchId}
      ORDER BY point_id, video_time
    `;
    
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
  
  // Debug: Show all attacks with their evaluation_code
  console.log('=== KILL DETECTION DEBUG ===');
  console.log('Total attacks:', attacks.length);
  console.log('Home attacks:', homeAttacks.length);
  console.log('Visiting attacks:', visitingAttacks.length);
  
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
  console.log('=== END KILL DETECTION DEBUG ===');
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

