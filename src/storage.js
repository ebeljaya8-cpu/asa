import fs from 'fs';
import path from 'path';
import { config } from './config.js';

export class Storage {
  constructor() {
    this.dataFile = config.dataFile;
    this.dataFileElysium = config.dataFileElysium;
    this.dataFileBaseDirect = config.dataFileBaseDirect;
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

    if (!fs.existsSync(this.dataFileElysium)) {
      fs.writeFileSync(this.dataFileElysium, JSON.stringify([], null, 2));
    }

    if (!fs.existsSync(this.dataFileBaseDirect)) {
      fs.writeFileSync(this.dataFileBaseDirect, JSON.stringify([], null, 2));
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

  getElysiumDeployedTokens() {
    try {
      if (!fs.existsSync(this.dataFileElysium)) return [];
      const data = fs.readFileSync(this.dataFileElysium, 'utf-8');
      return JSON.parse(data) || [];
    } catch {
      return [];
    }
  }

  saveElysiumDeployedToken(record) {
    const tokens = this.getElysiumDeployedTokens();
    const explorer = config.elysiumExplorer || 'https://elyscan.live';
    const entry = {
      id: record.id || Date.now().toString(),
      name: record.name,
      symbol: record.symbol,
      imageUrl: record.imageUrl || 'https://assets.coingecko.com/coins/images/placeholder.png',
      totalSupply: record.totalSupply || '100000000000',
      tokenAddress: record.tokenAddress,
      poolAddress: record.poolAddress,
      lockAddress: record.lockAddress || '',
      deployerAddress: record.deployerAddress,
      feeWallet: record.feeWallet || record.deployerAddress,
      buyFee: record.buyFee || 5,
      sellFee: record.sellFee || 5,
      dexVersion: record.dexVersion || 'Uniswap V4',
      pairToken: record.pairToken || 'HYPE',
      quoteDeposited: record.quoteDeposited || record.hypeDeposited || '0.0001',
      hypeDeposited: record.hypeDeposited || '0.0001',
      devBuyHype: record.devBuyHype || '0.0001',
      tokenDeposited: record.tokenDeposited || '20000000000',
      initialPriceHype: record.initialPriceHype || 0,
      positionTokenId: record.positionTokenId || null,
      v3FeeTier: record.v3FeeTier || 10000,
      deployTx: record.deployTx || '',
      lockTx: record.lockTx || '',
      addLiquidityTx: record.addLiquidityTx || '',
      setPairTx: record.setPairTx || '',
      enableTradingTx: record.enableTradingTx || '',
      devBuyTx: record.devBuyTx || '',
      isVerified: Boolean(record.isVerified),
      deployedAt: new Date().toISOString(),
      network: 'Elysium Mainnet',
      chainId: config.elysiumChainId || 99901,
      explorerUrl: `${explorer}/address/${record.tokenAddress}`,
      poolExplorerUrl: record.poolAddress ? `${explorer}/address/${record.poolAddress}` : '',
      dexscreenerUrl: record.poolAddress ? `https://dexscreener.com/elysium/${record.poolAddress}` : `https://dexscreener.com/elysium/${record.tokenAddress}`
    };

    tokens.unshift(entry);
    fs.writeFileSync(this.dataFileElysium, JSON.stringify(tokens.slice(0, 500), null, 2));

    // Update state stats
    const state = this.getState();
    state.totalElysiumDeployedCount = (state.totalElysiumDeployedCount || 0) + 1;
    this.saveState(state);
    return entry;
  }

  getBaseDirectDeployedTokens() {
    try {
      if (!fs.existsSync(this.dataFileBaseDirect)) return [];
      const data = fs.readFileSync(this.dataFileBaseDirect, 'utf-8');
      return JSON.parse(data) || [];
    } catch {
      return [];
    }
  }

  saveBaseDirectDeployedToken(record) {
    const tokens = this.getBaseDirectDeployedTokens();
    const explorer = config.baseExplorer || 'https://basescan.org';
    const entry = {
      id: record.id || Date.now().toString(),
      name: record.name,
      symbol: record.symbol,
      imageUrl: record.imageUrl || 'https://assets.coingecko.com/coins/images/placeholder.png',
      totalSupply: record.totalSupply || '100000000000',
      tokenAddress: record.tokenAddress,
      poolAddress: record.poolAddress,
      deployerAddress: record.deployerAddress,
      feeWallet: record.feeWallet || record.deployerAddress,
      buyFee: record.buyFee || 5,
      sellFee: record.sellFee || 5,
      dexVersion: record.dexVersion || 'Uniswap V4',
      pairToken: record.pairToken || 'ETH',
      quoteDeposited: record.quoteDeposited || record.ethDeposited || '0.0001',
      ethDeposited: record.ethDeposited || '0.0001',
      devBuyEth: record.devBuyEth || '0.0001',
      tokenDeposited: record.tokenDeposited || '20000000000',
      initialPriceEth: record.initialPriceEth || 0,
      positionTokenId: record.positionTokenId || null,
      v3FeeTier: record.v3FeeTier || 10000,
      deployTx: record.deployTx || '',
      addLiquidityTx: record.addLiquidityTx || '',
      setPairTx: record.setPairTx || '',
      enableTradingTx: record.enableTradingTx || '',
      devBuyTx: record.devBuyTx || '',
      isVerified: Boolean(record.isVerified),
      deployedAt: new Date().toISOString(),
      network: 'Base Mainnet',
      chainId: 8453,
      explorerUrl: `${explorer}/token/${record.tokenAddress}`,
      poolExplorerUrl: record.poolAddress ? `${explorer}/address/${record.poolAddress}` : '',
      dexscreenerUrl: record.poolAddress ? `https://dexscreener.com/base/${record.poolAddress}` : `https://dexscreener.com/base/${record.tokenAddress}`,
      geckoterminalUrl: record.poolAddress ? `https://www.geckoterminal.com/base/pools/${record.poolAddress}` : `https://www.geckoterminal.com/base/pools/${record.tokenAddress}`
    };

    tokens.unshift(entry);
    fs.writeFileSync(this.dataFileBaseDirect, JSON.stringify(tokens.slice(0, 500), null, 2));

    // Update state stats
    const state = this.getState();
    state.totalBaseDirectDeployedCount = (state.totalBaseDirectDeployedCount || 0) + 1;
    this.saveState(state);
    return entry;
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

  setAllWalletsAutoDeploy(enabled = true) {
    for (let i = 1; i <= 3; i++) {
      this.setWalletConfig(i, { enabled });
    }
    return true;
  }

  setOnlyPrimaryWalletAutoDeploy() {
    this.setWalletConfig(1, { enabled: true });
    this.setWalletConfig(2, { enabled: false });
    this.setWalletConfig(3, { enabled: false });
    return true;
  }

  getAutoDeployWalletMode() {
    const w1 = this.getWalletConfig(1).enabled !== false;
    const w2 = this.getWalletConfig(2).enabled !== false;
    const w3 = this.getWalletConfig(3).enabled !== false;
    if (w1 && !w2 && !w3) return 'primary_only';
    if (w1 && w2 && w3) return 'all_wallets';
    return 'custom';
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

  getFeePercent() {
    const state = this.getState();
    return state.feePercent !== undefined ? state.feePercent : config.permanentFeePercent;
  }

  setFeePercent(pct) {
    const num = Number(pct);
    // Clanker v4 feeStaticHook contract enforces strict hard limit: max 10% (1000 bps)
    const validFees = [3, 5, 10];
    const target = validFees.includes(num) ? num : (num >= 0 && num <= 10 ? num : 10);
    const state = this.getState();
    state.feePercent = target;
    if (state.wallets) {
      for (const id of [1, 2, 3]) {
        if (state.wallets[id]) {
          state.wallets[id].feePercent = target;
        }
      }
    }
    this.saveState(state);
    return target;
  }

  getElysiumLpHype() {
    const state = this.getState();
    return state.elysiumLpHype !== undefined ? state.elysiumLpHype : (config.elysiumDefaultLpHype || 0.0001);
  }

  setElysiumLpHype(amount) {
    const num = parseFloat(amount);
    const target = !isNaN(num) && num >= 0.0001 && num <= 0.0002 ? num : 0.0001;
    const state = this.getState();
    state.elysiumLpHype = target;
    this.saveState(state);
    return target;
  }

  getElysiumDevBuyHype() {
    const state = this.getState();
    return state.elysiumDevBuyHype !== undefined ? state.elysiumDevBuyHype : (config.elysiumDevBuyHype || 0.0001);
  }

  setElysiumDevBuyHype(amount) {
    const num = parseFloat(amount);
    const target = isNaN(num) || num < 0 ? 0 : num;
    const state = this.getState();
    state.elysiumDevBuyHype = target;
    this.saveState(state);
    return target;
  }

  getElysiumDexVersion() {
    const state = this.getState();
    return state.elysiumDexVersion || config.elysiumDefaultDex || 'v4'; // 'v4' (default), 'v3', or 'v2'
  }

  setElysiumDexVersion(version) {
    const raw = String(version).toLowerCase().trim();
    const valid = ['v4', 'v3', 'v2'];
    const target = valid.includes(raw) ? raw : 'v4';
    const state = this.getState();
    state.elysiumDexVersion = target;
    this.saveState(state);
    return target;
  }

  getElysiumPairToken() {
    const state = this.getState();
    return state.elysiumPairToken || config.elysiumDefaultPair || 'HYPE'; // 'HYPE', 'ETH', 'USDC', 'WETH'
  }

  setElysiumPairToken(token) {
    const upper = (token || 'HYPE').toUpperCase().trim();
    const valid = ['HYPE', 'ETH', 'USDC', 'WETH'];
    const target = valid.includes(upper) ? upper : 'HYPE';
    const state = this.getState();
    state.elysiumPairToken = target;
    this.saveState(state);
    return target;
  }

  getElysiumV3FeeTier() {
    const state = this.getState();
    return state.elysiumV3FeeTier || 10000; // 10000 (1%) standard Elysium V3 meme fee
  }

  setElysiumV3FeeTier(fee) {
    const valid = [100, 500, 3000, 10000];
    const target = valid.includes(Number(fee)) ? Number(fee) : 10000;
    const state = this.getState();
    state.elysiumV3FeeTier = target;
    this.saveState(state);
    return target;
  }

  getBaseDirectLpEth() {
    const state = this.getState();
    return state.baseDirectLpEth !== undefined ? state.baseDirectLpEth : (config.baseDirectDefaultLpEth || 0.00001);
  }

  setBaseDirectLpEth(amount) {
    const num = parseFloat(amount);
    const target = !isNaN(num) && num >= 0.00001 && num <= 0.002 ? num : 0.00001;
    const state = this.getState();
    state.baseDirectLpEth = target;
    this.saveState(state);
    return target;
  }

  getBaseDirectDevBuyEth() {
    const state = this.getState();
    return state.baseDirectDevBuyEth !== undefined ? state.baseDirectDevBuyEth : (config.baseDirectDevBuyEth || 0.0001);
  }

  setBaseDirectDevBuyEth(amount) {
    const num = parseFloat(amount);
    const target = isNaN(num) || num < 0 ? 0 : num;
    const state = this.getState();
    state.baseDirectDevBuyEth = target;
    this.saveState(state);
    return target;
  }

  getBaseDirectDexVersion() {
    const state = this.getState();
    return state.baseDirectDexVersion || config.baseDirectDefaultDex || 'v4'; // 'v4' (default), 'v3', 'v2'
  }

  setBaseDirectDexVersion(version) {
    const raw = String(version).toLowerCase().trim();
    const valid = ['v4', 'v3', 'v2'];
    const target = valid.includes(raw) ? raw : 'v4';
    const state = this.getState();
    state.baseDirectDexVersion = target;
    this.saveState(state);
    return target;
  }

  getBaseDirectPairToken() {
    const state = this.getState();
    return state.baseDirectPairToken || config.baseDirectDefaultPair || 'ETH'; // 'ETH', 'USDC', 'WETH'
  }

  setBaseDirectPairToken(token) {
    const upper = (token || 'ETH').toUpperCase().trim();
    const valid = ['ETH', 'USDC', 'WETH'];
    const target = valid.includes(upper) ? upper : 'ETH';
    const state = this.getState();
    state.baseDirectPairToken = target;
    this.saveState(state);
    return target;
  }

  getBaseDirectV3FeeTier() {
    const state = this.getState();
    return state.baseDirectV3FeeTier || 10000; // 10000 (1%) standard Base V3 meme fee
  }

  setBaseDirectV3FeeTier(fee) {
    const valid = [100, 500, 3000, 10000];
    const target = valid.includes(Number(fee)) ? Number(fee) : 10000;
    const state = this.getState();
    state.baseDirectV3FeeTier = target;
    this.saveState(state);
    return target;
  }
}

export const storage = new Storage();
