const axios = require('axios');
const cheerio = require('cheerio');
const { encodeSpecialCharacters } = require('./utils');

module.exports = (logError, DATA_SOURCES) => {
  async function scrapeOPGG(summonerName, tagLine, region, retryCount = 0) {
    const maxRetries = 3;
    try {
      const fullName = `${summonerName}-${tagLine}`;
      const encodedName = encodeSpecialCharacters(fullName);
      const url = `https://op.gg/lol/summoners/${region}/${encodedName}`;
      console.log(`[OP.GG] Scraping: ${url}`);
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      });
      const $ = cheerio.load(response.data);
      const summonerData = {
        summoner: {
          name: summonerName,
          tagLine: tagLine,
          region: region,
          level: parseInt($('[class*="level"], [class*="summoner-level"]').first().text().trim()) || 0
        },
        ranked: [],
        matches: [],
        insights: [],
        opScore: 50,
        sourceUrl: url,
        statistics: { winRate: 0, avgKDA: 0, avgCS: 0 }
      };
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
            wins,
            losses
          });
        }
      });
      $('[class*="match-item"], [class*="game-item"], [class*="match-row"]').each((_, el) => {
        const matchEl = $(el);
        const isWin = matchEl.find('[class*="win"]').length > 0;
        const kdaEl = matchEl.find('[class*="kda"], [class*="k-d-a"]');
        const kdaText = kdaEl.text().trim();
        const [kills, deaths, assists] = kdaText.split(/\s*[\/\-]\s*/).map(n => parseInt(n) || 0);
        const csEl = matchEl.find('[class*="cs-score"], [class*="minion-kills"], [class*="cs"]');
        const csText = csEl.text().trim();
        const csPerMin = parseFloat((csText.match(/(\d+\.?\d*)/) || [])[1]) || 0;
        const championEl = matchEl.find('[class*="champion-name"], [class*="name"]');
        summonerData.matches.push({
          champion_name: championEl.text().trim(),
          win: isWin,
          kills,
          deaths,
          assists,
          cs_per_minute: csPerMin
        });
      });
      if (summonerData.matches.length > 0) {
        const totalMatches = summonerData.matches.length;
        const wins = summonerData.matches.filter(m => m.win).length;
        summonerData.statistics = {
          winRate: wins / totalMatches,
          avgKDA: summonerData.matches.reduce((sum, m) => sum + (m.kills + m.assists) / Math.max(m.deaths, 1), 0) / totalMatches,
          avgCS: summonerData.matches.reduce((sum, m) => sum + (m.cs_per_minute || 0), 0) / totalMatches
        };
      }
      console.log(`[OP.GG] Successfully scraped data for ${summonerName}#${tagLine}`);
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
  return { scrapeOPGG };
};
