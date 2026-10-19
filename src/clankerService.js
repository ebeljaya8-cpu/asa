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

    this.account = null;
    this.walletClient = null;
    this.clanker = null;

    this.initWallet();
  }

  initWallet() {
    if (config.privateKey && config.privateKey.startsWith('0x') && config.privateKey.length === 66) {
      try {
        this.account = privateKeyToAccount(config.privateKey);
        this.walletClient = createWalletClient({
          account: this.account,
          chain: base,
          transport: http(config.rpcUrl)
        });
        this.clanker = new Clanker({
          wallet: this.walletClient,
          publicClient: this.publicClient
        });
      } catch (err) {
        console.error('Failed to initialize wallet client:', err.message);
      }
    } else {
      // Initialize with public client only (read/simulate mode)
      this.clanker = new Clanker({
        publicClient: this.publicClient
      });
    }
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
   * Get wallet address and balance
   */
  async getWalletInfo() {
    if (!this.account) {
      return {
        hasWallet: false,
        address: 'No Private Key Configured',
        balanceEth: '0.0000',
        network: 'Base (Chain ID 8453)'
      };
    }

    try {
      const balanceWei = await this.publicClient.getBalance({
        address: this.account.address
      });
      return {
        hasWallet: true,
        address: this.account.address,
        balanceEth: parseFloat(formatEther(balanceWei)).toFixed(5),
        network: 'Base (Chain ID 8453)'
      };
    } catch (err) {
      return {
        hasWallet: true,
        address: this.account.address,
        balanceEth: 'Error fetching',
        network: 'Base (Chain ID 8453)'
      };
    }
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
  buildDeployPayload({ name, symbol, imageUrl, customDescription, options = {} }) {
    const adminAddress = this.account?.address || '0x000000000000000000000000000000000000dEaD';
    const description = this.generateProDescription(name, symbol, customDescription);
    
    // Fee calculation: 3% = 300 bps (150 clankerFee + 150 pairedFee in hundredths of bps: 150 each)
    const feePct = options.feePercent !== undefined ? options.feePercent : config.permanentFeePercent;
    const halfBps = Math.round((feePct * 100) / 2);

    // Sniper tax decay: max 120s
    const sniperDecay = options.sniperTaxDurationSec || config.sniperTaxDurationSec;

    // Creator vault: minimum 7 days lockup duration enforced by Clanker contract
    const vaultPct = options.creatorVaultPercent !== undefined ? options.creatorVaultPercent : config.creatorVaultPercent;
    const lockupSeconds = Math.max((config.creatorVaultLockupDays || 7) * 86400, 7 * 86400);

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
        ethAmount: options.devBuyEth !== undefined ? options.devBuyEth : config.devBuyEth
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
   * Deploy token either on-chain or simulated (dry-run)
   */
  async deployToken({ name, symbol, imageUrl, customDescription, originPool = '', options = {} }) {
    let finalImageUrl = imageUrl;
    if (imageUrl && !imageUrl.startsWith('ipfs://')) {
      try {
        finalImageUrl = await pinataService.uploadFromUrl(imageUrl, `${symbol.toLowerCase()}.png`);
      } catch (e) {
        console.warn('Pinata IPFS upload skipped, using direct URL:', e.message);
      }
    }

    const payload = this.buildDeployPayload({ name, symbol, imageUrl: finalImageUrl, customDescription, options });

    // Dry Run or No Wallet: Calculate predicted address and simulate
    if (config.dryRun || !this.account || !this.walletClient) {
      try {
        const txPlan = await this.clanker.getDeployTransaction(payload);
        const predictedAddress = txPlan.expectedAddress;
        const simulatedTxHash = '0x_simulated_' + Math.random().toString(16).substring(2, 10);

        const record = {
          name,
          symbol,
          imageUrl,
          tokenAddress: predictedAddress,
          txHash: simulatedTxHash,
          originPool,
          sourceNetwork: config.geckoNetwork
        };
        storage.saveDeployedToken(record);

        return {
          success: true,
          simulated: true,
          tokenAddress: predictedAddress,
          txHash: simulatedTxHash,
          basescanUrl: `https://basescan.org/token/${predictedAddress}`,
          dexscreenerUrl: `https://dexscreener.com/base/${predictedAddress}`,
          clankerUrl: `https://www.clanker.world/clanker/${predictedAddress}`
        };
      } catch (err) {
        return {
          success: false,
          error: `Simulation failed: ${err.message}`
        };
      }
    }

    // Live deployment on Base
    try {
      console.log(`[Deploying to Clanker] ${name} (${symbol})...`);
      const deployResult = await this.clanker.deploy(payload);

      if (deployResult.error) {
        throw new Error(deployResult.error.message || 'Deployment rejected by RPC/Contract');
      }

      const txHash = deployResult.txHash;
      console.log(`Transaction sent! TxHash: ${txHash}. Awaiting confirmation...`);

      const receipt = await deployResult.waitForTransaction();
      const tokenAddress = receipt.address;

      const record = {
        name,
        symbol,
        imageUrl,
        tokenAddress,
        txHash,
        originPool,
        sourceNetwork: config.geckoNetwork
      };
      storage.saveDeployedToken(record);

      return {
        success: true,
        simulated: false,
        tokenAddress,
        txHash,
        basescanUrl: `https://basescan.org/token/${tokenAddress}`,
        dexscreenerUrl: `https://dexscreener.com/base/${tokenAddress}`,
        clankerUrl: `https://www.clanker.world/clanker/${tokenAddress}`
      };
    } catch (err) {
      console.error(`Deployment failed for ${name}:`, err);
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Execute batch deployment for trending token:
   * 1st deploy: Original name ($NAME)
   * 2nd deploy: With "BASE" suffix ($NAME BASE)
   */
  async deployTrendingBatch(token) {
    const results = [];
    const suffix = storage.getRepeatSuffix();
    const shouldRepeat = Boolean(suffix && suffix.toUpperCase() !== 'NONE');
    const repeatCount = shouldRepeat ? 2 : 1;

    for (let i = 0; i < repeatCount; i++) {
      const isRepeatWithSuffix = i > 0;
      const targetName = isRepeatWithSuffix ? `${token.name} ${suffix}` : token.name;
      const targetSymbol = token.symbol;

      console.log(`Starting deploy batch item ${i + 1}/${repeatCount}: "${targetName}" (${targetSymbol})`);

      const result = await this.deployToken({
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

      // Small delay between transactions if multiple
      if (i < repeatCount - 1) {
        await new Promise(r => setTimeout(r, 4000));
      }
    }

    return results;
  }
}

export const clankerService = new ClankerService();
