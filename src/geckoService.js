import { config } from './config.js';
import { storage } from './storage.js';

export class GeckoService {
  constructor() {
    this.baseUrl = 'https://api.geckoterminal.com/api/v2';
  }

  /**
   * Fetch trending pools and their base tokens from GeckoTerminal
   * @param {string} network - network identifier (e.g. 'base', 'eth')
   * @returns {Promise<Array>} List of token details
   */
  async getTrendingTokens(network = config.geckoNetwork) {
    try {
      const url = `${this.baseUrl}/networks/${network}/trending_pools?include=base_token`;
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json;version=20230302',
          'User-Agent': 'ClankerGeckoBot/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`GeckoTerminal API error: ${response.status} ${response.statusText}`);
      }

      const json = await response.json();
      const pools = json.data || [];
      const included = json.included || [];

      // Create lookup dictionary for included base_token objects
      const tokenMap = new Map();
      for (const item of included) {
        if (item.type === 'token') {
          tokenMap.set(item.id, item.attributes);
        }
      }

      const results = [];
      const seenSymbols = new Set();

      for (const pool of pools) {
        const poolAttrs = pool.attributes || {};
        const baseTokenRel = pool.relationships?.base_token?.data;
        const tokenAttrs = baseTokenRel ? tokenMap.get(baseTokenRel.id) : null;

        if (!tokenAttrs) continue;

        const name = (tokenAttrs.name || '').trim();
        const symbol = (tokenAttrs.symbol || '').trim().toUpperCase();
        let imageUrl = tokenAttrs.image_url || '';

        // Discard missing or blank names/symbols
        if (!name || !symbol) continue;

        // Deduplicate in current batch
        if (seenSymbols.has(symbol)) continue;
        seenSymbols.add(symbol);

        const volume24h = parseFloat(poolAttrs.volume_usd?.h24 || '0');
        if (config.minVolumeUsd > 0 && volume24h < config.minVolumeUsd) {
          continue;
        }

        results.push({
          id: pool.id,
          name,
          symbol,
          imageUrl: imageUrl || 'https://assets.coingecko.com/coins/images/placeholder.png',
          priceUsd: poolAttrs.base_token_price_usd || '0',
          fdvUsd: poolAttrs.fdv_usd || '0',
          volume24h: volume24h.toFixed(2),
          poolAddress: poolAttrs.address,
          poolName: poolAttrs.name,
          network,
          sourceUrl: `https://www.geckoterminal.com/${network}/pools/${poolAttrs.address}`
        });
      }

      return results;
    } catch (error) {
      console.error('Error fetching trending tokens from GeckoTerminal:', error.message);
      return [];
    }
  }

  /**
   * Get trending tokens that haven't been deployed yet by this bot
   */
  async getNewTrendingCandidates(network = config.geckoNetwork) {
    const trending = await this.getTrendingTokens(network);
    return trending.filter(token => !storage.isTokenAlreadyDeployed(token.symbol, token.name));
  }
}

export const geckoService = new GeckoService();
