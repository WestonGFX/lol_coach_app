const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // Serve files from current directory

// Riot API Configuration (commented out as keys expire in 24h)
/*
const RIOT_API_KEY = process.env.RIOT_API_KEY || 'YOUR_RIOT_API_KEY_HERE';
const RIOT_BASE_URLS = {
    americas: 'https://americas.api.riotgames.com',
    asia: 'https://asia.api.riotgames.com',
    europe: 'https://europe.api.riotgames.com'
};

const REGIONAL_ENDPOINTS = {
    na1: 'https://na1.api.riotgames.com',
    euw1: 'https://euw1.api.riotgames.com',
    eun1: 'https://eun1.api.riotgames.com',
    kr: 'https://kr.api.riotgames.com',
    jp1: 'https://jp1.api.riotgames.com',
    br1: 'https://br1.api.riotgames.com',
    la1: 'https://la1.api.riotgames.com',
    la2: 'https://la2.api.riotgames.com',
    oc1: 'https://oc1.api.riotgames.com',
    tr1: 'https://tr1.api.riotgames.com',
    ru: 'https://ru.api.riotgames.com'
};
*/

// Database initialization
const db = new sqlite3.Database('./lol_coach.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        initializeDatabase();
    }
});

// Initialize database tables
function initializeDatabase() {
    const tables = [
        `CREATE TABLE IF NOT EXISTS summoners (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            puuid TEXT UNIQUE NOT NULL,
            summoner_name TEXT NOT NULL,
            tag_line TEXT NOT NULL,
            summoner_level INTEGER,
            profile_icon_id INTEGER,
            region TEXT NOT NULL,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS ranked_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            summoner_puuid TEXT NOT NULL,
            queue_type TEXT NOT NULL,
            tier TEXT,
            rank_division TEXT,
            league_points INTEGER,
            wins INTEGER,
            losses INTEGER,
            hot_streak BOOLEAN,
            veteran BOOLEAN,
            fresh_blood BOOLEAN,
            inactive BOOLEAN,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (summoner_puuid) REFERENCES summoners (puuid)
        )`,
        
        `CREATE TABLE IF NOT EXISTS matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id TEXT UNIQUE NOT NULL,
            summoner_puuid TEXT NOT NULL,
            game_creation BIGINT,
            game_duration INTEGER,
            game_mode TEXT,
            game_type TEXT,
            game_version TEXT,
            map_id INTEGER,
            queue_id INTEGER,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (summoner_puuid) REFERENCES summoners (puuid)
        )`,
        
        `CREATE TABLE IF NOT EXISTS match_participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id TEXT NOT NULL,
            summoner_puuid TEXT NOT NULL,
            champion_id INTEGER,
            champion_name TEXT,
            team_id INTEGER,
            win BOOLEAN,
            kills INTEGER,
            deaths INTEGER,
            assists INTEGER,
            gold_earned INTEGER,
            total_minions_killed INTEGER,
            vision_score INTEGER,
            damage_dealt INTEGER,
            damage_taken INTEGER,
            kda_ratio REAL,
            cs_per_minute REAL,
            kill_participation REAL,
            first_blood BOOLEAN DEFAULT FALSE,
            first_tower BOOLEAN DEFAULT FALSE,
            double_kills INTEGER DEFAULT 0,
            triple_kills INTEGER DEFAULT 0,
            quadra_kills INTEGER DEFAULT 0,
            penta_kills INTEGER DEFAULT 0,
            largest_killing_spree INTEGER DEFAULT 0,
            FOREIGN KEY (match_id) REFERENCES matches (match_id),
            FOREIGN KEY (summoner_puuid) REFERENCES summoners (puuid)
        )`,
        
        `CREATE TABLE IF NOT EXISTS insights (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            summoner_puuid TEXT NOT NULL,
            insight_type TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            priority INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (summoner_puuid) REFERENCES summoners (puuid)
        )`,
        
        `CREATE TABLE IF NOT EXISTS error_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME NOT NULL,
            source TEXT NOT NULL,
            operation TEXT NOT NULL,
            error_message TEXT NOT NULL,
            status_code INTEGER,
            additional_data TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS data_source_fallbacks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            summoner_name TEXT NOT NULL,
            tag_line TEXT NOT NULL,
            region TEXT NOT NULL,
            successful_source TEXT NOT NULL,
            failed_sources TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
    ];

    tables.forEach((table) => {
        db.run(table, (err) => {
            if (err) {
                console.error('Error creating table:', err.message);
            }
        });
    });
    
    console.log('Database tables initialized successfully.');
}

// Utility functions for region mapping (commented out as Riot API is disabled)
/*
function getRegionalCluster(region) {
    const regionMap = {
        na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
        euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe',
        kr: 'asia', jp1: 'asia'
    };
    return regionMap[region] || 'americas';
}
*/

// Data Source Priority Order: OP.GG → Mobalytics → League of Graphs (Riot API disabled as keys expire in 24h)
const DATA_SOURCES = {
    OPGG: 'opgg',
    MOBALYTICS: 'mobalytics', 
    LEAGUE_OF_GRAPHS: 'league_of_graphs',
    // RIOT_API: 'riot_api',     // Disabled - keys expire in 24h
    DATA_DRAGON: 'data_dragon'   // Optional - for static assets/data
};

// Error logging function
function logError(source, operation, error, additionalData = {}) {
    const errorLog = {
        timestamp: new Date().toISOString(),
        source: source,
        operation: operation,
        error: error.message,
        stack: error.stack,
        statusCode: error.response?.status,
        ...additionalData
    };
    
    // Log to SQLite for debugging
    db.run(`
        INSERT OR REPLACE INTO error_logs 
        (timestamp, source, operation, error_message, status_code, additional_data)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [
        errorLog.timestamp,
        errorLog.source,
        errorLog.operation,
        errorLog.error,
        errorLog.statusCode,
        JSON.stringify(additionalData)
    ], (err) => {
        if (err) console.error('Failed to log error to database:', err.message);
    });
    
    console.error(`[${source}] ${operation} failed:`, errorLog);
}

