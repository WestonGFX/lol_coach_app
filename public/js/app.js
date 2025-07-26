// Front-end logic for LoL Personal Coach
document.addEventListener('DOMContentLoaded', () => {
  // Get DOM elements and validate their existence
  const elements = {
    summonerForm: document.getElementById('searchForm'),
    summonerInput: document.getElementById('summonerName'),
    tagInput: document.getElementById('tagLine'),
    regionSelect: document.getElementById('region'),
    dataSourceSelect: document.getElementById('dataSource'),
    disableRiotCheckbox: document.getElementById('disableRiot'),
    testProfiles: document.getElementById('testProfiles'),
    statsSection: document.getElementById('statsSection'),
    tagsContainer: document.getElementById('tagsContainer'),
    championStatsSection: document.getElementById('championStatsSection'),
    championStatsTable: document.getElementById('championStatsTable'),
    insightsContainer: document.getElementById('insightsContainer'),
    loadingIndicator: document.getElementById('loadingIndicator'),
    errorContainer: document.getElementById('errorContainer'),
    performanceChartCanvas: document.getElementById('performanceChart')
  };

  // Validate required elements
  const missingElements = Object.entries(elements)
    .filter(([, element]) => !element)
    .map(([id]) => id);

  if (missingElements.length > 0) {
    console.error('Missing required DOM elements:', missingElements);
    return;
  }

  // Destructure elements after validation
  const {
    summonerForm,
    summonerInput,
    tagInput,
    regionSelect,
    dataSourceSelect,
    disableRiotCheckbox,
    testProfiles,
    statsSection,
    tagsContainer,
    championStatsSection,
    championStatsTable,
    insightsContainer,
    loadingIndicator,
    errorContainer,
    performanceChartCanvas
  } = elements;

  // Initialize state
  let performanceChart = null;

  // Helper functions
  const helpers = {
    showError(message) {
      errorContainer.innerHTML = `<div class="error">${message}</div>`;
    },

    clearUI() {
      statsSection.innerHTML = '';
      tagsContainer.innerHTML = '';
      errorContainer.innerHTML = '';
      if (championStatsTable) {
        championStatsTable.querySelector('tbody').innerHTML = '';
      }
      if (insightsContainer) {
        insightsContainer.innerHTML = '';
      }
      if (performanceChart) {
        performanceChart.destroy();
        performanceChart = null;
      }
    },

    showLoading() {
      loadingIndicator.style.display = 'block';
    },

    hideLoading() {
      loadingIndicator.style.display = 'none';
    },

    updateChampionStats(matches) {
      if (!championStatsTable) return;

      const tbody = championStatsTable.querySelector('tbody');
      tbody.innerHTML = '';
      
      // Group matches by champion
      const champStats = {};
      matches.forEach(match => {
        const champ = match.champion_name;
        if (!champStats[champ]) {
          champStats[champ] = {
            games: 0,
            wins: 0,
            kills: 0,
            deaths: 0,
            assists: 0
          };
        }
        champStats[champ].games++;
        if (match.win) champStats[champ].wins++;
        champStats[champ].kills += match.kills;
        champStats[champ].deaths += match.deaths;
        champStats[champ].assists += match.assists;
      });

      // Convert to array and sort by games played
      Object.entries(champStats)
        .sort(([,a], [,b]) => b.games - a.games)
        .forEach(([champion, stats]) => {
          const winRate = (stats.wins / stats.games * 100).toFixed(1);
          const kda = ((stats.kills + stats.assists) / Math.max(stats.deaths, 1)).toFixed(2);
          
          const row = document.createElement('tr');
          row.innerHTML = `
            <td>
              <div class="champion-cell">
                <img class="champion-icon" src="https://ddragon.leagueoflegends.com/cdn/13.24.1/img/champion/${champion}.png" 
                     onerror="this.src='https://ddragon.leagueoflegends.com/cdn/13.24.1/img/champion/default.png'"
                     alt="${champion}">
                <span>${champion}</span>
              </div>
            </td>
            <td>${stats.games}</td>
            <td><span class="winrate-text">${winRate}%</span></td>
            <td><span class="kda-text">${kda}</span></td>
          `;
          tbody.appendChild(row);
        });
    },

    updatePerformanceChart(matches) {
      if (!performanceChartCanvas) return;
      
      const ctx = performanceChartCanvas.getContext('2d');
      
      // Clear any existing chart
      if (performanceChart) {
        performanceChart.destroy();
      }

      // Prepare data for last 10 matches
      const recentMatches = matches.slice(0, 10).reverse();
      const labels = recentMatches.map((_, index) => `Game ${index + 1}`);
      const kdaData = recentMatches.map(match => 
        ((match.kills + match.assists) / Math.max(match.deaths, 1)).toFixed(2)
      );
      const csData = recentMatches.map(match => match.cs_per_minute || 0);
      
      // Create new performance chart
      performanceChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'KDA',
              data: kdaData,
              borderColor: 'rgb(136, 192, 208)',
              backgroundColor: 'rgba(136, 192, 208, 0.2)',
              tension: 0.3,
              yAxisID: 'y'
            },
            {
              label: 'CS/min',
              data: csData,
              borderColor: 'rgb(180, 142, 173)',
              backgroundColor: 'rgba(180, 142, 173, 0.2)',
              tension: 0.3,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          responsive: true,
          interaction: {
            mode: 'index',
            intersect: false,
          },
          scales: {
            y: {
              type: 'linear',
              display: true,
              position: 'left',
              title: {
                display: true,
                text: 'KDA',
                color: 'rgb(136, 192, 208)'
              },
              grid: {
                color: 'rgba(236, 239, 244, 0.1)'
              },
              ticks: {
                color: 'rgb(136, 192, 208)'
              }
            },
            y1: {
              type: 'linear',
              display: true,
              position: 'right',
              title: {
                display: true,
                text: 'CS/min',
                color: 'rgb(180, 142, 173)'
              },
              grid: {
                drawOnChartArea: false
              },
              ticks: {
                color: 'rgb(180, 142, 173)'
              }
            },
            x: {
              grid: {
                color: 'rgba(236, 239, 244, 0.1)'
              },
              ticks: {
                color: 'rgb(216, 222, 233)'
              }
            }
          },
          plugins: {
            legend: {
              labels: {
                color: 'rgb(236, 239, 244)'
              }
            }
          }
        }
      });
    },

    updateStats(data) {
      console.log('Updating stats with:', data.summoner);
      // Create summoner info block
      let statsHtml = `
        <div class="stat-block summoner-info">
          <div class="summoner-header">
            ${data.summoner.profileIconId ? 
              `<img class="profile-icon" src="https://ddragon.leagueoflegends.com/cdn/13.24.1/img/profileicon/${data.summoner.profileIconId}.png" alt="Profile Icon">` 
              : '<div class="profile-icon-placeholder"></div>'}
            <div>
              <h3>${data.summoner.name || ''}${data.summoner.tagLine ? '#' + data.summoner.tagLine : ''}</h3>
              <p class="region">${(data.summoner.region || '').toUpperCase()}</p>
              ${data.summoner.level && data.summoner.level > 0 ? `<p class="level">Level ${data.summoner.level}</p>` : ''}
            </div>
          </div>
        </div>`;

      // Add ranked info if available
      if (data.ranked?.length > 0) {
        const rankedData = data.ranked[0];
        const tier = rankedData.tier.toLowerCase();
        statsHtml += `
          <div class="stat-block ranked-info">
            <div class="rank-header">
              <img class="rank-icon" src="https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/ranked-emblem/emblem-${tier}.png" alt="${rankedData.tier} Rank">
              <div>
                <h3>${rankedData.tier} ${rankedData.rank}</h3>
                <p class="lp">${rankedData.leaguePoints} LP</p>
              </div>
            </div>
            <div class="rank-stats">
              <p class="win-loss">
                <span class="wins">${rankedData.wins || 0}W</span> / 
                <span class="losses">${rankedData.losses || 0}L</span>
                <span class="winrate">${((rankedData.wins / (rankedData.wins + rankedData.losses)) * 100).toFixed(1)}% WR</span>
              </p>
            </div>
          </div>`;
      } else {
        statsHtml += '<div class="stat-block ranked-info"><p>Unranked</p></div>';
      }

      // Add performance stats
      statsHtml += `
        <div class="stat-block performance-stats">
          <h3>Performance</h3>
          <p>Win Rate: ${(data.statistics.winRate * 100).toFixed(1)}%</p>
          <p>KDA: ${data.statistics.avgKDA ? data.statistics.avgKDA.toFixed(2) : 'N/A'}</p>
          <p>CS/min: ${data.statistics.avgCS ? data.statistics.avgCS.toFixed(1) : 'N/A'}</p>
          ${data.statistics.kda ? `
            <p class="detailed-kda">
              ${data.statistics.kda.kills}/${data.statistics.kda.deaths}/${data.statistics.kda.assists}
            </p>
          ` : ''}
        </div>`;

      statsSection.innerHTML = statsHtml;
    },

    updateUI(data) {
      console.log('Updating UI with data:', data);
      this.clearUI();
      
      if (!data || !data.summoner) {
        this.showError('Invalid data format received from server');
        return;
      }

      try {
        // Update main stats first
        this.updateStats(data);
        console.log('Stats updated');

        // Update additional components if match data exists
        if (data.matches?.length > 0) {
          this.updateChampionStats(data.matches);
          console.log('Champion stats updated');
          this.updatePerformanceChart(data.matches);
          console.log('Performance chart updated');
        } else {
          console.log('No matches data available');
          // Show a message in the champion stats section
          if (championStatsSection) {
            championStatsSection.innerHTML = '<h2>Champion Statistics</h2><p class="no-data">No recent matches available</p>';
          }
        }

        // Update data source info
        tagsContainer.innerHTML = `
          <span class="tag source">Source: ${data.dataSource}</span>
          ${data.failedSources?.length > 0 ? 
            `<span class="tag failed">Failed sources: ${data.failedSources.join(', ')}</span>` 
            : ''}
          ${!data.matches?.length ? 
            `<span class="tag warning">No match data available</span>` 
            : ''}
        `;
        console.log('Data source info updated');
      } catch (err) {
        console.error('Error updating UI:', err);
        this.showError('Error updating display: ' + err.message);
      }
    }
  };

  // Event Listeners
  testProfiles.addEventListener('change', (e) => {
    const value = e.target.value;
    if (!value) {
      summonerInput.value = '';
      tagInput.value = '';
      return;
    }
    
    const [nameTag, region] = value.split('|');
    const [name, tag] = nameTag.split('#');
    summonerInput.value = name.replace(/\\u200B/g, ''); // Remove zero-width spaces
    tagInput.value = tag;
    regionSelect.value = region.toLowerCase();
    dataSourceSelect.value = 'league_of_graphs'; // Set default source
  });

  summonerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const summonerName = summonerInput.value.trim();
    const tagLine = tagInput.value.trim();
    const region = regionSelect.value;
    const dataSource = dataSourceSelect.value;
    const useRiotApi = !disableRiotCheckbox.checked;

    // Validate input
    if (!summonerName || !tagLine || !region || !dataSource) {
      helpers.showError('Please fill in all required fields');
      return;
    }

    // Clear previous content and show loading
    helpers.clearUI();
    helpers.showLoading();

    try {
      console.log('Submitting form with data:', {
        summonerName,
        tagLine,
        region: region.toLowerCase(),
        dataSource,
        useRiotApi
      });

      const response = await fetch('/api/summoner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          summonerName, 
          tagLine, 
          region: region.toLowerCase(), 
          dataSource, 
          useRiotApi 
        })
      });

      console.log('Response status:', response.status);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('Received data:', data);

      if (data.error) {
        throw new Error(data.error);
      }

      // Still update UI even if no matches, as we might have summoner/ranked data
      helpers.updateUI(data);
    } catch (err) {
      console.error('Error:', err);
      helpers.showError(err.message || 'Failed to fetch summoner data');
    } finally {
      helpers.hideLoading();
    }
  });
});
