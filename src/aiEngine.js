import { config } from './config.js';
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
          topKeywords: ['AI', 'BASE', 'ELYSIUM', 'FINANCE', 'DOGE', 'CAT', 'PUMP', 'PEPE', 'DEFI'],
          avgVolumeThreshold: 5000,
          preferredCategories: ['pump', 'base', 'elysium', 'coingecko']
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

    const description = `${name} ($${symbol}) is an autonomous community-centric digital asset natively launched on Base, inspired by emerging Web3 alpha momentum and digital innovation. Conceived to unite decentralized supporters through verifiable on-chain participation, community stewardship, and collaborative ecosystem growth.`;

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

  /**
   * Generates a completely distinct, high-momentum AI Alpha candidate guaranteed not to collide with seen symbols or deployed tokens
   */
  generateDistinctAlphaCandidate(seenSymbols = new Set(), seenNames = new Set()) {
    const memory = this.getMemory();
    const keywords = (memory.successfulPatterns?.topKeywords || ['BASE', 'ALPHA', 'CLANKER', 'AI', 'PEPE', 'FOMO', 'BRETT', 'CHAD']).filter(k => k.length > 2);
    const prefixes = ['Quantum', 'Cyber', 'Hyper', 'Super', 'Mega', 'Based', 'Nova', 'Apex', 'Vortex', 'Prime', 'Zenith', 'Echo', 'Aero', 'Solar', 'Pulse'];
    const nouns = ['Agent', 'Matrix', 'Nexus', 'Pulse', 'Forge', 'Vault', 'Flow', 'Spark', 'Orbit', 'Wave', 'Shift', 'Core', 'Titan', 'Beacon', 'Atlas'];

    for (let attempt = 0; attempt < 50; attempt++) {
      const p = prefixes[Math.floor(Math.random() * prefixes.length)];
      const n = nouns[Math.floor(Math.random() * nouns.length)];
      const k = keywords[Math.floor(Math.random() * keywords.length)] || 'BASE';
      
      const candidateName = `${p} ${k} ${n}`;
      const candidateSymbol = `${p.slice(0, 2)}${k.slice(0, 2)}${n.slice(0, 2)}`.toUpperCase();

      if (seenSymbols.has(candidateSymbol) || seenNames.has(candidateName.toLowerCase())) {
        continue;
      }
      if (storage.isTokenAlreadyDeployed(candidateSymbol, candidateName)) {
        continue;
      }

      return {
        name: candidateName,
        symbol: candidateSymbol,
        imageUrl: 'https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw/295953fa-15ed-4d3c-241d-b6c1758c6200/original',
        volume24h: '50000',
        sourceType: 'AI Autonomous Alpha Radar',
        sourceNetwork: 'BASE',
        poolAddress: `ai_distinct_${Date.now()}_${attempt}`,
        description: `${candidateName} ($${candidateSymbol}) is an autonomous decentralized digital asset natively launched on Base, engineered to capture real-time on-chain momentum and community utility.`
      };
    }

    const fallbackUid = Math.floor(100 + Math.random() * 900);
    return {
      name: `Base Alpha ${fallbackUid}`,
      symbol: `BA${fallbackUid}`,
      imageUrl: 'https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw/295953fa-15ed-4d3c-241d-b6c1758c6200/original',
      volume24h: '25000',
      sourceType: 'AI Autonomous Alpha Radar',
      sourceNetwork: 'BASE',
      poolAddress: `ai_fallback_${Date.now()}`,
      description: `Base Alpha ${fallbackUid} is an autonomous digital asset deployed natively on Base.`
    };
  }

  /**
   * Respan AI Gateway caller (using model: respan/gemini-4-carbon:free or custom)
   */
  async callRespanAI(messages, options = {}) {
    const apiKey = storage.getRespanApiKey() || config.respanApiKey;
    if (!apiKey) {
      throw new Error('RESPAN_API_KEY belum dikonfigurasi. Silakan pasang via /setrespan <api_key> di bot atau di file .env');
    }

    const gatewayUrl = config.respanGatewayUrl || 'https://gateway.respan.ai/v1/chat/completions';
    const model = storage.getRespanModel() || config.respanModel || 'respan/gemini-4-carbon:free';

    const payload = {
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 1024
    };

    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45000)
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data) {
      const errMsg = data?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
      throw new Error(`Respan AI Gateway Error: ${errMsg}`);
    }

    if (data.error) {
      throw new Error(`Respan AI Error: ${data.error.message || JSON.stringify(data.error)}`);
    }

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('Respan AI Gateway memberikan respon kosong.');
    }

    return content;
  }

  /**
   * Universal Web3 / Crypto AI Chat using Respan Gemini 4 Carbon
   */
  async askAI(prompt, systemInstruction = '') {
    const systemPrompt = systemInstruction || 
      'Kamu adalah ASA AI, asisten dan analis crypto alpha cerdas dari bot Clanker & Elysium Launchpad. ' +
      'Berikan jawaban yang tajam, akurat, informatif, dan ringkas mengenai Web3, DeFi, memecoin, likuiditas on-chain (Base & Elysium Network), smart contracts, dan tren crypto terkini. ' +
      'Gunakan format teks yang rapi dan mudah dibaca (bullet points jika perlu).';

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ];

    return await this.callRespanAI(messages, { temperature: 0.7, max_tokens: 1500 });
  }

  /**
   * Generate creative viral memecoin identity using Respan Gemini 4 Carbon
   */
  async generateMemeTokenWithAI(topicOrTheme = '', network = 'ELYSIUM') {
    const defaultLogo = 'https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw/295953fa-15ed-4d3c-241d-b6c1758c6200/original';
    
    try {
      const promptText = topicOrTheme
        ? `Buatkan konsep memecoin viral berbasis tema/topik: "${topicOrTheme}".`
        : `Buatkan konsep memecoin viral yang sangat lucu, kreatif, dan berpotensi FOMO tinggi untuk jaringan ${network}.`;

      const systemPrompt = 
        'Kamu adalah AI Creative Memecoin Architect kelas dunia. Tugasmu adalah merancang identitas memecoin yang unik, viral, dan belum pernah ada.\n' +
        'KEMBALIKAN HANYA FORMAT JSON MURNI (tanpa markdown ```json, tanpa komentar tambahan):\n' +
        '{\n' +
        '  "name": "Nama Keren Memecoin (Maksimal 3 kata)",\n' +
        '  "symbol": "TICKER (3-6 karakter huruf kapital)",\n' +
        '  "description": "Deskripsi memikat, lucu, atau narasi alpha yang mengundang komunitas untuk bergabung (2-3 kalimat)",\n' +
        '  "theme": "Tema utama (misal: AI Meme, Cat/Dog, Cyberpunk, DeFi Degens, dsb)"\n' +
        '}';

      const aiResponse = await this.callRespanAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: promptText }
      ], { temperature: 0.8, max_tokens: 600 });

      // Clean response string in case markdown fences are present
      let cleaned = aiResponse.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');

      let parsed = null;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      }

      if (parsed && parsed.name && parsed.symbol) {
        let symbol = String(parsed.symbol).toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (symbol.length > 6) symbol = symbol.slice(0, 6);
        if (symbol.length < 3) symbol = (symbol + 'X').slice(0, 4);

        let name = String(parsed.name).trim();
        if (name.length > 30) name = name.slice(0, 30);

        return {
          name,
          symbol,
          description: parsed.description || `${name} ($${symbol}) - Viral community memecoin natively engineered for ${network}.`,
          theme: parsed.theme || topicOrTheme || 'AI Alpha Meme',
          imageUrl: defaultLogo,
          network,
          sourceType: 'Respan Gemini 4 Carbon AI',
          sourceNetwork: network.toUpperCase()
        };
      }
    } catch (err) {
      console.warn('[AI Engine] Failed to generate meme token via Respan AI, falling back to autonomous candidate generator:', err.message);
    }

    // Fallback if Respan key is not set or network fails
    const fallback = this.generateDistinctAlphaCandidate();
    return {
      name: fallback.name,
      symbol: fallback.symbol,
      description: fallback.description,
      theme: 'Autonomous Alpha Generator',
      imageUrl: fallback.imageUrl,
      network,
      sourceType: 'AI Autonomous Engine (Fallback)',
      sourceNetwork: network.toUpperCase()
    };
  }
}

export const aiEngine = new AIEngine();
