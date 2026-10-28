import fs from 'fs';
import path from 'path';
import { config } from './config.js';

export class Storage {
  constructor() {
    this.dataFile = config.dataFile;
    this.stateFile = config.stateFile;
    this.init();
  }

  init() {
    const dir = path.dirname(this.dataFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.dataFile)) {
      fs.writeFileSync(this.dataFile, JSON.stringify([], null, 2));
    }

    if (!fs.existsSync(this.stateFile)) {
      const defaultState = {
        autoDeploy: config.autoDeploy,
        lastCheckedPoolId: null,
        totalDeployedCount: 0,
        settings: {
          devBuyEth: config.devBuyEth,
          permanentFeePercent: config.permanentFeePercent,
          sniperTaxDurationSec: config.sniperTaxDurationSec,
          creatorVaultPercent: config.creatorVaultPercent,
          repeatCount: config.repeatCount,
          repeatSuffix: config.repeatSuffix
        }
      };
      fs.writeFileSync(this.stateFile, JSON.stringify(defaultState, null, 2));
    }
  }

  getDeployedTokens() {
    try {
      const data = fs.readFileSync(this.dataFile, 'utf-8');
      return JSON.parse(data) || [];
    } catch {
      return [];
    }
  }

  isTokenAlreadyDeployed(symbol, name) {
    const tokens = this.getDeployedTokens();
    const cleanSym = (symbol || '').trim().toLowerCase();
    const cleanName = (name || '').trim().toLowerCase();
    
    const deployedInstances = tokens.filter(t => {
      const s = t.symbol.toLowerCase();
      const n = t.name.toLowerCase();
      return s === cleanSym || n.includes(cleanName) || cleanName.includes(n);
    });

    if (deployedInstances.length >= 2) {
      return true; // Already deployed 2 times, reject
    }

    if (deployedInstances.length === 1) {
      // Deployed once, wait at least 12 hours before deploying again
      const lastDeployTime = new Date(deployedInstances[0].deployedAt).getTime();
      const hoursSinceLastDeploy = (Date.now() - lastDeployTime) / (1000 * 60 * 60);
      if (hoursSinceLastDeploy < 12) {
        return true; // Not yet 12 hours, reject
      }
    }

    return false;
  }

  canAutoDeployToday() {
    // Sesuai aturan: setiap minimal 1 jam wajib deploy 1 token (24/7 continuous mode)
    const state = this.getState();
    const maxDaily = Number(process.env.MAX_DAILY_DEPLOYS || 100);
    return (state.autoDeployCount || 0) < maxDaily;
  }

  incrementAutoDeployCount() {
    const state = this.getState();
    const today = new Date().toISOString().split('T')[0];
    if (state.autoDeployDate !== today) {
      state.autoDeployDate = today;
      state.autoDeployCount = 0;
    }
    state.autoDeployCount = (state.autoDeployCount || 0) + 1;
    this.saveState(state);
  }

  saveDeployedToken(tokenRecord) {
    const tokens = this.getDeployedTokens();
    tokens.unshift({
      id: tokenRecord.id || Date.now().toString(),
      name: tokenRecord.name,
      symbol: tokenRecord.symbol,
      imageUrl: tokenRecord.imageUrl,
      tokenAddress: tokenRecord.tokenAddress,
      txHash: tokenRecord.txHash,
      originPool: tokenRecord.originPool,
      sourceNetwork: tokenRecord.sourceNetwork || 'base',
      walletIndex: tokenRecord.walletIndex || 1,
      walletName: tokenRecord.walletName || 'Wallet 1 (Utama)',
      walletAddress: tokenRecord.walletAddress || '',
      deployedAt: new Date().toISOString(),
      basescanUrl: `https://basescan.org/token/${tokenRecord.tokenAddress}`,
      dexscreenerUrl: `https://dexscreener.com/base/${tokenRecord.tokenAddress}`,
      clankerUrl: `https://www.clanker.world/clanker/${tokenRecord.tokenAddress}`
    });

    fs.writeFileSync(this.dataFile, JSON.stringify(tokens.slice(0, 500), null, 2));

    // Update state stats
    const state = this.getState();
    state.totalDeployedCount = (state.totalDeployedCount || 0) + 1;
    this.saveState(state);
  }

  getDeployedTokensByWallet(walletIndex) {
    const tokens = this.getDeployedTokens();
    return tokens.filter(t => (t.walletIndex || 1) === Number(walletIndex));
  }

  getState() {
    try {
      const data = fs.readFileSync(this.stateFile, 'utf-8');
      const state = JSON.parse(data) || {};
      
      // Ensure 3 wallets state structure is initialized
      if (!state.wallets) {
        state.wallets = {
          1: { id: 1, name: 'Wallet 1 (Utama)', enabled: true, devBuyEth: config.devBuyEth, feePercent: config.permanentFeePercent, vaultPercent: config.creatorVaultPercent },
          2: { id: 2, name: 'Wallet 2', enabled: true, devBuyEth: config.devBuyEth, feePercent: config.permanentFeePercent, vaultPercent: config.creatorVaultPercent },
          3: { id: 3, name: 'Wallet 3', enabled: true, devBuyEth: config.devBuyEth, feePercent: config.permanentFeePercent, vaultPercent: config.creatorVaultPercent }
        };
      }
      return state;
    } catch {
      return {
        autoDeploy: config.autoDeploy,
        wallets: {
          1: { id: 1, name: 'Wallet 1 (Utama)', enabled: true, devBuyEth: config.devBuyEth, feePercent: config.permanentFeePercent, vaultPercent: config.creatorVaultPercent },
          2: { id: 2, name: 'Wallet 2', enabled: true, devBuyEth: config.devBuyEth, feePercent: config.permanentFeePercent, vaultPercent: config.creatorVaultPercent },
          3: { id: 3, name: 'Wallet 3', enabled: true, devBuyEth: config.devBuyEth, feePercent: config.permanentFeePercent, vaultPercent: config.creatorVaultPercent }
        }
      };
    }
  }

  getWalletConfig(walletIndex = 1) {
    const idx = Number(walletIndex) || 1;
    const state = this.getState();
    if (!state.wallets) state.wallets = {};
    if (!state.wallets[idx]) {
      state.wallets[idx] = {
        id: idx,
        name: idx === 1 ? 'Wallet 1 (Utama)' : `Wallet ${idx}`,
        enabled: true,
        devBuyEth: config.devBuyEth,
        feePercent: config.permanentFeePercent,
        vaultPercent: config.creatorVaultPercent
      };
      this.saveState(state);
    }
    return state.wallets[idx];
  }

  setWalletConfig(walletIndex, updates = {}) {
    const idx = Number(walletIndex) || 1;
    const state = this.getState();
    if (!state.wallets) state.wallets = {};
    state.wallets[idx] = {
      ...this.getWalletConfig(idx),
      ...updates
    };
    this.saveState(state);
    return state.wallets[idx];
  }

  getWalletPrivateKey(walletIndex = 1) {
    const idx = Number(walletIndex) || 1;
    const state = this.getState();
    const stored = state.wallets?.[idx]?.privateKey;
    if (stored && stored.startsWith('0x') && stored.length === 66) {
      return stored;
    }
    if (idx === 1) {
      return config.privateKey || process.env.PRIVATE_KEY_1 || process.env.PRIVATE_KEY || '';
    } else if (idx === 2) {
      return config.privateKey2 || process.env.PRIVATE_KEY_2 || '';
    } else if (idx === 3) {
      return config.privateKey3 || process.env.PRIVATE_KEY_3 || '';
    }
    return '';
  }

  setWalletPrivateKey(walletIndex, privateKey) {
    const idx = Number(walletIndex) || 1;
    const cleanKey = (privateKey || '').trim();
    return this.setWalletConfig(idx, { privateKey: cleanKey });
  }

  toggleWalletAutoDeploy(walletIndex, forceState) {
    const current = this.getWalletConfig(walletIndex);
    const next = typeof forceState === 'boolean' ? forceState : !current.enabled;
    this.setWalletConfig(walletIndex, { enabled: next });
    return next;
  }

  saveState(state) {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    } catch (e) {
      console.error('Error saving state:', e);
    }
  }

  toggleAutoDeploy(forceState) {
    const state = this.getState();
    if (typeof forceState === 'boolean') {
      state.autoDeploy = forceState;
    } else {
      state.autoDeploy = !state.autoDeploy;
    }
    this.saveState(state);
    return state.autoDeploy;
  }

  getIntervalMinutes() {
    const state = this.getState();
    return state.intervalMinutes || 15; // default 15 minutes
  }

  setIntervalMinutes(minutes) {
    const validIntervals = [15, 30, 60, 120];
    const target = validIntervals.includes(Number(minutes)) ? Number(minutes) : 15;
    const state = this.getState();
    state.intervalMinutes = target;
    this.saveState(state);
    return target;
  }

  getRepeatSuffix() {
    const state = this.getState();
    return state.repeatSuffix !== undefined ? state.repeatSuffix : (config.repeatSuffix || 'BASE');
  }

  setRepeatSuffix(suffix) {
    const state = this.getState();
    const cleanSuffix = (suffix || '').trim();
    state.repeatSuffix = cleanSuffix;
    this.saveState(state);
    return cleanSuffix;
  }

  getGasMode() {
    const state = this.getState();
    return state.gasMode || 'low'; // 'low' (Hemat), 'standard' (Normal), 'ultra_low' (Super Hemat)
  }

  setGasMode(mode) {
    const validModes = ['low', 'ultra_low', 'standard'];
    const target = validModes.includes(mode) ? mode : 'low';
    const state = this.getState();
    state.gasMode = target;
    this.saveState(state);
    return target;
  }

  getMaxGasPriceGwei() {
    const state = this.getState();
    return state.maxGasPriceGwei || 0.1; // Default max 0.1 Gwei threshold for auto deploy
  }

  setMaxGasPriceGwei(gwei) {
    const target = Math.max(0.001, parseFloat(gwei) || 0.1);
    const state = this.getState();
    state.maxGasPriceGwei = target;
    this.saveState(state);
    return target;
  }
}

export const storage = new Storage();
