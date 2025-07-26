/**
 * LoL Coach App - Enhanced Local Storage & Persistence System
 * Features: IndexedDB, localStorage fallback, expiration policies, state hydration
 */

class LoLCoachStorage {
    constructor() {
        this.DB_NAME = 'LoLCoachDB';
        this.DB_VERSION = 1;
        this.EXPIRATION_HOURS = 12; // 12-hour refresh policy
        this.db = null;
        this.isIndexedDBSupported = false;
        
        this.init();
    }

    async init() {
        // Check for IndexedDB support
        this.isIndexedDBSupported = 'indexedDB' in window;
        
        if (this.isIndexedDBSupported) {
            try {
                await this.initIndexedDB();
                console.log('🗄️ IndexedDB initialized successfully');
            } catch (error) {
                console.warn('IndexedDB initialization failed, falling back to localStorage:', error);
                this.isIndexedDBSupported = false;
            }
        } else {
            console.log('🗄️ IndexedDB not supported, using localStorage');
        }
    }

    initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create summoner data store
                if (!db.objectStoreNames.contains('summoners')) {
                    const summonerStore = db.createObjectStore('summoners', { keyPath: 'key' });
                    summonerStore.createIndex('timestamp', 'timestamp', { unique: false });
                    summonerStore.createIndex('region', 'data.summoner.region', { unique: false });
                }
                
                // Create app settings store
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
                