// Log successful fallback usage
function logDataSourceFallback(summonerName, tagLine, region, successfulSource, failedSources) {
    db.run(`
        INSERT INTO data_source_fallbacks 
        (summoner_name, tag_line, region, successful_source, failed_sources)
        VALUES (?, ?, ?, ?, ?)
    `, [
        summonerName,
        tagLine, 
        region,
        successfulSource,
        JSON.stringify(failedSources)
    ], (err) => {
        if (err) console.error('Failed to log data source fallback:', err.message);
    });
}

// Enhanced Riot API helper with exponential backoff (commented out as keys expire in 24h)
/*
async function makeRiotAPICall(url, retryCount = 0) {
    const maxRetries = 5;
    const baseDelay = 1000; // 1 second base delay
    const headers = {
        'X-Riot-Token': RIOT_API_KEY,
        'User-Agent': 'LoL-Personal-Coach/1.0'
    };

    try {
        const response = await axios.get(url, { 
            headers, 
            timeout: 15000,
            validateStatus: (status) => status < 500 || status === 503
        });
        
        if (response.status >= 400 && response.status < 500) {
            throw new Error(`Client error: ${response.status} - ${response.statusText}`);
        }
        
        return response.data;
    } catch (error) {
        const isRateLimited = error.response?.status === 429;
        const isServerError = error.response?.status >= 500;
        const isNetworkError = !error.response;
        
        if ((isRateLimited || isServerError || isNetworkError) && retryCount < maxRetries) {
            let retryDelay;
            
            if (isRateLimited) {
                retryDelay = (error.response.headers['retry-after'] || Math.pow(2, retryCount)) * 1000;
            } else {
                retryDelay = baseDelay * Math.pow(2, retryCount) + Math.random() * 1000;
            }
            
            console.log(`${isRateLimited ? 'Rate limited' : 'Server/Network error'}. Retrying after ${retryDelay/1000}s... (attempt ${retryCount + 1}/${maxRetries})`);
            
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            return makeRiotAPICall(url, retryCount + 1);
        }
        
        logError(DATA_SOURCES.RIOT_API, 'API_CALL', error, { url, retryCount });
        throw error;
    }
}

// Primary API fetching functions
// Riot API functions commented out as keys expire in 24h
/*
async function fetchSummonerByRiotID(gameName, tagLine, region) {
    try {
        const cluster = getRegionalCluster(region);
        const url = `${RIOT_BASE_URLS[cluster]}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
        return await makeRiotAPICall(url);
    } catch (error) {
        console.error('Error fetching summoner by Riot ID:', error.message);
        throw error;
    }
}
*/


// Riot API functions - all commented out as keys expire in 24h
/*
async function fetchSummonerByRiotID(gameName, tagLine, region) {
    try {
        const cluster = getRegionalCluster(region);
        const url = `${RIOT_BASE_URLS[cluster]}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
        return await makeRiotAPICall(url);
    } catch (error) {
        console.error('Error fetching summoner by Riot ID:', error.message);
        throw error;
    }
}

async function fetchSummonerByPUUID(puuid, region) {
    try {
        const url = `${REGIONAL_ENDPOINTS[region]}/lol/summoner/v4/summoners/by-puuid/${puuid}`;
        return await makeRiotAPICall(url);
    } catch (error) {
        console.error('Error fetching summoner by PUUID:', error.message);
        throw error;
    }
}

async function fetchRankedStats(summonerId, region) {
    try {
        const url = `${REGIONAL_ENDPOINTS[region]}/lol/league/v4/entries/by-summoner/${summonerId}`;
        return await makeRiotAPICall(url);
    } catch (error) {
        console.error('Error fetching ranked stats:', error.message);
        throw error;
    }
}

async function fetchMatchHistory(puuid, region, count = 20) {
    try {
        const cluster = getRegionalCluster(region);
        const url = `${RIOT_BASE_URLS[cluster]}/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${count}`;
        return await makeRiotAPICall(url);
    } catch (error) {
        console.error('Error fetching match history:', error.message);
        throw error;
    }
}

async function fetchMatchDetails(matchId, region) {
    try {
        const cluster = getRegionalCluster(region);
        const url = `${RIOT_BASE_URLS[cluster]}/lol/match/v5/matches/${matchId}`;
        return await makeRiotAPICall(url);
    } catch (error) {
        console.error('Error fetching match details:', error.message);
        throw error;
    }
}
*/



// Backup data fetching methods
async function fetchFromDataDragon() {
    try {
        // Fetching champion data, items, etc. from Data Dragon APIs
        const itemsUrl = 'https://ddragon.leagueoflegends.com/cdn/13.24.1/data/en_US/item.json';
        const championsResponse = await axios.get('https://ddragon.leagueoflegends.com/cdn/13.24.1/data/en_US/champion.json', { timeout: 10000 });
        const itemsResponse = await axios.get(itemsUrl, { timeout: 10000 });
        return {
            champions: championsResponse.data,
            items: itemsResponse.data
        };
    } catch (error) {
        console.error('Error fetching from Data Dragon:', error.message);
        throw error;
    }
}

// Helper function to handle URL encoding for special characters
function encodeSpecialCharacters(str) {
    // Handle special characters like Æ properly for URLs
    return encodeURIComponent(str).replace(/[!'()*]/g, function(c) {
        return '%' + c.charCodeAt(0).toString(16);
    });
}

