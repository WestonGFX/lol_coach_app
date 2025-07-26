const axios = require('axios');

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

function getRegionalCluster(region) {
  const regionMap = {
    na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
    euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe',
    kr: 'asia', jp1: 'asia'
  };
  return regionMap[region] || 'americas';
}

async function makeRiotAPICall(url, apiKey, retryCount = 0) {
  const maxRetries = 5;
  const baseDelay = 1000;
  const headers = {
    'X-Riot-Token': apiKey,
    'User-Agent': 'LoL-Personal-Coach/1.0'
  };
  try {
    const response = await axios.get(url, { headers, timeout: 15000 });
    if (response.status >= 400 && response.status < 500) {
      throw new Error(`Client error: ${response.status}`);
    }
    return response.data;
  } catch (error) {
    const isRateLimited = error.response?.status === 429;
    const isServerError = error.response?.status >= 500;
    const isNetworkError = !error.response;
    if ((isRateLimited || isServerError || isNetworkError) && retryCount < maxRetries) {
      let retryDelay = baseDelay * Math.pow(2, retryCount);
      if (isRateLimited) {
        retryDelay = (error.response.headers['retry-after'] || 1) * 1000;
      }
      await new Promise(res => setTimeout(res, retryDelay));
      return makeRiotAPICall(url, apiKey, retryCount + 1);
    }
    throw error;
  }
}

async function fetchSummonerByRiotID(gameName, tagLine, region, apiKey) {
  const cluster = getRegionalCluster(region);
  const url = `${RIOT_BASE_URLS[cluster]}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  return makeRiotAPICall(url, apiKey);
}

async function fetchSummonerByPUUID(puuid, region, apiKey) {
  const url = `${REGIONAL_ENDPOINTS[region]}/lol/summoner/v4/summoners/by-puuid/${puuid}`;
  return makeRiotAPICall(url, apiKey);
}

async function fetchRankedStats(summonerId, region, apiKey) {
  const url = `${REGIONAL_ENDPOINTS[region]}/lol/league/v4/entries/by-summoner/${summonerId}`;
  return makeRiotAPICall(url, apiKey);
}

async function fetchMatchHistory(puuid, region, count = 20, apiKey) {
  const cluster = getRegionalCluster(region);
  const url = `${RIOT_BASE_URLS[cluster]}/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${count}`;
  return makeRiotAPICall(url, apiKey);
}

async function fetchMatchDetails(matchId, region, apiKey) {
  const cluster = getRegionalCluster(region);
  const url = `${RIOT_BASE_URLS[cluster]}/lol/match/v5/matches/${matchId}`;
  return makeRiotAPICall(url, apiKey);
}

async function fetchFromRiotApi(summonerName, tagLine, region) {
  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) throw new Error('Riot API key not configured');

  const account = await fetchSummonerByRiotID(summonerName, tagLine, region, apiKey);
  const summoner = await fetchSummonerByPUUID(account.puuid, region, apiKey);
  const ranked = await fetchRankedStats(summoner.id, region, apiKey);
  const matchIds = await fetchMatchHistory(account.puuid, region, 10, apiKey);
  const matches = [];
  for (const id of matchIds) {
    const details = await fetchMatchDetails(id, region, apiKey);
    const participant = details.info.participants.find(p => p.puuid === account.puuid);
    matches.push({
      champion_name: participant.championName,
      win: participant.win,
      kills: participant.kills,
      deaths: participant.deaths,
      assists: participant.assists,
      cs_per_minute: participant.totalMinionsKilled / (details.info.gameDuration / 60)
    });
  }
  const stats = {
    winRate: matches.filter(m => m.win).length / matches.length,
    avgKDA: matches.reduce((s, m) => s + (m.kills + m.assists) / Math.max(m.deaths, 1), 0) / matches.length,
    avgCS: matches.reduce((s, m) => s + (m.cs_per_minute || 0), 0) / matches.length
  };
  return {
    summoner: {
      name: account.gameName,
      tagLine: account.tagLine,
      level: summoner.summonerLevel,
      region,
      profileIconId: summoner.profileIconId
    },
    ranked,
    matches,
    insights: [],
    opScore: 50,
    sourceUrl: 'riot_api',
    statistics: stats
  };
}

module.exports = { fetchFromRiotApi };
