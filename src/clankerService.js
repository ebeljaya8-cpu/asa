import { createPublicClient, createWalletClient, http, formatEther, formatGwei, parseGwei } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { Clanker } from 'clanker-sdk/v4';
import { POOL_POSITIONS, createMerkleTree } from 'clanker-sdk';
import { config, getAirdropEntries } from './config.js';
import { storage } from './storage.js';
import { pinataService } from './pinataService.js';

export class ClankerService {
  constructor() {
    this.publicClient = createPublicClient({
      chain: base,
      transport: http(config.rpcUrl)
    });

    this.wallets = new Map();
    this.account = null;
    this.walletClient = null;
    this.clanker = null;

    this.initAllWallets();
  }

  initAllWallets() {
    this.wallets.clear();
    const walletDefs = [
      { id: 1, name: 'Wallet 1 (Utama)' },
      { id: 2, name: 'Wallet 2' },
      { id: 3, name: 'Wallet 3' }
    ];

    for (const def of walletDefs) {
      const privateKey = storage.getWalletPrivateKey(def.id);
      let account = null;
      let walletClient = null;
      let clankerInstance = null;

      if (privateKey && privateKey.startsWith('0x') && privateKey.length === 66) {
        try {
          account = privateKeyToAccount(privateKey);
          walletClient = createWalletClient({
            account,
            chain: base,
            transport: http(config.rpcUrl)
          });
          clankerInstance = new Clanker({
            wallet: walletClient,
            publicClient: this.publicClient
          });
        } catch (err) {
          console.error(`Failed to initialize ${def.name}:`, err.message);
        }
      }

      // If no valid client, provide a publicClient-only instance for dryRun/simulation
      if (!clankerInstance) {
        clankerInstance = new Clanker({
          publicClient: this.publicClient
        });
      }

      this.wallets.set(def.id, {
        id: def.id,
        name: def.name,
        account,
        walletClient,
        clanker: clankerInstance,
        hasKey: Boolean(account)
      });
    }

    // Set backward compatibility aliases pointing to Wallet 1 (Utama)
    const primary = this.wallets.get(1);
    this.account = primary?.account || null;
    this.walletClient = primary?.walletClient || null;
    this.clanker = primary?.clanker || null;
  }

  reloadWallets() {
    this.initAllWallets();
  }

  getWallet(walletIndex = 1) {
    const idx = Number(walletIndex) || 1;
    return this.wallets.get(idx) || this.wallets.get(1);
  }

  getActiveWallets() {
    const active = [];
    for (let i = 1; i <= 3; i++) {
      const w = this.wallets.get(i);
      const wConfig = storage.getWalletConfig(i);
      if (w && w.hasKey && wConfig.enabled !== false) {
        active.push(w);
      }
    }
    // If no wallets have keys configured, return Wallet 1 for simulation/dryRun
    if (active.length === 0) {
      active.push(this.wallets.get(1));
    }
    return active;
  }

  /**
   * Get realtime Base gas price and recommendations
   */
  async getGasInfo() {
    try {
      const gasPrice = await this.publicClient.getGasPrice();
      const gasPriceGwei = parseFloat(formatGwei(gasPrice));
      
      let feeEstimate = null;
      try {
        feeEstimate = await this.publicClient.estimateFeesPerGas();
      } catch (e) {}

      const mode = storage.getGasMode(); // 'ultra_low', 'low', 'standard'
      const maxThreshold = storage.getMaxGasPriceGwei();

      return {
        gasPriceGwei: gasPriceGwei.toFixed(4),
        gasPriceWei: gasPrice.toString(),
        maxPriorityFeeGwei: feeEstimate?.maxPriorityFeePerGas ? parseFloat(formatGwei(feeEstimate.maxPriorityFeePerGas)).toFixed(4) : '0.0010',
        mode,
        maxThresholdGwei: maxThreshold,
        isGasSafe: gasPriceGwei <= maxThreshold,
        recommendation: gasPriceGwei <= 0.05 ? '🟢 Super Rendah (Sangat Hemat)' : gasPriceGwei <= 0.1 ? '🟡 Normal' : '🔴 Sedang Naik'
      };
    } catch (err) {
      return {
        gasPriceGwei: '0.0020',
        gasPriceWei: '2000000',
        maxPriorityFeeGwei: '0.0010',
        mode: storage.getGasMode(),
        maxThresholdGwei: storage.getMaxGasPriceGwei(),
        isGasSafe: true,
        recommendation: '🟢 Normal'
      };
    }
  }

