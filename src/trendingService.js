import { config } from './config.js';
import { storage } from './storage.js';
import { xRadarService } from './xRadarService.js';
import { aiEngine } from './aiEngine.js';

export class TrendingService {
  constructor() {
    this.geckoTerminalBase = 'https://api.geckoterminal.com/api/v2';
    this.coinGeckoBase = 'https://api.coingecko.com/api/v3';
    this.dexScreenerBase = 'https://api.dexscreener.com';
    this.clankerWorldBase = 'https://www.clanker.world/api';
    this.cache = new Map();
    this.cacheExpiry = 3 * 60 * 1000; // 3 minutes in-memory cache to stay well under rate limits
  }

  async getXAlphaTrending() {
    return xRadarService.getXAlphaTrending();
  }

  /**
   * 0.1 Fetch OKX Hot Tokens (Trending by token score & X social mentions + spot gainers)
   */
  async getOkxHotTokens() {
    const cacheKey = 'okx_hot_tokens';
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.time < this.cacheExpiry) {
      return cached.data;
    }

    const results = [];
    const seen = new Set();

    // 1. OKX Web3 Hot Tokens - Trending (rankingType=4) & X-mentioned (rankingType=5)
    const rankingTypes = [
      { type: '4', label: 'OKX DEX Trending' },
      { type: '5', label: 'OKX X-Social Hype' }
    ];

    for (const r of rankingTypes) {
      try {
        const url = `https://web3.okx.com/api/v6/dex/market/token/hot-token?rankingType=${r.type}&rankingTimeFrame=4&riskFilter=true`;
        const json = await this.safeFetchJson(url, {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });

        if (json && Array.isArray(json.data)) {
          for (const item of json.data) {
            const symbol = (item.tokenSymbol || item.symbol || '').trim().toUpperCase();
            const name = (item.tokenName || item.name || symbol).trim();
            if (!symbol || !name || seen.has(symbol)) continue;
            seen.add(symbol);

            const chainMap = {
              '8453': 'BASE',
              '1': 'ETH',
              '501': 'SOLANA',
              '56': 'BSC',
              '137': 'POLYGON',
              '42161': 'ARBITRUM'
            };
            const chain = chainMap[String(item.chainIndex)] || 'OKX-Web3';

            results.push({
              id: `okx_${symbol.toLowerCase()}_${(item.tokenContractAddress || '').slice(0, 8)}`,
              name,
              symbol,
              imageUrl: item.tokenLogoUrl || item.logoUrl || 'https://assets.coingecko.com/coins/images/placeholder.png',
              priceUsd: String(item.price || item.priceUsd || '0'),
              fdvUsd: String(item.marketCap || '0'),
              volume24h: parseFloat(item.volume24h || item.tradeAmount || '0').toFixed(2),
              sourceNetwork: chain,
              sourceType: r.label,
              poolAddress: item.tokenContractAddress || '',
              poolName: `${symbol} (${r.label})`,
              sourceUrl: item.tokenContractAddress ? `https://www.okx.com/web3/dex-market/token/${item.tokenContractAddress}` : 'https://www.okx.com/web3'
            });
          }
        }
      } catch (e) {
        // Continue gracefully
      }
    }

