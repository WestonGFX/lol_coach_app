const axios = require('axios');

async function fetchFromDataDragon() {
  try {
    const version = '13.24.1';
    const itemsUrl = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/item.json`;
    const champsUrl = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`;
    const [championsResponse, itemsResponse] = await Promise.all([
      axios.get(champsUrl, { timeout: 10000 }),
      axios.get(itemsUrl, { timeout: 10000 })
    ]);
    return {
      champions: championsResponse.data,
      items: itemsResponse.data
    };
  } catch (error) {
    console.error('Error fetching from Data Dragon:', error.message);
    throw error;
  }
}

module.exports = { fetchFromDataDragon };
