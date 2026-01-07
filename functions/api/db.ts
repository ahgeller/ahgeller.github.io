// Cloudflare Pages Function for database queries via R2 cache + Neon
// Architecture: R2 stores cached JSON responses, Workers query Neon if cache miss
// This acts as a query layer between the website and Neon Postgres

export async function onRequestPost({ request, env }: { request: Request; env: any }) {
  try {
    const body = await request.json();
    const { action, query, params, tableName } = body;

    // Check for R2 binding (required for caching)
    if (!env.R2_BUCKET) {
      return new Response(JSON.stringify({ error: 'R2 bucket not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check for Neon connection string (required for queries)
    if (!env.NEON_CONNECTION_STRING) {
      return new Response(JSON.stringify({ error: 'Neon connection string not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Helper function to generate cache key from query
    const getCacheKey = (action: string, query?: string, params?: any, tableName?: string) => {
      const key = `${action}_${tableName || 'default'}_${query || ''}_${JSON.stringify(params || {})}`;
      // Create a hash for the key (simple approach)
      return `cache_${btoa(key).replace(/[+/=]/g, '').substring(0, 200)}`;
    };

    // Helper function to query Neon Postgres
    const queryNeon = async (sqlQuery: string, queryParams?: any[]): Promise<any[]> => {
      const { neon } = await import('@neondatabase/serverless');
      const sql = neon(env.NEON_CONNECTION_STRING);
      
      if (queryParams && queryParams.length > 0) {
        // Replace $1, $2 placeholders with actual values (sanitized)
        // Note: This is a simple approach - for production, consider using a proper SQL builder
        let processedQuery = sqlQuery;
        queryParams.forEach((param, index) => {
          const placeholder = `$${index + 1}`;
          // Escape single quotes and wrap in quotes for strings
          const escapedValue = typeof param === 'string' 
            ? `'${param.replace(/'/g, "''")}'` 
            : param;
          processedQuery = processedQuery.replace(placeholder, String(escapedValue));
        });
        const result = await sql.unsafe(processedQuery);
        return Array.isArray(result) ? result : [];
      } else {
        // For queries without parameters
        const result = await sql.unsafe(sqlQuery);
        return Array.isArray(result) ? result : [];
      }
    };

    switch (action) {
      case 'query': {
        // Execute a SELECT query with R2 caching
        if (!query) {
          return new Response(JSON.stringify({ error: 'Query is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        try {
          // Check R2 cache first
          const cacheKey = getCacheKey('query', query, params, tableName);
          const cached = await env.R2_BUCKET.get(cacheKey);
          
          if (cached) {
            const cachedData = await cached.json();
            // Check if cache is still valid (6 hours for queries - aggressive caching)
            const cacheAge = Date.now() - (cachedData.timestamp || 0);
            if (cacheAge < 6 * 60 * 60 * 1000) {
              // Cache is still valid - return cached data (no database query!)
              return new Response(JSON.stringify({ 
                success: true, 
                rows: cachedData.rows || [],
                meta: { cached: true },
                fromCache: true
              }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            // Cache expired - delete it and continue to query Neon
            await env.R2_BUCKET.delete(cacheKey);
          }

          // Cache miss - query Neon
          const result = await queryNeon(query, params);
          
          // Store in R2 cache (with 6 hour TTL - aggressive caching for team use)
          const cacheData = {
            rows: result,
            timestamp: Date.now()
          };
          await env.R2_BUCKET.put(cacheKey, JSON.stringify(cacheData), {
            httpMetadata: {
              contentType: 'application/json',
            },
            // Cache for 6 hours (aggressive caching to reduce queries)
            customMetadata: {
              expiresAt: String(Date.now() + 6 * 60 * 60 * 1000)
            }
          });
          
          return new Response(JSON.stringify({ 
            success: true, 
            rows: result || [],
            meta: { cached: false }
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ 
            error: error.message || 'Query execution failed',
            details: error.toString()
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      case 'count': {
        // Get row count for a table with optional WHERE conditions
        if (!tableName) {
          return new Response(JSON.stringify({ error: 'Table name is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        try {
          // Check cache
          const cacheKey = getCacheKey('count', undefined, params, tableName);
          const cached = await env.R2_BUCKET.get(cacheKey);
          
          if (cached) {
            const cachedData = await cached.json();
            // Check if cache is still valid (6 hours for counts - aggressive caching)
            const cacheAge = Date.now() - (cachedData.timestamp || 0);
            if (cacheAge < 6 * 60 * 60 * 1000) {
              // Cache is still valid - return cached data (no database query!)
              return new Response(JSON.stringify({ 
                success: true, 
                count: cachedData.count || 0,
                fromCache: true
              }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            // Cache expired - delete it and continue to query Neon
            await env.R2_BUCKET.delete(cacheKey);
          }

          // Build query (PostgreSQL syntax, not SQLite)
          let countQuery = `SELECT COUNT(*) as count FROM "${tableName.replace(/"/g, '""')}"`;
          
          // Add WHERE conditions if provided
          if (params && params.whereConditions && Array.isArray(params.whereConditions) && params.whereConditions.length > 0) {
            countQuery += ` WHERE ${params.whereConditions.join(' AND ')}`;
          }
          
          const result = await queryNeon(countQuery);
          const count = result[0]?.count || 0;
          
          // Cache the result (6 hours - aggressive caching for team use)
          await env.R2_BUCKET.put(cacheKey, JSON.stringify({ count, timestamp: Date.now() }), {
            httpMetadata: { contentType: 'application/json' },
            customMetadata: { expiresAt: String(Date.now() + 6 * 60 * 60 * 1000) } // 6 hours
          });
          
          return new Response(JSON.stringify({ 
            success: true, 
            count: count
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ 
            error: error.message || 'Count query failed',
            details: error.toString()
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      case 'matches': {
        // Get list of available matches
        try {
          const tableName = params?.tableName || 'combined_dvw';
          
          // Check cache
          const cacheKey = getCacheKey('matches', undefined, params, tableName);
          const cached = await env.R2_BUCKET.get(cacheKey);
          
          if (cached) {
            const cachedData = await cached.json();
            // Check if cache is still valid (24 hours for matches list - changes rarely)
            const cacheAge = Date.now() - (cachedData.timestamp || 0);
            if (cacheAge < 24 * 60 * 60 * 1000) {
              // Cache is still valid - return cached data (no database query!)
              return new Response(JSON.stringify({ 
                success: true, 
                matches: cachedData.matches || [],
                fromCache: true
              }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            // Cache expired - delete it and continue to query Neon
            await env.R2_BUCKET.delete(cacheKey);
          }

          // Query Neon (PostgreSQL syntax - use double quotes)
          const query = `SELECT DISTINCT match_id, home_team, visiting_team 
                        FROM "${tableName.replace(/"/g, '""')}" 
                        WHERE match_id IS NOT NULL 
                        AND home_team IS NOT NULL 
                        AND visiting_team IS NOT NULL
                        ORDER BY match_id`;
          
          const result = await queryNeon(query);
          
          // Cache the result for 24 hours (matches list changes rarely)
          await env.R2_BUCKET.put(cacheKey, JSON.stringify({ 
            matches: result, 
            timestamp: Date.now() 
          }), {
            httpMetadata: { contentType: 'application/json' },
            customMetadata: { expiresAt: String(Date.now() + 24 * 60 * 60 * 1000) }
          });
          
          return new Response(JSON.stringify({ 
            success: true, 
            matches: result || []
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ 
            error: error.message || 'Failed to fetch matches',
            details: error.toString()
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      case 'listTables': {
        // List all tables in the database
        try {
          // Check cache (tables list changes rarely, cache for 24 hours)
          const cacheKey = getCacheKey('listTables');
          const cached = await env.R2_BUCKET.get(cacheKey);
          
          if (cached) {
            const cachedData = await cached.json();
            // Check if cache is still valid (24 hours)
            const cacheAge = Date.now() - (cachedData.timestamp || 0);
            if (cacheAge < 24 * 60 * 60 * 1000) {
              return new Response(JSON.stringify({ 
                success: true, 
                tables: cachedData.tables || [],
                fromCache: true
              }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
          }

          // Query Neon to get all table names from public schema
          const query = `SELECT table_name 
                        FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_type = 'BASE TABLE'
                        ORDER BY table_name`;
          
          const result = await queryNeon(query);
          const tables = result.map((row: any) => row.table_name).filter(Boolean);
          
          // Cache the result for 24 hours
          await env.R2_BUCKET.put(cacheKey, JSON.stringify({ 
            tables, 
            timestamp: Date.now() 
          }), {
            httpMetadata: { contentType: 'application/json' },
            customMetadata: { expiresAt: String(Date.now() + 24 * 60 * 60 * 1000) }
          });
          
          return new Response(JSON.stringify({ 
            success: true, 
            tables
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ 
            error: error.message || 'Failed to list tables',
            details: error.toString()
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      case 'matchData': {
        // Get all data for a specific match
        if (!params || !params.matchId) {
          return new Response(JSON.stringify({ error: 'Match ID is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        try {
          const tableName = params.tableName || 'combined_dvw';
          const matchId = params.matchId;
          
          // Check cache (match data is large, cache for 1 hour)
          const cacheKey = getCacheKey('matchData', undefined, { matchId, tableName }, tableName);
          const cached = await env.R2_BUCKET.get(cacheKey);
          
          if (cached) {
            const cachedData = await cached.json();
            // Check if cache is still valid (1 hour)
            const cacheAge = Date.now() - (cachedData.timestamp || 0);
            if (cacheAge < 60 * 60 * 1000) {
              return new Response(JSON.stringify({ 
                success: true, 
                data: cachedData.data || [],
                fromCache: true
              }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
          }

          // Build comprehensive SELECT query (PostgreSQL syntax)
          const query = `SELECT 
            match_id, point_id, video_time, team, player_number, player_name, player_id,
            skill_type, evaluation_code, evaluation, attack_code, attack_description,
            set_code, set_description, set_type, start_zone, end_zone, end_subzone, end_cone,
            skill_subtype, set_number, home_team_score, visiting_team_score,
            home_score, visiting_score, phase, home_team, visiting_team, point_won_by,
            point, winning_attack, serving_team, point_phase, attack_phase, reception_quality,
            timeout, end_of_set, substitution, num_players, num_players_numeric,
            special_code, custom_code, home_setter_position, visiting_setter_position,
            home_p1, home_p2, home_p3, home_p4, home_p5, home_p6,
            visiting_p1, visiting_p2, visiting_p3, visiting_p4, visiting_p5, visiting_p6,
            start_coordinate_x, start_coordinate_y, mid_coordinate_x, mid_coordinate_y,
            end_coordinate_x, end_coordinate_y, point_differential
          FROM "${tableName.replace(/"/g, '""')}" 
          WHERE match_id = $1
          ORDER BY point_id, video_time`;
          
          const result = await queryNeon(query, [matchId]);
          
          // Cache the result for 6 hours (aggressive caching - match data changes when you update database)
          await env.R2_BUCKET.put(cacheKey, JSON.stringify({ 
            data: result, 
            timestamp: Date.now() 
          }), {
            httpMetadata: { contentType: 'application/json' },
            customMetadata: { expiresAt: String(Date.now() + 6 * 60 * 60 * 1000) } // 6 hours
          });
          
          return new Response(JSON.stringify({ 
            success: true, 
            data: result || []
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ 
            error: error.message || 'Failed to fetch match data',
            details: error.toString()
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
    }
  } catch (error: any) {
    return new Response(JSON.stringify({ 
      error: error.message || 'Request processing failed',
      details: error.toString()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