  /**
   * Get wallet address and balance for a specific wallet
   */
  async getWalletInfo(walletIndex = 1) {
    const idx = Number(walletIndex) || 1;
    const w = this.wallets.get(idx) || this.wallets.get(1);
    const wConfig = storage.getWalletConfig(idx);

    if (!w || !w.account) {
      return {
        id: idx,
        name: w?.name || `Wallet ${idx}`,
        hasWallet: false,
        address: 'Private Key Belum Dikonfigurasi',
        balanceEth: '0.0000',
        network: 'Base (Chain ID 8453)',
        enabled: wConfig.enabled !== false,
        settings: wConfig
      };
    }

    try {
      const balanceWei = await this.publicClient.getBalance({
        address: w.account.address
      });
      return {
        id: w.id,
        name: w.name,
        hasWallet: true,
        address: w.account.address,
        balanceEth: parseFloat(formatEther(balanceWei)).toFixed(5),
        network: 'Base (Chain ID 8453)',
        enabled: wConfig.enabled !== false,
        settings: wConfig
      };
    } catch (err) {
      return {
        id: w.id,
        name: w.name,
        hasWallet: true,
        address: w.account.address,
        balanceEth: 'Error fetching',
        network: 'Base (Chain ID 8453)',
        enabled: wConfig.enabled !== false,
        settings: wConfig
      };
    }
  }

  /**
   * Get status & balances for all 3 wallets
   */
  async getAllWalletsInfo() {
    const results = [];
    for (let i = 1; i <= 3; i++) {
      const info = await this.getWalletInfo(i);
      results.push(info);
    }
    return results;
  }

  /**
   * Generates professional, coin-focused description explaining the coin itself (narrative, utility, mission)
   * Completely free of Clanker protocol metadata or mechanical fee parameters
   */
  generateProDescription(name, symbol, baseDescription = '') {
    // If a descriptive text from external source (like DexScreener/X) exists and is substantial
    if (baseDescription && baseDescription.trim().length > 30 && !/uniswap v4|clanker protocol|anti-mev/i.test(baseDescription)) {
      const cleanDesc = baseDescription.trim().replace(/\s+/g, ' ');
      return `${cleanDesc} ${name} ($${symbol}) is an independently launched community asset on Base dedicated to transparent digital ownership and ecosystem growth.`;
    }

    const lower = `${name} ${symbol}`.toLowerCase();

    // 1. AI, Tech & Autonomous Agents
    if (/ai|agent|bot|neural|intel|gpt|compute|model|brain|synth|matrix|cyber/i.test(lower)) {
      return `${name} ($${symbol}) is an innovative decentralized digital asset on Base, designed to empower open-source artificial intelligence coordination and autonomous Web3 technology. Built for developers, enthusiasts, and community builders, ${symbol} represents the intersection of decentralized intelligence, algorithmic transparency, and next-generation digital utility across the on-chain ecosystem.`;
    }

    // 2. DeFi, Yield & Financial Utilities
    if (/fi|defi|yield|stake|vault|capital|fund|swap|liquidity|trade|finance|bank|reserve/i.test(lower)) {
      return `${name} ($${symbol}) is a decentralized financial utility asset on Base, created to foster transparent on-chain economic participation and community-driven liquidity coordination. Embodying the ethos of open finance, ${symbol} provides a transparent medium of value exchange, empowering holders with decentralized ownership and collaborative ecosystem stewardship.`;
    }

    // 3. Meme, Cultural & Community Movements
    if (/doge|cat|pepe|frog|woof|meow|inu|meme|chad|moon|ape|banana|pump|fun/i.test(lower)) {
      return `${name} ($${symbol}) is a community-driven cultural asset on Base, celebrating the vibrant energy of decentralized internet culture and digital creativity. Built from grassroots community enthusiasm, ${symbol} unites global supporters around a shared creative narrative, emphasizing decentralized community governance, social coordination, and active collective participation.`;
    }

    // 4. Gaming & Digital Entertainment
    if (/game|play|meta|quest|hero|pixel|arcade|arena|guild|craft/i.test(lower)) {
      return `${name} ($${symbol}) is an interactive digital entertainment asset on Base, bridging Web3 gaming communities with open, decentralized digital value. Engineered to support player-centric ecosystems and creative virtual economies, ${symbol} serves as the native identity token connecting gaming enthusiasts across decentralized environments.`;
    }

    // 5. Universal Flagship Professional Identity (Distinctive variations based on symbol)
    const templates = [
      `${name} ($${symbol}) is an independently deployed decentralized digital asset natively living on the Base network. Conceived to drive meaningful community engagement and peer-to-peer digital collaboration, ${symbol} serves as an open utility and identity token uniting holders in a transparent, decentralized ecosystem.`,
      `${name} ($${symbol}) is a modern decentralized asset on Base, built to explore new frontiers in community-driven digital culture and decentralized coordination. Championing fair access and transparent on-chain participation, ${symbol} empowers its community with a verifiable digital medium designed for long-term grassroots adoption.`,
      `${name} ($${symbol}) is a next-generation decentralized ecosystem token on Base, established to support community-led initiatives, decentralized networking, and digital value exchange. Engineered for transparency, sustainability, and open community participation across the evolving Web3 landscape.`
    ];

    const charCodeSum = symbol.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return templates[charCodeSum % templates.length];
  }

