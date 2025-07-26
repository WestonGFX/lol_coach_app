const { expect } = require('chai');
const DATA_SOURCES = {
    OPGG: 'opgg',
    MOBALYTICS: 'mobalytics',
    LEAGUE_OF_GRAPHS: 'league_of_graphs'
};

// Mock logger function
const logError = (source, operation, error, context) => {
    console.error(`[${source}] ${operation} error:`, error, context);
};

// Import scrapers
const { scrapeLeagueOfGraphs } = require('../services/leagueOfGraphs')(logError, DATA_SOURCES);
const { scrapeOPGG } = require('../services/opgg')(logError, DATA_SOURCES);
const { scrapeMobalytics } = require('../services/mobalytics')(logError, DATA_SOURCES);

describe('Data Scrapers', () => {
    // Test cases that should work for all scrapers
    const commonTests = (scraperFn, scraperName) => {
        it('should handle non-existent summoners', async () => {
            try {
                await scraperFn('NonExistentSummoner123456', 'NA1', 'na1');
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).to.include('not found');
            }
        });

        it('should validate summoner data structure', async () => {
            const result = await scraperFn('Hide on bush', 'KR1', 'kr');
            expect(result).to.have.property('summoner');
            expect(result.summoner).to.have.property('name');
            expect(result.summoner).to.have.property('tagLine');
            expect(result.summoner).to.have.property('region');
            expect(result.summoner).to.have.property('level');
            expect(result.summoner.level).to.be.a('number');
        });

        it('should validate ranked data structure', async () => {
            const result = await scraperFn('Hide on bush', 'KR1', 'kr');
            expect(result).to.have.property('ranked');
            expect(result.ranked).to.be.an('array');
            if (result.ranked.length > 0) {
                const ranked = result.ranked[0];
                expect(ranked).to.have.property('queueType');
                expect(ranked).to.have.property('tier');
                expect(ranked).to.have.property('rank');
                expect(ranked).to.have.property('leaguePoints');
                expect(ranked).to.have.property('wins');
                expect(ranked).to.have.property('losses');
            }
        });

        it('should validate statistics structure', async () => {
            const result = await scraperFn('Hide on bush', 'KR1', 'kr');
            expect(result).to.have.property('statistics');
            const stats = result.statistics;
            expect(stats).to.have.property('totalGames');
            expect(stats).to.have.property('winRate');
            expect(stats).to.have.property('avgKDA');
            expect(stats).to.have.property('avgCS');
            expect(stats.winRate).to.be.within(0, 1);
            expect(stats.avgCS).to.be.within(0, 20);
        });

        it('should validate match history structure', async () => {
            const result = await scraperFn('Hide on bush', 'KR1', 'kr');
            expect(result).to.have.property('matches');
            expect(result.matches).to.be.an('array');
            if (result.matches.length > 0) {
                const match = result.matches[0];
                expect(match).to.have.property('champion');
                expect(match).to.have.property('result');
                expect(match).to.have.property('kda');
                expect(match.kda).to.have.all.keys('kills', 'deaths', 'assists');
                expect(match).to.have.property('cs');
                expect(['Victory', 'Defeat']).to.include(match.result);
            }
        });
    };

    describe('League of Graphs Scraper', () => {
        commonTests(scrapeLeagueOfGraphs, 'League of Graphs');
    });

    describe('OP.GG Scraper', () => {
        commonTests(scrapeOPGG, 'OP.GG');

        it('should include OP Score', async () => {
            const result = await scrapeOPGG('Hide on bush', 'KR1', 'kr');
            expect(result).to.have.property('opScore');
            expect(result.opScore).to.be.a('number');
        });
    });

    describe('Mobalytics Scraper', () => {
        commonTests(scrapeMobalytics, 'Mobalytics');

        it('should include GPI score', async () => {
            const result = await scrapeMobalytics('Hide on bush', 'KR1', 'kr');
            expect(result).to.have.property('mobalyticsGPI');
            expect(result.mobalyticsGPI).to.be.a('number');
        });
    });
});

// Additional validation tests
describe('Data Validation', () => {
    const testSummoner = 'Hide on bush';
    const testTag = 'KR1';
    const testRegion = 'kr';

    it('should have consistent KDA calculation across all sources', async () => {
        const results = await Promise.all([
            scrapeLeagueOfGraphs(testSummoner, testTag, testRegion),
            scrapeOPGG(testSummoner, testTag, testRegion),
            scrapeMobalytics(testSummoner, testTag, testRegion)
        ]);

        results.forEach(result => {
            const stats = result.statistics;
            if (stats.kda) {
                const calculatedKDA = stats.kda.deaths > 0 ? 
                    (stats.kda.kills + stats.kda.assists) / stats.kda.deaths :
                    stats.kda.kills + stats.kda.assists;
                expect(Math.abs(calculatedKDA - stats.avgKDA)).to.be.lessThan(0.1);
            }
        });
    });

    it('should have reasonable CS/min values', async () => {
        const results = await Promise.all([
            scrapeLeagueOfGraphs(testSummoner, testTag, testRegion),
            scrapeOPGG(testSummoner, testTag, testRegion),
            scrapeMobalytics(testSummoner, testTag, testRegion)
        ]);

        results.forEach(result => {
            expect(result.statistics.avgCS).to.be.within(0, 12);
        });
    });

    it('should have consistent total games count with wins/losses', async () => {
        const results = await Promise.all([
            scrapeLeagueOfGraphs(testSummoner, testTag, testRegion),
            scrapeOPGG(testSummoner, testTag, testRegion),
            scrapeMobalytics(testSummoner, testTag, testRegion)
        ]);

        results.forEach(result => {
            if (result.ranked.length > 0) {
                const ranked = result.ranked[0];
                expect(result.statistics.totalGames).to.equal(ranked.wins + ranked.losses);
            }
        });
    });
});
