import { config } from './config.js';
import { storage } from './storage.js';
import { xRadarService } from './xRadarService.js';

export class TrendingService {
  constructor() {
    this.geckoTerminalBase = 'https://api.geckoterminal.com/api/v2';
    this.coinGeckoBase = 'https://api.coingecko.com/api/v3';
    this.dexScreenerBase = 'https://api.dexscreener.com';
    this.cache = new Map();
    this.cacheExpiry = 60 * 1000; // 1 minute in-memory cache
  }

  async getXAlphaTrending() {
    return xRadarService.getXAlphaTrending();
  }

  /**
   * Helper to fetch with timeout and headers
   */
  async safeFetchJson(url, headers = {}) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ClankerMultiTrending/2.0',
          ...headers
        }
      });
      clearTimeout(timeout);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  /**
   * 1. Fetch GeckoTerminal Trending for a specific network (base, solana, eth, bsc, etc.)
   */
  async getGeckoTerminalTrending(network = 'base') {
    const cacheKey = `gt_${network}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.time < this.cacheExpiry) {
      return cached.data;
    }

    const url = `${this.geckoTerminalBase}/networks/${network}/trending_pools?include=base_token`;
    const json = await this.safeFetchJson(url, { 'Accept': 'application/json;version=20230302' });
    if (!json || !json.data) return [];

    const pools = json.data || [];
    const included = json.included || [];
    const tokenMap = new Map();

    for (const item of included) {
      if (item.type === 'token') {
        tokenMap.set(item.id, item.attributes);
      }
    }

    const results = [];
    const seen = new Set();

    for (const pool of pools) {
      const poolAttrs = pool.attributes || {};
      const baseTokenRel = pool.relationships?.base_token?.data;
      const tokenAttrs = baseTokenRel ? tokenMap.get(baseTokenRel.id) : null;
      if (!tokenAttrs) continue;

      const name = (tokenAttrs.name || '').trim();
      const symbol = (tokenAttrs.symbol || '').trim().toUpperCase();
      if (!name || !symbol || seen.has(symbol)) continue;
      seen.add(symbol);

      const volume24h = parseFloat(poolAttrs.volume_usd?.h24 || '0');
      results.push({
        id: `gt_${network}_${symbol.toLowerCase()}`,
        name,
        symbol,
        imageUrl: tokenAttrs.image_url || 'https://assets.coingecko.com/coins/images/placeholder.png',
        priceUsd: poolAttrs.base_token_price_usd || '0',
        fdvUsd: poolAttrs.fdv_usd || '0',
        volume24h: volume24h.toFixed(2),
        sourceNetwork: network.toUpperCase(),
        sourceType: `GeckoTerminal (${network.toUpperCase()})`,
        poolAddress: poolAttrs.address,
        poolName: poolAttrs.name || `${symbol} Pool`,
        sourceUrl: `https://www.geckoterminal.com/${network}/pools/${poolAttrs.address}`
      });
    }

    this.cache.set(cacheKey, { data: results, time: Date.now() });
    return results;
  }

  /**
   * 2. Fetch CoinGecko Global Trending Coins & Categories
   */
  async getCoinGeckoTrending() {
    const cacheKey = 'cg_trending';
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.time < this.cacheExpiry) {
      return cached.data;
    }

    const url = `${this.coinGeckoBase}/search/trending`;
    const json = await this.safeFetchJson(url);
    if (!json || !json.coins) return [];

    const results = [];
    const seen = new Set();

    for (const entry of json.coins) {
      const item = entry.item;
      if (!item) continue;

      const name = (item.name || '').trim();
      const symbol = (item.symbol || '').trim().toUpperCase();
      if (!name || !symbol || seen.has(symbol)) continue;
      seen.add(symbol);

      const priceUsd = item.data?.price ? String(item.data.price) : '0';
      const volume24h = item.data?.total_volume ? parseFloat(item.data.total_volume.replace(/[^0-9.-]+/g, '')) || 0 : 0;

      results.push({
        id: `cg_${item.id || symbol.toLowerCase()}`,
        name,
        symbol,
        imageUrl: item.large || item.thumb || 'https://assets.coingecko.com/coins/images/placeholder.png',
        priceUsd,
        fdvUsd: item.data?.market_cap || '0',
        volume24h: volume24h.toFixed(2),
        sourceNetwork: 'GLOBAL',
        sourceType: 'CoinGecko Trending',
        poolAddress: item.coin_id || item.id,
        poolName: `Global Search #${item.score + 1}`,
        sourceUrl: `https://www.coingecko.com/en/coins/${item.slug || item.id}`
      });
    }

    this.cache.set(cacheKey, { data: results, time: Date.now() });
    return results;
  }

  /**
   * 3. Fetch Pump.fun & Solana Meme Trending Tokens (via DexScreener search & profiles)
   */
  async getPumpFunTrending() {
    const cacheKey = 'pump_trending';
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.time < this.cacheExpiry) {
      return cached.data;
    }

    const url = `${this.dexScreenerBase}/latest/dex/search?q=pump`;
    const json = await this.safeFetchJson(url);
    if (!json || !json.pairs) return [];

    const pairs = json.pairs || [];
    const results = [];
    const seen = new Set();

    for (const pair of pairs) {
      if (pair.chainId !== 'solana') continue;
      const baseToken = pair.baseToken;
      if (!baseToken) continue;

      const name = (baseToken.name || '').trim();
      const symbol = (baseToken.symbol || '').trim().toUpperCase();
      if (!name || !symbol || seen.has(symbol)) continue;
      seen.add(symbol);

      const imageUrl = pair.info?.imageUrl || pair.info?.header || 'https://assets.coingecko.com/coins/images/placeholder.png';
      const volume24h = parseFloat(pair.volume?.h24 || '0');

      results.push({
        id: `pump_${pair.pairAddress?.substring(0, 12) || symbol.toLowerCase()}`,
        name,
        symbol,
        imageUrl,
        priceUsd: pair.priceUsd || '0',
        fdvUsd: pair.fdv ? String(pair.fdv) : '0',
        volume24h: volume24h.toFixed(2),
        sourceNetwork: 'SOLANA',
        sourceType: 'Pump.fun / Solana Meme',
        poolAddress: pair.pairAddress,
        poolName: `${symbol} (Pump.fun)`,
        sourceUrl: pair.url || `https://dexscreener.com/solana/${pair.pairAddress}`
      });
    }

    this.cache.set(cacheKey, { data: results, time: Date.now() });
    return results;
  }

  /**
   * 4. Fetch FOMO & Top Boosted Tokens (DexScreener Boosts / Robinhood & Multi-Chain)
   */
  async getFomoBoostedTrending() {
    const cacheKey = 'fomo_boosts';
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.time < this.cacheExpiry) {
      return cached.data;
    }

    const url = `${this.dexScreenerBase}/token-boosts/top/v1`;
    const json = await this.safeFetchJson(url);
    if (!json || !Array.isArray(json)) return [];

    const results = [];
    const seen = new Set();

    for (const item of json.slice(0, 15)) {
      const address = item.tokenAddress;
      const chainId = (item.chainId || 'multi').toUpperCase();
      if (!address) continue;

      let symbol = address.substring(0, 6).toUpperCase();
      let name = `FOMO Boosted ${chainId}`;
      let imageUrl = item.icon || item.header || 'https://assets.coingecko.com/coins/images/placeholder.png';

      if (item.description) {
        const words = item.description.trim().split(' ');
        if (words[0] && words[0].length < 15) {
          name = words.slice(0, 3).join(' ');
          symbol = words[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || symbol;
        }
      }

      if (seen.has(address)) continue;
      seen.add(address);

      results.push({
        id: `fomo_${address.substring(0, 10)}`,
        name,
        symbol: symbol.substring(0, 10),
        imageUrl,
        priceUsd: '0',
        fdvUsd: '0',
        volume24h: String(item.totalAmount || '0'),
        sourceNetwork: chainId,
        sourceType: `FOMO Boosted (${chainId})`,
        poolAddress: address,
        poolName: `Top Boosted on ${chainId}`,
        sourceUrl: item.url || `https://dexscreener.com/${item.chainId}/${address}`
      });
    }

    this.cache.set(cacheKey, { data: results, time: Date.now() });
    return results;
  }

  /**
   * 4.5. Fetch DexScreener New Pairs Base (Profile=1)
   */
  async getDexScreenerNewPairsBase() {
    const cacheKey = 'dx_new_base_profile';
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.time < this.cacheExpiry) {
      return cached.data;
    }

    // Since direct HTML scraping is blocked by CF, we use the token-profiles API which perfectly matches profile=1 new pairs
    const url = `${this.dexScreenerBase}/token-profiles/latest/v1`;
    const json = await this.safeFetchJson(url);
    if (!json || !Array.isArray(json)) return [];

    const baseProfiles = json.filter(item => item.chainId === 'base');
    const results = [];
    
    // If token-profiles doesn't yield enough base tokens, we can fallback to GeckoTerminal New Pools Base
    if (baseProfiles.length === 0) {
      const fallbackUrl = `https://api.geckoterminal.com/api/v2/networks/base/new_pools?include=base_token`;
      const fbJson = await this.safeFetchJson(fallbackUrl, { 'Accept': 'application/json;version=20230302' });
      if (fbJson && fbJson.data) {
        const included = fbJson.included || [];
        const tokenMap = new Map();
        for (const item of included) {
          if (item.type === 'token') {
            tokenMap.set(item.id, item.attributes);
          }
        }
        for (const pool of fbJson.data) {
          const baseTokenRel = pool.relationships?.base_token?.data;
          const tokenAttrs = baseTokenRel ? tokenMap.get(baseTokenRel.id) : null;
          if (!tokenAttrs) continue;
          
          results.push({
            id: `dxnew_${tokenAttrs.symbol}`,
            name: tokenAttrs.name,
            symbol: tokenAttrs.symbol.toUpperCase(),
            imageUrl: tokenAttrs.image_url || 'https://assets.coingecko.com/coins/images/placeholder.png',
            priceUsd: pool.attributes.base_token_price_usd || '0',
            fdvUsd: pool.attributes.fdv_usd || '0',
            volume24h: '0',
            sourceNetwork: 'BASE',
            sourceType: 'DexScreener New Pairs (Profile=1)',
            poolAddress: pool.attributes.address,
            poolName: pool.attributes.name || 'New Pair',
            sourceUrl: `https://dexscreener.com/base/${pool.attributes.address}`
          });
        }
      }
    } else {
      for (const item of baseProfiles) {
        // We have address, icon, description, url. Name and Symbol we will approximate or leave to Clanker to match.
        // Usually DexScreener URLs have symbol in it, but we can just use a fallback logic.
        let name = "New Base Pair";
        let symbol = item.tokenAddress.substring(0, 5).toUpperCase();
        
        results.push({
          id: `dxnew_${item.tokenAddress}`,
          name,
          symbol,
          imageUrl: item.icon || item.header || 'https://assets.coingecko.com/coins/images/placeholder.png',
          priceUsd: '0',
          fdvUsd: '0',
          volume24h: '0',
          sourceNetwork: 'BASE',
          sourceType: 'DexScreener New Pairs (Profile=1)',
          poolAddress: item.tokenAddress,
          poolName: 'New Base Pair',
          sourceUrl: item.url || `https://dexscreener.com/base/${item.tokenAddress}`
        });
      }
    }

    // Reverse the results if we want oldest (order=asc) or newest. The API usually returns newest first.
    // The user asked for "order=asc" which means oldest first. We will reverse the array.
    results.reverse();

    this.cache.set(cacheKey, { data: results, time: Date.now() });
    return results;
  }

  /**
   * 4.6. Fetch Uniswap / Multi-DEX Trending via DexScreener Search
   */
  async getMultiPlatformDexTrending() {
    const cacheKey = 'multi_dex_trending';
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.time < this.cacheExpiry) {
      return cached.data;
    }

    const queries = ['uniswap', 'raydium', 'robinhood'];
    const results = [];
    const seen = new Set();

    for (const q of queries) {
      const url = `${this.dexScreenerBase}/latest/dex/search?q=${encodeURIComponent(q)}`;
      const json = await this.safeFetchJson(url);
      if (!json || !json.pairs) continue;

      for (const pair of json.pairs.slice(0, 5)) {
        const baseToken = pair.baseToken;
        if (!baseToken) continue;

        const name = (baseToken.name || '').trim();
        const symbol = (baseToken.symbol || '').trim().toUpperCase();
        if (!name || !symbol || seen.has(symbol)) continue;
        seen.add(symbol);

        const chainId = (pair.chainId || 'MULTI').toUpperCase();
        const dexId = (pair.dexId || q).toUpperCase();
        const imageUrl = pair.info?.imageUrl || pair.info?.header || 'https://assets.coingecko.com/coins/images/placeholder.png';
        const volume24h = parseFloat(pair.volume?.h24 || '0');

        results.push({
          id: `dex_${pair.pairAddress?.substring(0, 10) || symbol.toLowerCase()}`,
          name,
          symbol,
          imageUrl,
          priceUsd: pair.priceUsd || '0',
          fdvUsd: pair.fdv ? String(pair.fdv) : '0',
          volume24h: volume24h.toFixed(2),
          sourceNetwork: chainId,
          sourceType: `${dexId} (${chainId})`,
          poolAddress: pair.pairAddress,
          poolName: `${symbol} on ${dexId}`,
          sourceUrl: pair.url || `https://dexscreener.com/${pair.chainId}/${pair.pairAddress}`
        });
      }
    }

    this.cache.set(cacheKey, { data: results, time: Date.now() });
    return results;
  }

  /**
   * 4.7. Fetch Ethereum (ETH) & BSC Trending Pools
   */
  async getEthBscTrending(network = 'eth') {
    return this.getGeckoTerminalTrending(network);
  }

  /**
   * 5. Get Combined All-in-One Multi-Chain & Multi-Platform Trending
   * Aggregates Base, Solana, CoinGecko, Pump.fun, FOMO Boosts, DexScreener New Pairs, Ethereum, BSC, and Multi-DEX
   */
  async getAllTrendingTokens() {
    const [
      baseGecko,
      solanaGecko,
      coinGecko,
      pumpFun,
      fomoBoosts,
      xAlpha,
      dxNewBase,
      multiDex,
      ethGecko,
      bscGecko
    ] = await Promise.all([
      this.getGeckoTerminalTrending('base'),
      this.getGeckoTerminalTrending('solana'),
      this.getCoinGeckoTrending(),
      this.getPumpFunTrending(),
      this.getFomoBoostedTrending(),
      this.getXAlphaTrending(),
      this.getDexScreenerNewPairsBase(),
      this.getMultiPlatformDexTrending(),
      this.getGeckoTerminalTrending('eth'),
      this.getGeckoTerminalTrending('bsc')
    ]);

    const combined = [];
    const seenSymbols = new Set();

    // Round-robin mix from each source for variety
    const maxLen = Math.max(
      baseGecko.length,
      solanaGecko.length,
      coinGecko.length,
      pumpFun.length,
      fomoBoosts.length,
      xAlpha.length,
      dxNewBase.length,
      multiDex.length,
      ethGecko.length,
      bscGecko.length
    );

    for (let i = 0; i < maxLen; i++) {
      const candidates = [
        dxNewBase[i], // prioritize new pairs
        xAlpha[i],
        baseGecko[i],
        coinGecko[i],
        multiDex[i],
        pumpFun[i],
        ethGecko[i],
        bscGecko[i],
        solanaGecko[i],
        fomoBoosts[i]
      ].filter(Boolean);

      for (const t of candidates) {
        if (!seenSymbols.has(t.symbol)) {
          seenSymbols.add(t.symbol);
          combined.push(t);
        }
      }
    }

    return combined;
  }

  /**
   * Get candidates for auto-deployment (not yet deployed)
   */
  async getNewTrendingCandidates() {
    const all = await this.getAllTrendingTokens();
    return all.filter(token => !storage.isTokenAlreadyDeployed(token.symbol, token.name));
  }
}

export const trendingService = new TrendingService();