  /**
   * Prepare deploy payload complying with Clanker v4 Zod schema
   */
  /**
   * Prepare deploy payload complying with Clanker v4 Zod schema for a specific wallet
   */
  buildDeployPayload({ name, symbol, imageUrl, customDescription, options = {}, walletIndex = 1 }) {
    const w = this.getWallet(walletIndex);
    const wConfig = storage.getWalletConfig(w.id);
    const adminAddress = w.account?.address || '0x000000000000000000000000000000000000dEaD';
    const description = this.generateProDescription(name, symbol, customDescription);
    
    // Fee calculation: e.g. 3% = 300 bps (150 clankerFee + 150 pairedFee in hundredths of bps: 150 each)
    const feePct = options.feePercent !== undefined ? options.feePercent : (wConfig.feePercent !== undefined ? wConfig.feePercent : config.permanentFeePercent);
    const halfBps = Math.round((feePct * 100) / 2);

    // Sniper tax decay: max 120s
    const sniperDecay = options.sniperTaxDurationSec || config.sniperTaxDurationSec;

    // Creator vault: minimum 7 days lockup duration enforced by Clanker contract
    const vaultPct = options.creatorVaultPercent !== undefined ? options.creatorVaultPercent : (wConfig.vaultPercent !== undefined ? wConfig.vaultPercent : config.creatorVaultPercent);
    const lockupSeconds = Math.max((config.creatorVaultLockupDays || 7) * 86400, 7 * 86400);

    const devBuyEth = options.devBuyEth !== undefined ? options.devBuyEth : (wConfig.devBuyEth !== undefined ? wConfig.devBuyEth : config.devBuyEth);

    const payload = {
      name,
      symbol,
      image: imageUrl || 'https://assets.coingecko.com/coins/images/placeholder.png',
      tokenAdmin: adminAddress,
      metadata: {
        description,
        socialMediaUrls: [
          { platform: 'telegram', url: 'https://t.me' }
        ]
      },
      pool: {
        positions: POOL_POSITIONS[config.poolType] || POOL_POSITIONS.Project
      },
      fees: {
        type: 'static',
        clankerFee: halfBps,
        pairedFee: halfBps
      },
      sniperFees: {
        startingFee: 500000, // 50% initial anti-snipe tax
        endingFee: 30000,    // 3% normal rate
        secondsToDecay: Math.min(sniperDecay, 120) // decays in 120 seconds
      },
      vault: {
        percentage: vaultPct,
        lockupDuration: lockupSeconds,
        recipient: adminAddress
      },
      devBuy: {
        ethAmount: devBuyEth
      }
    };

    // Airdrop Merkle Tree support
    const airdropEntries = options.airdropEntries || getAirdropEntries();
    if (airdropEntries && airdropEntries.length > 0) {
      const { root } = createMerkleTree(airdropEntries);
      const totalAmount = airdropEntries.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      payload.airdrop = {
        admin: adminAddress,
        merkleRoot: root,
        lockupDuration: Math.max((config.airdropLockupDays || 1) * 86400, 86400),
        amount: totalAmount
      };
      console.log(`[Airdrop] Merkle root generated: ${root} for ${airdropEntries.length} recipients (Total: ${totalAmount})`);
    }

    return payload;
  }

