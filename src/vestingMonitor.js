import { storage } from './storage.js';
import { config } from './config.js';
import { aiEngine } from './aiEngine.js';

export class VestingMonitor {
  constructor(botInstance = null) {
    this.bot = botInstance;
    this.interval = null;
    this.isChecking = false;
  }

  setBot(botInstance) {
    this.bot = botInstance;
  }

  /**
   * Fetch token liquidity and trading data from DexScreener or GeckoTerminal
   * @param {string} tokenAddress - ERC20 token address on Base
   * @returns {Promise<Object|null>}
   */
  async getTokenMarketData(tokenAddress) {
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ClankerBot/1.0' }
      });
      if (!res.ok) return null;

      const data = await res.json();
      if (!data.pairs || data.pairs.length === 0) return null;

      // Filter for Base network pairs
      const basePairs = data.pairs.filter(p => p.chainId === 'base');
      if (basePairs.length === 0) return null;

      // Sort by highest liquidity
      basePairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      const mainPair = basePairs[0];

      const liquidityUsd = parseFloat(mainPair.liquidity?.usd || 0);
      const buysCount = parseInt(mainPair.txns?.h24?.buys || mainPair.txns?.h1?.buys || 0, 10);
      const volume24h = parseFloat(mainPair.volume?.h24 || 0);
      const priceUsd = mainPair.priceUsd || '0';

      return {
        pairAddress: mainPair.pairAddress,
        dexUrl: mainPair.url,
        liquidityUsd,
        buysCount,
        volume24h,
        priceUsd
      };
    } catch (err) {
      console.error(`[VestingMonitor] Error fetching market data for ${tokenAddress}:`, err.message);
      return null;
    }
  }

  /**
   * Check all deployed tokens for vesting completion (>= 1 day) and LP >= $1 with active buyers
   */
  async checkVestedTokens() {
    if (this.isChecking) return;
    this.isChecking = true;

    try {
      const tokens = storage.getDeployedTokens();
      if (!tokens || tokens.length === 0) return;

      const now = Date.now();
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;

      for (const token of tokens) {
        if (!token.tokenAddress || token.tokenAddress.startsWith('0x_simulated')) continue;

        const deployedTime = new Date(token.deployedAt || 0).getTime();
        const elapsed = now - deployedTime;
        const isVestingDone = elapsed >= ONE_DAY_MS;

        // Fetch real-time market data
        const market = await this.getTokenMarketData(token.tokenAddress);
        if (!market) continue;

        // Update token record in storage with latest stats
        token.liquidityUsd = market.liquidityUsd;
        token.buysCount = market.buysCount;
        token.priceUsd = market.priceUsd;
        // Condition 1: Volume di atas $5 (Notifikasi Volume Spike / Buyer Active)
        const hasVolumeAbove5Dollar = market.volume24h >= 5.0;
        if (hasVolumeAbove5Dollar && !token.volume5AlertNotified) {
          token.volume5AlertNotified = true;
          token.lastVolumeAlertTime = now;
          console.log(`[VestingMonitor] Triggering Volume > $5 alert for ${token.name} ($${token.symbol}) - Vol: $${market.volume24h.toFixed(2)}`);
          await this.sendVolumeAlert(token, market);
        }

        // Condition 2: Vesting 1 hari selesai AND LP >= $1 AND ada transaksi beli (buys > 0 atau volume > 0)
        const hasLiquidityAbove1Dollar = market.liquidityUsd >= 1.0;
        const hasBuyers = market.buysCount > 0 || market.volume24h > 0;

        if (isVestingDone && hasLiquidityAbove1Dollar && hasBuyers) {
          if (!token.vestingNotified) {
            token.vestingNotified = true;
            console.log(`[VestingMonitor] Triggering alert for ${token.name} ($${token.symbol}) - LP: $${market.liquidityUsd.toFixed(2)}, Buys: ${market.buysCount}`);
            
            await this.sendVestingAlert(token, market);
          }
        }
      }

      // Trigger AI Self-Learning from active token results
      const activeLpTokens = tokens.filter(t => (t.liquidityUsd || 0) >= 1.0 || (t.volume24h || 0) >= 5.0);
      aiEngine.learnFromTokenResults(tokens, activeLpTokens);

      // Save updated data
      const fs = await import('fs');
      fs.writeFileSync(config.dataFile, JSON.stringify(tokens, null, 2));
    } catch (err) {
      console.error('[VestingMonitor] Exception during scan:', err.message);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Send real-time notification alert when token trading volume exceeds $5
   */
  async sendVolumeAlert(token, market) {
    if (!this.bot || !config.telegramChatId) return;

    const alertMsg = 
`🚀 <b>PEMBERITAHUAN VOLUME TINGGI: VOLUME DI ATAS $5!</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
🪙 <b>Token:</b> <b>${token.name}</b> (<code>$${token.symbol}</code>)
📊 <b>Volume 24 Jam:</b> <b>$${Number(market.volume24h).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b> (Target &gt; $5 Tercapai! 🎯)
💰 <b>Likuiditas Pool:</b> <code>$${market.liquidityUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</code>
🛒 <b>Transaksi Beli:</b> <b>${market.buysCount} Pembeli Aktif</b>
💵 <b>Harga Terkini:</b> <code>$${parseFloat(market.priceUsd).toFixed(6)}</code>
🕒 <b>Waktu Terdeteksi:</b> <code>${new Date().toLocaleString('id-ID')}</code>
━━━━━━━━━━━━━━━━━━━━━━━━━━
🔗 <a href="${token.basescanUrl}">BaseScan</a> | <a href="${token.dexscreenerUrl}">DexScreener</a> | <a href="${token.clankerUrl}">Clanker</a>

⚡ <i>Token ini menarik minat pasar dengan volume perdagangan aktif menembus batas $5!</i>`;

    try {
      await this.bot.telegram.sendMessage(config.telegramChatId, alertMsg, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
    } catch (e) {
      console.error('[VestingMonitor] Failed to send Telegram volume alert:', e.message);
    }
  }

  /**
   * Send real-time notification alert to Telegram
   */
  async sendVestingAlert(token, market) {
    if (!this.bot || !config.telegramChatId) return;

    const alertMsg = 
`🚨 <b>PEMBERITAHUAN: TOKEN SELESAI VESTING 1 HARI &amp; AKTIF!</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
🪙 <b>Token:</b> <b>${token.name}</b> (<code>$${token.symbol}</code>)
💰 <b>Likuiditas Pool (LP):</b> <b>$${market.liquidityUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b> (Di atas $1 ✅)
🛒 <b>Aktivitas Pembeli:</b> <b>${market.buysCount} Transaksi Beli</b> terdeteksi!
💵 <b>Harga Terkini:</b> <code>$${parseFloat(market.priceUsd).toFixed(6)}</code>
📊 <b>Volume 24 Jam:</b> <code>$${Number(market.volume24h).toLocaleString()}</code>
🕒 <b>Waktu Deploy:</b> <code>${new Date(token.deployedAt).toLocaleString('id-ID')}</code>
━━━━━━━━━━━━━━━━━━━━━━━━━━
🔗 <a href="${token.basescanUrl}">BaseScan</a> | <a href="${token.dexscreenerUrl}">DexScreener</a> | <a href="${token.clankerUrl}">Clanker</a>

<i>Token ini telah melewati masa lockup 1 hari, likuiditas LP masih aman di atas $1, dan terbukti ada pembeli aktif!</i>`;

    try {
      await this.bot.telegram.sendMessage(config.telegramChatId, alertMsg, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
    } catch (e) {
      console.error('[VestingMonitor] Failed to send Telegram alert:', e.message);
    }
  }

  /**
   * Get all active tokens meeting the criteria for the /active command
   */
  async getActiveTokensList() {
    const tokens = storage.getDeployedTokens();
    const activeList = [];

    for (const token of tokens) {
      if (!token.tokenAddress || token.tokenAddress.startsWith('0x_simulated')) continue;
      const market = await this.getTokenMarketData(token.tokenAddress);
      if (market && (market.liquidityUsd >= 1.0 || market.volume24h >= 5.0)) {
        activeList.push({
          ...token,
          ...market
        });
      }
    }

    return activeList;
  }

  start(intervalMinutes = 10) {
    if (this.interval) clearInterval(this.interval);
    console.log(`[VestingMonitor] Started. Checking vesting status & LP > $1 every ${intervalMinutes} minutes...`);
    
    // Initial check after 15 seconds
    setTimeout(() => this.checkVestedTokens(), 15000);
    
    this.interval = setInterval(() => {
      this.checkVestedTokens();
    }, intervalMinutes * 60 * 1000);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
  }
}

export const vestingMonitor = new VestingMonitor();