    // 2. OKX Spot High-Momentum Tickers
    if (results.length < 10) {
      try {
        const spotUrl = 'https://www.okx.com/api/v5/market/tickers?instType=SPOT';
        const spotJson = await this.safeFetchJson(spotUrl, {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        });

        if (spotJson && Array.isArray(spotJson.data)) {
          const spotTokens = spotJson.data
            .filter(t => t.instId && t.instId.endsWith('-USDT'))
            .map(t => {
              const sym = t.instId.replace('-USDT', '').trim().toUpperCase();
              const open24h = parseFloat(t.open24h) || 0;
              const last = parseFloat(t.last) || 0;
              const changePct = open24h > 0 ? ((last - open24h) / open24h) * 100 : 0;
              const volUsd = (parseFloat(t.volCcy24h) || 0);
              return { sym, last, changePct, volUsd };
            })
            .filter(t => t.volUsd > 50000 && !['USDC', 'USDT', 'DAI', 'FDUSD', 'TUSD', 'EUR', 'BUSD'].includes(t.sym))
            .sort((a, b) => b.changePct - a.changePct)
            .slice(0, 15);

          for (const st of spotTokens) {
            if (!seen.has(st.sym)) {
              seen.add(st.sym);
              results.push({
                id: `okx_spot_${st.sym.toLowerCase()}`,
                name: `${st.sym} Token`,
                symbol: st.sym,
                imageUrl: 'https://assets.coingecko.com/coins/images/placeholder.png',
                priceUsd: String(st.last),
                fdvUsd: '0',
                volume24h: st.volUsd.toFixed(2),
                sourceNetwork: 'OKX-Spot',
                sourceType: 'OKX Hot Gainers',
                poolAddress: '',
                poolName: `${st.sym} (OKX Top Gainer +${st.changePct.toFixed(1)}%)`,
                sourceUrl: `https://www.okx.com/trade-spot/${st.sym.toLowerCase()}-usdt`
              });
            }
          }
        }
      } catch (e) {
        // Fallback gracefully
      }
    }

    if (results.length > 0) {
      this.cache.set(cacheKey, { data: results, time: Date.now() });
      return results;
    }