                // Create cache metadata store
                if (!db.objectStoreNames.contains('metadata')) {
                    db.createObjectStore('metadata', { keyPath: 'key' });
                }
            };
        });
    }

    // Generate consistent cache key
    generateSummonerKey(summonerName, tagLine, region) {
        return `summoner_${summonerName}_${tagLine}_${region}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    }

    // Check if data is expired based on 12-hour policy
    isExpired(timestamp, customHours = null) {
        const expirationHours = customHours || this.EXPIRATION_HOURS;
        const expirationTime = expirationHours * 60 * 60 * 1000; // Convert to milliseconds
        return Date.now() - timestamp > expirationTime;
    }

    // Save summoner data with metadata
    async saveSummonerData(summonerName, tagLine, region, data, settings = {}) {
        const key = this.generateSummonerKey(summonerName, tagLine, region);
        const timestamp = Date.now();
        
        const cacheEntry = {
            key,
            data,
            timestamp,
            expires: timestamp + (this.EXPIRATION_HOURS * 60 * 60 * 1000),
            settings,
            metadata: {
                version: '1.0',
                source: data.dataSource || 'opgg', // Changed from riot_api as it's disabled
                size: JSON.stringify(data).length
            }
        };

        try {
            if (this.isIndexedDBSupported && this.db) {
                await this.saveToIndexedDB('summoners', cacheEntry);
                console.log(`💾 Saved summoner data to IndexedDB: ${key}`);
            } else {
                this.saveToLocalStorage(key, cacheEntry);
                console.log(`💾 Saved summoner data to localStorage: ${key}`);
            }
            
            // Update last accessed summoner
            await this.saveAppSetting('lastAccessedSummoner', { summonerName, tagLine, region, timestamp });
            
            return true;
        } catch (error) {
            console.error('Failed to save summoner data:', error);
            return false;
        }
    }

    // Get summoner data with expiration check
    async getSummonerData(summonerName, tagLine, region) {
        const key = this.generateSummonerKey(summonerName, tagLine, region);
        
        try {
            let cacheEntry;
            
            if (this.isIndexedDBSupported && this.db) {
                cacheEntry = await this.getFromIndexedDB('summoners', key);
            } else {
                cacheEntry = this.getFromLocalStorage(key);
            }
            
            if (!cacheEntry) {
                console.log(`📂 No cached data found for: ${key}`);
                return null;
            }
            
            // Check expiration
            if (this.isExpired(cacheEntry.timestamp)) {
                console.log(`⏰ Cached data expired for: ${key}`);
                await this.removeSummonerData(summonerName, tagLine, region);
                return null;
            }
            
            // Update last accessed time
            await this.saveAppSetting('lastAccessedSummoner', { 
                summonerName, tagLine, region, 
                timestamp: Date.now() 
            });
            
            console.log(`📂 Retrieved cached data for: ${key} (age: ${Math.round((Date.now() - cacheEntry.timestamp) / (60 * 1000))} minutes)`);
            return cacheEntry;
            
        } catch (error) {
            console.error('Failed to get summoner data:', error);
            return null;
        }
    }

    // Remove specific summoner data
    async removeSummonerData(summonerName, tagLine, region) {
        const key = this.generateSummonerKey(summonerName, tagLine, region);
        
        try {
            if (this.isIndexedDBSupported && this.db) {
                await this.removeFromIndexedDB('summoners', key);
            } else {
                localStorage.removeItem(`lol_coach_${key}`);
            }
            console.log(`🗑️ Removed cached data for: ${key}`);
            return true;
        } catch (error) {
            console.error('Failed to remove summoner data:', error);
            return false;
        }
    }

    // Get all cached summoners
    async getAllSummoners() {
        try {
            if (this.isIndexedDBSupported && this.db) {
                return await this.getAllFromIndexedDB('summoners');
            } else {
                return this.getAllFromLocalStorage();
            }
        } catch (error) {
            console.error('Failed to get all summoners:', error);
            return [];
        }
    }

    // Save app settings
    async saveAppSetting(key, value) {
        const setting = {
            key,
            value,
            timestamp: Date.now()
        };

        try {
            if (this.isIndexedDBSupported && this.db) {
                await this.saveToIndexedDB('settings', setting);
            } else {
                localStorage.setItem(`lol_coach_setting_${key}`, JSON.stringify(setting));
            }
            return true;
        } catch (error) {
            console.error(`Failed to save app setting ${key}:`, error);
            return false;
        }
    }

    // Get app setting
    async getAppSetting(key, defaultValue = null) {
        try {
            let setting;
            
            if (this.isIndexedDBSupported && this.db) {
                setting = await this.getFromIndexedDB('settings', key);
            } else {
                const stored = localStorage.getItem(`lol_coach_setting_${key}`);
                setting = stored ? JSON.parse(stored) : null;
            }
            
            return setting ? setting.value : defaultValue;
        } catch (error) {
            console.error(`Failed to get app setting ${key}:`, error);
            return defaultValue;
        }
    }

    // Enhanced settings management
    async saveSettings(settingsObject) {
        try {
            for (const [key, value] of Object.entries(settingsObject)) {
                await this.saveAppSetting(key, value);
            }
            return true;
        } catch (error) {
            console.error('Failed to save settings object:', error);
            return false;
        }
    }

    async getSettings() {
        try {
            const settings = {};
            
            if (this.isIndexedDBSupported && this.db) {
                const allSettings = await this.getAllFromIndexedDB('settings');
                allSettings.forEach(setting => {
                    settings[setting.key] = setting.value;
                });
            } else {
                // Get all settings from localStorage
                Object.keys(localStorage)
                    .filter(key => key.startsWith('lol_coach_setting_'))
                    .forEach(key => {
                        try {
                            const setting = JSON.parse(localStorage.getItem(key));
                            const settingKey = key.replace('lol_coach_setting_', '');
                            settings[settingKey] = setting.value;
                        } catch (e) {
                            // Ignore corrupted settings
                        }
                    });
            }
            
            return settings;
        } catch (error) {
            console.error('Failed to get settings:', error);
            return {};
        }
    }

    // Account management functions
    async getSavedAccounts() {
        return await this.getAppSetting('savedAccounts', []);
    }

    async saveSavedAccounts(accounts) {
        return await this.saveAppSetting('savedAccounts', accounts);
    }

    async addSavedAccount(summonerName, tagLine, region = 'na1') {
        try {
            const accounts = await this.getSavedAccounts();
            const newAccount = {
                summonerName,
                tagLine,
                region,
                default: accounts.length === 0, // First account is default
                dateAdded: Date.now()
            };
            
            // Check if account already exists
            const exists = accounts.find(acc => 
                acc.summonerName === summonerName && acc.tagLine === tagLine && acc.region === region
            );
            
            if (!exists) {
                accounts.push(newAccount);
                await this.saveSavedAccounts(accounts);
                console.log(`📝 Added account: ${summonerName}#${tagLine} (${region})`);
                return true;
            } else {
                console.log(`⚠️ Account already exists: ${summonerName}#${tagLine}`);
                return false;
            }
        } catch (error) {
            console.error('Failed to add saved account:', error);
            return false;
        }
    }

    async removeSavedAccount(summonerName, tagLine, region = 'na1') {
        try {
            let accounts = await this.getSavedAccounts();
            const originalLength = accounts.length;
            
            accounts = accounts.filter(acc => 
                !(acc.summonerName === summonerName && acc.tagLine === tagLine && acc.region === region)
            );
            
            if (accounts.length < originalLength) {
                await this.saveSavedAccounts(accounts);
                console.log(`🗑️ Removed account: ${summonerName}#${tagLine} (${region})`);
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Failed to remove saved account:', error);
            return false;
        }
    }

    async setDefaultAccount(summonerName, tagLine, region = 'na1') {
        try {
            const accounts = await this.getSavedAccounts();
            
            // Set all accounts to non-default, then set the specified one as default
            accounts.forEach(acc => {
                acc.default = (acc.summonerName === summonerName && 
                              acc.tagLine === tagLine && 
                              acc.region === region);
            });
            
            await this.saveSavedAccounts(accounts);
            console.log(`⭐ Set default account: ${summonerName}#${tagLine} (${region})`);
            return true;
        } catch (error) {
            console.error('Failed to set default account:', error);
            return false;
        }
    }

    async getDefaultAccount() {
        try {
            const accounts = await this.getSavedAccounts();
            return accounts.find(acc => acc.default) || null;
        } catch (error) {
            console.error('Failed to get default account:', error);
            return null;
        }
    }

    // Cleanup expired data
    async cleanupExpiredData() {
        console.log('🧹 Starting cleanup of expired data...');
        let cleanedCount = 0;

        try {
            if (this.isIndexedDBSupported && this.db) {
                const allSummoners = await this.getAllFromIndexedDB('summoners');
                for (const entry of allSummoners) {
                    if (this.isExpired(entry.timestamp)) {
                        await this.removeFromIndexedDB('summoners', entry.key);
                        cleanedCount++;
                    }
                }
            } else {
                const keys = Object.keys(localStorage).filter(key => key.startsWith('lol_coach_'));
                for (const key of keys) {
                    try {
                        const data = JSON.parse(localStorage.getItem(key));
                        if (data.timestamp && this.isExpired(data.timestamp)) {
                            localStorage.removeItem(key);
                            cleanedCount++;
                        }
                    } catch (e) {
                        // Remove corrupted entries
                        localStorage.removeItem(key);
                        cleanedCount++;
                    }
                }
            }
            
            console.log(`🧹 Cleanup complete: ${cleanedCount} expired entries removed`);
            return cleanedCount;
        } catch (error) {
            console.error('Cleanup failed:', error);
            return 0;
        }
    }

    // Clear all cached data
    async clearAllData() {
        try {
            if (this.isIndexedDBSupported && this.db) {
                const transaction = this.db.transaction(['summoners', 'settings', 'metadata'], 'readwrite');
                await Promise.all([
                    transaction.objectStore('summoners').clear(),
                    transaction.objectStore('settings').clear(),
                    transaction.objectStore('metadata').clear()
                ]);
            } else {
                const keys = Object.keys(localStorage).filter(key => key.startsWith('lol_coach_'));
                keys.forEach(key => localStorage.removeItem(key));
            }
            
            console.log('🗑️ All cached data cleared');
            return true;
        } catch (error) {
            console.error('Failed to clear all data:', error);
            return false;
        }
    }

    // Get storage statistics
    async getStorageStats() {
        try {
            let totalEntries = 0;
            let totalSize = 0;
            let oldestEntry = Date.now();
            let newestEntry = 0;

            if (this.isIndexedDBSupported && this.db) {
                const summoners = await this.getAllFromIndexedDB('summoners');
                totalEntries = summoners.length;
                
                summoners.forEach(entry => {
                    totalSize += entry.metadata?.size || 0;
                    if (entry.timestamp < oldestEntry) oldestEntry = entry.timestamp;
                    if (entry.timestamp > newestEntry) newestEntry = entry.timestamp;
                });
            } else {
                const keys = Object.keys(localStorage).filter(key => key.startsWith('lol_coach_'));
                totalEntries = keys.length;
                
                keys.forEach(key => {
                    const data = localStorage.getItem(key);
                    totalSize += data.length;
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.timestamp) {
                            if (parsed.timestamp < oldestEntry) oldestEntry = parsed.timestamp;
                            if (parsed.timestamp > newestEntry) newestEntry = parsed.timestamp;
                        }
                    } catch (e) {
                        // Ignore invalid entries
                    }
                });
            }

            return {
                totalEntries,
                totalSize,
                oldestEntry: oldestEntry === Date.now() ? null : oldestEntry,
                newestEntry: newestEntry || null,
                storageType: this.isIndexedDBSupported ? 'IndexedDB' : 'localStorage'
            };
        } catch (error) {
            console.error('Failed to get storage stats:', error);
            return { totalEntries: 0, totalSize: 0, storageType: 'unknown' };
        }
    }

    // IndexedDB helper methods
    saveToIndexedDB(storeName, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data);
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    getFromIndexedDB(storeName, key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    removeFromIndexedDB(storeName, key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    getAllFromIndexedDB(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    // localStorage helper methods (fallback)
    saveToLocalStorage(key, data) {
        try {
            localStorage.setItem(`lol_coach_${key}`, JSON.stringify(data));
        } catch (e) {
            console.warn('localStorage save failed, possibly due to storage quota:', e);
            // Try to clear some space and retry
            this.cleanupExpiredData();
            localStorage.setItem(`lol_coach_${key}`, JSON.stringify(data));
        }
    }

    getFromLocalStorage(key) {
        try {
            const data = localStorage.getItem(`lol_coach_${key}`);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.warn('localStorage parse failed:', e);
            return null;
        }
    }

    getAllFromLocalStorage() {
        const summoners = [];
        const keys = Object.keys(localStorage).filter(key => key.startsWith('lol_coach_summoner_'));
        
        keys.forEach(key => {
            try {
                const data = localStorage.getItem(key);
                if (data) {
                    summoners.push(JSON.parse(data));
                }
            } catch (e) {
                console.warn('Failed to parse localStorage entry:', key);
            }
        });
        
        return summoners;
    }

    // Export/Import functionality for backup
    async exportData() {
        try {
            const allSummoners = await this.getAllSummoners();
            const settings = this.isIndexedDBSupported 
                ? await this.getAllFromIndexedDB('settings')
                : Object.keys(localStorage)
                    .filter(key => key.startsWith('lol_coach_setting_'))
                    .map(key => JSON.parse(localStorage.getItem(key)));

            const exportData = {
                version: '1.0',
                timestamp: Date.now(),
                summoners: allSummoners,
                settings,
                stats: await this.getStorageStats()
            };

            return JSON.stringify(exportData, null, 2);
        } catch (error) {
            console.error('Export failed:', error);
            throw error;
        }
    }

    async importData(jsonData) {
        try {
            const importData = JSON.parse(jsonData);
            
            if (!importData.version || !importData.summoners) {
                throw new Error('Invalid import data format');
            }

            // Clear existing data
            await this.clearAllData();

            // Import summoners
            for (const summoner of importData.summoners) {
                if (this.isIndexedDBSupported && this.db) {
                    await this.saveToIndexedDB('summoners', summoner);
                } else {
                    this.saveToLocalStorage(summoner.key, summoner);
                }
            }

            // Import settings
            if (importData.settings) {
                for (const setting of importData.settings) {
                    if (this.isIndexedDBSupported && this.db) {
                        await this.saveToIndexedDB('settings', setting);
                    } else {
                        localStorage.setItem(`lol_coach_setting_${setting.key}`, JSON.stringify(setting));
                    }
                }
            }

            console.log(`📥 Import complete: ${importData.summoners.length} summoners imported`);
            return true;
        } catch (error) {
            console.error('Import failed:', error);
            throw error;
        }
    }
}

// Global instance
window.lolStorage = new LoLCoachStorage();

// Auto-cleanup on page load
document.addEventListener('DOMContentLoaded', async () => {
    await window.lolStorage.cleanupExpiredData();
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LoLCoachStorage;
}