  /**
   * Deploy token for a specific wallet (Wallet 1 Utama, Wallet 2, or Wallet 3)
   */
  async deployTokenForWallet({ walletIndex = 1, name, symbol, imageUrl, customDescription, originPool = '', options = {} }) {
    const w = this.getWallet(walletIndex);
    let finalImageUrl = imageUrl;
    if (imageUrl && !imageUrl.startsWith('ipfs://')) {
      try {
        finalImageUrl = await pinataService.uploadFromUrl(imageUrl, `${symbol.toLowerCase()}.png`);
      } catch (e) {
        console.warn('Pinata IPFS upload skipped, using direct URL:', e.message);
      }
    }

    const payload = this.buildDeployPayload({ name, symbol, imageUrl: finalImageUrl, customDescription, options, walletIndex: w.id });

    // Dry Run or Wallet lacks private key: Calculate predicted address and simulate
    if (config.dryRun || !w.account || !w.walletClient) {
      try {
        const txPlan = await w.clanker.getDeployTransaction(payload);
        const predictedAddress = txPlan.expectedAddress;
        const simulatedTxHash = '0x_simulated_' + Math.random().toString(16).substring(2, 10);

        const record = {
          name,
          symbol,
          imageUrl,
          tokenAddress: predictedAddress,
          txHash: simulatedTxHash,
          originPool,
          sourceNetwork: config.geckoNetwork,
          walletIndex: w.id,
          walletName: w.name,
          walletAddress: w.account ? w.account.address : 'Simulasi (Tanpa Key)'
        };
        storage.saveDeployedToken(record);

        return {
          success: true,
          simulated: true,
          walletIndex: w.id,
          walletName: w.name,
          walletAddress: w.account ? w.account.address : 'Simulasi (Tanpa Key)',
          tokenAddress: predictedAddress,
          txHash: simulatedTxHash,
          basescanUrl: `https://basescan.org/token/${predictedAddress}`,
          dexscreenerUrl: `https://dexscreener.com/base/${predictedAddress}`,
          clankerUrl: `https://www.clanker.world/clanker/${predictedAddress}`
        };
      } catch (err) {
        return {
          success: false,
          walletIndex: w.id,
          walletName: w.name,
          error: `Simulation failed: ${err.message}`
        };
      }
    }

    // Live deployment on Base
    try {
      console.log(`[${w.name}] Deploying to Clanker: "${name}" (${symbol}) using ${w.account.address}...`);
      const deployResult = await w.clanker.deploy(payload);

      if (deployResult.error) {
        throw new Error(deployResult.error.message || 'Deployment rejected by RPC/Contract');
      }

      const txHash = deployResult.txHash;
      console.log(`[${w.name}] Transaction sent! TxHash: ${txHash}. Awaiting confirmation...`);

      const receipt = await deployResult.waitForTransaction();
      const tokenAddress = receipt.address;

      const record = {
        name,
        symbol,
        imageUrl,
        tokenAddress,
        txHash,
        originPool,
        sourceNetwork: config.geckoNetwork,
        walletIndex: w.id,
        walletName: w.name,
        walletAddress: w.account.address
      };
      storage.saveDeployedToken(record);

      return {
        success: true,
        simulated: false,
        walletIndex: w.id,
        walletName: w.name,
        walletAddress: w.account.address,
        tokenAddress,
        txHash,
        basescanUrl: `https://basescan.org/token/${tokenAddress}`,
        dexscreenerUrl: `https://dexscreener.com/base/${tokenAddress}`,
        clankerUrl: `https://www.clanker.world/clanker/${tokenAddress}`
      };
    } catch (err) {
      console.error(`[${w.name}] Deployment failed for ${name}:`, err.message);
      return {
        success: false,
        walletIndex: w.id,
        walletName: w.name,
        walletAddress: w.account ? w.account.address : '',
        error: err.message
      };
    }
  }