    if (cached && cached.data && cached.data.length > 0) return cached.data;
    return [];
  }

  /**
   * 0. Fetch Top Trending Now directly from Clanker.world (Volume 24h & Transactions)
   */
  async getClankerWorldTrending() {
    const cacheKey = 'clanker_world_trending';
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.time < this.cacheExpiry) {
      return cached.data;
    }

    const url = `${this.clankerWorldBase}/tokens?sortBy=volume-h24&sort=desc&page=1&limit=20`;
    const json = await this.safeFetchJson(url);
    if (!json || !json.data) {
      if (cached && cached.data && cached.data.length > 0) return cached.data;
      return [];
    }

    const results = [];
    const seen = new Set();

    for (const item of json.data) {
      const name = (item.name || '').trim();
      const symbol = (item.symbol || '').trim().toUpperCase();
      const address = item.contract_address;
      if (!name || !symbol || seen.has(symbol)) continue;
      seen.add(symbol);

      const market = item.related?.market || {};
      const volume24h = parseFloat(market.volume24h || '0');
      const priceUsd = market.priceUsd ? String(market.priceUsd) : (item.priceUsd ? String(item.priceUsd) : '0');
      const fdvUsd = market.marketCap ? String(market.marketCap) : '0';
      const imageUrl = item.img_url || 'https://assets.coingecko.com/coins/images/placeholder.png';

      results.push({
        id: `clanker_${address ? address.substring(0, 10).toLowerCase() : symbol.toLowerCase()}`,
        name,
        symbol,
        imageUrl,
        priceUsd,
        fdvUsd,
        volume24h: volume24h.toFixed(2),
        sourceNetwork: 'BASE',
        sourceType: 'Clanker.world Trending Now',
        poolAddress: address || item.pool_address || '',
        poolName: `${symbol} (Clanker.world Top Volume)`,
        sourceUrl: `https://www.clanker.world/clanker/${address || ''}`
      });
    }

    this.cache.set(cacheKey, { data: results, time: Date.now() });
    return results;
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
    if (!json || !json.data) {
      if (cached && cached.data && cached.data.length > 0) return cached.data;
      return [];
    }

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
   * 4.8. Fetch DexScreener Trending All-Chain (Solana, Base, Ethereum, BSC, Arbitrum, etc.)
   * Mengambil token top-boosted dan active profiles lintas chain langsung dengan detail DEX
   */
  async getDexScreenerAllChainTrending() {
    const cacheKey = 'dx_all_chain_trending';
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.time < this.cacheExpiry) {
      return cached.data;
    }

    try {
      const [boosts, profiles] = await Promise.all([
        this.safeFetchJson(`${this.dexScreenerBase}/token-boosts/top/v1`),
        this.safeFetchJson(`${this.dexScreenerBase}/token-profiles/latest/v1`)
      ]);

      const addresses = new Set();
      (boosts || []).slice(0, 15).forEach(b => b.tokenAddress && addresses.add(b.tokenAddress));
      (profiles || []).slice(0, 15).forEach(p => p.tokenAddress && addresses.add(p.tokenAddress));

      const addrList = Array.from(addresses).slice(0, 30);
      if (addrList.length === 0) return [];

      const pairsData = await this.safeFetchJson(`${this.dexScreenerBase}/latest/dex/tokens/${addrList.join(',')}`);
      if (!pairsData || !pairsData.pairs) return [];

      const results = [];
      const seen = new Set();

      for (const pair of pairsData.pairs) {
        const baseToken = pair.baseToken;
        if (!baseToken) continue;

        const name = (baseToken.name || '').trim();
        const symbol = (baseToken.symbol || '').trim().toUpperCase();
        if (!name || !symbol || seen.has(symbol)) continue;
        seen.add(symbol);

        const chainId = (pair.chainId || 'MULTI').toUpperCase();
        const dexId = (pair.dexId || 'DEX').toUpperCase();
        const volume24h = parseFloat(pair.volume?.h24 || '0');
        const imageUrl = pair.info?.imageUrl || pair.info?.header || 'https://assets.coingecko.com/coins/images/placeholder.png';

        results.push({
          id: `dxall_${pair.chainId?.toLowerCase()}_${pair.pairAddress?.substring(0, 8) || symbol.toLowerCase()}`,
          name,
          symbol,
          imageUrl,
          priceUsd: pair.priceUsd ? String(pair.priceUsd) : '0',
          fdvUsd: pair.fdv ? String(pair.fdv) : '0',
          volume24h: volume24h.toFixed(2),
          sourceNetwork: chainId,
          sourceType: `DexScreener All-Chain (${chainId}/${dexId})`,
          poolAddress: pair.pairAddress || pair.baseToken?.address,
          poolName: `${symbol} on ${dexId} (${chainId})`,
          sourceUrl: pair.url || `https://dexscreener.com/${pair.chainId}/${pair.pairAddress}`
        });
      }

      this.cache.set(cacheKey, { data: results, time: Date.now() });
      return results;
    } catch (e) {
      console.warn('Error fetching DexScreener all-chain trending:', e.message);
      return [];
    }
  }

  /**
   * 4.9. Fetch Robinhood Network Trending (GeckoTerminal + DexScreener Robinhood L2)
   */
  async getRobinhoodTrending() {
    const cacheKey = 'gt_rh_trending';
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.time < this.cacheExpiry) {
      return cached.data;
    }

    try {
      const results = [];
      const seen = new Set();

      // 1. GeckoTerminal Trending Pools on Robinhood network
      const gtPools = await this.getGeckoTerminalTrending('robinhood');
      for (const t of gtPools) {
        if (!seen.has(t.symbol)) {
          seen.add(t.symbol);
          results.push({
            ...t,
            sourceNetwork: 'ROBINHOOD',
            sourceType: 'GeckoTerminal (Robinhood L2)'
          });
        }
      }

      // 2. DexScreener Search Robinhood pairs as supplement
      const dxUrl = `${this.dexScreenerBase}/latest/dex/search?q=robinhood`;
      const dxJson = await this.safeFetchJson(dxUrl);
      if (dxJson && dxJson.pairs) {
        for (const pair of dxJson.pairs) {
          if (pair.chainId !== 'robinhood') continue;
          const baseToken = pair.baseToken;
          if (!baseToken || !baseToken.symbol) continue;
          const symbol = baseToken.symbol.trim().toUpperCase();
          if (seen.has(symbol)) continue;
          seen.add(symbol);

          const volume24h = parseFloat(pair.volume?.h24 || '0');
          results.push({
            id: `rh_${pair.pairAddress?.substring(0, 10) || symbol.toLowerCase()}`,
            name: baseToken.name || symbol,
            symbol,
            imageUrl: pair.info?.imageUrl || pair.info?.header || 'https://assets.coingecko.com/coins/images/placeholder.png',
            priceUsd: pair.priceUsd || '0',
            fdvUsd: pair.fdv ? String(pair.fdv) : '0',
            volume24h: volume24h.toFixed(2),
            sourceNetwork: 'ROBINHOOD',
            sourceType: 'DexScreener (Robinhood L2)',
            poolAddress: pair.pairAddress,
            poolName: `${symbol} on Robinhood`,
            sourceUrl: pair.url || `https://dexscreener.com/robinhood/${pair.pairAddress}`
          });
        }
      }

      this.cache.set(cacheKey, { data: results, time: Date.now() });
      return results;
    } catch (e) {
      console.warn('Error fetching Robinhood trending:', e.message);
      return [];
    }
  }

  /**
   * 4.10. Fetch ARC Network Trending (GeckoTerminal + DexScreener ARC Layer-1 / Circle EVM)
   */
  async getArcTrending() {
    const cacheKey = 'gt_arc_trending';
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.time < this.cacheExpiry) {
      return cached.data;
    }

    try {
      const results = [];
      const seen = new Set();

      // 1. GeckoTerminal Trending Pools on ARC network
      const gtPools = await this.getGeckoTerminalTrending('arc');
      for (const t of gtPools) {
        if (!seen.has(t.symbol)) {
          seen.add(t.symbol);
          results.push({
            ...t,
            sourceNetwork: 'ARC',
            sourceType: 'GeckoTerminal (ARC Network)'
          });
        }
      }

      // 2. DexScreener Search ARC pairs as supplement
      const dxUrl = `${this.dexScreenerBase}/latest/dex/search?q=arc`;
      const dxJson = await this.safeFetchJson(dxUrl);
      if (dxJson && dxJson.pairs) {
        for (const pair of dxJson.pairs) {
          if (pair.chainId !== 'arc') continue;
          const baseToken = pair.baseToken;
          if (!baseToken || !baseToken.symbol) continue;
          const symbol = baseToken.symbol.trim().toUpperCase();
          if (seen.has(symbol)) continue;
          seen.add(symbol);

          const volume24h = parseFloat(pair.volume?.h24 || '0');
          results.push({
            id: `arc_${pair.pairAddress?.substring(0, 10) || symbol.toLowerCase()}`,
            name: baseToken.name || symbol,
            symbol,
            imageUrl: pair.info?.imageUrl || pair.info?.header || 'https://assets.coingecko.com/coins/images/placeholder.png',
            priceUsd: pair.priceUsd || '0',
            fdvUsd: pair.fdv ? String(pair.fdv) : '0',
            volume24h: volume24h.toFixed(2),
            sourceNetwork: 'ARC',
            sourceType: 'DexScreener (ARC Network)',
            poolAddress: pair.pairAddress,
            poolName: `${symbol} on ARC`,
            sourceUrl: pair.url || `https://dexscreener.com/arc/${pair.pairAddress}`
          });
        }
      }

      this.cache.set(cacheKey, { data: results, time: Date.now() });
      return results;
    } catch (e) {
      console.warn('Error fetching ARC trending:', e.message);
      return [];
    }
  }

  /**
   * 4.11. Fetch Kategori Coin Baru dengan Exposure Tinggi (All-Chain Fresh & High-Exposure)
   * Mengumpulkan token yang berumur muda (< 72 jam) dengan volume, transaksi, dan exposure/boost tertinggi
   * dari SEMUA jaringan (Solana, Base, Ethereum, BSC, Robinhood, ARC, dll.)
   */
  async getFreshHighExposureTrending() {
    const cacheKey = 'fresh_high_exposure_trending';
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.time < this.cacheExpiry) {
      return cached.data;
    }

    try {
      const [boostsTop, boostsLatest, profiles] = await Promise.all([
        this.safeFetchJson(`${this.dexScreenerBase}/token-boosts/top/v1`),
        this.safeFetchJson(`${this.dexScreenerBase}/token-boosts/latest/v1`),
        this.safeFetchJson(`${this.dexScreenerBase}/token-profiles/latest/v1`)
      ]);

      const boostMap = new Map();
      (boostsTop || []).forEach(b => {
        if (b.tokenAddress) {
          boostMap.set(b.tokenAddress, { totalAmount: b.totalAmount || 0, icon: b.icon || b.header });
        }
      });
      (boostsLatest || []).forEach(b => {
        if (b.tokenAddress && !boostMap.has(b.tokenAddress)) {
          boostMap.set(b.tokenAddress, { totalAmount: b.totalAmount || 0, icon: b.icon || b.header });
        }
      });
      (profiles || []).forEach(p => {
        if (p.tokenAddress && !boostMap.has(p.tokenAddress)) {
          boostMap.set(p.tokenAddress, { totalAmount: 0, icon: p.icon || p.header });
        }
      });

      const addressList = Array.from(boostMap.keys()).slice(0, 30);
      if (addressList.length === 0) return [];

      const pairsRes = await this.safeFetchJson(`${this.dexScreenerBase}/latest/dex/tokens/${addressList.join(',')}`);
      if (!pairsRes || !pairsRes.pairs) return [];

      const now = Date.now();
      const candidates = [];
      const seen = new Set();

      for (const pair of pairsRes.pairs) {
        const baseToken = pair.baseToken;
        if (!baseToken || !baseToken.symbol) continue;
        const symbol = baseToken.symbol.trim().toUpperCase();
        if (seen.has(symbol)) continue;

        const createdAt = pair.pairCreatedAt || 0;
        const ageMs = createdAt > 0 ? (now - createdAt) : 0;
        const ageHours = ageMs / (1000 * 3600);

        const volume24h = parseFloat(pair.volume?.h24 || '0');
        const totalTxns = (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0);
        const boostInfo = boostMap.get(baseToken.address) || {};
        const boostAmount = boostInfo.totalAmount || 0;

        // Kriteria: Umur baru (<= 72 jam jika createdAt ada, atau rilis baru di profile)
        // dan exposure tinggi (volume >= $5000, transaksi >= 50, atau boost >= 10)
        const isNew = createdAt > 0 ? ageHours <= 72 : true;
        const hasHighExposure = volume24h >= 5000 || totalTxns >= 50 || boostAmount >= 10;

        if (isNew && hasHighExposure) {
          seen.add(symbol);

          let ageStr = '';
          if (createdAt > 0) {
            if (ageHours < 1) {
              ageStr = `${Math.max(1, Math.round(ageHours * 60))} Menit`;
            } else if (ageHours < 24) {
              ageStr = `${ageHours.toFixed(1)} Jam`;
            } else {
              ageStr = `${(ageHours / 24).toFixed(1)} Hari`;
            }
          } else {
            ageStr = 'Baru Rilis (<24j)';
          }

          const chainId = (pair.chainId || 'MULTI').toUpperCase();
          const exposureScore = volume24h + (totalTxns * 50) + (boostAmount * 100);

          candidates.push({
            id: `fresh_${pair.chainId?.toLowerCase()}_${pair.pairAddress?.substring(0, 8) || symbol.toLowerCase()}`,
            name: baseToken.name || symbol,
            symbol,
            imageUrl: pair.info?.imageUrl || pair.info?.header || boostInfo.icon || 'https://assets.coingecko.com/coins/images/placeholder.png',
            priceUsd: pair.priceUsd ? String(pair.priceUsd) : '0',
            fdvUsd: pair.fdv ? String(pair.fdv) : '0',
            volume24h: volume24h.toFixed(2),
            totalTxns,
            age: ageStr,
            exposureScore,
            sourceNetwork: chainId,
            sourceType: `Koin Baru Exposure Tinggi (${chainId})`,
            poolAddress: pair.pairAddress || baseToken.address,
            poolName: `${symbol} [Umur: ${ageStr} | ${totalTxns.toLocaleString()} Txns]`,
            sourceUrl: pair.url || `https://dexscreener.com/${pair.chainId}/${pair.pairAddress}`
          });
        }
      }

      // Urutkan berdasarkan exposureScore tertinggi
      candidates.sort((a, b) => b.exposureScore - a.exposureScore);

      this.cache.set(cacheKey, { data: candidates, time: Date.now() });
      return candidates;
    } catch (e) {
      console.warn('Error fetching fresh high exposure trending:', e.message);
      return [];
    }
  }

  /**
   * 5. Get Combined All-in-One Multi-Chain & Multi-Platform Trending
   * Aggregates OKX Hot Tokens, Clanker.world, Fresh High-Exposure, Robinhood, ARC, DexScreener All-Chain, Base, Solana, CoinGecko, Pump.fun, FOMO Boosts, DexScreener New Pairs, Ethereum, BSC, and Multi-DEX
   */
  async getAllTrendingTokens() {
    const [
      okxHot,
      clankerWorld,
      freshHighExposure,
      robinhood,
      arc,
      dxAllChain,
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
      this.getOkxHotTokens(),
      this.getClankerWorldTrending(),
      this.getFreshHighExposureTrending(),
      this.getRobinhoodTrending(),
      this.getArcTrending(),
      this.getDexScreenerAllChainTrending(),
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
      okxHot.length,
      clankerWorld.length,
      freshHighExposure.length,
      robinhood.length,
      arc.length,
      dxAllChain.length,
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
        okxHot[i],             // OKX Web3 Hot Tokens & Social Hype
        clankerWorld[i],       // Official Clanker.world trending now
        freshHighExposure[i],  // Koin baru umur muda dengan exposure tinggi lintas chain
        robinhood[i],          // Robinhood L2 trending
        arc[i],                // ARC network trending
        dxAllChain[i],         // DexScreener All-Chain trending (Solana, Base, ETH, BSC)
        dxNewBase[i],          // DexScreener new pairs
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

  /**
   * Get multiple distinct candidates for multi-wallet deployments
   * Ensures all candidates have distinct symbols, names, and are not yet deployed.
   * If external sources have fewer candidates than requested count, AI creates distinct candidates.
   */
  async getDistinctNewCandidates(count = 3) {
    const all = await this.getAllTrendingTokens();
    const distinct = [];
    const seenSymbols = new Set();
    const seenNames = new Set();

    for (const token of all) {
      const sym = (token.symbol || '').trim().toUpperCase();
      const name = (token.name || '').trim().toLowerCase();
      if (!sym || seenSymbols.has(sym) || seenNames.has(name)) continue;

      if (storage.isTokenAlreadyDeployed(token.symbol, token.name)) {
        continue;
      }

      seenSymbols.add(sym);
      seenNames.add(name);
      distinct.push(token);

      if (distinct.length >= count) break;
    }

    // Fill remaining with distinct AI Alpha tokens if needed
    let aiAttempt = 0;
    while (distinct.length < count && aiAttempt < 10) {
      aiAttempt++;
      const aiCand = aiEngine.generateDistinctAlphaCandidate(seenSymbols, seenNames);
      if (aiCand) {
        seenSymbols.add(aiCand.symbol.toUpperCase());
        seenNames.add(aiCand.name.toLowerCase());
        distinct.push(aiCand);
      }
    }

    return distinct;
  }
}

export const trendingService = new TrendingService();