// OP.GG Web Scraping (Primary Source)
async function scrapeOPGG(summonerName, tagLine, region, retryCount = 0) {
    const maxRetries = 3;
    
    try {
        // OP.GG URL format: https://op.gg/lol/summoners/{region}/{summonerName-tagLine}
        const fullName = `${summonerName}-${tagLine}`;
        const encodedName = encodeSpecialCharacters(fullName);
        const url = `https://op.gg/lol/summoners/${region}/${encodedName}`;
        
        console.log(`[OP.GG] Scraping: ${url}`);
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        
        // Extract actual data from OP.GG
        const summonerData = {
            summoner: {
                name: summonerName,
                tagLine: tagLine,
                region: region,
                level: parseInt($('[class*="level"], [class*="summoner-level"]').first().text().trim()) || 0,
            },
            ranked: [],
            matches: [],
            insights: [],
            opScore: 50,
            sourceUrl: url,
            statistics: {
                winRate: 0,
                avgKDA: 0,
                avgCS: 0
            }
        };

        // Extract rank information
        $('[class*="tier-rank"], [class*="tier"], [class*="rank-tier"]').each((_, el) => {
            const tierEl = $(el);
            const rankText = tierEl.text().trim();
            const rankMatch = rankText.match(/(Iron|Bronze|Silver|Gold|Platinum|Diamond|Master|Grandmaster|Challenger)\s*(I{1,4}|V?I{0,3})?/i);
            
            if (rankMatch) {
                const [_, tier, division] = rankMatch;
                const lpEl = tierEl.closest('[class*="wrapper"], [class*="container"]').find('[class*="lp"], [class*="league-points"]');
                const lpText = lpEl.text().trim();
                const lp = parseInt(lpText.match(/\d+/)?.[0]) || 0;

                const statsEl = tierEl.closest('[class*="wrapper"], [class*="container"]');
                const winsEl = statsEl.find('[class*="win"], [class*="wins"]');
                const lossesEl = statsEl.find('[class*="loss"], [class*="losses"]');
                
                const wins = parseInt(winsEl.text().match(/\d+/)?.[0]) || 0;
                const losses = parseInt(lossesEl.text().match(/\d+/)?.[0]) || 0;

                summonerData.ranked.push({
                    queue: 'RANKED_SOLO_5x5',
                    tier: tier || 'Unranked',
                    rank: division || '',
                    leaguePoints: lp,
                    wins: wins,
                    losses: losses
                });
            }
        });

        // Extract match history
        $('[class*="match-item"], [class*="game-item"], [class*="match-row"]').each((_, el) => {
            const matchEl = $(el);
            const isWin = matchEl.find('[class*="win"]').length > 0;
            const kdaEl = matchEl.find('[class*="kda"], [class*="k-d-a"]');
            const kdaText = kdaEl.text().trim();
            const [kills, deaths, assists] = kdaText.split(/\s*[\/\-]\s*/).map(n => parseInt(n) || 0);
            
            const csEl = matchEl.find('[class*="cs-score"], [class*="minion-kills"], [class*="cs"]');
            const csText = csEl.text().trim();
            const csPerMin = parseFloat(csText.match(/(\d+\.?\d*)/)?.[1]) || 0;
            
            const championEl = matchEl.find('[class*="champion-name"], [class*="name"]');
            
            const match = {
                champion_name: championEl.text().trim(),
                win: isWin,
                kills: kills,
                deaths: deaths,
                assists: assists,
                cs_per_minute: csPerMin
            };
            summonerData.matches.push(match);
        });

        // Calculate statistics
        if (summonerData.matches.length > 0) {
            const totalMatches = summonerData.matches.length;
            const wins = summonerData.matches.filter(m => m.win).length;
            
            summonerData.statistics = {
                winRate: wins / totalMatches,
                avgKDA: summonerData.matches.reduce((sum, m) => sum + (m.kills + m.assists) / Math.max(m.deaths, 1), 0) / totalMatches,
                avgCS: summonerData.matches.reduce((sum, m) => sum + (m.cs_per_minute || 0), 0) / totalMatches
            };
        }

        console.log('[OP.GG] Successfully scraped data for ' + summonerName + '#' + tagLine);
        return summonerData;
    } catch (error) {
        logError(DATA_SOURCES.OPGG, 'SCRAPE_SUMMONER', error, { summonerName, tagLine, region, retryCount });
        
        if (retryCount < maxRetries && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {
            console.log(`[OP.GG] Retrying... (${retryCount + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
            return scrapeOPGG(summonerName, tagLine, region, retryCount + 1);
        }
        
        throw error;
    }
}

// Mobalytics Web Scraping (Secondary Source) 
async function scrapeMobalytics(summonerName, tagLine, region, retryCount = 0) {
    const maxRetries = 3;
    
    try {
        // Mobalytics URL format: https://mobalytics.gg/lol/profile/{region}/{summonerName-tagLine}/
        // Test with: https://mobalytics.gg/lol/profile/na/vr%C3%86l-vrael/
        const fullName = `${summonerName}-${tagLine}`;
        const encodedName = encodeSpecialCharacters(fullName.toLowerCase()); // Mobalytics uses lowercase
        const url = `https://mobalytics.gg/lol/profile/${region}/${encodedName}/`;
        
        console.log(`[Mobalytics] Scraping: ${url}`);
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://mobalytics.gg/',
                'DNT': '1'
            },
            timeout: 20000,
            validateStatus: (status) => status < 500
        });
        
        if (response.status === 404) {
            throw new Error(`Summoner ${summonerName}#${tagLine} not found on Mobalytics`);
        }
        
        const $ = cheerio.load(response.data);
        
        // Create summoner data structure
        const summonerData = {
            summoner: {
                name: summonerName,
                tagLine: tagLine,
                region: region,
                level: 0 // Mobalytics doesn't show summoner level prominently
            },
            ranked: [],
            matches: [],
            insights: [],
            opScore: 50, // We'll calculate this based on available stats
            sourceUrl: url,
            statistics: {
                winRate: 0,
                avgKDA: 0,
                avgCS: 0
            }
        };
        
        // Extract rank information from various possible locations
        const rankElement = $('[data-testid="rank-tier"], [class*="rank-tier"], [class*="current-rank"]').first();
        if (rankElement.length) {
            const rankText = rankElement.text().trim();
            const rankMatch = rankText.match(/(Iron|Bronze|Silver|Gold|Platinum|Diamond|Master|Grandmaster|Challenger)\s*(I{1,4}|V?I{0,3})?/i);
            if (rankMatch) {
                const [_, tier, division] = rankMatch;
                const lpMatch = rankText.match(/(\d+)\s*LP/i);
                const lp = lpMatch ? parseInt(lpMatch[1]) : 0;
                
                summonerData.ranked.push({
                    queue: 'RANKED_SOLO_5x5',
                    tier: tier,
                    rank: division || '',
                    leaguePoints: lp
                });
            }
        }
        
        // Extract season stats
        const statsEl = $('[class*="season-stats"], [class*="ranked-stats"]');
        if (statsEl.length) {
            const winsText = statsEl.find('[class*="wins"]').text().trim();
            const lossesText = statsEl.find('[class*="losses"]').text().trim();
            const wins = parseInt(winsText.match(/\d+/)?.[0]) || 0;
            const losses = parseInt(lossesText.match(/\d+/)?.[0]) || 0;
            
            if (summonerData.ranked.length > 0) {
                summonerData.ranked[0].wins = wins;
                summonerData.ranked[0].losses = losses;
            }
        }
        
        // Extract match history
        $('[class*="match-history-item"], [class*="match-row"]').each((_, el) => {
            const matchEl = $(el);
            const isWin = matchEl.find('[class*="victory"], [class*="win"]').length > 0;
            
            // Find KDA
            const kdaEl = matchEl.find('[class*="kda-ratio"], [class*="kda"]');
            const kdaText = kdaEl.text().trim();
            const [kills, deaths, assists] = kdaText.split(/\s*[\/\-]\s*/).map(n => parseInt(n) || 0);
            
            // Find CS/min
            const csEl = matchEl.find('[class*="creep-score"], [class*="cs"]');
            const csText = csEl.text().trim();
            const csPerMin = parseFloat(csText.match(/(\d+\.?\d*)/)?.[1]) || 0;
            
            // Find champion
            const championEl = matchEl.find('[class*="champion-name"], [class*="champion"]');
            
            const championText = championEl.text().trim();
            
            summonerData.matches.push({
                gameId: Date.now() + Math.random(), // Generate a unique ID
                champion: championText,
                win: isWin,
                kills,
                deaths,
                assists,
                cs: Math.round(csPerMin * 15), // Estimate total CS based on cs/min
                duration: 900, // Default to 15 min games
                gameMode: 'Classic',
                gameType: 'MATCHED_GAME',
                invalid: false,
                ipEarned: 0,
                mapId: 11,
                spell1: 4, // Default Flash
                spell2: 14, // Default Ignite
                subType: 'RANKED_SOLO_5x5',
                teamId: 100
            });
        });
        
        // Calculate average stats
        if (summonerData.matches.length > 0) {
            const totalKills = summonerData.matches.reduce((sum, m) => sum + m.kills, 0);
            const totalDeaths = summonerData.matches.reduce((sum, m) => sum + m.deaths, 0);
            const totalAssists = summonerData.matches.reduce((sum, m) => sum + m.assists, 0);
            const totalCS = summonerData.matches.reduce((sum, m) => sum + m.cs, 0);
            const wins = summonerData.matches.filter(m => m.win).length;
            
            summonerData.statistics.avgKDA = ((totalKills + totalAssists) / Math.max(totalDeaths, 1)).toFixed(2);
            summonerData.statistics.avgCS = (totalCS / summonerData.matches.length).toFixed(1);
            summonerData.statistics.winRate = Math.round((wins / summonerData.matches.length) * 100);
            
            // Generate insights based on stats
            if (summonerData.statistics.avgKDA > 3) {
                summonerData.insights.push('Good KDA ratio - keep it up!');
            }
            if (summonerData.statistics.avgCS < 5) {
                summonerData.insights.push('Try to improve CS score');
            }
            if (summonerData.statistics.winRate > 55) {
                summonerData.insights.push('Strong win rate - you\'re climbing!');
            }
        }
        
        console.log(`[Mobalytics] Successfully scraped data for ${summonerName}#${tagLine}`);
        return summonerData;
        
    } catch (error) {
        logError(DATA_SOURCES.MOBALYTICS, 'SCRAPE_SUMMONER', error, { summonerName, tagLine, region, retryCount });
        
        if (retryCount < maxRetries && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {
            console.log(`[Mobalytics] Retrying... (${retryCount + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 3000 * (retryCount + 1)));
            return scrapeMobalytics(summonerName, tagLine, region, retryCount + 1);
        }
        
        throw error;
    }
}

// League of Graphs Web Scraping (Tertiary Source)
async function scrapeLeagueOfGraphs(summonerName, tagLine, region, retryCount = 0) {
    const maxRetries = 3;
    
    try {
        // League of Graphs URL format: https://www.leagueofgraphs.com/summoner/{region}/{summonerName-tagLine}
        const fullName = `${summonerName}-${tagLine}`;
        const encodedName = encodeSpecialCharacters(fullName);
        const url = `https://www.leagueofgraphs.com/summoner/${region}/${encodedName}`;
        
        console.log(`[League of Graphs] Scraping: ${url}`);
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive'
            },
            timeout: 25000,
            validateStatus: (status) => status < 500
        });
        
        if (response.status === 404) {
            throw new Error(`Summoner ${summonerName}#${tagLine} not found on League of Graphs`);
        }
        
        const $ = cheerio.load(response.data);
        
        // Extract summoner level
        const levelElement = $('.summonerLevel, [class*="level"]').first();
        const level = parseInt(levelElement.text().replace(/\D/g, '')) || 0;
        
        // Extract rank information
        const rankElement = $('.leagueTier, .rank, [class*="tier"]').first();
        const rankText = rankElement.text().trim() || 'Unranked';
        
        // Extract LP
        const lpElement = $('.leaguePoints, [class*="lp"], [class*="points"]').first();
        const lp = parseInt(lpElement.text().replace(/\D/g, '')) || 0;
        
        // Extract win/loss stats
        const winsElement = $('.wins, [class*="win"]:not([class*="rate"])').first();
        const lossesElement = $('.losses, [class*="loss"]').first();
        const wins = parseInt(winsElement.text().replace(/\D/g, '')) || 0;
        const losses = parseInt(lossesElement.text().replace(/\D/g, '')) || 0;
        const totalGames = wins + losses;
        const winRate = totalGames > 0 ? (wins / totalGames * 100) : 0;
        
        // Extract average KDA
        const kdaElement = $('.kda, [class*="kda"]').first();
        const kdaText = kdaElement.text().trim() || '0/0/0';
        
        // Extract recent matches
        const recentMatches = [];
        $('.match, [class*="match"], .game').each((i, element) => {
            if (i >= 8) return false; // Limit to 8 matches from LoG
            
            const match = $(element);
            const championName = match.find('.champion, [class*="champion"]').text().trim();
            const matchResult = match.find('.result, [class*="result"]').text().trim();
            const matchKda = match.find('.kda, [class*="kda"]').text().trim();
            
            if (championName) {
                recentMatches.push({
                    championName: championName,
                    kda: matchKda,
                    win: matchResult.toLowerCase().includes('victory') || 
                         matchResult.toLowerCase().includes('win') ||
                         match.hasClass('victory') || match.hasClass('win')
                });
            }
        });
        
        const scrapedData = {
            source: DATA_SOURCES.LEAGUE_OF_GRAPHS,
            summoner: {
                name: summonerName,
                tagLine: tagLine,
                level: level,
                region: region
            },
            ranked: rankText !== 'Unranked' ? [{
                queueType: 'RANKED_SOLO_5x5',
                tier: rankText.split(' ')[0] || 'UNRANKED',
                rank: rankText.split(' ')[1] || '',
                leaguePoints: lp,
                wins: wins,
                losses: losses
            }] : [],
            matches: recentMatches,
            statistics: {
                totalGames: totalGames,
                winRate: winRate / 100,
                avgKDA: 0, // Will calculate from kdaText if needed
                avgCS: 0   // Not typically available from LoG basic view
            },
            leagueOfGraphsSpecific: {
                kdaText: kdaText
            }
        };
        
        console.log(`[League of Graphs] Successfully scraped data for ${summonerName}#${tagLine}`);
        return scrapedData;
        
    } catch (error) {
        logError(DATA_SOURCES.LEAGUE_OF_GRAPHS, 'SCRAPE_SUMMONER', error, { summonerName, tagLine, region, retryCount });
        
        if (retryCount < maxRetries && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {
            console.log(`[League of Graphs] Retrying... (${retryCount + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 4000 * (retryCount + 1)));
            return scrapeLeagueOfGraphs(summonerName, tagLine, region, retryCount + 1);
        }
        
        throw error;
    }
}

// Data processing and insight generation
function calculateOPScore(matchData, rankedData) {
    let opScore = 50; // Base score

    if (rankedData && rankedData.length > 0) {
        const soloQueue = rankedData.find(queue => queue.queueType === 'RANKED_SOLO_5x5');
        if (soloQueue) {
            const winRate = soloQueue.wins / (soloQueue.wins + soloQueue.losses);
            opScore += winRate * 30; // Win rate contributes up to 30 points
            
            // Rank bonus
            const rankBonus = {
                'CHALLENGER': 25, 'GRANDMASTER': 23, 'MASTER': 20,
                'DIAMOND': 15, 'PLATINUM': 10, 'GOLD': 5, 'SILVER': 2, 'BRONZE': 0, 'IRON': -5
            };
            opScore += rankBonus[soloQueue.tier] || 0;
        }
    }

    if (matchData && matchData.length > 0) {
        const recentMatches = matchData.slice(0, 10);
        const avgKDA = recentMatches.reduce((sum, match) => {
            return sum + ((match.kills + match.assists) / Math.max(match.deaths, 1));
        }, 0) / recentMatches.length;
        
        opScore += Math.min(avgKDA * 8, 25); // KDA contributes up to 25 points

        const avgCS = recentMatches.reduce((sum, match) => sum + (match.cs_per_minute || 0), 0) / recentMatches.length;
        opScore += Math.min(avgCS * 2, 15); // CS contributes up to 15 points
    }

    return Math.min(Math.max(Math.round(opScore), 0), 100);
}

function generateInsights(summonerData, matchData, rankedData) {
    const insights = [];

    if (!matchData || matchData.length === 0) {
        insights.push({
            type: 'general',
            title: '📊 No Recent Match Data',
            description: 'Play some ranked games to get personalized insights and coaching tips.',
            priority: 1
        });
        return insights;
    }

    const recentMatches = matchData.slice(0, 20);
    const winRate = recentMatches.filter(match => match.win).length / recentMatches.length;
    const avgKDA = recentMatches.reduce((sum, match) => {
        return sum + ((match.kills + match.assists) / Math.max(match.deaths, 1));
    }, 0) / recentMatches.length;
    const avgCS = recentMatches.reduce((sum, match) => sum + (match.cs_per_minute || 0), 0) / recentMatches.length;

    // Win rate insights
    if (winRate < 0.4) {
        insights.push({
            type: 'performance',
            title: '📈 Focus on Consistency',
            description: 'Your recent win rate is below 40%. Focus on playing safer, minimizing deaths, and improving map awareness.',
            priority: 1
        });
    } else if (winRate > 0.7) {
        insights.push({
            type: 'performance',
            title: '🔥 Great Win Streak!',
            description: 'You\'re performing excellently! Keep up the current playstyle and consider climbing to higher ranks.',
            priority: 1
        });
    }

    // KDA insights
    if (avgKDA < 1.5) {
        insights.push({
            type: 'gameplay',
            title: '⚔️ Improve Your KDA',
            description: 'Focus on playing safer and positioning better in team fights. Avoid unnecessary risks.',
            priority: 2
        });
    } else if (avgKDA > 4.0) {
        insights.push({
            type: 'gameplay',
            title: '💪 Excellent KDA',
            description: 'Your KDA is impressive! You have good positioning and decision-making skills.',
            priority: 3
        });
    }

    // CS insights
    if (avgCS < 5) {
        insights.push({
            type: 'farming',
            title: '🎯 Improve Your Farming',
            description: 'Your CS/min is below average. Practice last-hitting in training mode and focus on wave management.',
            priority: 1
        });
    } else if (avgCS > 7) {
        insights.push({
            type: 'farming',
            title: '🌾 Excellent Farming',
            description: 'Your CS numbers are great! You have solid farming fundamentals.',
            priority: 3
        });
    }

    // Champion diversity insight
    const championCounts = {};
    recentMatches.forEach(match => {
        championCounts[match.champion_name] = (championCounts[match.champion_name] || 0) + 1;
    });

    const uniqueChampions = Object.keys(championCounts).length;
    if (uniqueChampions < 16) {
        insights.push({
            type: 'champion',
            title: '🎭 Expand Your Champion Pool',
            description: 'You are playing very few champions. Learning 2-3 more champions can improve your adaptability.',
            priority: 2
        });
    }

    return insights;
}

// Database helper functions
function saveSummonerData(summonerData, accountData) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO summoners 
            (puuid, summoner_name, tag_line, summoner_level, profile_icon_id, region, last_updated)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        stmt.run([
            accountData.puuid,
            accountData.gameName,
            accountData.tagLine,
            summonerData.summonerLevel,
            summonerData.profileIconId,
            summonerData.region
        ], function(err) {
            if (err) {
                reject(err);
            } else {
                resolve(this.lastID);
            }
        });
        
        stmt.finalize();
    });
}

function saveRankedStats(puuid, rankedData) {
    return new Promise((resolve, reject) => {
        // Clear existing ranked stats for this summoner
        db.run('DELETE FROM ranked_stats WHERE summoner_puuid = ?', [puuid], (err) => {
            if (err) {
                reject(err);
                return;
            }

            if (!rankedData || rankedData.length === 0) {
                resolve();
                return;
            }

            const stmt = db.prepare(`
                INSERT INTO ranked_stats 
                (summoner_puuid, queue_type, tier, rank_division, league_points, wins, losses, hot_streak, veteran, fresh_blood, inactive)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            rankedData.forEach(queue => {
                stmt.run([
                    puuid,
                    queue.queueType,
                    queue.tier,
                    queue.rank,
                    queue.leaguePoints,
                    queue.wins,
                    queue.losses,
                    queue.hotStreak,
                    queue.veteran,
                    queue.freshBlood,
                    queue.inactive
                ]);
            });

            stmt.finalize((err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

function saveMatchData(matchId, puuid, matchDetails) {
    return new Promise((resolve, reject) => {
        // Save match info
        const matchStmt = db.prepare(`
            INSERT OR REPLACE INTO matches 
            (match_id, summoner_puuid, game_creation, game_duration, game_mode, game_type, game_version, map_id, queue_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const info = matchDetails.info;
        matchStmt.run([
            matchId,
            puuid,
            info.gameCreation,
            info.gameDuration,
            info.gameMode,
            info.gameType,
            info.gameVersion,
            info.mapId,
            info.queueId
        ], function(err) {
            if (err) {
                reject(err);
                return;
            }

            // Find participant data for this summoner
            const participant = info.participants.find(p => p.puuid === puuid);
            if (!participant) {
                resolve();
                return;
            }

            // Calculate additional stats
            const kda = (participant.kills + participant.assists) / Math.max(participant.deaths, 1);
            const csPerMin = participant.totalMinionsKilled / (info.gameDuration / 60);
            const totalKills = info.participants
                .filter(p => p.teamId === participant.teamId)
                .reduce((sum, p) => sum + p.kills, 0);
            const killParticipation = totalKills > 0 ? (participant.kills + participant.assists) / totalKills : 0;

            // Save participant data
            const participantStmt = db.prepare(`
                INSERT OR REPLACE INTO match_participants 
                (match_id, summoner_puuid, champion_id, champion_name, team_id, win, kills, deaths, assists, 
                 gold_earned, total_minions_killed, vision_score, damage_dealt, damage_taken, kda_ratio, 
                 cs_per_minute, kill_participation, first_blood, first_tower, double_kills, triple_kills, 
                 quadra_kills, penta_kills, largest_killing_spree)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            participantStmt.run([
                matchId, puuid, participant.championId, participant.championName, participant.teamId,
                participant.win, participant.kills, participant.deaths, participant.assists,
                participant.goldEarned, participant.totalMinionsKilled, participant.visionScore,
                participant.totalDamageDealtToChampions, participant.totalDamageTaken, kda,
                csPerMin, killParticipation, participant.firstBloodKill, participant.firstTowerKill,
                participant.doubleKills, participant.tripleKills, participant.quadraKills,
                participant.pentaKills, participant.largestKillingSpree
            ], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });

            participantStmt.finalize();
        });

        matchStmt.finalize();
    });
}

function saveInsights(puuid, insights) {
    return new Promise((resolve, reject) => {
        // Clear existing insights
        db.run('DELETE FROM insights WHERE summoner_puuid = ?', [puuid], (err) => {
            if (err) {
                reject(err);
                return;
            }

            if (!insights || insights.length === 0) {
                resolve();
                return;
            }

            const stmt = db.prepare(`
                INSERT INTO insights (summoner_puuid, insight_type, title, description, priority)
                VALUES (?, ?, ?, ?, ?)
            `);

            insights.forEach(insight => {
                stmt.run([puuid, insight.type, insight.title, insight.description, insight.priority]);
            });

            stmt.finalize((err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

// API Routes
app.post('/api/summoner', async (req, res) => {
    try {
        const { summonerName, tagLine, region } = req.body;
        if (!summonerName || !tagLine || !region) {
            return res.status(400).json({
                error: 'Missing required fields',
                message: 'Summoner name, tag line, and region are required'
            });
        }

        console.log(`Fetching data for ${summonerName}#${tagLine} on ${region}`);
        console.log('Using web scraping data sources with priority order: OP.GG → Mobalytics → League of Graphs');
            
        let scrapedData = null;
        let successfulSource = null;
        const failedSources = [];
            
        // Priority 1: Try OP.GG (Primary Source)
        try {
            console.log('\n=== Trying OP.GG (Primary Source) ===');
            scrapedData = await scrapeOPGG(summonerName, tagLine, region);
            successfulSource = DATA_SOURCES.OPGG;
            console.log('✅ OP.GG data retrieval successful');
        } catch (opggError) {
            console.log('❌ OP.GG failed:', opggError.message);
            failedSources.push(DATA_SOURCES.OPGG);
            
            // Priority 2: Try Mobalytics (Secondary Source)
            try {
                console.log('\n=== Trying Mobalytics (Secondary Source) ===');
                scrapedData = await scrapeMobalytics(summonerName, tagLine, region);
                successfulSource = DATA_SOURCES.MOBALYTICS;
                console.log('✅ Mobalytics data retrieval successful');
            } catch (mobalyticsError) {
                console.log('❌ Mobalytics failed:', mobalyticsError.message);
                failedSources.push(DATA_SOURCES.MOBALYTICS);
                
                // Priority 3: Try League of Graphs (Tertiary Source)
                try {
                    console.log('\n=== Trying League of Graphs (Tertiary Source) ===');
                    scrapedData = await scrapeLeagueOfGraphs(summonerName, tagLine, region);
                    successfulSource = DATA_SOURCES.LEAGUE_OF_GRAPHS;
                    console.log('✅ League of Graphs data retrieval successful');
                } catch (logError) {
                    console.log('❌ League of Graphs failed:', logError.message);
                    failedSources.push(DATA_SOURCES.LEAGUE_OF_GRAPHS);
                    
                    // Optional: Try Data Dragon for static data as last resort (Development purposes)
                    try {
                        console.log('\n=== Trying Data Dragon (Static Data) ===');
                        const dragonData = await fetchFromDataDragon();
                        console.log('⚠️  Data Dragon fallback successful (limited static data only)');
                        
                        // Return minimal data with error message
                        logDataSourceFallback(summonerName, tagLine, region, DATA_SOURCES.DATA_DRAGON, failedSources);
                        return res.json({
                            error: 'Limited static data only',
                            summoner: { name: summonerName, tagLine: tagLine, level: 0, region: region },
                            ranked: [],
                            matches: [],
                            insights: [{
                                type: 'error',
                                title: '⚠️ Limited Static Data Only',
                                description: 'Only static game data is available. Player-specific data could not be retrieved.',
                                priority: 1
                            }],
                            opScore: 0,
                            statistics: { winRate: 0, avgKDA: 0, avgCS: 0, totalGames: 0 },
                            dataSource: DATA_SOURCES.DATA_DRAGON,
                            staticData: {
                                champions: dragonData.champions?.data || {},
                                items: dragonData.items?.data || {}
                            }
                        });
                    } catch (dragonError) {
                        console.log('❌ All data sources failed, including Data Dragon');
                        logError('ALL_SOURCES', 'COMPLETE_FAILURE', new Error('All data sources failed'), {
                            summonerName, tagLine, region, failedSources
                        });
                        
                        return res.status(503).json({
                            error: 'All data sources unavailable',
                            details: 'Unable to retrieve data from any source. Please try again later.',
                            failedSources: failedSources,
                            summoner: { name: summonerName, tagLine: tagLine }
                        });
                    }
                }
            }
        }
            
        // If we successfully got data from any scraping source, process it
        if (scrapedData && successfulSource) {
            console.log(`\n✅ Successfully retrieved data from ${successfulSource.toUpperCase()}`);
            logDataSourceFallback(summonerName, tagLine, region, successfulSource, failedSources);
            
            // Generate insights based on scraped data
            const scrapedInsights = [
                {
                    type: 'data_source',
                    title: `🌐 Using ${successfulSource.charAt(0).toUpperCase() + successfulSource.slice(1).replace('_', ' ')}`,
                    description: 'Data is retrieved from public sources. Some advanced features may be limited.',
                    priority: 3
                }
            ];
            
            // Add insights based on available data
            if (scrapedData.statistics.winRate > 0) {
                if (scrapedData.statistics.winRate > 0.6) {
                    scrapedInsights.push({
                        type: 'performance',
                        title: '🔥 Strong Performance',
                        description: `Your win rate of ${(scrapedData.statistics.winRate * 100).toFixed(1)}% shows strong performance. Keep up the good work!`,
                        priority: 1
                    });
                } else if (scrapedData.statistics.winRate < 0.4) {
                    scrapedInsights.push({
                        type: 'performance',
                        title: '📈 Room for Improvement',
                        description: `Your current win rate is ${(scrapedData.statistics.winRate * 100).toFixed(1)}%. Focus on consistency and game fundamentals.`,
                        priority: 1
                    });
                }
            }
            
            // Calculate OP Score from scraped data
            const scrapedOpScore = calculateOPScore(scrapedData.matches || [], scrapedData.ranked || []);
            
            // Create normalized response
            const normalizedResponse = {
                summoner: {
                    name: scrapedData.summoner.name,
                    tagLine: scrapedData.summoner.tagLine,
                    level: scrapedData.summoner.level || 0,
                    profileIconId: 0,
                    puuid: `${successfulSource}_${summonerName}_${tagLine}_${region}`.replace(/[^a-zA-Z0-9_]/g, '_'),
                    region: scrapedData.summoner.region
                },
                ranked: scrapedData.ranked || [],
                matches: scrapedData.matches || [],
                insights: scrapedInsights,
                opScore: scrapedOpScore,
                statistics: scrapedData.statistics,
                dataSource: successfulSource,
                failedSources: failedSources
            };
            
            // Save data to database with pseudo-PUUID for tracking
            try {
                const pseudoAccountData = {
                    puuid: normalizedResponse.summoner.puuid,
                    gameName: summonerName,
                    tagLine: tagLine
                };
                const pseudoSummonerData = {
                    summonerLevel: normalizedResponse.summoner.level,
                    profileIconId: 0,
                    region: region
                };
                
                await saveSummonerData(pseudoSummonerData, pseudoAccountData);
                await saveRankedStats(pseudoAccountData.puuid, normalizedResponse.ranked);
                await saveInsights(pseudoAccountData.puuid, scrapedInsights);
                
                console.log('📝 Scraped data saved to database');
            } catch (saveError) {
                console.log('⚠️  Failed to save scraped data to database:', saveError.message);
                // Continue anyway, data saving is not critical for response
            }
            
            return res.json(normalizedResponse);
        }
        
        return res.status(503).json({
            error: 'All data sources unavailable',
            details: 'Unable to retrieve data from any source. Please try again later.',
            failedSources: failedSources,
            summoner: { name: summonerName, tagLine: tagLine }
        });

    } catch (error) {
        console.error('Error in /api/summoner:', error);
        res.status(500).json({ 
            error: 'Failed to fetch summoner data',
            details: error.message 
        });
    }
});

// Get historical data for a summoner
app.get('/api/summoner/:puuid/history', (req, res) => {
    const { puuid } = req.params;
    
    db.all(`
        SELECT mp.*, m.game_creation, m.game_duration, m.queue_id
        FROM match_participants mp
        JOIN matches m ON mp.match_id = m.match_id
        WHERE mp.summoner_puuid = ?
        ORDER BY m.game_creation DESC
        LIMIT 50
    `, [puuid], (err, rows) => {
        if (err) {
            res.status(500).json({ error: 'Database error', details: err.message });
        } else {
            res.json(rows);
        }
    });
});

// Get insights for a summoner
app.get('/api/summoner/:puuid/insights', (req, res) => {
    const { puuid } = req.params;
    
    db.all(`
        SELECT * FROM insights 
        WHERE summoner_puuid = ? 
        ORDER BY priority ASC, created_at DESC
    `, [puuid], (err, rows) => {
        if (err) {
            res.status(500).json({ error: 'Database error', details: err.message });
        } else {
            res.json(rows);
        }
    });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        database: 'Connected'
    });
});

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'lol_coach_app.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`LoL Coach API server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} to access the application`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    db.close((err) => {
        if (err) {
            console.error(err.message);
        } else {
            console.log('Database connection closed.');
        }
    });
    process.exit(0);
});

/* TODO COMMENTS - DETAILED IMPLEMENTATION STEPS:

TODO 1: Enhanced Web Scraping
- Implement more robust error handling for web scraping
- Add support for League of Graphs scraping
- Improve CSS selectors for better data extraction reliability
- Add retry logic for failed scraping attempts
- Implement CAPTCHA detection and handling
- Add user-agent rotation to avoid detection

TODO 3: Data Normalization Improvements
- Create unified data models for all sources
- Implement data validation and sanitization
- Add data quality scoring system
- Create fallback mechanisms when primary sources fail
- Add data freshness tracking and expiration
- Implement conflict resolution for contradicting data

TODO 4: Advanced Player Performance Analytics
- Implement champion mastery scoring and recommendations
- Add role performance analysis (ADC, Support, Mid, etc.)
- Create streak detection (win streaks, loss streaks, performance trends)
- Add comparative analysis against players of similar rank
- Implement game impact scoring (damage share, vision control, objective participation)
- Create performance regression analysis to identify declining skills
- Add seasonal performance tracking and meta adaptation scoring

TODO 5: Intelligent Coaching System
- Implement machine learning models for personalized improvement suggestions
- Create champion recommendation engine based on playstyle and meta
- Add itemization analysis and build path optimization suggestions
- Implement skill order analysis and recommendations
- Create map awareness scoring based on death locations and ward placement
- Add team composition analysis and synergy recommendations
- Implement behavioral pattern recognition (aggressive vs passive play)

TODO 6: Enhanced Error Handling and Input Validation
- Add comprehensive data retrieval validation before analysis
- Implement graceful degradation when partial data is available
- Create detailed error messages for different failure scenarios
- Add PUUID-only search functionality as alternative to name+tag+region
- Implement input sanitization and validation for all user inputs
- Add rate limiting on client side to prevent API abuse
- Create fallback UI states for when data sources are unavailable

TODO 7: Real-time Match Analysis and Live Game Features
- Implement live game detection and real-time match analysis
- Add opponent analysis and counter-pick suggestions
- Create in-game performance tracking and live coaching tips
- Implement post-game analysis with replay timestamps for key moments
- Add team fight analysis and positioning recommendations
- Create objective timer tracking and strategic suggestions
- Implement voice/text coaching integration during matches

TODO 8: Social and Competitive Features
- Add friend comparison and leaderboard systems
- Implement team/clan management and group statistics
- Create achievement system with unlockable badges and rewards
- Add social sharing of performance highlights and improvements
- Implement mentor/coaching matchmaking system
- Create tournament and scrim analysis tools
- Add performance challenges and improvement goals tracking

TODO 9: Advanced Data Visualization and Reporting
- Create interactive heat maps for champion performance across patches
- Implement detailed match timeline visualization with key events
- Add champion mastery curves and learning progression charts
- Create rank progression forecasting based on current performance
- Implement detailed item efficiency and gold optimization analysis
- Add ward placement heat maps and vision control scoring
- Create comprehensive PDF reports for coaching sessions

TODO 10: Performance Optimization and Scalability
- Implement Redis caching layer for frequently accessed data
- Add database connection pooling and query optimization
- Create background job processing for heavy analytics calculations
- Implement CDN integration for static assets and images
- Add horizontal scaling support with load balancing
- Create monitoring and alerting system for system health
- Implement data archival strategy for historical match data
- Add API response compression and minification
- Create efficient data structures for large dataset operations
*/