  /**
   * Deploy token (legacy signature, defaults to Wallet 1)
   */
  async deployToken(params) {
    return this.deployTokenForWallet({
      walletIndex: params.walletIndex || 1,
      ...params
    });
  }

  /**
   * Deploy distinct tokens simultaneously across active wallets (Wallet 1, 2, 3)
   * Each wallet deploys a DIFFERENT token candidate concurrently!
   */
  async deployMultiWalletSimultaneous(distinctCandidates = []) {
    const activeWallets = this.getActiveWallets();
    console.log(`[MultiWallet Deploy] Deploying across ${activeWallets.length} active wallets simultaneously...`);

    const deployTasks = activeWallets.map(async (wallet, idx) => {
      const candidate = distinctCandidates[idx];
      if (!candidate) {
        return {
          walletIndex: wallet.id,
          walletName: wallet.name,
          walletAddress: wallet.account?.address || '',
          success: false,
          error: 'Tidak ada kandidat token berbeda yang dialokasikan untuk wallet ini'
        };
      }

      console.log(`[MultiWallet] Assigning "${candidate.name}" ($${candidate.symbol}) to ${wallet.name}`);
      const res = await this.deployTokenForWallet({
        walletIndex: wallet.id,
        name: candidate.name,
        symbol: candidate.symbol,
        imageUrl: candidate.imageUrl,
        originPool: candidate.poolAddress || '',
        customDescription: candidate.description || '',
        options: {}
      });

      return {
        walletIndex: wallet.id,
        walletName: wallet.name,
        walletAddress: wallet.account?.address || '',
        targetName: candidate.name,
        targetSymbol: candidate.symbol,
        candidate,
        ...res
      };
    });

    const results = await Promise.all(deployTasks);
    return results;
  }

  /**
   * Execute batch deployment for trending token (legacy single wallet batch)
   */
  async deployTrendingBatch(token, walletIndex = 1) {
    const results = [];
    const suffix = storage.getRepeatSuffix();
    const shouldRepeat = Boolean(suffix && suffix.toUpperCase() !== 'NONE');
    const repeatCount = shouldRepeat ? 2 : 1;

    for (let i = 0; i < repeatCount; i++) {
      const isRepeatWithSuffix = i > 0;
      const targetName = isRepeatWithSuffix ? `${token.name} ${suffix}` : token.name;
      const targetSymbol = token.symbol;

      console.log(`Starting deploy batch item ${i + 1}/${repeatCount}: "${targetName}" (${targetSymbol}) via Wallet ${walletIndex}`);

      const result = await this.deployTokenForWallet({
        walletIndex,
        name: targetName,
        symbol: targetSymbol,
        imageUrl: token.imageUrl,
        originPool: token.poolAddress,
        customDescription: token.description || ''
      });

      results.push({
        index: i + 1,
        targetName,
        targetSymbol,
        ...result
      });

      if (i < repeatCount - 1) {
        await new Promise(r => setTimeout(r, 4000));
      }
    }

    return results;
  }
}

export const clankerService = new ClankerService();
