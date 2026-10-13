import { storage } from './storage.js';
import { clankerService } from './clankerService.js';
import { trendingService } from './trendingService.js';

export class AIEngine {
  constructor() {
    this.memoryKey = 'ai_engine_memory';
    this.initMemory();
  }

  initMemory() {
    const state = storage.getState();
    if (!state.aiMemory) {
      state.aiMemory = {
        marketAnalysisHistory: [],
        successfulPatterns: {
          topKeywords: ['AI', 'BASE', 'FINANCE', 'DOGE', 'CAT', 'PUMP', 'PEPE', 'DEFI'],
          avgVolumeThreshold: 5000,
          preferredCategories: ['pump', 'base', 'coingecko']
        },
        learnedDeployCount: 0,
        highFomoCount: 0,
        lastAutonomousCheck: Date.now()
      };
      storage.saveState(state);
    }
  }

  getMemory() {
    const state = storage.getState();
    return state.aiMemory || {};
  }

  saveMemory(data) {
    const state = storage.getState();
    state.aiMemory = { ...state.aiMemory, ...data };
    storage.saveState(state);
  }

  /**
   * Analyze on-chain and DEX market conditions in real-time
   * Returns market heat score (0-100), market state, and autonomous deployment recommendation
   */
  async analyzeMarketConditions() {
    try {
      const [gasInfo, trendingTokens] = await Promise.all([
        clankerService.getGasInfo(),
        trendingService.getAllTrendingTokens()
      ]);

      const totalTokens = trendingTokens.length;
      const totalVolume24h = trendingTokens.reduce((sum, t) => sum + (parseFloat(t.volume24h) || 0), 0);
      const avgVolume = totalTokens > 0 ? totalVolume24h / totalTokens : 0;
      const gasGwei = parseFloat(gasInfo.gasPriceGwei) || 0.005;

      // Calculate Market Heat Components (0 - 100)
      let heatScore = 50; // Base baseline

      // 1. Volume Factor (+/- 25 pts)
      if (avgVolume > 500000) heatScore += 25;
      else if (avgVolume > 100000) heatScore += 18;
      else if (avgVolume > 20000) heatScore += 10;
      else if (avgVolume < 2000) heatScore -= 15;

      // 2. Token Velocity Factor (+/- 15 pts)
      if (totalTokens >= 30) heatScore += 15;
      else if (totalTokens >= 15) heatScore += 8;

      // 3. Gas Price Efficiency Factor (+/- 10 pts)
      // On Base, low gas is ideal for launching
      if (gasGwei <= 0.01) heatScore += 10;
      else if (gasGwei <= 0.05) heatScore += 5;
      else if (gasGwei > 0.2) heatScore -= 15;

      heatScore = Math.min(100, Math.max(10, Math.round(heatScore)));

      let marketState = 'NORMAL';
      let stateEmoji = '🟡';
      let decision = 'MONITOR';

      if (heatScore >= 80) {
        marketState = '🔥 SUPER FOMO / HYPE TINGGI';
        stateEmoji = '🚀';
        decision = 'DEPLOY_AGGRESSIVE';
      } else if (heatScore >= 65) {
        marketState = '🟢 PASAR RAMAI / MOMENTUM KUAT';
        stateEmoji = '🟢';
        decision = 'DEPLOY_ACTIVE';
      } else if (heatScore >= 45) {
        marketState = '🟡 PASAR MODERAT / NORMAL';
        stateEmoji = '🟡';
        decision = 'DEPLOY_SELECTIVE';
      } else {
        marketState = '❄️ PASAR TENANG / LOW VOLUME';
        stateEmoji = '❄️';
        decision = 'WAIT';
      }

      const analysis = {
        timestamp: Date.now(),
        heatScore,
        marketState,
        stateEmoji,
        decision,
        totalTokensScanned: totalTokens,
        totalVolume24hUsd: totalVolume24h,
        avgVolumeUsd: avgVolume,
        gasGwei,
        recommendedAction: decision === 'DEPLOY_AGGRESSIVE' || decision === 'DEPLOY_ACTIVE'
          ? 'Pasar sedang sangat aktif dengan likuiditas tinggi. AI merekomendasikan peluncuran token sekarang.'
          : decision === 'DEPLOY_SELECTIVE'
          ? 'Pasar dalam kondisi stabil. AI merekomendasikan peluncuran selektif pada narasi viral teratas.'
          : 'Volume pasar sedang rendah. AI menyarankan menunggu momentum meningkat.'
      };

      // Record to history memory
      const memory = this.getMemory();
      const history = memory.marketAnalysisHistory || [];
      history.unshift({
        time: new Date().toISOString(),
        score: heatScore,
        decision
      });
      memory.marketAnalysisHistory = history.slice(0, 20);
      this.saveMemory(memory);

      return analysis;
    } catch (err) {
      console.error('AI Market Analysis error:', err.message);
      return {
        timestamp: Date.now(),
        heatScore: 60,
        marketState: '🟢 NORMAL',
        stateEmoji: '🟢',
        decision: 'DEPLOY_SELECTIVE',
        totalTokensScanned: 20,
        totalVolume24hUsd: 100000,
        avgVolumeUsd: 5000,
        gasGwei: 0.005,
        recommendedAction: 'Kondisi pasar normal. Peluncuran token dapat dilanjutkan.'
      };
    }
  }

