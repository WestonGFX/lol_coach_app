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
      const levelElement = $('.summonerLevel, [class*="level"]').first();
      const level = parseInt(levelElement.text().replace(/\D/g, '')) || 0;
      const rankElement = $('.leagueTier, .rank, [class*="tier"]').first();
      const rankText = rankElement.text().trim() || 'Unranked';
      const lpElement = $('.leaguePoints, [class*="lp"], [class*="points"]').first();
      const lp = parseInt(lpElement.text().replace(/\D/g, '')) || 0;
      const winsElement = $('.wins, [class*="win"]:not([class*="rate"])').first();
      const lossesElement = $('.losses, [class*="loss"]').first();
      const wins = parseInt(winsElement.text().replace(/\D/g, '')) || 0;
      const losses = parseInt(lossesElement.text().replace(/\D/g, '')) || 0;
      const totalGames = wins + losses;
      const winRate = totalGames > 0 ? (wins / totalGames * 100) : 0;
      const kdaElement = $('.kda, [class*="kda"]').first();
      const kdaText = kdaElement.text().trim() || '0/0/0';
      const recentMatches = [];
      $('.match, [class*="match"], .game').each((i, element) => {
        if (i >= 8) return false;
        const match = $(element);
        const championName = match.find('.champion, [class*="champion"]').text().trim();
        const matchResult = match.find('.result, [class*="result"]').text().trim();
        const matchKda = match.find('.kda, [class*="kda"]').text().trim();
        if (championName) {
          let kdaParts = matchKda.split(/\s*[\/\-]\s*/);
          if (!kdaParts || kdaParts.length < 3) {
            const kdaMatch = matchKda.match(/(\d+)\D+(\d+)\D+(\d+)/);
            kdaParts = kdaMatch ? [kdaMatch[1], kdaMatch[2], kdaMatch[3]] : [0, 0, 0];
          }
          const kills = parseInt(kdaParts[0]) || 0;
          const deaths = parseInt(kdaParts[1]) || 0;
          const assists = parseInt(kdaParts[2]) || 0;
          recentMatches.push({
            champion_name: championName,
            win: matchResult.toLowerCase().includes('victory') ||
                 matchResult.toLowerCase().includes('win') ||
                 match.hasClass('victory') || match.hasClass('win'),
            kills,
            deaths,
            assists,
            cs_per_minute: 0
          });
        }
      });
      let avgKDAVal = 0;
      let avgCSVal = 0;
      if (recentMatches.length > 0) {
        const totalKills = recentMatches.reduce((sum, m) => sum + (m.kills || 0), 0);
        const totalDeaths = recentMatches.reduce((sum, m) => sum + (m.deaths || 0), 0);
        const totalAssists = recentMatches.reduce((sum, m) => sum + (m.assists || 0), 0);
        avgKDAVal = totalDeaths > 0 ? (totalKills + totalAssists) / totalDeaths / recentMatches.length : 0;
        avgCSVal = recentMatches.reduce((sum, m) => sum + (m.cs_per_minute || 0), 0) / recentMatches.length;
      }
      const scrapedData = {
        source: DATA_SOURCES.LEAGUE_OF_GRAPHS,
        summoner: { name: summonerName, tagLine, level, region },
        ranked: rankText !== 'Unranked' ? [{
          queueType: 'RANKED_SOLO_5x5',
          tier: rankText.split(' ')[0] || 'UNRANKED',
          rank: rankText.split(' ')[1] || '',
          leaguePoints: lp,
          wins,
          losses
        }] : [],
        matches: recentMatches,
        statistics: { totalGames, winRate: winRate / 100, avgKDA: avgKDAVal, avgCS: avgCSVal },
        leagueOfGraphsSpecific: { kdaText }
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
  return { scrapeLeagueOfGraphs };
};
