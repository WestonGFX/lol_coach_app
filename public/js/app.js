// Front-end logic for LoL Personal Coach

document.addEventListener('DOMContentLoaded', () => {
  const searchForm = document.getElementById('searchForm');
  const summonerInput = document.getElementById('summonerName');
  const tagInput = document.getElementById('tagLine');
  const regionSelect = document.getElementById('region');
  const dataSourceSelect = document.getElementById('dataSource');
  const disableRiotCheckbox = document.getElementById('disableRiot');
  const testProfiles = document.getElementById('testProfiles');
  const statsSection = document.getElementById('statsSection');
  const tagsContainer = document.getElementById('tagsContainer');
  const championStatsTableBody = document.querySelector('#championStatsTable tbody');
  const insightsContainer = document.getElementById('insightsContainer');
  const loadingIndicator = document.getElementById('loadingIndicator');
  const errorContainer = document.getElementById('errorContainer');
  let performanceChart = null;

  // Populate form fields when selecting a test profile
  testProfiles.addEventListener('change', () => {
    const value = testProfiles.value;
    if (!value) return;
    const [nameTag, region] = value.split('|');
    const [name, tag] = nameTag.split('#');
    summonerInput.value = name;
    tagInput.value = tag;
    regionSelect.value = region;
  });

  // Handle form submission
  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const summonerName = summonerInput.value.trim();
    const tagLine = tagInput.value.trim();
    const region = regionSelect.value;
    const dataSource = dataSourceSelect.value;
    const disableRiot = disableRiotCheckbox.checked;
    // Clear previous content
    statsSection.innerHTML = '';
    tagsContainer.innerHTML = '';
    championStatsTableBody.innerHTML = '';
    insightsContainer.innerHTML = '';
    errorContainer.innerHTML = '';
    // Show loading indicator
    loadingIndicator.style.display = 'block';
    try {
      const payload = {
        summonerName,
        tagLine,
        region,
        dataSource,
        useRiotApi: !disableRiot
      };
      const res = await fetch('/api/summoner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      displaySummonerData(data);
    } catch (err) {
      showError(err.message);
    } finally {
      loadingIndicator.style.display = 'none';
    }
  });

  function showError(message) {
    errorContainer.innerHTML = `<div class="error">${message}</div>`;
  }

  // Update UI with summoner data
  function displaySummonerData(data) {
    // Display basic statistics
    const stats = data.statistics || {};
    const statCards = [];
    if (stats.rank_tier) {
      statCards.push({ label: 'Rank', value: `${stats.rank_tier} ${stats.rank_division || ''} (${stats.league_points || 0} LP)` });
    }
    if (stats.winRate !== undefined) {
      statCards.push({ label: 'Win Rate', value: `${(stats.winRate * 100).toFixed(1)}%` });
    }
    if (stats.avgKDA !== undefined) {
      statCards.push({ label: 'Average KDA', value: stats.avgKDA.toFixed(2) });
    }
    if (stats.avgCS !== undefined) {
      statCards.push({ label: 'CS / Min', value: stats.avgCS.toFixed(2) });
    }
    // Render stat cards
    statCards.forEach(({ label, value }) => {
      const card = document.createElement('div');
      card.className = 'stat-card';
      card.innerHTML = `<h3>${label}</h3><div class="stat-value">${value}</div>`;
      statsSection.appendChild(card);
    });
    // Render tags
    if (data.tags && Array.isArray(data.tags)) {
      data.tags.forEach(tag => {
        const span = document.createElement('span');
        const cls = {
          mvp: 'tag-mvp',
          doubleKill: 'tag-double-kill',
          unstoppable: 'tag-unstoppable',
          carry: 'tag-carry',
          clutch: 'tag-clutch'
        }[tag.type] || 'tag-mvp';
        span.className = `achievement-tag ${cls}`;
        span.textContent = tag.title || tag.name || tag;
        tagsContainer.appendChild(span);
      });
    }
    // Compute and render champion stats
    updateChampionStats(data.matches || []);
    // Render insights
    if (data.insights && Array.isArray(data.insights)) {
      data.insights.forEach(item => {
        const div = document.createElement('div');
        div.className = 'insight-item';
        div.innerHTML = `<div class="insight-title">${item.title}</div><div class="insight-text">${item.description || item.text || ''}</div>`;
        insightsContainer.appendChild(div);
      });
    }
    // Render chart
    renderChart(stats);
  }

  // Generate champion statistics table
  function updateChampionStats(matches) {
    const champStats = {};
    matches.forEach(match => {
      const champ = match.champion_name || match.champion;
      if (!champ) return;
      if (!champStats[champ]) {
        champStats[champ] = {
          games: 0,
          wins: 0,
          kills: 0,
          deaths: 0,
          assists: 0,
          csPerMin: 0
        };
      }
      champStats[champ].games += 1;
      if (match.win) champStats[champ].wins += 1;
      champStats[champ].kills += match.kills || 0;
      champStats[champ].deaths += match.deaths || 0;
      champStats[champ].assists += match.assists || 0;
      champStats[champ].csPerMin += match.cs_per_minute || match.cs || 0;
    });
    Object.keys(champStats).forEach(champ => {
      const s = champStats[champ];
      const winRate = s.wins / s.games;
      const kda = (s.deaths === 0 ? s.kills + s.assists : (s.kills + s.assists) / s.deaths);
      const avgCs = s.csPerMin / s.games;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${champ}</td>
        <td>${s.games}</td>
        <td>${(winRate * 100).toFixed(1)}%</td>
        <td>${kda.toFixed(2)}</td>
        <td>${avgCs.toFixed(2)}</td>
      `;
      championStatsTableBody.appendChild(tr);
    });
  }

  // Build a simple performance chart
  function renderChart(stats) {
    const ctx = document.getElementById('performanceChart').getContext('2d');
    const labels = ['Win Rate', 'Average KDA', 'Average CS'];
    const values = [
      stats.winRate !== undefined ? (stats.winRate * 100).toFixed(1) : 0,
      stats.avgKDA !== undefined ? stats.avgKDA.toFixed(2) : 0,
      stats.avgCS !== undefined ? stats.avgCS.toFixed(2) : 0
    ];
    const data = {
      labels,
      datasets: [
        {
          label: 'Performance',
          data: values,
          backgroundColor: [
            'rgba(136, 192, 208, 0.6)',
            'rgba(129, 161, 193, 0.6)',
            'rgba(94, 129, 172, 0.6)'
          ],
          borderColor: [
            'rgba(136, 192, 208, 1)',
            'rgba(129, 161, 193, 1)',
            'rgba(94, 129, 172, 1)'
          ],
          borderWidth: 1
        }
      ]
    };
    if (performanceChart) {
      performanceChart.destroy();
    }
    performanceChart = new Chart(ctx, {
      type: 'bar',
      data,
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });
  }
});
