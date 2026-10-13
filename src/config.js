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
  privateKey: process.env.PRIVATE_KEY || '',
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
  permanentFeePercent: parseFloat(process.env.PERMANENT_FEE_PERCENT || '3'), // 3% total permanent fee
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
  stateFile: path.join(__dirname, '..', 'data', 'bot_state.json')
};
