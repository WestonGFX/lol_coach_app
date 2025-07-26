const axios = require('axios');
const cheerio = require('cheerio');
const { encodeSpecialCharacters } = require('./utils');

module.exports = (logError, DATA_SOURCES) => {
  async function scrapeMobalytics(summonerName, tagLine, region, retryCount = 0) {
    const maxRetries = 3;
    try {
      const fullName = `${summonerName}-${tagLine}`;
      const encodedName = encodeSpecialCharacters(fullName.toLowerCase());
      const url = `https://mobalytics.gg/lol/profile/${region}/${encodedName}/`;
      console.log(`[Mobalytics] Scraping: ${url}`);
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://mobalytics.gg/',
          'DNT': '1'
        },
        timeout: 20000,
        validateStatus: status => status < 500
      });
      if (response.status === 404) {
        throw new Error(`Summoner ${summonerName}#${tagLine} not found on Mobalytics`);
      }
      const $ = cheerio.load(response.data);
      const summonerData = {
        summoner: { name: summonerName, tagLine, region, level: 0 },
        ranked: [],
        matches: [],
        insights: [],
        opScore: 50,
        sourceUrl: url,
        statistics: { winRate: 0, avgKDA: 0, avgCS: 0 }
      };
      const rankElement = $('[data-testid="rank-tier"], [class*="rank-tier"], [class*="current-rank"]').first();
      if (rankElement.length) {
        const rankText = rankElement.text().trim();
        const rankMatch = rankText.match(/(Iron|Bronze|Silver|Gold|Platinum|Diamond|Master|Grandmaster|Challenger)\s*(I{1,4}|V?I{0,3})?/i);
        if (rankMatch) {
          const [_, tier, division] = rankMatch;
          const lpMatch = rankText.match(/(\d+)\s*LP/i);
          const lp = lpMatch ? parseInt(lpMatch[1]) : 0;
          summonerData.ranked.push({ queue: 'RANKED_SOLO_5x5', tier, rank: division || '', leaguePoints: lp });
        }
      }
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
      $('[class*="match-history-item"], [class*="match-row"]').each((_, el) => {
        const matchEl = $(el);
        const isWin = matchEl.find('[class*="victory"], [class*="win"]').length > 0;
        const kdaEl = matchEl.find('[class*="kda-ratio"], [class*="kda"]');
        const kdaText = kdaEl.text().trim();
        const [kills, deaths, assists] = kdaText.split(/\s*[\/\-]\s*/).map(n => parseInt(n) || 0);
        const csEl = matchEl.find('[class*="creep-score"], [class*="cs"]');
        const csText = csEl.text().trim();
        const csPerMin = parseFloat((csText.match(/(\d+\.?\d*)/) || [])[1]) || 0;
        const championEl = matchEl.find('[class*="champion-name"], [class*="champion"]');
        const championText = championEl.text().trim();
        summonerData.matches.push({
          champion_name: championText,
          win: isWin,
          kills,
          deaths,
          assists,
          cs_per_minute: csPerMin,
          cs: Math.round(csPerMin * 15)
        });
      });
      if (summonerData.matches.length > 0) {
        const totalKills = summonerData.matches.reduce((sum, m) => sum + m.kills, 0);
        const totalDeaths = summonerData.matches.reduce((sum, m) => sum + m.deaths, 0);
        const totalAssists = summonerData.matches.reduce((sum, m) => sum + m.assists, 0);
        const totalCS = summonerData.matches.reduce((sum, m) => sum + m.cs, 0);
        const wins = summonerData.matches.filter(m => m.win).length;
        const avgKDAVal = (totalKills + totalAssists) / Math.max(totalDeaths, 1);
        const avgCSVal = totalCS / summonerData.matches.length;
        const winRateVal = wins / summonerData.matches.length;
        summonerData.statistics.avgKDA = avgKDAVal;
        summonerData.statistics.avgCS = avgCSVal;
        summonerData.statistics.winRate = winRateVal;
        if (avgKDAVal > 3) summonerData.insights.push('Good KDA ratio - keep it up!');
        if (avgCSVal < 5) summonerData.insights.push('Try to improve CS score');
        if (winRateVal > 0.55) summonerData.insights.push("Strong win rate - you're climbing!");
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
  return { scrapeMobalytics };
};
