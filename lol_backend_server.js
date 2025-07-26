const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const app = express();
// Use a fixed port unless overridden by environment
const PORT = process.env.PORT || 6969;

// Middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


// Database initialization
const db = new sqlite3.Database('./lol_coach.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        initializeDatabase();
    }
});

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

const DATA_SOURCES = {
    OPGG: 'opgg',
    MOBALYTICS: 'mobalytics',
    LEAGUE_OF_GRAPHS: 'league_of_graphs',
    RIOT_API: 'riot_api',
    DATA_DRAGON: 'data_dragon'
};

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

    db.run(
        `INSERT OR REPLACE INTO error_logs 
        (timestamp, source, operation, error_message, status_code, additional_data)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [
            errorLog.timestamp,
            errorLog.source,
            errorLog.operation,
            errorLog.error,
            errorLog.statusCode,
            JSON.stringify(additionalData)
        ],
        (err) => {
            if (err) console.error('Failed to log error to database:', err.message);
        }
    );

    console.error(`[${source}] ${operation} failed:`, errorLog);
}

function logDataSourceFallback(summonerName, tagLine, region, successfulSource, failedSources) {
    db.run(
        `INSERT INTO data_source_fallbacks 
        (summoner_name, tag_line, region, successful_source, failed_sources)
        VALUES (?, ?, ?, ?, ?)`,
        [
            summonerName,
            tagLine,
            region,
            successfulSource,
            JSON.stringify(failedSources)
        ],
        (err) => {
            if (err) console.error('Failed to log data source fallback:', err.message);
        }
    );
}
// Load data source modules after logger is defined
const { fetchFromDataDragon } = require("./services/dataDragon");
const { fetchFromRiotApi } = require("./services/riotApi");
const { scrapeOPGG } = require("./services/opgg")(logError, DATA_SOURCES);
const { scrapeMobalytics } = require("./services/mobalytics")(logError, DATA_SOURCES);
const { scrapeLeagueOfGraphs } = require("./services/leagueOfGraphs")(logError, DATA_SOURCES);



function calculateOPScore(matchData, rankedData) {
    let opScore = 50;
    if (rankedData && rankedData.length > 0) {
        const soloQueue = rankedData.find(queue => queue.queueType === 'RANKED_SOLO_5x5');
        if (soloQueue) {
            const winRate = soloQueue.wins / (soloQueue.wins + soloQueue.losses);
            opScore += winRate * 30;
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
        opScore += Math.min(avgKDA * 8, 25);
        const avgCS = recentMatches.reduce((sum, match) => sum + (match.cs_per_minute || 0), 0) / recentMatches.length;
        opScore += Math.min(avgCS * 2, 15);
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

function saveSummonerData(summonerData, accountData) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare(
            `INSERT OR REPLACE INTO summoners 
            (puuid, summoner_name, tag_line, summoner_level, profile_icon_id, region, last_updated)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
        );
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
        db.run('DELETE FROM ranked_stats WHERE summoner_puuid = ?', [puuid], (err) => {
            if (err) {
                reject(err);
                return;
            }
            if (!rankedData || rankedData.length === 0) {
                resolve();
                return;
            }
            const stmt = db.prepare(
                `INSERT INTO ranked_stats 
                (summoner_puuid, queue_type, tier, rank_division, league_points, wins, losses, hot_streak, veteran, fresh_blood, inactive)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            rankedData.forEach(queue => {
                stmt.run([
                    puuid,
                    queue.queueType || queue.queue,
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

function saveInsights(puuid, insights) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM insights WHERE summoner_puuid = ?', [puuid], (err) => {
            if (err) {
                reject(err);
                return;
            }
            if (!insights || insights.length === 0) {
                resolve();
                return;
            }
            const stmt = db.prepare(
                `INSERT INTO insights (summoner_puuid, insight_type, title, description, priority)
                VALUES (?, ?, ?, ?, ?)`
            );
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

app.post('/api/summoner', async (req, res) => {
    try {
        let { summonerName, tagLine, region, dataSource = 'all', useRiotApi = false } = req.body;
        if (!summonerName || !tagLine || !region) {
            return res.status(400).json({ error: 'Missing required fields', message: 'Summoner name, tag line, and region are required' });
        }

        // Region maps for each data source
        const regionMaps = {
            riot_api: { na: 'na1', euw: 'euw1', eune: 'eun1', kr: 'kr', oce: 'oc1' },
            opgg:     { na: 'na1', euw: 'euw1', eune: 'eun1', kr: 'kr', oce: 'oce' },
            mobalytics: { na: 'na', euw: 'euw', eune: 'eune', kr: 'kr', oce: 'oce' },
            league_of_graphs: { na: 'na', euw: 'euw', eune: 'eune', kr: 'kr', oce: 'oce' }
        };

        // Example usage:
        const riotRegion = regionMaps.riot_api[region] || region;
        const opggRegion = regionMaps.opgg[region] || region;
        const mobalyticsRegion = regionMaps.mobalytics[region] || region;
        const leagueOfGraphsRegion = regionMaps.league_of_graphs[region] || region;

        // Then pass the correct region to each data source:
        // e.g.
        // await fetchFromRiotApi(summonerName, tagLine, riotRegion)
        // await scrapeOPGG(summonerName, tagLine, opggRegion)
        // await scrapeMobalytics(summonerName, tagLine, mobalyticsRegion)
        // await scrapeLeagueOfGraphs(summonerName, tagLine, leagueOfGraphsRegion)

        console.log(`Fetching data for ${summonerName}#${tagLine} on ${region}`);
        console.log(`Requested data source: ${dataSource}, useRiotApi: ${useRiotApi}`);
        let scrapedData = null;
        let successfulSource = null;
        const failedSources = [];
        const sourcesToTry = [];
        const normalizedSource = (dataSource || 'all').toLowerCase();
        if (useRiotApi && (normalizedSource === 'all' || normalizedSource === DATA_SOURCES.RIOT_API)) {
            sourcesToTry.push(DATA_SOURCES.RIOT_API);
        }
        const priorityOrder = [DATA_SOURCES.OPGG, DATA_SOURCES.MOBALYTICS, DATA_SOURCES.LEAGUE_OF_GRAPHS];
        if (normalizedSource === 'all') {
            sourcesToTry.push(...priorityOrder);
        } else if (normalizedSource === DATA_SOURCES.OPGG) {
            sourcesToTry.push(DATA_SOURCES.OPGG);
        } else if (normalizedSource === DATA_SOURCES.MOBALYTICS) {
            sourcesToTry.push(DATA_SOURCES.MOBALYTICS);
        } else if (normalizedSource === DATA_SOURCES.LEAGUE_OF_GRAPHS) {
            sourcesToTry.push(DATA_SOURCES.LEAGUE_OF_GRAPHS);
        } else if (normalizedSource === DATA_SOURCES.RIOT_API && !useRiotApi) {
            console.log('Riot API selected but disabled via useRiotApi flag.');
        }
        console.log('Will attempt sources in order:', sourcesToTry);
        for (const source of sourcesToTry) {
            try {
                if (source === DATA_SOURCES.RIOT_API) {
                    console.log('=== Trying Riot API ===');
                    scrapedData = await fetchFromRiotApi(summonerName, tagLine, region);
                } else if (source === DATA_SOURCES.OPGG) {
                    console.log('=== Trying OP.GG ===');
                    scrapedData = await scrapeOPGG(summonerName, tagLine, region);
                } else if (source === DATA_SOURCES.MOBALYTICS) {
                    console.log('=== Trying Mobalytics ===');
                    scrapedData = await scrapeMobalytics(summonerName, tagLine, region);
                } else if (source === DATA_SOURCES.LEAGUE_OF_GRAPHS) {
                    console.log('=== Trying League of Graphs ===');
                    scrapedData = await scrapeLeagueOfGraphs(summonerName, tagLine, region);
                }
                successfulSource = source;
                console.log(`✅ ${source} data retrieval successful`);
                break;
            } catch (err) {
                console.log(`❌ ${source} failed:`, err.message);
                failedSources.push(source);
            }
        }
        if (!scrapedData || !successfulSource) {
            try {
                console.log('=== Trying Data Dragon (Static Data) ===');
                const dragonData = await fetchFromDataDragon();
                console.log('⚠️  Data Dragon fallback successful (limited static data only)');
                logDataSourceFallback(summonerName, tagLine, region, DATA_SOURCES.DATA_DRAGON, failedSources);
                return res.json({
                    error: 'Limited static data only',
                    summoner: { name: summonerName, tagLine: tagLine, level: 0, region: region },
                    ranked: [],
                    matches: [],
                    insights: [{ type: 'error', title: '⚠️ Limited Static Data Only', description: 'Only static game data is available. Player-specific data could not be retrieved.', priority: 1 }],
                    opScore: 0,
                    statistics: { winRate: 0, avgKDA: 0, avgCS: 0, totalGames: 0 },
                    dataSource: DATA_SOURCES.DATA_DRAGON,
                    staticData: { champions: dragonData.champions?.data || {}, items: dragonData.items?.data || {} },
                    failedSources: failedSources
                });
            } catch (dragonErr) {
                console.log('❌ All data sources failed, including Data Dragon');
                logError('ALL_SOURCES', 'COMPLETE_FAILURE', new Error('All data sources failed'), { summonerName, tagLine, region, failedSources });
                return res.status(503).json({
                    error: 'All data sources unavailable',
                    details: 'Unable to retrieve data from any source. Please try again later.',
                    failedSources: failedSources,
                    summoner: { name: summonerName, tagLine: tagLine }
                });
            }
        }
        console.log(`✅ Successfully retrieved data from ${successfulSource}`);
        logDataSourceFallback(summonerName, tagLine, region, successfulSource, failedSources);
        const scrapedInsights = [
            {
                type: 'data_source',
                title: `🌐 Using ${successfulSource.charAt(0).toUpperCase() + successfulSource.slice(1).replace('_', ' ')}`,
                description: 'Data is retrieved from public sources. Some advanced features may be limited.',
                priority: 3
            }
        ];
        if (scrapedData.statistics && typeof scrapedData.statistics.winRate === 'number') {
            const winRate = scrapedData.statistics.winRate;
            if (winRate > 0.6) {
                scrapedInsights.push({ type: 'performance', title: '🔥 Strong Performance', description: `Your win rate of ${(winRate * 100).toFixed(1)}% shows strong performance. Keep up the good work!`, priority: 1 });
            } else if (winRate < 0.4) {
                scrapedInsights.push({ type: 'performance', title: '📈 Room for Improvement', description: `Your current win rate is ${(winRate * 100).toFixed(1)}%. Focus on consistency and game fundamentals.`, priority: 1 });
            }
        }
        const scrapedOpScore = calculateOPScore(scrapedData.matches || [], scrapedData.ranked || []);
        const normalizedResponse = {
            summoner: {
                name: scrapedData.summoner.name,
                tagLine: scrapedData.summoner.tagLine,
                level: scrapedData.summoner.level || 0,
                profileIconId: scrapedData.summoner.profileIconId || 0,
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
        try {
            const pseudoAccountData = { puuid: normalizedResponse.summoner.puuid, gameName: summonerName, tagLine: tagLine };
            const pseudoSummonerData = { summonerLevel: normalizedResponse.summoner.level, profileIconId: normalizedResponse.summoner.profileIconId, region: region };
            await saveSummonerData(pseudoSummonerData, pseudoAccountData);
            await saveRankedStats(pseudoAccountData.puuid, normalizedResponse.ranked);
            await saveInsights(pseudoAccountData.puuid, scrapedInsights);
            console.log('📝 Scraped data saved to database');
        } catch (saveErr) {
            console.log('⚠️  Failed to save scraped data to database:', saveErr.message);
        }

        // Debug logging before sending response
        console.log('\n=== Debug: Data being sent to frontend ===');
        console.log('Summoner:', normalizedResponse.summoner);
        console.log('Ranked Data:', normalizedResponse.ranked);
        console.log('Match Count:', normalizedResponse.matches.length);
        console.log('Statistics:', normalizedResponse.statistics);
        console.log('Data Source:', normalizedResponse.dataSource);
        console.log('Failed Sources:', normalizedResponse.failedSources);
        console.log('=====================================\n');

        return res.json(normalizedResponse);
    } catch (error) {
        console.error('Error in /api/summoner:', error);
        return res.status(500).json({ error: 'Failed to fetch summoner data', details: error.message });
    }
});

app.get('/api/summoner/:puuid/history', (req, res) => {
    const { puuid } = req.params;
    db.all(
        `SELECT mp.*, m.game_creation, m.game_duration, m.queue_id
         FROM match_participants mp
         JOIN matches m ON mp.match_id = m.match_id
         WHERE mp.summoner_puuid = ?
         ORDER BY m.game_creation DESC
         LIMIT 50`,
        [puuid],
        (err, rows) => {
            if (err) {
                res.status(500).json({ error: 'Database error', details: err.message });
            } else {
                res.json(rows);
            }
        }
    );
});

app.get('/api/summoner/:puuid/insights', (req, res) => {
    const { puuid } = req.params;
    db.all(
        `SELECT * FROM insights 
         WHERE summoner_puuid = ? 
         ORDER BY priority ASC, created_at DESC`,
        [puuid],
        (err, rows) => {
            if (err) {
                res.status(500).json({ error: 'Database error', details: err.message });
            } else {
                res.json(rows);
            }
        }
    );
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString(), database: 'Connected' });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`LoL Coach API server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} to access the application`);
});

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

// Add this new test endpoint
app.get('/api/test/:source', async (req, res) => {
    const { source } = req.params;
    const testSummoner = {
        name: 'VRÆL',
        tagLine: 'VRAEL',
        region: 'na'
    };

    try {
        let data;
        switch(source) {
            case 'opgg':
                data = await scrapeOPGG(testSummoner.name, testSummoner.tagLine, testSummoner.region);
                break;
            case 'mobalytics':
                data = await scrapeMobalytics(testSummoner.name, testSummoner.tagLine, testSummoner.region);
                break;
            case 'leagueofgraphs':
                data = await scrapeLeagueOfGraphs(testSummoner.name, testSummoner.tagLine, testSummoner.region);
                break;
            default:
                return res.status(400).json({ error: 'Invalid source' });
        }
        res.json(data);
    } catch (error) {
        console.error(`Test ${source} error:`, error);
        res.status(500).json({ error: error.message });
    }
});
