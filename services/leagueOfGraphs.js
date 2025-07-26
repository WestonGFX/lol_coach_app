const axios = require('axios');
const cheerio = require('cheerio');
const { encodeSpecialCharacters } = require('./utils');

module.exports = (logError, DATA_SOURCES) => {
  async function scrapeLeagueOfGraphs(summonerName, tagLine, region, retryCount = 0) {
    const maxRetries = 3;
    try {
      const fullName = `${summonerName}-${tagLine}`;
      const encodedName = encodeSpecialCharacters(fullName);
      const url = `https://www.leagueofgraphs.com/summoner/${region}/${encodedName}`;
      console.log(`[League of Graphs] Scraping: ${url}`);
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive'
        },
        timeout: 25000,
        validateStatus: status => status < 500
      });
      
      if (response.status === 404) {
        throw new Error(`Summoner ${summonerName}#${tagLine} not found on League of Graphs`);
      }
      
      const $ = cheerio.load(response.data);
      
      // Get summoner level - found in text containing "Level"
      const levelText = $('div:contains("Level")').first().text();
      const levelMatch = levelText.match(/Level\s+(\d+)/);
      const level = levelMatch ? parseInt(levelMatch[1]) : 0;

      // Get rank info from the ranked section
      const rankElement = $('div:contains("LP")').first();
      const rankText = rankElement.text().trim();
      const rankMatch = rankText.match(/(Iron|Bronze|Silver|Gold|Platinum|Diamond|Master|Grandmaster|Challenger)\s+(I|II|III|IV|V)\s+(\d+)\s+LP/i);
      const tier = rankMatch ? rankMatch[1] : 'Unranked';
      const rank = rankMatch ? rankMatch[2] : '';
      const lp = rankMatch ? parseInt(rankMatch[3]) : 0;

      // Get wins/losses - they appear near each other in the ranked section
      const statsText = $('div:contains("Wins"):contains("Losses")').first().text();
      const winsMatch = statsText.match(/Wins:\s*(\d+)/);
      const lossesMatch = statsText.match(/Losses:\s*(\d+)/);
      const wins = winsMatch ? parseInt(winsMatch[1]) : 0;
      const losses = lossesMatch ? parseInt(lossesMatch[1]) : 0;
      const totalGames = wins + losses;
      // Store win rate as a decimal (56.2% = 0.562)
      const winRate = totalGames > 0 ? parseFloat((wins / totalGames).toFixed(3)) : 0;

      // Get KDA from the overall stats section
      const kdaText = $('div:contains("/"):contains("Average KDA")').first().text();
      const kdaMatch = kdaText.match(/(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)/);
      let kills = 0, deaths = 0, assists = 0;
      
      if (kdaMatch) {
        kills = parseFloat(kdaMatch[1]);
        deaths = parseFloat(kdaMatch[2]);
        assists = parseFloat(kdaMatch[3]);
      }
      
      // Calculate KDA according to League's formula: (Kills + Assists) / Deaths
      const kdaAvg = deaths > 0 ? ((kills + assists) / deaths).toFixed(2) : (kills + assists).toFixed(2);

      // Get CS per minute from recent matches
      let totalCSPerMin = 0;
      let validCSGames = 0;
      
      // Look for CS and game duration in match history
      $('.game-box:not(.arena)').each((_, el) => {
        const $match = $(el);
        const csText = $match.find('[class*="cs"], [class*="farm"]').text();
        const durationText = $match.find('[class*="duration"]').text();
        
        const csMatch = csText.match(/(\d+)\s*CS/);
        const durationMatch = durationText.match(/(\d+):(\d+)/);
        
        if (csMatch && durationMatch) {
          const cs = parseInt(csMatch[1]);
          const minutes = parseInt(durationMatch[1]);
          const seconds = parseInt(durationMatch[2]);
          const durationInMinutes = minutes + (seconds / 60);
          
          if (durationInMinutes > 0) {
            const csPerMin = cs / durationInMinutes;
            // Only count reasonable CS/min values (between 0 and 12)
            if (csPerMin >= 0 && csPerMin <= 12) {
              totalCSPerMin += csPerMin;
              validCSGames++;
            }
          }
        }
      });
      
      const avgCS = validCSGames > 0 ? (totalCSPerMin / validCSGames).toFixed(1) : '0';

      // Get match history
      const recentMatches = [];
      $('[class*="game-box"]:not([class*="arena"])').each((_, matchEl) => {
        const $match = $(matchEl);
        const champName = $match.find('[class*="champion"]').attr('title') || '';
        const kdaText = $match.find('[class*="kda"]').text().trim();
        const isWin = $match.find('[class*="victory"], [class*="win"]').length > 0;
        const csText = $match.find('[class*="cs"]').text().trim();
        const dateText = $match.find('[class*="time-ago"]').text().trim();
        
        const kdaMatch = kdaText.match(/(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
        if (kdaMatch) {
          recentMatches.push({
            champion: champName,
            kda: {
              kills: parseInt(kdaMatch[1]),
              deaths: parseInt(kdaMatch[2]),
              assists: parseInt(kdaMatch[3])
            },
            result: isWin ? 'Victory' : 'Defeat',
            cs: parseInt(csText) || 0,
            date: dateText
          });
        }
      });

      // Prepare the return object
      const summonerData = {
        summoner: {
          name: summonerName,
          tagLine,
          region,
          level
        },
        ranked: [{
          queueType: 'RANKED_SOLO_5x5',
          tier,
          rank,
          leaguePoints: lp,
          wins,
          losses
        }],
        matches: recentMatches,
        statistics: {
          totalGames,
          winRate, // Already stored as proper decimal (0.562 for 56.2%)
          avgKDA: parseFloat(kdaAvg), // Properly calculated (K+A)/D
          avgCS: parseFloat(avgCS), // Now properly calculated per minute, range 0-12
          kda: { // Adding individual KDA components
            kills,
            deaths,
            assists
          }
        },
        sourceUrl: url
      };

      console.log(`[League of Graphs] Successfully scraped data for ${summonerName}#${tagLine}`);
      return summonerData;

    } catch (error) {
      logError(DATA_SOURCES.LEAGUE_OF_GRAPHS, 'SCRAPE_SUMMONER', error, { summonerName, tagLine, region, retryCount });
      if (retryCount < maxRetries && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {
        console.log(`[League of Graphs] Retrying... (${retryCount + 1}/${maxRetries})`);
        return scrapeLeagueOfGraphs(summonerName, tagLine, region, retryCount + 1);
      }
      throw error;
    }
  }
  return { scrapeLeagueOfGraphs };
};