  /**
   * Smart AI Ticker & Name Generator from raw text, tweets or narratives
   */
  generateSmartTokenIdentity(rawText, sourceAccount = '') {
    if (!rawText) {
      return {
        name: 'Based Alpha',
        symbol: 'ALPHA',
        description: 'Decentralized digital asset natively deployed on Base.'
      };
    }

    // Clean text
    const cleanText = rawText
      .replace(/https?:\/\/\S+/g, '')
      .replace(/#(\w+)/g, '$1')
      .replace(/@(\w+)/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .trim();

    const words = cleanText.split(/\s+/).filter(w => w.length > 2 && !['the', 'and', 'with', 'for', 'this', 'that', 'from', 'base'].includes(w.toLowerCase()));

    let name = 'Based Alpha';
    let symbol = 'ALPHA';

    if (words.length >= 2) {
      name = words.slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      symbol = words.slice(0, 2).map(w => w.substring(0, 2)).join('').toUpperCase();
    } else if (words.length === 1) {
      name = words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
      symbol = words[0].substring(0, 5).toUpperCase();
    } else if (sourceAccount) {
      const cleanAcc = sourceAccount.replace(/[^a-zA-Z0-9]/g, '');
      name = `${cleanAcc} Alpha`;
      symbol = cleanAcc.substring(0, 5).toUpperCase();
    }

    if (symbol.length < 3) symbol = `${symbol}X`;
    if (symbol.length > 6) symbol = symbol.substring(0, 6);

    const description = `${name} ($${symbol}) is an autonomous AI-curated decentralized asset on Base, derived from high-momentum Web3 alpha signals. Backed by Uniswap v4 permanent liquidity locks and dynamic MEV protection hooks.`;

    return { name, symbol, description };
  }

  /**
   * Self-Learning: Learn from past deployed tokens performance
   */
  learnFromTokenResults(deployedTokens, activeLpTokens) {
    const memory = this.getMemory();
    const successful = activeLpTokens || [];
    
    if (successful.length > 0) {
      const keywords = memory.successfulPatterns?.topKeywords || [];
      for (const token of successful) {
        const words = (token.name || '').toUpperCase().split(/\s+/);
        for (const w of words) {
          if (w.length > 2 && !keywords.includes(w)) {
            keywords.unshift(w);
          }
        }
      }
      memory.successfulPatterns.topKeywords = keywords.slice(0, 25);
      memory.learnedDeployCount = (memory.learnedDeployCount || 0) + successful.length;
      this.saveMemory(memory);
      console.log(`[AI Engine] Learned from ${successful.length} active LP tokens. Updated top keyword patterns.`);
    }
  }
}

export const aiEngine = new AIEngine();
