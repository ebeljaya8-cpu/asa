import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export function getAirdropEntries() {
  if (process.env.AIRDROP_ENTRIES) {
    try {
      const parsed = process.env.AIRDROP_ENTRIES.split(',').map(item => {
        const [acc, amt] = item.split(':').map(s => s.trim());
        return { account: acc, amount: Number(amt) };
      }).filter(e => e.account && !isNaN(e.amount));
      if (parsed.length > 0) return parsed;
    } catch (e) {
      console.warn('Failed to parse AIRDROP_ENTRIES from .env:', e.message);
    }
  }

  try {
    const airdropPath = path.join(__dirname, '..', 'data', 'airdrop.json');
    if (fs.existsSync(airdropPath)) {
      const data = JSON.parse(fs.readFileSync(airdropPath, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch (e) {
    console.warn('Failed to read data/airdrop.json:', e.message);
  }

  return [];
}

export const config = {
  // Telegram Bot Settings
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '', // Allowed chat/user ID for security
  
  // Blockchain / Base Network Settings
  rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  chainId: 8453,
  privateKey: process.env.PRIVATE_KEY_1 || process.env.PRIVATE_KEY || '',
  privateKey2: process.env.PRIVATE_KEY_2 || '',
  privateKey3: process.env.PRIVATE_KEY_3 || '',
  pinataJwt: process.env.PINATA_JWT || '',
  
  // Dry run mode: if true, simulates deployments without sending real transactions
  dryRun: process.env.DRY_RUN === 'true',

  // GeckoTerminal Settings
  geckoNetwork: process.env.GECKO_NETWORK || 'base', // e.g. 'base' or 'eth'
  geckoCheckIntervalSec: parseInt(process.env.GECKO_CHECK_INTERVAL_SEC || '60', 10),
  minVolumeUsd: parseFloat(process.env.MIN_VOLUME_USD || '0'), // Filter low volume tokens if desired

  // Clanker Deployment Defaults (as requested)
  autoDeploy: process.env.AUTO_DEPLOY === 'true', // Auto deploy toggle
  devBuyEth: parseFloat(process.env.DEV_BUY_ETH || '0.0000001'), // Dev buy 0.0000001 ETH (Lowest cost mode)
  permanentFeePercent: Math.min(10, parseFloat(process.env.PERMANENT_FEE_PERCENT || '10')), // Max 10% on-chain limit in Clanker v4 (1000 bps buy & sell)
  startingSniperFeePercent: parseFloat(process.env.STARTING_SNIPER_FEE_PERCENT || '80'), // 80% starting sniper anti-bot tax
  sniperTaxDurationSec: parseInt(process.env.SNIPER_TAX_DURATION_SEC || '120', 10), // 120s sniper tax decay
  poolType: process.env.POOL_TYPE || 'Project', // 'Project' or 'Standard' (PoolPositions.Project)
  creatorVaultPercent: parseFloat(process.env.CREATOR_VAULT_PERCENT || '5'), // Creator vault 5%
  creatorVaultLockupDays: parseInt(process.env.CREATOR_VAULT_LOCKUP_DAYS || '7', 10), // Min 7 days required by Clanker v4
  
  // Repeat Deployment Suffix Logic
  repeatCount: parseInt(process.env.REPEAT_DEPLOY_COUNT || '2', 10), // 2 repetitions
  repeatSuffix: process.env.REPEAT_SUFFIX || 'BASE', // Suffix for 2nd token: "BASE"

  // Airdrop settings
  airdropLockupDays: parseInt(process.env.AIRDROP_LOCKUP_DAYS || '1', 10), // 1 day
  airdropWallets: process.env.AIRDROP_WALLETS ? process.env.AIRDROP_WALLETS.split(',').map(s => s.trim()) : [],

  // Paths
  dataFile: path.join(__dirname, '..', 'data', 'deployed_tokens.json'),
  dataFileElysium: path.join(__dirname, '..', 'data', 'elysium_deployed_tokens.json'),
  dataFileBaseDirect: path.join(__dirname, '..', 'data', 'base_direct_deployed_tokens.json'),
  dataFileRobinhood: path.join(__dirname, '..', 'data', 'robinhood_deployed_tokens.json'),
  stateFile: path.join(__dirname, '..', 'data', 'bot_state.json'),

  // Base Direct Deploy (Tanpa Clanker) Settings
  baseDirectDefaultDex: process.env.BASE_DIRECT_DEFAULT_DEX || 'v4',
  baseDirectDefaultPair: process.env.BASE_DIRECT_DEFAULT_PAIR || 'ETH',
  baseDirectDefaultLpEth: parseFloat(process.env.BASE_DIRECT_DEFAULT_LP_ETH || '0.00001'),
  baseDirectDevBuyEth: parseFloat(process.env.BASE_DIRECT_DEV_BUY_ETH || '0.000001'),
  baseDirectDefaultTargetMcap: parseFloat(process.env.BASE_DIRECT_TARGET_MCAP || '35000'),
  baseDirectDefaultTotalSupply: process.env.BASE_DIRECT_DEFAULT_TOTAL_SUPPLY || '100000000000', // 100B
  baseV4PoolManager: process.env.BASE_V4_POOL_MANAGER || '0x498581fF718922c3f8e6A244956aF099B2652b2b',
  baseV4PositionManager: process.env.BASE_V4_POSITION_MANAGER || '0x7C5f5A4bBd8fD63184577525326123B519429bDc',
  basePermit2: process.env.BASE_PERMIT2 || '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  baseUniversalRouter: process.env.BASE_UNIVERSAL_ROUTER || '0x6fF5693b99212Da76ad316178A184AB56D299b43',
  baseV3Factory: process.env.BASE_V3_FACTORY || '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  baseV3PositionManager: process.env.BASE_V3_POSITION_MANAGER || '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
  baseV3SwapRouter: process.env.BASE_V3_SWAP_ROUTER || '0x2626664c2603336E57B271c5C0b26F421741e481',
  baseV2Router: process.env.BASE_V2_ROUTER || '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
  baseV2Factory: process.env.BASE_V2_FACTORY || '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
  baseWeth: process.env.BASE_WETH || '0x4200000000000000000000000000000000000006',
  baseUsdc: process.env.BASE_USDC || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  baseExplorer: process.env.BASE_EXPLORER || 'https://basescan.org',
  baseFeeWallet: process.env.BASE_FEE_WALLET || '',

  // Elysium Network Settings
  elysiumRpcUrl: process.env.ELYSIUM_RPC_URL || 'https://rpc.elysium.kinetiq.xyz',
  elysiumChainId: parseInt(process.env.ELYSIUM_CHAIN_ID || '99901', 10),
  elysiumApiKey: process.env.CONDUIT_API_KEY || process.env.ELYSIUM_API_KEY || '',
  elysiumDefaultDex: process.env.ELYSIUM_DEFAULT_DEX || 'v4',
  elysiumDefaultPair: process.env.ELYSIUM_DEFAULT_PAIR || 'HYPE',
  elysiumV4PoolManager: process.env.ELYSIUM_V4_POOL_MANAGER || '0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1',
  elysiumV4PositionManager: process.env.ELYSIUM_V4_POSITION_MANAGER || '0x1d1C51b9d07fD27d36412A2b66CC23D19Eb3E518',
  elysiumPermit2: process.env.ELYSIUM_PERMIT2 || '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  elysiumUniversalRouter: process.env.ELYSIUM_UNIVERSAL_ROUTER || '0xA13f7611115752DEB2B13813BDDE16A5073e4b45',
  elysiumV4DexRouter: process.env.ELYSIUM_V4_DEX_ROUTER || '0x6c3C2eFa01a8240C00a683E36502F656f0c15Fd6',
  elysiumV3Factory: process.env.ELYSIUM_V3_FACTORY || '0x1707327F626496A7b5b3872e7E4d2879Df7d7a9f',
  elysiumV3PositionManager: process.env.ELYSIUM_V3_POSITION_MANAGER || '0xF025e0Fe9E331A0eF05c2ad3C4E9C64b625cda6f',
  elysiumV3SwapRouter: process.env.ELYSIUM_V3_SWAP_ROUTER || '0x003aa18c6E682dB80Cf4aa17261CcbFfd28690CE',
  elysiumV3Quoter: process.env.ELYSIUM_V3_QUOTER || '0x94a7d36e2AE728d6A2B2ee533b0a260385596D8b',
  elysiumRouter: process.env.ELYSIUM_ROUTER || process.env.UNISWAP_V2_ROUTER || '0x3320b5685c1c4a0d2a5b0ca30dcee095142bf076',
  elysiumWeth: process.env.ELYSIUM_WETH || '0xbA876237B0F021A6c6D852d6c26E107997cC5E81',
  elysiumUsdc: process.env.ELYSIUM_USDC || '0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65',
  elysiumExplorer: process.env.ELYSIUM_EXPLORER || 'https://elyscan.live',
  elysiumPrivateKey: process.env.ELYSIUM_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY_1 || process.env.PRIVATE_KEY || '',
  elysiumFeeWallet: process.env.ELYSIUM_FEE_WALLET || '',
  elysiumDefaultBuyFee: parseFloat(process.env.ELYSIUM_DEFAULT_BUY_FEE || '5'),
  elysiumDefaultSellFee: parseFloat(process.env.ELYSIUM_DEFAULT_SELL_FEE || '5'),
  elysiumDefaultLpHype: parseFloat(process.env.ELYSIUM_DEFAULT_LP_HYPE || '0.0001'),
  elysiumDevBuyHype: parseFloat(process.env.ELYSIUM_DEV_BUY_HYPE || '0.0001'),
  elysiumDefaultTargetMcap: parseFloat(process.env.ELYSIUM_TARGET_MCAP || '35000'),
  elysiumDefaultTotalSupply: process.env.ELYSIUM_DEFAULT_TOTAL_SUPPLY || '100000000000', // 100B
  elysiumMontraFactory: process.env.ELYSIUM_MONTRA_FACTORY || '0x38D3ef3A06D18fA3286Fb5dEAfe611be725fcD15',
  elysiumMontraHook: process.env.ELYSIUM_MONTRA_HOOK || '0x6b1216A40B65c83e9c9e18a562C446697B8cf8EC',
  elysiumMontraRouter: process.env.ELYSIUM_MONTRA_ROUTER || '0xc6E9a8E1a99023B67067B8A3605403b8d7B3A157',

  // Robinhood Chain Settings (Chain ID: 4663, Gas: ETH)
  robinhoodRpcUrl: process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
  robinhoodChainId: parseInt(process.env.ROBINHOOD_CHAIN_ID || '4663', 10),
  robinhoodExplorer: process.env.ROBINHOOD_EXPLORER || 'https://robinhoodchain.blockscout.com',
  robinhoodPrivateKey: process.env.ROBINHOOD_PRIVATE_KEY || process.env.ELYSIUM_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY_1 || process.env.PRIVATE_KEY || '',
  robinhoodV4PoolManager: process.env.ROBINHOOD_V4_POOL_MANAGER || '0x8366a39cc670b4001a1121b8f6a443a643e40951',
  robinhoodV4PositionManager: process.env.ROBINHOOD_V4_POSITION_MANAGER || '0x58daec3116aae6d93017baaea7749052e8a04fa7',
  robinhoodUniversalRouter: process.env.ROBINHOOD_UNIVERSAL_ROUTER || '0x204FAca1764B154221e35c0d20aBb3c525710498',
  robinhoodPermit2: process.env.ROBINHOOD_PERMIT2 || '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  robinhoodV3Factory: process.env.ROBINHOOD_V3_FACTORY || '0x1f7d7550b1b028f7571e69a784071f0205fd2efa',
  robinhoodV3PositionManager: process.env.ROBINHOOD_V3_POSITION_MANAGER || '0x73991a25c818bf1f1128deaab1492d45638de0d3',
  robinhoodWeth: process.env.ROBINHOOD_WETH || '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  robinhoodUsdg: process.env.ROBINHOOD_USDG || '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  robinhoodDefaultDex: process.env.ROBINHOOD_DEFAULT_DEX || 'v4',
  robinhoodDefaultPair: process.env.ROBINHOOD_DEFAULT_PAIR || 'ETH',
  robinhoodDefaultLpEth: parseFloat(process.env.ROBINHOOD_DEFAULT_LP_ETH || '0.00001'),
  robinhoodDevBuyEth: parseFloat(process.env.ROBINHOOD_DEV_BUY_ETH || '0.000001'),
  robinhoodDefaultTargetMcap: parseFloat(process.env.ROBINHOOD_TARGET_MCAP || '35000'),
  robinhoodDefaultTotalSupply: process.env.ROBINHOOD_DEFAULT_TOTAL_SUPPLY || '100000000000', // 100B
  robinhoodDefaultBuyFee: parseFloat(process.env.ROBINHOOD_DEFAULT_BUY_FEE || '5'),
  robinhoodDefaultSellFee: parseFloat(process.env.ROBINHOOD_DEFAULT_SELL_FEE || '5'),
  robinhoodPonsFactory: process.env.ROBINHOOD_PONS_FACTORY || '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',

  // Respan AI Gateway (Gemini 4 Carbon Free)
  respanApiKey: process.env.RESPAN_API_KEY || '',
  respanGatewayUrl: process.env.RESPAN_GATEWAY_URL || 'https://gateway.respan.ai/v1/chat/completions',
  respanModel: process.env.RESPAN_MODEL || 'respan/gemini-4-carbon:free'
};
