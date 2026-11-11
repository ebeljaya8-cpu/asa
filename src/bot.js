import { Telegraf, Markup } from 'telegraf';
import { ethers } from 'ethers';
import { config, getAirdropEntries } from './config.js';
import { storage } from './storage.js';
import { geckoService } from './geckoService.js';
import { trendingService } from './trendingService.js';
import { clankerService } from './clankerService.js';
import { vestingMonitor } from './vestingMonitor.js';
import { aiEngine } from './aiEngine.js';
import { xRadarService } from './xRadarService.js';
import { elysiumService } from './elysium/elysiumService.js';
import { baseDeployService } from './base/baseDeployService.js';
import { robinhoodService } from './robinhood/robinhoodService.js';

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function toHttpImageUrl(url) {
  if (!url) return '';
  if (url.startsWith('ipfs://')) {
    const hash = url.replace('ipfs://', '');
    return `https://gateway.pinata.cloud/ipfs/${hash}`;
  }
  return url;
}

export class TelegramBotApp {
  constructor() {
    this.token = config.telegramToken;
    this.bot = null;
    this.pollingInterval = null;
    this.isProcessingCandidate = false;
    this.trendingCache = [];
    this.latestAIToken = null;
  }

  init() {
    if (!this.token) {
      console.warn('⚠️ TELEGRAM_BOT_TOKEN is not set in .env. Bot interactive interface will not start.');
      return;
    }

    this.bot = new Telegraf(this.token);

    // Global error handler so no unhandled rejection crashes the polling
    this.bot.catch((err, ctx) => {
      console.error(`[Telegraf Error] updateType=${ctx?.updateType}:`, err.message);
    });

    this.setupHandlers();
    this.startBackgroundPoller();

    // Start 24-hour vesting & LP > $1 Realtime Monitor (every 10 minutes)
    vestingMonitor.setBot(this.bot);
    vestingMonitor.start(10);
  }

  isAuthorized(ctx) {
    if (!config.telegramChatId) return true;
    const currentChatId = ctx.chat?.id?.toString();
    const currentFromId = ctx.from?.id?.toString();
    return (
      currentChatId === config.telegramChatId.toString() ||
      currentFromId === config.telegramChatId.toString()
    );
  }

  setupHandlers() {
    const bot = this.bot;

    // Middleware for authorization
    bot.use(async (ctx, next) => {
      if (!this.isAuthorized(ctx)) {
        return ctx.reply('⛔ Akses ditolak. Hanya pemilik bot yang diizinkan.');
      }
      return next();
    });

    // /start command
    bot.command('start', async (ctx) => {
      await this.sendStartMenu(ctx);
    });

    // /help command
    bot.command('help', async (ctx) => {
      const helpMsg = 
`📖 <b>PANDUAN LENGKAP PERINTAH BOT (3 WALLET & RADAR HYPE):</b>
• <code>/start</code> - Membuka dashboard utama & ringkasan 3 wallet
• <code>/wallets</code> - Pusat pengaturan & kontrol 3 wallet terpisah
• <code>/setkey2 &lt;0x...&gt;</code> - Pasang/ganti private key Wallet 2 (aman & auto-delete)
• <code>/setkey3 &lt;0x...&gt;</code> - Pasang/ganti private key Wallet 3 (aman & auto-delete)
• <code>/setkey1 &lt;0x...&gt;</code> - Pasang/ganti private key Wallet 1 (Utama)
• <code>/deployall</code> - Deploy 3 token berbeda secara simultan di 3 wallet
• <code>/trending</code> - Radar token trending terlengkap (+ tombol deploy)
  <i>Pilihan langsung: <code>/trending okx</code>, <code>/trending elysium</code>, <code>/trending fresh</code>, <code>/trending clanker</code>, <code>/trending base</code>, <code>/trending all</code></i>
• <code>/autodeploy on</code> - Aktifkan auto-deploy simultan 3 wallet
• <code>/autodeploy off</code> - Matikan auto-deploy
• <code>/interval [15|30|60|120]</code> - Atur frekuensi auto-deploy (15m, 30m, 1j, 2j)
• <code>/active</code> - Cek token yang sudah selesai lockup & memiliki LP > $1
• <code>/deploy &lt;Nama&gt; &lt;Ticker&gt; [ImageUrl]</code> - Deploy manual via Wallet 1
• <code>/deploy1</code>, <code>/deploy2</code>, <code>/deploy3</code> - Deploy manual via wallet tertentu
• <code>/status</code> - Cek saldo ETH 3 wallet & estimasi gas Base
• <code>/fee [3|5|10]</code> - Atur fee buy & sell token (3%, 5%, 10% Max)
• <code>/basemenu</code> - Dashboard & Launchpad Base Mandiri (Tanpa Clanker, Chain ID 8453)
• <code>/basedeploy &lt;Nama&gt; &lt;Ticker&gt; [Pair] [LpEth] [Fee%] [ImageUrl]</code> - Deploy mandiri ke Base (+ Uniswap V4 Pool, Pinata IPFS Logo &amp; Anti-Sniper)
• <code>/basepair [eth|usdc|weth]</code> - Atur trading pair Base (ETH, USDC, WETH)
• <code>/basedex [v4|v3|v2]</code> - Atur DEX Engine Base (Uniswap V4 Standar / V3 / V2)
• <code>/baselp [0.00001-0.002]</code> - Atur likuiditas pool awal ETH di Base (default: 0.00001 ETH)
• <code>/basedevbuy [0.000001|off]</code> - Atur dev buy otomatis di Base (default: 0.000001 ETH)
• <code>/basehistory</code> - Riwayat token deploy mandiri di Base
• <code>/elysium</code> - Dashboard & Launchpad Elysium Mainnet (Chain 99901)
• <code>/elysfee [buy%] [sell%]</code> - Atur fee beli & jual di Elysium (% dari total transaksi USD)
• <code>/elysbuyfee [0-25]</code> - Atur fee beli (buy fee) di Elysium
• <code>/elyssellfee [0-25]</code> - Atur fee jual (sell fee) di Elysium
• <code>/deployelysium &lt;Nama&gt; &lt;Ticker&gt; [Pair] [LpHype] [Fee%] [ImageUrl]</code> - Deploy token ke Elysium (+ Uniswap V4 Pool, Pinata IPFS Logo &amp; Verified)
• <code>/elysiumpair [hype|eth|usdc|weth]</code> - Atur trading pair (HYPE, ETH, USDC, WETH)
• <code>/elysiumdex [v4|v3|v2]</code> - Atur DEX Engine (Uniswap V4 Standar / V3 / V2)
• <code>/elysiumlp [0.0001-0.0002]</code> - Atur likuiditas pool awal HYPE (0.0001 s/d 0.0002 HYPE)
• <code>/devbuyelys [0.0001|off]</code> - Atur dev buy otomatis sesaat setelah trading dibuka (0.0001 HYPE)
• <code>/robinhood</code> - Dashboard &amp; Launchpad Robinhood Chain (Chain ID 4663, Gas ETH)
• <code>/deployrobinhood &lt;Nama&gt; &lt;Ticker&gt; [Pair] [LpEth] [Fee%] [ImageUrl]</code> - Deploy token ke Robinhood (Uniswap V4/V3)
• <code>/rhpair [eth|weth|usdg]</code> - Atur trading pair Robinhood
• <code>/rhdex [v4|v3]</code> - Atur DEX Engine Robinhood
• <code>/rhlp [0.000001-0.002]</code> - Atur likuiditas pool awal ETH Robinhood
• <code>/devbuyrh [0.000001|off]</code> - Atur dev buy otomatis ETH Robinhood
• <code>/rhfee [buy%] [sell%]</code> / <code>/rhbuyfee</code> / <code>/rhsellfee</code> - Atur fee beli &amp; jual Robinhood
• <code>/rhhistory</code> - Riwayat token deploy di Robinhood Chain
• <code>/history</code> - Riwayat token yang berhasil dideploy
• <code>/settings</code> - Detail parameter tokenomics & fee
━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 <b>RESPAN AI GATEWAY (GEMINI 4 CARBON):</b>
• <code>/ai &lt;pertanyaan&gt;</code> - Tanya AI tentang alpha, DeFi, crypto, & analisa pasar
• <code>/aitoken [tema/topik]</code> - Buat ide token memecoin viral otomatis pakai Gemini AI (+ tombol deploy langsung)
• <code>/setrespan &lt;api_key&gt;</code> - Pasang API Key Respan (aman & auto-delete chat)
• <code>/setmodel &lt;model&gt;</code> - Ganti model AI (default: <code>respan/gemini-4-carbon:free</code>)
━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>Fitur Unggulan Baru:</b>
1. <b>🤖 Integrasi Respan Gemini AI:</b> Generator ide token memecoin viral otomatis & analis Web3 cerdas via Respan AI Gateway!
2. <b>🪐 Elysium Mainnet Launchpad:</b> Deploy token ERC-20 mandiri ke Elysium Mainnet (Chain 99901, gas HYPE), otomatis set up Uniswap V4 pool (Pair HYPE/ETH/USDC/WETH), upload logo ke IPFS via Pinata (seperti di Clanker), proteksi sniper 80% buy tax 30 menit, dan 100% verifikasi otomatis di Elyscan!
3. <b>Multi-Wallet Simultan:</b> Menjalankan 3 wallet secara bersamaan di Base Network, masing-masing mendeploy token berbeda tanpa duplikasi!
4. <b>Radar Hype Terlengkap:</b> Memantau OKX Web3 Hot Tokens & Social Hype, Elysium DEX, Clanker.world, DexScreener, GeckoTerminal, dan Pump.fun!
5. <b>Kontrol Terpisah Telegram:</b> Atur saldo, private key, dan auto-deploy masing-masing wallet secara mandiri lewat dashboard!`;

      await ctx.replyWithHTML(helpMsg, Markup.inlineKeyboard([
        [Markup.button.callback('👛 Kelola 3 Wallet', 'cmd_wallets_menu')],
        [Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')]
      ]));
    });

    // /wallets command (Pusat pengaturan 3 wallet)
    bot.command(['wallets', 'wallet'], async (ctx) => {
      await this.sendWalletsMenu(ctx);
    });

    // /deployall command (Deploy 3 token berbeda secara bersamaan ke 3 wallet)
    bot.command('deployall', async (ctx) => {
      await this.executeDeployAllWallets(ctx);
    });

    // /setkey1, /setkey2, /setkey3 commands (Set private key via chat with instant auto-delete)
    bot.command(['setkey1', 'setwallet1'], async (ctx) => {
      await this.handleSetKeyCommand(ctx, 1);
    });
    bot.command(['setkey2', 'setwallet2'], async (ctx) => {
      await this.handleSetKeyCommand(ctx, 2);
    });
    bot.command(['setkey3', 'setwallet3'], async (ctx) => {
      await this.handleSetKeyCommand(ctx, 3);
    });

    // /deploy1, /deploy2, /deploy3 commands (Manual deploy for a specific wallet)
    bot.command('deploy1', async (ctx) => {
      await this.handleManualDeployWallet(ctx, 1);
    });
    bot.command('deploy2', async (ctx) => {
      await this.handleManualDeployWallet(ctx, 2);
    });
    bot.command('deploy3', async (ctx) => {
      await this.handleManualDeployWallet(ctx, 3);
    });

    // /status command
    bot.command('status', async (ctx) => {
      await this.sendStatusMessage(ctx);
    });

    // /settings command
    bot.command('settings', async (ctx) => {
      await this.sendSettingsMessage(ctx);
    });

    // /history command
    bot.command('history', async (ctx) => {
      await this.sendHistoryMessage(ctx);
    });

    // /trending command (e.g. /trending, /trending pump, /trending solana, /trending cg, /trending base)
    bot.command('trending', async (ctx) => {
      const parts = ctx.message.text.split(' ');
      const arg = parts[1]?.toLowerCase();
      if (arg) {
        if (['okx', 'okxhot'].includes(arg)) {
          return this.sendTrendingList(ctx, 'okx');
        }
        if (['rh', 'robinhood'].includes(arg)) {
          return this.sendTrendingList(ctx, 'robinhood');
        }
        if (['arc'].includes(arg)) {
          return this.sendTrendingList(ctx, 'arc');
        }
        if (['elysium', 'elys'].includes(arg)) {
          return this.sendTrendingList(ctx, 'elysium');
        }
        if (['fresh', 'new', 'exposure', 'freshexp'].includes(arg)) {
          return this.sendTrendingList(ctx, 'fresh');
        }
        if (['pump', 'pumpfun', 'solana', 'meme'].includes(arg)) {
          return this.sendTrendingList(ctx, 'pump');
        }
        if (['cg', 'coingecko', 'global'].includes(arg)) {
          return this.sendTrendingList(ctx, 'coingecko');
        }
        if (['fomo', 'boost', 'boosts'].includes(arg)) {
          return this.sendTrendingList(ctx, 'fomo');
        }
        if (['dexscreener', 'newpairs', 'dxnew'].includes(arg)) {
          return this.sendTrendingList(ctx, 'dxnew');
        }
        if (['base'].includes(arg)) {
          return this.sendTrendingList(ctx, 'base');
        }
        if (['all', 'semua'].includes(arg)) {
          return this.sendTrendingList(ctx, 'all');
        }
      }
      await this.sendTrendingMenu(ctx);
    });

    // /active or /vesting command
    bot.command(['active', 'vesting'], async (ctx) => {
      await this.sendActiveTokensMessage(ctx);
    });

    // /interval command
    bot.command('interval', async (ctx) => {
      const parts = ctx.message.text.split(' ');
      const arg = parts[1];
      if (arg && [15, 30, 60, 120].includes(Number(arg))) {
        const mins = Number(arg);
        storage.setIntervalMinutes(mins);
        this.startBackgroundPoller(mins);
        const label = mins >= 60 ? `${mins / 60} Jam` : `${mins} Menit`;
        return ctx.replyWithHTML(`✅ <b>Durasi auto-deploy berhasil diubah ke: Setiap ${label}!</b>\n\nBot akan memeriksa token trending baru dari GeckoTerminal setiap ${label}.`);
      }
      await this.sendIntervalSelection(ctx);
    });

    // /suffix command (e.g. /suffix Finance, /suffix Coin, /suffix BASE, /suffix none)
    bot.command('suffix', async (ctx) => {
      const parts = ctx.message.text.split(' ');
      const newSuffix = parts.slice(1).join(' ').trim();
      if (newSuffix) {
        const saved = storage.setRepeatSuffix(newSuffix);
        const isNone = saved.toUpperCase() === 'NONE';
        const display = isNone ? 'Tanpa Suffix (1x deploy)' : `"${saved}" (2x deploy: Nama Asli & Nama + ${saved})`;
        return ctx.replyWithHTML(`✅ <b>Suffix nama berhasil diubah menjadi: ${display}!</b>\n\nSetiap token trending yang dideploy akan menerapkan suffix ini.`);
      }
      await this.sendSuffixSelection(ctx);
    });

    // /gas command
    bot.command('gas', async (ctx) => {
      await this.sendGasMenu(ctx);
    });

    // /ai, /askai, /gemini command (Respan Gemini AI Chat & Analysis)
    bot.command(['ai', 'askai', 'gemini'], async (ctx) => {
      const parts = (ctx.message?.text || '').trim().split(/\s+/).slice(1);
      if (parts.length > 0) {
        const prompt = parts.join(' ');
        await this.handleAskAI(ctx, prompt);
      } else {
        await this.sendAIMenu(ctx);
      }
    });

    // /market command (Autonomous AI Market Intelligence)
    bot.command('market', async (ctx) => {
      await this.sendAIMenu(ctx);
    });

    // /aitoken, /createtoken, /aimeme command (AI Creative Meme Token Concept)
    bot.command(['aitoken', 'createtoken', 'aimeme'], async (ctx) => {
      const parts = (ctx.message?.text || '').trim().split(/\s+/).slice(1);
      const topic = parts.join(' ');
      await this.handleAITokenCreation(ctx, topic);
    });

    // /setrespan command (Set Respan AI Gateway API Key securely)
    bot.command(['setrespan', 'setrespanapikey'], async (ctx) => {
      await this.handleSetRespanCommand(ctx);
    });

    // /setmodel command (Set Respan AI Model)
    bot.command(['setmodel', 'setaimodel'], async (ctx) => {
      await this.handleSetModelCommand(ctx);
    });

    // /x or /alpha command (X / Twitter Radar)
    bot.command(['x', 'alpha', 'twitter'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1);
      if (parts.length > 0) {
        const text = parts.join(' ');
        const candidate = xRadarService.parseCustomTweet(text);
        const activeWallets = clankerService.getActiveWallets();
        const walletCount = activeWallets.length > 0 ? activeWallets.length : 3;

        await ctx.replyWithHTML(
          `🐦 <b>KANDIDAT DARI X TWEET:</b>\n\n` +
          `• Nama: <b>${escapeHtml(candidate.name)}</b> (<code>$${escapeHtml(candidate.symbol)}</code>)\n` +
          `• Narasi: <i>${escapeHtml(text)}</i>\n\n` +
          `⏳ <i>Memulai deploy simultan ke SEMUA WALLET (${walletCount} Wallet) di Base via Clanker...</i>`
        );
        const results = await clankerService.deployManualTokenAcrossWallets(candidate);
        return this.sendManualMultiWalletDeploySummary(ctx, candidate, results);
      }
      await this.sendXRadarMenu(ctx);
    });

    // /fee [3|5|10] - Mengatur fee buy & sell token (Max on-chain 10%)
    bot.command('fee', async (ctx) => {
      const arg = (ctx.message.text || '').split(' ')[1];
      if (arg) {
        const val = parseInt(arg, 10);
        if ([3, 5, 10].includes(val) || (val >= 1 && val <= 10)) {
          const saved = storage.setFeePercent(val);
          return ctx.replyWithHTML(
            `✅ <b>Fee Buy & Sell berhasil diubah ke ${saved}%!</b>\n\n` +
            `• Buy Fee: <code>${saved}%</code>\n` +
            `• Sell Fee: <code>${saved}%</code>\n\n` +
            `<i>Berlaku untuk semua wallet (W1, W2, W3). (Batas maksimum on-chain Clanker v4 adalah 10%).</i>`,
            Markup.inlineKeyboard([
              [Markup.button.callback('💸 Menu Fee', 'cmd_fee_menu')],
              [Markup.button.callback('⬅️ Dashboard', 'cmd_start_menu')]
            ])
          );
        } else {
          return ctx.replyWithHTML(
            `⚠️ <b>Pilihan fee tidak valid: "${escapeHtml(arg)}"</b>\n` +
            `Smart contract Clanker v4 di Base membatasi fee maksimal 10% (1000 bps).\n` +
            `Pilihan yang tersedia: <code>3</code>, <code>5</code>, atau <code>10</code>%.\n` +
            `Contoh: <code>/fee 10</code>`
          );
        }
      }
      await this.sendFeeMenu(ctx);
    });

    // /autodeploy [on|off|all|primary]
    bot.command('autodeploy', async (ctx) => {
      const text = ctx.message.text.split(' ')[1]?.toLowerCase();
      if (text === 'all') {
        storage.toggleAutoDeploy(true);
        storage.setAllWalletsAutoDeploy(true);
        return ctx.replyWithHTML(
          '⚡ <b>Auto-Deploy: 🟢 AKTIF (SEMUA 3 WALLET)</b>\nKetiga wallet akan mendeploy token berbeda secara simultan.',
          Markup.inlineKeyboard([[Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')]])
        );
      } else if (text === 'primary' || text === '1') {
        storage.toggleAutoDeploy(true);
        storage.setOnlyPrimaryWalletAutoDeploy();
        return ctx.replyWithHTML(
          '⚡ <b>Auto-Deploy: 🟢 AKTIF (HANYA WALLET UTAMA)</b>\nHanya Wallet 1 yang akan mendeploy token secara berkala. Wallet 2 & 3 dimatikan.',
          Markup.inlineKeyboard([[Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')]])
        );
      }

      let newState;
      if (text === 'on') {
        newState = storage.toggleAutoDeploy(true);
      } else if (text === 'off') {
        newState = storage.toggleAutoDeploy(false);
      } else {
        newState = storage.toggleAutoDeploy();
      }

      const statusText = newState ? '🟢 AKTIF (ON)' : '🔴 NONAKTIF (OFF)';
      await ctx.replyWithHTML(
        `⚡ <b>Status Auto-Deploy Global:</b> ${statusText}\n\n${newState ? 'Bot otomatis memantau Radar Hype & Tokenomics dan mendeploy token trending baru!' : 'Auto-deploy dinonaktifkan. Anda tetap dapat mendeploy manual lewat tombol /trending.'}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')]
        ])
      );
    });

    // /walletmode [all|primary]
    bot.command('walletmode', async (ctx) => {
      const mode = ctx.message.text.split(' ')[1]?.toLowerCase();
      if (mode === 'all') {
        storage.setAllWalletsAutoDeploy(true);
        await ctx.replyWithHTML('👥 <b>Mode Auto-Deploy: SEMUA 3 WALLET DIAKTIFKAN.</b>');
      } else if (mode === 'primary' || mode === '1') {
        storage.setOnlyPrimaryWalletAutoDeploy();
        await ctx.replyWithHTML('👤 <b>Mode Auto-Deploy: HANYA WALLET UTAMA DIAKTIFKAN.</b>');
      } else {
        const cur = storage.getAutoDeployWalletMode();
        const curLabel = cur === 'primary_only' ? 'Hanya Wallet Utama' : (cur === 'all_wallets' ? 'Semua 3 Wallet' : 'Kustom');
        await ctx.replyWithHTML(
          `👛 <b>Mode Target Auto-Deploy Saat Ini:</b> ${curLabel}\n\nPilih mode di bawah:\n• <code>/walletmode all</code> - Aktifkan semua 3 wallet\n• <code>/walletmode primary</code> - Hanya wallet utama`,
          Markup.inlineKeyboard([
            [
              Markup.button.callback('👥 Semua 3 Wallet', 'cmd_wallet_mode_all'),
              Markup.button.callback('👤 Hanya Wallet Utama', 'cmd_wallet_mode_primary')
            ],
            [Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')]
          ])
        );
      }
    });

    // /deploy <name> <symbol> <imageUrl> -> Deploys across ALL wallets simultaneously
    bot.command('deploy', async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1);
      if (parts.length < 2) {
        return ctx.replyWithHTML(
          '⚠️ <b>Format salah!</b>\n' +
          'Gunakan: <code>/deploy &lt;NamaToken&gt; &lt;Ticker&gt; [URL_Gambar]</code>\n' +
          'Contoh: <code>/deploy SuperDog SDOG https://example.com/logo.png</code>\n\n' +
          '💡 <i>Perintah ini otomatis mendeploy token ke SEMUA WALLET sekaligus. Jika hanya ingin mendeploy via wallet tertentu, gunakan:</i>\n' +
          '• <code>/deploy1</code> (Wallet 1 Utama)\n' +
          '• <code>/deploy2</code> (Wallet 2)\n' +
          '• <code>/deploy3</code> (Wallet 3)'
        );
      }

      const name = parts[0];
      const symbol = parts[1].toUpperCase();
      const imageUrl = parts[2] || '';
      const targetToken = {
        name,
        symbol,
        imageUrl,
        poolAddress: 'manual_deploy'
      };

      const activeWallets = clankerService.getActiveWallets();
      const walletCount = activeWallets.length > 0 ? activeWallets.length : 3;

      await ctx.replyWithHTML(
        `🚀 <b>Memulai Deploy Manual ke SEMUA WALLET (${walletCount} Wallet Sekaligus)!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `• Token: <b>${escapeHtml(name)}</b> (<code>$${escapeHtml(symbol)}</code>)\n` +
        `• Target: <b>Semua Wallet Aktif (W1, W2, W3)</b>\n\n` +
        `⏳ <i>Harap tunggu proses transaksi on-chain di Base network...</i>`
      );
      
      const batchResults = await clankerService.deployManualTokenAcrossWallets(targetToken);
      await this.sendManualMultiWalletDeploySummary(ctx, targetToken, batchResults);
    });

    // /elysium and /elys command
    bot.command(['elysium', 'elys'], async (ctx) => {
      await this.sendElysiumMenu(ctx);
    });

    // /deployelysium, /deployelys, /elysiumdeploy command
    bot.command(['deployelysium', 'deployelys', 'elysiumdeploy'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length === 0) {
        return this.sendElysiumDeployMenu(ctx);
      }

      if (parts.length < 2) {
        return ctx.replyWithHTML(
          '⚠️ <b>Format salah!</b>\n\n' +
          'Gunakan: <code>/deployelysium &lt;NamaToken&gt; &lt;Ticker&gt; [Pair] [LP] [Fee%] [ImageUrl]</code>\n' +
          '<i>Contoh:</i>\n' +
          '• <code>/deployelysium PepeElysium PEPE</code> (Gunakan default LP & Pair)\n' +
          '• <code>/deployelysium CyberDog CDOG USDC 0.0001 5 https://assets.coingecko.com/coins/images/placeholder.png</code>\n' +
          '• <code>/deployelysium RoboAI ROBO HYPE 0.0001 5</code>\n\n' +
          '<i>Logo akan otomatis diunggah ke IPFS via Pinata seperti di Clanker!</i>\n\n' +
          'Atau ketik <code>/deployelysium</code> saja untuk membuka panduan & menu preset interaktif.'
        );
      }

      const name = parts[0];
      const symbol = parts[1].toUpperCase();

      let hypeLp = String(storage.getElysiumLpHype());
      let pairChoice = storage.getElysiumPairToken();
      let buyFee = storage.getElysiumBuyFee();
      let sellFee = storage.getElysiumSellFee();
      let feeCount = 0;
      let imageUrl = '';

      const validPairs = ['HYPE', 'ETH', 'USDC', 'WETH'];

      for (let i = 2; i < parts.length; i++) {
        const item = parts[i];
        if (item.startsWith('http://') || item.startsWith('https://') || item.startsWith('ipfs://')) {
          imageUrl = item;
        } else if (validPairs.includes(item.toUpperCase())) {
          pairChoice = item.toUpperCase();
        } else if (!isNaN(parseFloat(item)) && parseFloat(item) >= 0.0001 && parseFloat(item) <= 0.0002) {
          hypeLp = item;
        } else if (!isNaN(parseFloat(item)) && parseFloat(item) >= 0 && parseFloat(item) <= 25) {
          if (feeCount === 0) {
            buyFee = Number(item);
            sellFee = Number(item);
            feeCount++;
          } else if (feeCount === 1) {
            sellFee = Number(item);
            feeCount++;
          }
        }
      }

      await this.executeDeployElysium(ctx, {
        name,
        symbol,
        imageUrl,
        pair: pairChoice,
        hypeLiquidity: hypeLp,
        buyFee,
        sellFee
      });
    });

    // /elysiumpair command (set trading pair: HYPE, ETH, USDC, WETH)
    bot.command(['elysiumpair', 'pair', 'setpair'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length === 0) {
        return this.sendElysiumPairMenu(ctx);
      }
      const choice = parts[0].toUpperCase();
      const valid = ['HYPE', 'ETH', 'USDC', 'WETH'];
      if (!valid.includes(choice)) {
        return ctx.replyWithHTML(
          '⚠️ <b>Pilihan pair tidak valid!</b>\n\n' +
          'Pilihan yang didukung:\n' +
          '• <code>/elysiumpair HYPE</code> (Native Gas HYPE - Default)\n' +
          '• <code>/elysiumpair ETH</code> (Elysium Native ETH)\n' +
          '• <code>/elysiumpair USDC</code> (USD Coin 0xb47c...)\n' +
          '• <code>/elysiumpair WETH</code> (Wrapped Elysium 0xbA87...)\n\n' +
          'Atau ketik <code>/elysiumpair</code> tanpa argumen untuk menu interaktif.'
        );
      }
      storage.setElysiumPairToken(choice);
      await ctx.replyWithHTML(
        `✅ <b>Trading Pair Elysium berhasil diatur ke: ${choice}!</b>\n\n` +
        `Deployment token berikutnya di Elysium (Uniswap V3) akan membuat pool likuiditas berpasangan <b>TOKEN / ${choice}</b>.`
      );
    });

    // /elysiumdex command (set DEX version: v4, v3, or v2)
    bot.command(['elysiumdex', 'dex'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length === 0) {
        return this.sendElysiumDexMenu(ctx);
      }
      const raw = parts[0].toLowerCase();
      if (!['v4', 'v3', 'v2'].includes(raw)) {
        return ctx.replyWithHTML('⚠️ Gunakan <code>/elysiumdex v4</code> (Uniswap V4 - Standar Elysium), <code>/elysiumdex v3</code>, atau <code>/elysiumdex v2</code>.');
      }
      storage.setElysiumDexVersion(raw);
      await ctx.replyWithHTML(`✅ <b>DEX Engine Elysium berhasil diatur ke: Uniswap ${raw.toUpperCase()}!</b>`);
    });

    // /elysiumlp command (set LP HYPE between 0.0001 and 0.0002)
    bot.command(['elysiumlp', 'setlphype'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length === 0) {
        return this.sendElysiumLpMenu(ctx);
      }
      const val = parseFloat(parts[0]);
      if (isNaN(val) || val < 0.0001 || val > 0.0002) {
        return ctx.replyWithHTML(
          '⚠️ <b>Nilai LP HYPE harus berada di antara 0.0001 dan 0.0002 HYPE!</b>\n\n' +
          '<i>Contoh:</i> <code>/elysiumlp 0.0001</code> atau <code>/elysiumlp 0.00015</code>'
        );
      }
      storage.setElysiumLpHype(val);
      await ctx.replyWithHTML(
        `✅ <b>Likuiditas Pool (LP) Elysium berhasil diatur ke: ${val} HYPE!</b>\n\n` +
        `Setiap deployment token di Elysium akan menyetor likuiditas awal sebesar <b>${val} HYPE</b> ke Uniswap V3.`
      );
    });

    // /devbuyelys command (set Dev Buy HYPE)
    bot.command(['devbuyelys', 'elysiumdevbuy'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length === 0) {
        return this.sendElysiumLpMenu(ctx);
      }
      const raw = parts[0].toLowerCase();
      if (raw === 'off' || raw === '0') {
        storage.setElysiumDevBuyHype(0);
        return ctx.replyWithHTML('🔴 <b>Dev Buy Otomatis di Elysium dinonaktifkan (0 HYPE)!</b>');
      }
      const val = parseFloat(raw);
      if (isNaN(val) || val <= 0) {
        return ctx.replyWithHTML('⚠️ Masukkan nominal Dev Buy HYPE yang valid (misal: <code>/devbuyelys 0.0001</code>).');
      }
      storage.setElysiumDevBuyHype(val);
      await ctx.replyWithHTML(
        `✅ <b>Dev Buy Otomatis di Elysium berhasil diatur ke: ${val} HYPE!</b>\n\n` +
        `Deployer akan otomatis membeli token sebesar <b>${val} HYPE</b> via Uniswap V3 sesaat setelah trading dibuka.`
      );
    });

    // /elysfee, /elysiumfee command (set Buy Fee & Sell Fee on Elysium)
    bot.command(['elysfee', 'elysiumfee', 'setelysfee'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length === 0) {
        return this.sendElysiumFeeMenu(ctx);
      }

      if (parts.length === 1) {
        const val = parseFloat(parts[0]);
        if (isNaN(val) || val < 0 || val > 25) {
          return ctx.replyWithHTML('⚠️ Masukkan persentase fee yang valid antara 0% dan 25% (misal: <code>/elysfee 5</code>).');
        }
        storage.setElysiumFees(val, val);
        return ctx.replyWithHTML(
          `✅ <b>Fee Elysium berhasil diatur!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `• 🟢 <b>Fee Beli (Buy Fee):</b> <b>${val}%</b> dari total nilai transaksi USD\n` +
          `• 🔴 <b>Fee Jual (Sell Fee):</b> <b>${val}%</b> dari total nilai transaksi USD\n\n` +
          `💡 Setiap ada user yang buy atau sell token di DEX (Uniswap), kontrak on-chain otomatis memotong ${val}% dari total nilai transaksi dalam USD dan mengirimkannya langsung ke Fee Wallet deployer Anda.`
        );
      }

      const buyVal = parseFloat(parts[0]);
      const sellVal = parseFloat(parts[1]);
      if (isNaN(buyVal) || buyVal < 0 || buyVal > 25 || isNaN(sellVal) || sellVal < 0 || sellVal > 25) {
        return ctx.replyWithHTML('⚠️ Masukkan persentase buy dan sell fee antara 0% dan 25% (misal: <code>/elysfee 3 5</code>).');
      }

      storage.setElysiumFees(buyVal, sellVal);
      await ctx.replyWithHTML(
        `✅ <b>Fee Elysium berhasil diperbarui!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `• 🟢 <b>Fee Beli (Buy Fee):</b> <b>${buyVal}%</b> dari total nilai transaksi USD\n` +
        `• 🔴 <b>Fee Jual (Sell Fee):</b> <b>${sellVal}%</b> dari total nilai transaksi USD\n\n` +
        `💡 Setiap order buy dikenakan potongan ${buyVal}% USD, dan order sell dikenakan potongan ${sellVal}% USD langsung ke Fee Wallet deployer.`
      );
    });

    // /elysbuyfee command (set Buy Fee only on Elysium)
    bot.command(['elysbuyfee', 'elysiumbuyfee'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length === 0) {
        return this.sendElysiumFeeMenu(ctx);
      }
      const val = parseFloat(parts[0]);
      if (isNaN(val) || val < 0 || val > 25) {
        return ctx.replyWithHTML('⚠️ Masukkan persentase fee beli antara 0% dan 25% (misal: <code>/elysbuyfee 3</code>).');
      }
      storage.setElysiumBuyFee(val);
      const curSell = storage.getElysiumSellFee();
      await ctx.replyWithHTML(
        `✅ <b>Fee Beli (Buy Fee) Elysium diatur ke: ${val}%!</b>\n\n` +
        `• 🟢 Fee Beli: <b>${val}%</b> dari total transaksi USD\n` +
        `• 🔴 Fee Jual: <b>${curSell}%</b> dari total transaksi USD\n\n` +
        `<i>Fee dipotong otomatis saat pembeli menukar HYPE/Quote ke token di DEX.</i>`
      );
    });

    // /elyssellfee command (set Sell Fee only on Elysium)
    bot.command(['elyssellfee', 'elysiumsellfee'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length === 0) {
        return this.sendElysiumFeeMenu(ctx);
      }
      const val = parseFloat(parts[0]);
      if (isNaN(val) || val < 0 || val > 25) {
        return ctx.replyWithHTML('⚠️ Masukkan persentase fee jual antara 0% dan 25% (misal: <code>/elyssellfee 5</code>).');
      }
      storage.setElysiumSellFee(val);
      const curBuy = storage.getElysiumBuyFee();
      await ctx.replyWithHTML(
        `✅ <b>Fee Jual (Sell Fee) Elysium diatur ke: ${val}%!</b>\n\n` +
        `• 🟢 Fee Beli: <b>${curBuy}%</b> dari total transaksi USD\n` +
        `• 🔴 Fee Jual: <b>${val}%</b> dari total transaksi USD\n\n` +
        `<i>Fee dipotong otomatis saat penjual menukar token kembali ke HYPE/Quote di DEX.</i>`
      );
    });

    // /harvesthype, /elysharvest command (Convert fee tokens to native HYPE)
    bot.command(['harvesthype', 'elysharvest', 'claimhype'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length > 0 && ethers.isAddress(parts[0])) {
        const targetAddr = parts[0];
        const statusMsg = await ctx.replyWithHTML(`⏳ <i>Memulai harvest token <code>${targetAddr}</code> ke koin HYPE...</i>`);
        try {
          const res = await elysiumService.harvestTokenToHype({ tokenAddress: targetAddr });
          if (!res.success) {
            return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, `⚠️ <b>Harvest Gagal:</b> ${escapeHtml(res.message)}`, { parse_mode: 'HTML' });
          }
          return ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            null,
            `🌾 <b>BERHASIL HARVEST FEE KE HYPE!</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `• Token: <b>${escapeHtml(res.name)} ($${escapeHtml(res.symbol)})</b>\n` +
            `• Token Diswap: <b>${Number(res.tokensSwapped).toLocaleString('id-ID', { maximumFractionDigits: 2 })} ${res.symbol}</b>\n` +
            `• Koin HYPE Diterima: <b>+${parseFloat(res.hypeReceived).toFixed(6)} HYPE</b> (Langsung ke Dompet!)\n` +
            `• Saldo HYPE Sekarang: <b>${parseFloat(res.newHypeBalance).toFixed(6)} HYPE</b>\n` +
            `• Transaksi Elyscan: <a href="${res.explorerUrl}">Lihat Tx Elyscan</a>`,
            { parse_mode: 'HTML', disable_web_page_preview: true }
          );
        } catch (err) {
          return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, `❌ <b>Gagal harvest:</b> ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
        }
      }

      await this.sendElysiumHarvestMenu(ctx);
    });

    // /basemenu, /base, /basedirect command
    bot.command(['basemenu', 'base', 'basedirect'], async (ctx) => {
      await this.sendBaseDirectMenu(ctx);
    });

    // /basedeploy, /deploybase, /directbase command
    bot.command(['basedeploy', 'deploybase', 'directbase'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length === 0) {
        return this.sendBaseDirectDeployMenu(ctx);
      }

      if (parts.length < 2) {
        return ctx.replyWithHTML(
          '⚠️ <b>Format salah!</b>\n\n' +
          'Gunakan: <code>/basedeploy &lt;NamaToken&gt; &lt;Ticker&gt; [Pair] [LP] [Fee%] [ImageUrl]</code>\n' +
          '<i>Contoh:</i>\n' +
          '• <code>/basedeploy BasePepe PEPE</code> (Gunakan default LP & Pair)\n' +
          '• <code>/basedeploy CyberCat CCAT USDC 0.00001 5 https://assets.coingecko.com/coins/images/placeholder.png</code>\n' +
          '• <code>/basedeploy SuperAI SUPER ETH 0.00001 5</code>\n\n' +
          '<i>Logo akan otomatis diunggah ke IPFS via Pinata!</i>\n\n' +
          'Atau ketik <code>/basedeploy</code> saja untuk membuka panduan & menu preset interaktif.'
        );
      }

      const name = parts[0];
      const symbol = parts[1].toUpperCase();

      let ethLp = String(storage.getBaseDirectLpEth());
      let pairChoice = storage.getBaseDirectPairToken();
      let fee = 5;
      let imageUrl = '';

      const validPairs = ['ETH', 'USDC', 'WETH'];

      for (let i = 2; i < parts.length; i++) {
        const item = parts[i];
        if (item.startsWith('http://') || item.startsWith('https://') || item.startsWith('ipfs://')) {
          imageUrl = item;
        } else if (validPairs.includes(item.toUpperCase())) {
          pairChoice = item.toUpperCase();
        } else if (!isNaN(parseFloat(item)) && parseFloat(item) >= 0.00001 && parseFloat(item) <= 0.002) {
          ethLp = item;
        } else if (!isNaN(parseFloat(item)) && parseFloat(item) > 0 && parseFloat(item) <= 20) {
          fee = Number(item);
        }
      }

      await this.executeDeployBaseDirect(ctx, {
        name,
        symbol,
        imageUrl,
        pair: pairChoice,
        ethLiquidity: ethLp,
        buyFee: fee,
        sellFee: fee
      });
    });

    // /basepair command (set trading pair: ETH, USDC, WETH)
    bot.command(['basepair', 'setbasepair'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length === 0) {
        return this.sendBaseDirectPairMenu(ctx);
      }
      const choice = parts[0].toUpperCase();
      const valid = ['ETH', 'USDC', 'WETH'];
      if (!valid.includes(choice)) {
        return ctx.replyWithHTML(
          '⚠️ <b>Pilihan pair tidak valid!</b>\n\n' +
          'Pilihan yang didukung:\n' +
          '• <code>/basepair ETH</code> (Native Gas ETH - Default)\n' +
          '• <code>/basepair USDC</code> (USD Coin 0x8335...)\n' +
          '• <code>/basepair WETH</code> (Wrapped Ether 0x4200...)\n\n' +
          'Atau ketik <code>/basepair</code> tanpa argumen untuk menu interaktif.'
        );
      }
      storage.setBaseDirectPairToken(choice);
      await ctx.replyWithHTML(
        `✅ <b>Trading Pair Base Mandiri berhasil diatur ke: ${choice}!</b>\n\n` +
        `Deployment token berikutnya di Base akan membuat pool likuiditas berpasangan <b>TOKEN / ${choice}</b>.`
      );
    });

    // /basedex command (set DEX version: v4, v3, or v2)
    bot.command(['basedex', 'setbasedex'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length === 0) {
        return this.sendBaseDirectDexMenu(ctx);
      }
      const raw = parts[0].toLowerCase();
      if (!['v4', 'v3', 'v2'].includes(raw)) {
        return ctx.replyWithHTML('⚠️ Gunakan <code>/basedex v4</code> (Uniswap V4 - Standar Base), <code>/basedex v3</code>, atau <code>/basedex v2</code>.');
      }
      storage.setBaseDirectDexVersion(raw);
      await ctx.replyWithHTML(`✅ <b>DEX Engine Base Mandiri berhasil diatur ke: Uniswap ${raw.toUpperCase()}!</b>`);
    });

    // /baselp command (set LP ETH)
    bot.command(['baselp', 'setbaselp'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length === 0) {
        return this.sendBaseDirectLpMenu(ctx);
      }
      const val = parseFloat(parts[0]);
      if (isNaN(val) || val < 0.00001 || val > 0.002) {
        return ctx.replyWithHTML(
          '⚠️ <b>Nilai LP ETH harus berada di antara 0.00001 dan 0.002 ETH!</b>\n\n' +
          '<i>Contoh:</i> <code>/baselp 0.00001</code> atau <code>/baselp 0.0001</code>'
        );
      }
      storage.setBaseDirectLpEth(val);
      await ctx.replyWithHTML(
        `✅ <b>Likuiditas Pool (LP) Base Mandiri berhasil diatur ke: ${val} ETH!</b>\n\n` +
        `Setiap deployment token di Base akan menyetor likuiditas awal sebesar <b>${val} ETH</b>.`
      );
    });

    // /basedevbuy command (set Dev Buy ETH)
    bot.command(['basedevbuy', 'devbuybase'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length === 0) {
        return this.sendBaseDirectLpMenu(ctx);
      }
      const raw = parts[0].toLowerCase();
      if (raw === 'off' || raw === '0') {
        storage.setBaseDirectDevBuyEth(0);
        return ctx.replyWithHTML('🔴 <b>Dev Buy Otomatis di Base Mandiri dinonaktifkan (0 ETH)!</b>');
      }
      const val = parseFloat(raw);
      if (isNaN(val) || val <= 0) {
        return ctx.replyWithHTML('⚠️ Masukkan nominal Dev Buy ETH yang valid (misal: <code>/basedevbuy 0.000001</code>).');
      }
      storage.setBaseDirectDevBuyEth(val);
      await ctx.replyWithHTML(
        `✅ <b>Dev Buy Otomatis di Base Mandiri berhasil diatur ke: ${val} ETH!</b>\n\n` +
        `Deployer akan otomatis membeli token sebesar <b>${val} ETH</b> sesaat setelah trading dibuka.`
      );
    });

    // /basehistory command
    bot.command(['basehistory', 'directhistory'], async (ctx) => {
      await this.sendBaseDirectHistory(ctx);
    });

    // ===== ROBINHOOD CHAIN COMMANDS =====
    bot.command(['robinhood', 'rh', 'rhub'], async (ctx) => {
      await this.sendRobinhoodMenu(ctx);
    });

    bot.command(['deployrobinhood', 'deployrh', 'rhdeployer', 'rhdeply'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length < 2) {
        return ctx.replyWithHTML(
          '⚠️ <b>Format: /deployrobinhood [Nama] [TICKER] [Pair] [LpETH] [Fee%] [ImageUrl]</b>\n\n' +
          'Contoh:\n' +
          '<code>/deployrobinhood MoonToken MOON ETH 0.00001 5</code>\n' +
          '<code>/deployrobinhood RhToken RHT USDG 0.00005 3 https://i.imgur.com/xxx.png</code>\n\n' +
          'Atau tekan tombol <b>🏹 Robinhood Hub</b> di menu utama.'
        );
      }
      const name = parts[0];
      const symbol = parts[1];
      let pairChoice = storage.getRobinhoodPairToken();
      let ethLp = String(storage.getRobinhoodLpEth());
      let fee = storage.getRobinhoodBuyFee();
      let imageUrl = '';
      const validPairs = ['ETH', 'WETH', 'USDG'];
      for (let i = 2; i < parts.length; i++) {
        const item = parts[i];
        if (item.startsWith('http://') || item.startsWith('https://') || item.startsWith('ipfs://')) {
          imageUrl = item;
        } else if (validPairs.includes(item.toUpperCase())) {
          pairChoice = item.toUpperCase();
        } else if (!isNaN(parseFloat(item)) && parseFloat(item) >= 0.000001 && parseFloat(item) <= 0.002) {
          ethLp = item;
        } else if (!isNaN(parseFloat(item)) && parseFloat(item) >= 0 && parseFloat(item) <= 25) {
          fee = Number(item);
        }
      }
      await this.executeDeployRobinhood(ctx, {
        name, symbol, imageUrl,
        pair: pairChoice,
        ethLiquidity: ethLp,
        buyFee: fee, sellFee: fee
      });
    });

    bot.command(['rhpair', 'robinhoodpair'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length === 0) {
        return this.sendRobinhoodPairMenu(ctx);
      }
      const choice = parts[0].toUpperCase();
      const valid = ['ETH', 'WETH', 'USDG'];
      if (!valid.includes(choice)) {
        return ctx.replyWithHTML('⚠️ Pilihan pair tidak valid! Gunakan: <code>ETH</code>, <code>WETH</code>, atau <code>USDG</code>');
      }
      storage.setRobinhoodPairToken(choice);
      await ctx.replyWithHTML(`✅ <b>Trading Pair Robinhood diatur ke: ${choice}!</b>`);
    });

    bot.command(['rhdex', 'robinhooddex'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length === 0) {
        return this.sendRobinhoodDexMenu(ctx);
      }
      const ver = parts[0].toLowerCase();
      if (!['v4', 'v3'].includes(ver)) {
        return ctx.replyWithHTML('⚠️ Pilihan DEX tidak valid! Gunakan <code>v4</code> atau <code>v3</code>');
      }
      storage.setRobinhoodDexVersion(ver);
      await ctx.replyWithHTML(`✅ <b>DEX Engine Robinhood diatur ke: ${ver.toUpperCase()}!</b>`);
    });

    bot.command(['rhlp', 'robinhoodlp'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length === 0) {
        return this.sendRobinhoodLpMenu(ctx);
      }
      const val = parseFloat(parts[0]);
      if (isNaN(val) || val < 0.000001 || val > 0.002) {
        return ctx.replyWithHTML('⚠️ LP ETH harus antara <code>0.000001</code> dan <code>0.002</code>');
      }
      storage.setRobinhoodLpEth(val);
      await ctx.replyWithHTML(`✅ <b>LP ETH Robinhood diatur ke: ${val} ETH!</b>`);
    });

    bot.command(['devbuyrh', 'rhdevbuy', 'robinhooddevbuy'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length === 0) {
        return this.sendRobinhoodLpMenu(ctx);
      }
      if (parts[0].toLowerCase() === 'off' || parts[0] === '0') {
        storage.setRobinhoodDevBuyEth(0);
        return ctx.replyWithHTML('✅ <b>Dev Buy Robinhood dinonaktifkan (0 ETH).</b>');
      }
      const val = parseFloat(parts[0]);
      if (isNaN(val) || val < 0) {
        return ctx.replyWithHTML('⚠️ Masukkan jumlah ETH yang valid (misal: <code>0.000001</code>) atau <code>off</code>.');
      }
      storage.setRobinhoodDevBuyEth(val);
      await ctx.replyWithHTML(`✅ <b>Dev Buy Robinhood diatur ke: ${val} ETH!</b>`);
    });

    bot.command(['rhbuyfee', 'robinhoodbuyfee'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length === 0) {
        return this.sendRobinhoodFeeMenu(ctx);
      }
      const val = parseFloat(parts[0]);
      if (isNaN(val) || val < 0 || val > 25) {
        return ctx.replyWithHTML('⚠️ Fee beli harus antara 0 dan 25%');
      }
      storage.setRobinhoodBuyFee(val);
      await ctx.replyWithHTML(`✅ <b>Fee Beli Robinhood diatur ke: ${val}%!</b>`);
    });

    bot.command(['rhsellfee', 'robinhoodsellfee'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length === 0) {
        return this.sendRobinhoodFeeMenu(ctx);
      }
      const val = parseFloat(parts[0]);
      if (isNaN(val) || val < 0 || val > 25) {
        return ctx.replyWithHTML('⚠️ Fee jual harus antara 0 dan 25%');
      }
      storage.setRobinhoodSellFee(val);
      await ctx.replyWithHTML(`✅ <b>Fee Jual Robinhood diatur ke: ${val}%!</b>`);
    });

    bot.command(['rhfee', 'robinhoodfee'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1).filter(Boolean);
      if (parts.length === 0) {
        return this.sendRobinhoodFeeMenu(ctx);
      }
      const buy = parseFloat(parts[0]);
      const sell = parts.length >= 2 ? parseFloat(parts[1]) : buy;
      if (isNaN(buy) || buy < 0 || buy > 25 || isNaN(sell) || sell < 0 || sell > 25) {
        return ctx.replyWithHTML('⚠️ Fee harus antara 0 dan 25%');
      }
      storage.setRobinhoodFees(buy, sell);
      await ctx.replyWithHTML(`✅ <b>Fee Robinhood:</b> Beli <b>${buy}%</b> | Jual <b>${sell}%</b>`);
    });

    bot.command(['rhhistory', 'robinhoodhistory'], async (ctx) => {
      await this.sendRobinhoodHistory(ctx);
    });

    // Action Handlers
    bot.action('cmd_start_menu', async (ctx) => {
      await ctx.answerCbQuery();
      await this.sendStartMenu(ctx);
    });

    bot.action('cmd_trending', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendTrendingMenu(ctx);
    });

    bot.action('cmd_trending_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendTrendingMenu(ctx);
    });

    bot.action('cmd_trending_all', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendTrendingList(ctx, 'all');
    });

    bot.action(['cmd_trending_okx', 'cmd_trending_okxhot'], async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendTrendingList(ctx, 'okx');
    });

    bot.action('cmd_wallets_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendWalletsMenu(ctx);
    });

    bot.action('cmd_deploy_all_wallets', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.executeDeployAllWallets(ctx);
    });

    bot.action('cmd_wallet_mode_all', async (ctx) => {
      await ctx.answerCbQuery('Semua 3 wallet diaktifkan untuk auto-deploy!').catch(() => {});
      storage.setAllWalletsAutoDeploy(true);
      await ctx.replyWithHTML(
        `👥 <b>MODE TARGET AUTO-DEPLOY: SEMUA 3 WALLET AKTIF!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `• <b>1️⃣ Wallet 1 (Utama):</b> 🟢 AKTIF\n` +
        `• <b>2️⃣ Wallet 2:</b> 🟢 AKTIF\n` +
        `• <b>3️⃣ Wallet 3:</b> 🟢 AKTIF\n\n` +
        `✅ Saat jadwal auto-deploy tiba, bot akan mendeploy 3 token berbeda secara simultan menggunakan ketiga wallet.`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback('👤 Ubah ke Hanya Wallet Utama', 'cmd_wallet_mode_primary'),
            Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')
          ]
        ])
      );
    });

    bot.action('cmd_wallet_mode_primary', async (ctx) => {
      await ctx.answerCbQuery('Auto-deploy diubah: Hanya Wallet Utama!').catch(() => {});
      storage.setOnlyPrimaryWalletAutoDeploy();
      await ctx.replyWithHTML(
        `👤 <b>MODE TARGET AUTO-DEPLOY: HANYA WALLET UTAMA!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `• <b>1️⃣ Wallet 1 (Utama):</b> 🟢 AKTIF\n` +
        `• <b>2️⃣ Wallet 2:</b> 🔴 NONAKTIF (Dimatikan)\n` +
        `• <b>3️⃣ Wallet 3:</b> 🔴 NONAKTIF (Dimatikan)\n\n` +
        `✅ Bot sekarang <b>HANYA</b> akan menggunakan <b>Wallet 1 (Utama)</b> untuk mendeploy token secara otomatis. Wallet 2 & 3 tidak akan dipakai saat auto-deploy.`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback('👥 Ubah ke Semua 3 Wallet', 'cmd_wallet_mode_all'),
            Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')
          ]
        ])
      );
    });

    bot.action(/^cmd_wallet_view_(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const idx = parseInt(ctx.match[1], 10);
      await this.sendWalletDetail(ctx, idx);
    });

    bot.action(/^cmd_wallet_toggle_(\d+)$/, async (ctx) => {
      const idx = parseInt(ctx.match[1], 10);
      const next = storage.toggleWalletAutoDeploy(idx);
      await ctx.answerCbQuery(`Auto-Deploy Wallet ${idx}: ${next ? 'Aktif' : 'Nonaktif'}`).catch(() => {});
      await this.sendWalletDetail(ctx, idx);
    });

    bot.action(/^cmd_wallet_setkey_(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const idx = parseInt(ctx.match[1], 10);
      await this.sendWalletSetKeyPrompt(ctx, idx);
    });

    bot.action(/^cmd_wallet_hist_(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const idx = parseInt(ctx.match[1], 10);
      await this.sendWalletHistoryMessage(ctx, idx);
    });

    bot.action(['cmd_trending_fresh', 'cmd_trending_freshexp'], async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendTrendingList(ctx, 'fresh');
    });

    bot.action(['cmd_trending_rh', 'cmd_trending_robinhood'], async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendTrendingList(ctx, 'robinhood');
    });

    bot.action('cmd_trending_arc', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendTrendingList(ctx, 'arc');
    });

    bot.action(['cmd_trending_elysium', 'cmd_trending_elys'], async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendTrendingList(ctx, 'elysium');
    });

    bot.action('cmd_trending_clanker', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendTrendingList(ctx, 'clanker');
    });

    bot.action('cmd_trending_dxall', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendTrendingList(ctx, 'dxall');
    });

    bot.action('cmd_trending_base', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendTrendingList(ctx, 'base');
    });

    bot.action('cmd_trending_pump', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendTrendingList(ctx, 'pump');
    });

    bot.action('cmd_trending_cg', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendTrendingList(ctx, 'coingecko');
    });

    bot.action('cmd_trending_fomo', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendTrendingList(ctx, 'fomo');
    });

    bot.action('cmd_trending_dxnew', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendTrendingList(ctx, 'dxnew');
    });

    bot.action('cmd_trending_solana', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendTrendingList(ctx, 'solana');
    });

    bot.action('cmd_trending_eth', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendTrendingList(ctx, 'eth');
    });

    bot.action('cmd_trending_bsc', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendTrendingList(ctx, 'bsc');
    });

    bot.action('cmd_trending_multidex', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendTrendingList(ctx, 'multidex');
    });

    bot.action('cmd_toggle_autodeploy', async (ctx) => {
      await ctx.answerCbQuery();
      const newState = storage.toggleAutoDeploy();
      const statusText = newState ? '🟢 AKTIF (ON)' : '🔴 NONAKTIF (OFF)';
      await ctx.replyWithHTML(
        `⚡ <b>Status Auto-Deploy Global berhasil diubah ke:</b> ${statusText}\n\n${newState ? '✅ Bot otomatis memantau Radar Hype & Tokenomics dan mendeploy ke 3 wallet secara berkala.' : '⏸️ Auto-deploy dinonaktifkan. Anda tetap dapat mendeploy manual lewat menu Deploy.'}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')]
        ])
      );
    });

    bot.action('cmd_status', async (ctx) => {
      await ctx.answerCbQuery();
      await this.sendStatusMessage(ctx);
    });

    bot.action('cmd_history', async (ctx) => {
      await ctx.answerCbQuery();
      await this.sendHistoryMessage(ctx);
    });

    bot.action('cmd_settings', async (ctx) => {
      await ctx.answerCbQuery();
      await this.sendSettingsMessage(ctx);
    });

    bot.action('cmd_suffix_menu', async (ctx) => {
      await ctx.answerCbQuery();
      await this.sendSuffixSelection(ctx);
    });

    bot.action(/^set_suffix_(.+)$/, async (ctx) => {
      const selected = ctx.match[1];
      await ctx.answerCbQuery(`Suffix diatur ke ${selected}`);
      const saved = storage.setRepeatSuffix(selected);
      const isNone = saved.toUpperCase() === 'NONE';
      const display = isNone ? 'Tanpa Suffix (1x deploy)' : `"${saved}" (2x deploy: Nama Asli & Nama + ${saved})`;
      await ctx.replyWithHTML(`✅ <b>Suffix nama berhasil diubah menjadi: ${display}!</b>\n\nSetiap token trending yang dideploy akan menerapkan suffix ini.`);
    });

    bot.action('cmd_active_tokens', async (ctx) => {
      await ctx.answerCbQuery();
      await this.sendActiveTokensMessage(ctx);
    });

    bot.action('cmd_gas_menu', async (ctx) => {
      await ctx.answerCbQuery();
      await this.sendGasMenu(ctx);
    });

    bot.action('cmd_fee_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendFeeMenu(ctx);
    });

    bot.action(/^set_fee_(\d+)$/, async (ctx) => {
      const pct = parseInt(ctx.match[1], 10);
      const saved = storage.setFeePercent(pct);
      await ctx.answerCbQuery(`Fee Buy/Sell diatur ke ${saved}%`).catch(() => {});
      await ctx.replyWithHTML(
        `✅ <b>Fee Buy & Sell Berhasil Diubah ke ${saved}%!</b>\n\n` +
        `• <b>Buy Fee:</b> <code>${saved}%</code>\n` +
        `• <b>Sell Fee:</b> <code>${saved}%</code>\n` +
        `• <b>Starting Sniper Tax:</b> <code>~80%</code> (Decay 120 detik -&gt; ${saved}%)\n\n` +
        `<i>Semua deployment berikutnya (Wallet 1, 2, 3) otomatis menerapkan fee ${saved}%.</i>`,
        Markup.inlineKeyboard([
          [Markup.button.callback('💸 Menu Fee', 'cmd_fee_menu')],
          [Markup.button.callback('⚙️ Pengaturan', 'cmd_settings')],
          [Markup.button.callback('⬅️ Dashboard', 'cmd_start_menu')]
        ])
      );
    });

    bot.action(/^set_gas_(low|ultra_low|standard)$/, async (ctx) => {
      const mode = ctx.match[1];
      const saved = storage.setGasMode(mode);
      const labels = {
        ultra_low: '⚡ Super Hemat (0.0005 Gwei Priority)',
        low: '🟢 Hemat Biaya (0.0010 Gwei Priority - Rekomendasi)',
        standard: '🔵 Normal (RPC Default)'
      };
      await ctx.answerCbQuery(`Mode gas diatur ke: ${labels[saved] || saved}`);
      await ctx.replyWithHTML(`✅ <b>Konfigurasi Gas Berhasil Disimpan!</b>\n\nMode Gas Aktif: <b>${labels[saved]}</b>\nBot akan selalu memprioritaskan biaya gas terendah saat melakukan pembuatan/deploy token.`);
    });

    bot.action('cmd_interval_menu', async (ctx) => {
      await ctx.answerCbQuery();
      await this.sendIntervalSelection(ctx);
    });

    bot.action(/^set_interval_(\d+)$/, async (ctx) => {
      const minutes = Number(ctx.match[1]);
      await ctx.answerCbQuery(`Durasi diatur ke ${minutes} menit`);
      storage.setIntervalMinutes(minutes);
      this.startBackgroundPoller(minutes);
      const label = minutes >= 60 ? `${minutes / 60} Jam` : `${minutes} Menit`;
      await ctx.replyWithHTML(`✅ <b>Durasi auto-deploy berhasil diubah ke: Setiap ${label}!</b>\n\nBot akan memeriksa token trending baru dari GeckoTerminal setiap ${label}.`);
    });

    bot.action('cmd_ai_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendAIMenu(ctx);
    });

    bot.action('cmd_ai_generate_new', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.handleAITokenCreation(ctx, '');
    });

    bot.action('cmd_ai_setkey_info', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.handleSetRespanCommand(ctx);
    });

    bot.action('cmd_ai_deploy_elysium', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!this.latestAIToken) {
        return ctx.reply('⚠️ Tidak ada konsep token AI yang aktif. Buat ide baru dengan /aitoken');
      }
      const t = this.latestAIToken;
      await this.executeDeployElysium(ctx, {
        name: t.name,
        symbol: t.symbol,
        imageUrl: t.imageUrl,
        pair: storage.getElysiumPairToken(),
        hypeLiquidity: String(storage.getElysiumLpHype()),
        buyFee: storage.getElysiumBuyFee(),
        sellFee: storage.getElysiumSellFee()
      });
    });

    bot.action('cmd_ai_deploy_base', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!this.latestAIToken) {
        return ctx.reply('⚠️ Tidak ada konsep token AI yang aktif. Buat ide baru dengan /aitoken');
      }
      const t = this.latestAIToken;
      await this.executeDeployBaseDirect(ctx, {
        name: t.name,
        symbol: t.symbol,
        imageUrl: t.imageUrl,
        pair: storage.getBaseDirectPairToken(),
        ethLiquidity: String(storage.getBaseDirectLpEth()),
        buyFee: 5,
        sellFee: 5
      });
    });

    bot.action('cmd_ai_deploy_clanker', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!this.latestAIToken) {
        return ctx.reply('⚠️ Tidak ada konsep token AI yang aktif. Buat ide baru dengan /aitoken');
      }
      const t = this.latestAIToken;
      await ctx.replyWithHTML(`⏳ <i>Memulai deploy simultan ${escapeHtml(t.name)} ($${escapeHtml(t.symbol)}) ke Wallet Base via Clanker...</i>`);
      const results = await clankerService.deployManualTokenAcrossWallets(t);
      await this.sendManualMultiWalletDeploySummary(ctx, t, results);
    });

    bot.action('cmd_x_radar', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendXRadarMenu(ctx);
    });

    bot.action('cmd_help', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply('Ketik /help untuk membaca panduan lengkap perintah.');
    });

    // Elysium Actions
    bot.action('cmd_elysium_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendElysiumMenu(ctx);
    });

    bot.action('cmd_elysium_deploy_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendElysiumDeployMenu(ctx);
    });

    bot.action('cmd_elysium_history', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendElysiumHistory(ctx);
    });

    bot.action('cmd_elysium_lp_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendElysiumLpMenu(ctx);
    });

    bot.action(/^set_elys_lp_([0-9\.]+)$/, async (ctx) => {
      const val = parseFloat(ctx.match[1]);
      storage.setElysiumLpHype(val);
      await ctx.answerCbQuery(`LP HYPE diatur ke ${val} HYPE!`).catch(() => {});
      await this.sendElysiumLpMenu(ctx, true);
    });

    bot.action(/^set_elys_devbuy_([0-9\.]+|off)$/, async (ctx) => {
      const raw = ctx.match[1];
      const val = raw === 'off' ? 0 : parseFloat(raw);
      storage.setElysiumDevBuyHype(val);
      await ctx.answerCbQuery(val > 0 ? `Dev Buy diatur ke ${val} HYPE!` : 'Dev Buy dinonaktifkan!').catch(() => {});
      await this.sendElysiumLpMenu(ctx, true);
    });

    bot.action('cmd_elysium_fee_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendElysiumFeeMenu(ctx, true);
    });

    bot.action(/^dummy_/, async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
    });

    bot.action(/^set_elys_fees_([0-9\.]+)_([0-9\.]+)$/, async (ctx) => {
      const b = parseFloat(ctx.match[1]);
      const s = parseFloat(ctx.match[2]);
      storage.setElysiumFees(b, s);
      await ctx.answerCbQuery(`Fee Elysium diatur: ${b}% Buy / ${s}% Sell!`).catch(() => {});
      await this.sendElysiumFeeMenu(ctx, true);
    });

    bot.action(/^set_elys_buyfee_([0-9\.]+)$/, async (ctx) => {
      const b = parseFloat(ctx.match[1]);
      storage.setElysiumBuyFee(b);
      await ctx.answerCbQuery(`Fee Beli Elysium diatur ke ${b}%!`).catch(() => {});
      await this.sendElysiumFeeMenu(ctx, true);
    });

    bot.action(/^set_elys_sellfee_([0-9\.]+)$/, async (ctx) => {
      const s = parseFloat(ctx.match[1]);
      storage.setElysiumSellFee(s);
      await ctx.answerCbQuery(`Fee Jual Elysium diatur ke ${s}%!`).catch(() => {});
      await this.sendElysiumFeeMenu(ctx, true);
    });

    bot.action('cmd_elysium_harvest_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendElysiumHarvestMenu(ctx, true);
    });

    bot.action('toggle_elys_autoharvest', async (ctx) => {
      const cur = storage.getElysiumAutoHarvestHype();
      const updated = storage.setElysiumAutoHarvestHype(!cur);
      await ctx.answerCbQuery(updated ? 'Auto-Convert ke HYPE DIAKTIFKAN!' : 'Auto-Convert ke HYPE DINONAKTIFKAN!').catch(() => {});
      await this.sendElysiumHarvestMenu(ctx, true);
    });

    bot.action(/^act_harvest_(0x[a-fA-F0-9]{40})$/, async (ctx) => {
      const addr = ctx.match[1];
      await ctx.answerCbQuery('Memulai swap fee ke HYPE...').catch(() => {});
      const statusMsg = await ctx.replyWithHTML(`⏳ <i>Sedang menukar token fee <code>${addr}</code> ke koin HYPE via Router Uniswap V4...</i>`);
      try {
        const res = await elysiumService.harvestTokenToHype({ tokenAddress: addr });
        if (!res.success) {
          return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, `⚠️ ${escapeHtml(res.message)}`, { parse_mode: 'HTML' });
        }
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          null,
          `🎉 <b>SUKSES MENCAIRKAN FEE KE HYPE!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `• Token: <b>${escapeHtml(res.name)} ($${escapeHtml(res.symbol)})</b>\n` +
          `• Token Diswap: <b>${Number(res.tokensSwapped).toLocaleString('id-ID', { maximumFractionDigits: 2 })} ${res.symbol}</b>\n` +
          `• Koin HYPE Diterima: <b>+${parseFloat(res.hypeReceived).toFixed(6)} HYPE</b> (Sudah masuk ke saldo wallet!)\n` +
          `• Saldo HYPE Sekarang: <b>${parseFloat(res.newHypeBalance).toFixed(6)} HYPE</b>\n` +
          `• Link Explorer: <a href="${res.explorerUrl}">Elyscan Tx</a>`,
          { parse_mode: 'HTML', disable_web_page_preview: true }
        );
      } catch (err) {
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, `❌ <b>Gagal:</b> ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
      }
    });

    bot.action('act_harvest_all', async (ctx) => {
      await ctx.answerCbQuery('Memulai auto-harvest semua token...').catch(() => {});
      const statusMsg = await ctx.replyWithHTML('⏳ <i>Sedang menukar semua saldo token fee ke koin HYPE...</i>');
      try {
        const results = await elysiumService.autoHarvestAll();
        if (results.length === 0) {
          return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, 'ℹ️ Tidak ada saldo token fee yang dapat dicairkan saat ini.', { parse_mode: 'HTML' });
        }
        let text = `🎉 <b>BERHASIL HARVEST ${results.length} TOKEN KE HYPE!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        for (const r of results) {
          text += `• <b>${r.symbol}</b>: Diswap ${Number(r.tokensSwapped).toLocaleString('id-ID', { maximumFractionDigits: 0 })} $\\rightarrow$ <b>+${parseFloat(r.hypeReceived).toFixed(6)} HYPE</b> (<a href="${r.explorerUrl}">Tx</a>)\n`;
        }
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, text, { parse_mode: 'HTML', disable_web_page_preview: true });
      } catch (err) {
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, `❌ <b>Gagal:</b> ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
      }
    });

    bot.action('cmd_elysium_pair_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendElysiumPairMenu(ctx);
    });

    bot.action(/^set_elys_pair_([A-Za-z0-9_]+)$/, async (ctx) => {
      const pair = ctx.match[1].toUpperCase();
      storage.setElysiumPairToken(pair);
      await ctx.answerCbQuery(`Trading Pair diatur ke ${pair}!`).catch(() => {});
      await this.sendElysiumPairMenu(ctx, true);
    });

    bot.action('cmd_elysium_dex_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendElysiumDexMenu(ctx);
    });

    bot.action(/^set_elys_dex_([A-Za-z0-9_]+)$/, async (ctx) => {
      const dex = ctx.match[1].toLowerCase();
      storage.setElysiumDexVersion(dex);
      await ctx.answerCbQuery(`DEX diatur ke Uniswap ${dex.toUpperCase()}!`).catch(() => {});
      await this.sendElysiumDexMenu(ctx, true);
    });

    bot.action('cmd_elysium_deploy_welysium', async (ctx) => {
      await ctx.answerCbQuery('Memulai deployment Wrapped Elysium...').catch(() => {});
      const curLp = storage.getElysiumLpHype();
      await this.executeDeployElysium(ctx, {
        name: 'Wrapped Elysium',
        symbol: 'WELYSIUM',
        imageUrl: 'https://raw.githubusercontent.com/ebeljaya8-cpu/asa/main/data/elysium-logo.png',
        hypeLiquidity: String(curLp),
        isWelysium: true,
        buyFee: storage.getElysiumBuyFee(),
        sellFee: storage.getElysiumSellFee(),
        sniperBuyFee: 80,
        sniperWindowMinutes: 30,
        lockAmount: ethers.parseEther('6000000000'),
        lockHours: 3
      });
    });

    bot.action('cmd_elysium_quick_demo', async (ctx) => {
      await ctx.answerCbQuery('Memulai Quick Deploy Token Demo...').catch(() => {});
      const randomTag = Math.floor(100 + Math.random() * 900);
      const curLp = storage.getElysiumLpHype();
      await this.executeDeployElysium(ctx, {
        name: `Elysium Gem ${randomTag}`,
        symbol: `GEM${randomTag}`,
        imageUrl: 'https://assets.coingecko.com/coins/images/placeholder.png',
        hypeLiquidity: String(curLp),
        buyFee: storage.getElysiumBuyFee(),
        sellFee: storage.getElysiumSellFee(),
        sniperBuyFee: 80,
        sniperWindowMinutes: 30,
        lockAmount: 0n
      });
    });

    bot.action(/^d_elys_(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery('Menyiapkan deploy ke Elysium...').catch(() => {});
      const idx = parseInt(ctx.match[1], 10);
      let targetToken = this.trendingCache ? this.trendingCache[idx] : null;

      if (!targetToken) {
        return ctx.reply('⚠️ Data token tidak ditemukan di cache. Silakan buka /trending elysium lagi.');
      }

      const curLp = storage.getElysiumLpHype();
      await this.executeDeployElysium(ctx, {
        name: targetToken.name,
        symbol: targetToken.symbol,
        imageUrl: targetToken.imageUrl,
        hypeLiquidity: String(curLp),
        buyFee: storage.getElysiumBuyFee(),
        sellFee: storage.getElysiumSellFee(),
        sniperBuyFee: 80,
        sniperWindowMinutes: 30,
        lockAmount: 0n
      });
    });

    // Base Direct Deploy (Mandiri Tanpa Clanker) Action Handlers
    bot.action('cmd_base_direct_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendBaseDirectMenu(ctx, true);
    });

    bot.action('cmd_base_direct_deploy_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendBaseDirectDeployMenu(ctx);
    });

    bot.action('cmd_base_direct_history', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendBaseDirectHistory(ctx);
    });

    // ===== ROBINHOOD CHAIN ACTION HANDLERS =====
    bot.action('cmd_robinhood_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendRobinhoodMenu(ctx, true);
    });

    bot.action('cmd_robinhood_deploy_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendRobinhoodDeployMenu(ctx, true);
    });

    bot.action('cmd_robinhood_history', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendRobinhoodHistory(ctx);
    });

    bot.action('cmd_robinhood_settings', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendRobinhoodSettingsMenu(ctx, true);
    });

    bot.action('cmd_robinhood_pair_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendRobinhoodPairMenu(ctx, true);
    });

    bot.action(/^set_rh_pair_([A-Za-z0-9_]+)$/, async (ctx) => {
      const pair = ctx.match[1].toUpperCase();
      storage.setRobinhoodPairToken(pair);
      await ctx.answerCbQuery(`Trading Pair Robinhood diatur ke ${pair}!`).catch(() => {});
      await this.sendRobinhoodPairMenu(ctx, true);
    });

    bot.action('cmd_robinhood_dex_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendRobinhoodDexMenu(ctx, true);
    });

    bot.action(/^set_rh_dex_([A-Za-z0-9_]+)$/, async (ctx) => {
      const dex = ctx.match[1].toLowerCase();
      storage.setRobinhoodDexVersion(dex);
      await ctx.answerCbQuery(`DEX Robinhood diatur ke Uniswap ${dex.toUpperCase()}!`).catch(() => {});
      await this.sendRobinhoodDexMenu(ctx, true);
    });

    bot.action(/^set_rh_v3tier_(\d+)$/, async (ctx) => {
      const tier = Number(ctx.match[1]);
      storage.setRobinhoodV3FeeTier(tier);
      await ctx.answerCbQuery(`Fee Tier Pool diatur ke ${tier / 10000}%!`).catch(() => {});
      await this.sendRobinhoodDexMenu(ctx, true);
    });

    bot.action('cmd_robinhood_lp_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendRobinhoodLpMenu(ctx, true);
    });

    bot.action(/^set_rh_lp_([0-9\.]+)$/, async (ctx) => {
      const val = parseFloat(ctx.match[1]);
      storage.setRobinhoodLpEth(val);
      await ctx.answerCbQuery(`LP ETH Robinhood diatur ke ${val} ETH!`).catch(() => {});
      await this.sendRobinhoodLpMenu(ctx, true);
    });

    bot.action(/^set_rh_devbuy_([0-9\.]+|off)$/, async (ctx) => {
      const raw = ctx.match[1];
      const val = raw === 'off' ? 0 : parseFloat(raw);
      storage.setRobinhoodDevBuyEth(val);
      await ctx.answerCbQuery(val > 0 ? `Dev Buy Robinhood diatur ke ${val} ETH!` : 'Dev Buy Robinhood dinonaktifkan!').catch(() => {});
      await this.sendRobinhoodLpMenu(ctx, true);
    });

    bot.action('cmd_robinhood_fee_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendRobinhoodFeeMenu(ctx, true);
    });

    bot.action(/^set_rh_fees_([0-9\.]+)_([0-9\.]+)$/, async (ctx) => {
      const b = parseFloat(ctx.match[1]);
      const s = parseFloat(ctx.match[2]);
      storage.setRobinhoodFees(b, s);
      await ctx.answerCbQuery(`Fee Robinhood diatur: ${b}% Buy / ${s}% Sell!`).catch(() => {});
      await this.sendRobinhoodFeeMenu(ctx, true);
    });

    bot.action(/^set_rh_buyfee_([0-9\.]+)$/, async (ctx) => {
      const b = parseFloat(ctx.match[1]);
      storage.setRobinhoodBuyFee(b);
      await ctx.answerCbQuery(`Fee Beli Robinhood diatur ke ${b}%!`).catch(() => {});
      await this.sendRobinhoodFeeMenu(ctx, true);
    });

    bot.action(/^set_rh_sellfee_([0-9\.]+)$/, async (ctx) => {
      const s = parseFloat(ctx.match[1]);
      storage.setRobinhoodSellFee(s);
      await ctx.answerCbQuery(`Fee Jual Robinhood diatur ke ${s}%!`).catch(() => {});
      await this.sendRobinhoodFeeMenu(ctx, true);
    });

    bot.action('cmd_robinhood_quick_demo', async (ctx) => {
      await ctx.answerCbQuery('⏳ Memulai deploy demo ke Robinhood...').catch(() => {});
      const randomTag = Math.floor(100 + Math.random() * 900);
      await this.executeDeployRobinhood(ctx, {
        name: `Robinhood Gem ${randomTag}`,
        symbol: `RH${randomTag}`,
        imageUrl: 'https://assets.coingecko.com/coins/images/placeholder.png',
        pair: storage.getRobinhoodPairToken(),
        ethLiquidity: String(storage.getRobinhoodLpEth()),
        buyFee: storage.getRobinhoodBuyFee(),
        sellFee: storage.getRobinhoodSellFee(),
        sniperBuyFee: 80,
        sniperWindowMinutes: 30,
        lockAmount: 0n
      });
    });

    bot.action(/^d_rh_(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery('Menyiapkan deploy ke Robinhood Chain...').catch(() => {});
      const idx = parseInt(ctx.match[1], 10);
      const targetToken = this.trendingCache ? this.trendingCache[idx] : null;
      if (!targetToken) {
        return ctx.reply('⚠️ Data token tidak ditemukan di cache. Silakan buka /trending robinhood lagi.');
      }
      await this.executeDeployRobinhood(ctx, {
        name: targetToken.name,
        symbol: targetToken.symbol,
        imageUrl: targetToken.imageUrl,
        pair: storage.getRobinhoodPairToken(),
        ethLiquidity: String(storage.getRobinhoodLpEth()),
        buyFee: storage.getRobinhoodBuyFee(),
        sellFee: storage.getRobinhoodSellFee(),
        sniperBuyFee: 80,
        sniperWindowMinutes: 30,
        lockAmount: 0n
      });
    });

    bot.action('cmd_base_direct_lp_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendBaseDirectLpMenu(ctx);
    });

    bot.action(/^set_base_lp_([0-9\.]+)$/, async (ctx) => {
      const val = parseFloat(ctx.match[1]);
      storage.setBaseDirectLpEth(val);
      await ctx.answerCbQuery(`LP ETH diatur ke ${val} ETH!`).catch(() => {});
      await this.sendBaseDirectLpMenu(ctx, true);
    });

    bot.action(/^set_base_devbuy_([0-9\.]+|off)$/, async (ctx) => {
      const raw = ctx.match[1];
      const val = raw === 'off' ? 0 : parseFloat(raw);
      storage.setBaseDirectDevBuyEth(val);
      await ctx.answerCbQuery(val > 0 ? `Dev Buy diatur ke ${val} ETH!` : 'Dev Buy dinonaktifkan!').catch(() => {});
      await this.sendBaseDirectLpMenu(ctx, true);
    });

    bot.action('cmd_base_direct_pair_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendBaseDirectPairMenu(ctx);
    });

    bot.action(/^set_base_pair_([A-Za-z0-9_]+)$/, async (ctx) => {
      const pair = ctx.match[1].toUpperCase();
      storage.setBaseDirectPairToken(pair);
      await ctx.answerCbQuery(`Trading Pair diatur ke ${pair}!`).catch(() => {});
      await this.sendBaseDirectPairMenu(ctx, true);
    });

    bot.action('cmd_base_direct_dex_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendBaseDirectDexMenu(ctx);
    });

    bot.action(/^set_base_dex_([A-Za-z0-9_]+)$/, async (ctx) => {
      const dex = ctx.match[1].toLowerCase();
      storage.setBaseDirectDexVersion(dex);
      await ctx.answerCbQuery(`DEX diatur ke Uniswap ${dex.toUpperCase()}!`).catch(() => {});
      await this.sendBaseDirectDexMenu(ctx, true);
    });

    bot.action('cmd_base_direct_quick_demo', async (ctx) => {
      await ctx.answerCbQuery('Memulai Quick Deploy Token Demo Base...').catch(() => {});
      const randomTag = Math.floor(100 + Math.random() * 900);
      const curLp = storage.getBaseDirectLpEth();
      await this.executeDeployBaseDirect(ctx, {
        name: `Base Gem ${randomTag}`,
        symbol: `GEM${randomTag}`,
        imageUrl: 'https://assets.coingecko.com/coins/images/placeholder.png',
        ethLiquidity: String(curLp),
        buyFee: 5,
        sellFee: 5
      });
    });

    bot.action(/^d_basedir_(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery('Menyiapkan deploy mandiri ke Base...').catch(() => {});
      const idx = parseInt(ctx.match[1], 10);
      let targetToken = this.trendingCache ? this.trendingCache[idx] : null;

      if (!targetToken) {
        return ctx.reply('⚠️ Data token tidak ditemukan di cache. Silakan buka /trending lagi.');
      }

      const curLp = storage.getBaseDirectLpEth();
      await this.executeDeployBaseDirect(ctx, {
        name: targetToken.name,
        symbol: targetToken.symbol,
        imageUrl: targetToken.imageUrl,
        ethLiquidity: String(curLp),
        buyFee: 5,
        sellFee: 5
      });
    });

    // Dynamic Deploy Button Action with short callback data (safe < 64 bytes)
    // DEPLOYS ACROSS ALL WALLETS SIMULTANEOUSLY!
    bot.action(/^d_idx_(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery('Memulai proses deploy di SEMUA wallet...').catch(() => {});
      const idx = parseInt(ctx.match[1], 10);
      let targetToken = this.trendingCache ? this.trendingCache[idx] : null;

      if (!targetToken) {
        const trending = await geckoService.getTrendingTokens();
        targetToken = trending[idx];
      }

      if (!targetToken) {
        return ctx.reply('⚠️ Data token tidak ditemukan. Silakan buka /trending untuk memperbarui daftar.');
      }

      const activeWallets = clankerService.getActiveWallets();
      const walletCount = activeWallets.length > 0 ? activeWallets.length : 3;
      const activeSuffix = storage.getRepeatSuffix();
      const isNone = activeSuffix.toUpperCase() === 'NONE';
      const suffixInfo = isNone ? '1x Deploy' : `2x Deploy (+ "${activeSuffix}")`;

      await ctx.replyWithHTML(
        `⏳ <b>Memulai Deploy Manual ke SEMUA WALLET (${walletCount} Wallet Sekaligus)!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `• Token: <b>${escapeHtml(targetToken.name)}</b> (<code>$${escapeHtml(targetToken.symbol)}</code>)\n` +
        `• Mode: <b>${suffixInfo}</b>\n` +
        `• Target: <b>Wallet 1 (Utama), Wallet 2, Wallet 3</b>\n\n` +
        `<i>Memproses transaksi simultan di Base Layer 2 via Clanker v4...</i>`
      );

      const results = await clankerService.deployManualTokenAcrossWallets(targetToken);
      await this.sendManualMultiWalletDeploySummary(ctx, targetToken, results);
    });

    bot.action(/^deploy_(.+)$/, async (ctx) => {
      await ctx.answerCbQuery('Memulai proses deploy di SEMUA wallet...').catch(() => {});
      const targetPoolId = ctx.match[1];
      
      const trending = await geckoService.getTrendingTokens();
      const targetToken = trending.find(t => t.id === targetPoolId || t.poolAddress === targetPoolId);

      if (!targetToken) {
        return ctx.reply('⚠️ Data token tidak ditemukan atau sudah kadaluarsa di cache GeckoTerminal. Silakan refresh /trending.');
      }

      const activeWallets = clankerService.getActiveWallets();
      const walletCount = activeWallets.length > 0 ? activeWallets.length : 3;
      const activeSuffix = storage.getRepeatSuffix();
      const isNone = activeSuffix.toUpperCase() === 'NONE';
      const suffixInfo = isNone ? '1x Deploy' : `2x Deploy (+ "${activeSuffix}")`;

      await ctx.replyWithHTML(
        `⏳ <b>Memulai Deploy Manual ke SEMUA WALLET (${walletCount} Wallet Sekaligus)!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `• Token: <b>${escapeHtml(targetToken.name)}</b> (<code>$${escapeHtml(targetToken.symbol)}</code>)\n` +
        `• Mode: <b>${suffixInfo}</b>\n` +
        `• Target: <b>Wallet 1 (Utama), Wallet 2, Wallet 3</b>\n\n` +
        `<i>Memproses transaksi simultan di Base Layer 2 via Clanker v4...</i>`
      );

      const results = await clankerService.deployManualTokenAcrossWallets(targetToken);
      await this.sendManualMultiWalletDeploySummary(ctx, targetToken, results);
    });
  }

  async sendStartMenu(ctx) {
    const state = storage.getState();
    const wallets = await clankerService.getAllWalletsInfo();
    const gasInfo = await clankerService.getGasInfo();
    const autoStatus = state.autoDeploy ? '🟢 AKTIF (ON)' : '🔴 NONAKTIF (OFF)';
    const intervalMins = storage.getIntervalMinutes();
    const intervalLabel = intervalMins >= 60 ? `${intervalMins / 60} Jam` : `${intervalMins} Menit`;
    const currentSuffix = storage.getRepeatSuffix();
    const suffixDisplay = currentSuffix.toUpperCase() === 'NONE' ? '1x Deploy (Tanpa Suffix)' : `2x (+ "${currentSuffix}")`;

    const gasModeLabel = {
      ultra_low: '⚡ Super Hemat',
      low: '🟢 Hemat Biaya (Default)',
      standard: '🔵 Normal'
    }[gasInfo.mode] || '🟢 Hemat Biaya';

    let walletsOverview = '';
    for (const w of wallets) {
      const isPrimary = w.id === 1;
      const tag = isPrimary ? '1️⃣ W1 (Utama)' : (w.id === 2 ? '2️⃣ W2' : '3️⃣ W3');
      const addrShort = w.hasWallet ? `${w.address.slice(0, 6)}...${w.address.slice(-4)}` : '⚠️ Belum Dipasang';
      const autoTag = w.enabled ? '🟢 ON' : '🔴 OFF';
      walletsOverview += `• <b>${tag}:</b> <code>${addrShort}</code> (<b>${w.balanceEth} ETH</b>) ${autoTag}\n`;
    }

    const walletMode = storage.getAutoDeployWalletMode();
    const walletModeLabel = walletMode === 'primary_only' 
      ? '👤 Hanya Wallet Utama (W1)' 
      : (walletMode === 'all_wallets' ? '👥 Semua 3 Wallet (Simultan)' : '⚙️ Kustom');

    const message = 
`💎 <b>CLANKER x RADAR MULTI-WALLET (BASE NETWORK)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Selamat datang di pusat kontrol bot token launchpad Base 3-Wallet!

📊 <b>STATUS SISTEM:</b>
• Auto-Deploy Global: <b>${autoStatus}</b>
• Target Auto-Deploy: <b>${walletModeLabel}</b>
• Frekuensi Cek: <b>Setiap ${intervalLabel}</b>
• Mode Saldo: <b>Dev Buy Minimal (${config.devBuyEth} ETH) ✅</b>
• Mode Gas: <b>${gasModeLabel}</b> (Gas Base: <code>${gasInfo.gasPriceGwei} Gwei</code>)
• Token Dideploy: <b>${state.totalDeployedCount || 0} token</b>

👛 <b>STATUS 3 WALLET (DEPLOI SIMULTAN):</b>
${walletsOverview}
⚙️ <b>RADAR HYPE &amp; TOKENOMICS:</b>
• Radar: <b>OKX Hot Tokens, Clanker, DexScreener, GeckoTerminal, Pump.fun</b>
• Fee: <b>${storage.getFeePercent()}% Buy / ${storage.getFeePercent()}% Sell</b> | Anti-Snipe: <b>120 Detik</b>
• Creator Vault: <b>5%</b> | Batch Duplikasi: <b>${suffixDisplay}</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
👇 <i>Pilih menu di bawah:</i>`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('⚡ Base Direct Hub (Mandiri)', 'cmd_base_direct_menu'),
        Markup.button.callback('🪐 Elysium Hub & Deploy', 'cmd_elysium_menu')
      ],
      [
        Markup.button.callback('🏹 Robinhood Hub & Deploy', 'cmd_robinhood_menu'),
        Markup.button.callback('🧠 AI Brain & Respan Gemini', 'cmd_ai_menu'),
        Markup.button.callback('🎨 Buat Token AI (/aitoken)', 'cmd_ai_generate_new')
      ],
      [
        Markup.button.callback('👛 Kelola 3 Wallet Terpisah', 'cmd_wallets_menu'),
        Markup.button.callback('🚀 Deploy 3 Wallet Sekaligus', 'cmd_deploy_all_wallets')
      ],
      [
        Markup.button.callback('🔥 Radar OKX & Multi-Chain', 'cmd_trending_menu'),
        Markup.button.callback(state.autoDeploy ? '⚡ Auto-Deploy: 🟢 AKTIF' : '⚡ Auto-Deploy: 🔴 NONAKTIF', 'cmd_toggle_autodeploy')
      ],
      [
        Markup.button.callback(walletMode === 'all_wallets' ? '✅ 👥 Semua 3 Wallet' : '👥 Auto: Semua 3 Wallet', 'cmd_wallet_mode_all'),
        Markup.button.callback(walletMode === 'primary_only' ? '✅ 👤 Hanya Wallet Utama' : '👤 Auto: Hanya Wallet 1', 'cmd_wallet_mode_primary')
      ],
      [
        Markup.button.callback('⏱️ Atur Durasi', 'cmd_interval_menu'),
        Markup.button.callback('🏷️ Ganti Suffix', 'cmd_suffix_menu')
      ],
      [
        Markup.button.callback('⛽ Mode Gas Fee', 'cmd_gas_menu'),
        Markup.button.callback('📊 Saldo & Gas', 'cmd_status')
      ],
      [
        Markup.button.callback('💎 Token Aktif (LP > $1)', 'cmd_active_tokens'),
        Markup.button.callback('📜 Riwayat Deploy', 'cmd_history')
      ],
      [
        Markup.button.callback('⚙️ Konfigurasi Lengkap', 'cmd_settings'),
        Markup.button.callback('❓ Panduan / Help', 'cmd_help')
      ]
    ]);

    await ctx.replyWithHTML(message, keyboard);
  }

  async sendStatusMessage(ctx) {
    const state = storage.getState();
    const wallets = await clankerService.getAllWalletsInfo();
    const gasInfo = await clankerService.getGasInfo();
    const autoStatus = state.autoDeploy ? '🟢 AKTIF' : '🔴 NONAKTIF';
    const intervalMins = storage.getIntervalMinutes();
    const intervalLabel = intervalMins >= 60 ? `${intervalMins / 60} Jam` : `${intervalMins} Menit`;
    const currentSuffix = storage.getRepeatSuffix();
    const suffixDisplay = currentSuffix.toUpperCase() === 'NONE' ? 'Tanpa Suffix (1x)' : `"${currentSuffix}" (2x)`;

    const gasModeLabel = {
      ultra_low: '⚡ Super Hemat (0.0005 Gwei Priority)',
      low: '🟢 Hemat Biaya (0.0010 Gwei Priority)',
      standard: '🔵 Normal'
    }[gasInfo.mode] || '🟢 Hemat Biaya';

    const walletMode = storage.getAutoDeployWalletMode();
    const walletModeLabel = walletMode === 'primary_only' 
      ? '👤 Hanya Wallet Utama (W1)' 
      : (walletMode === 'all_wallets' ? '👥 Semua 3 Wallet' : '⚙️ Kustom');

    let walletsDetailedStr = '';
    for (const w of wallets) {
      const isPrimary = w.id === 1;
      const statusText = w.hasWallet 
        ? `<code>${w.address}</code>\n  Saldo: <b>${w.balanceEth} ETH</b> | Auto-Deploy: <b>${w.enabled ? '🟢 ON' : '🔴 OFF'}</b>` 
        : '<i>⚠️ Belum Dipasang (Gunakan /setkey' + w.id + ')</i>';
      walletsDetailedStr += `• <b>${w.name} ${isPrimary ? '(Utama)' : ''}:</b>\n  ${statusText}\n`;
    }

    const msg = 
`📊 <b>STATUS BOT, 3 WALLET &amp; BIAYA GAS BASE</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
• Auto-Deploy Global: <b>${autoStatus}</b>
• Target Auto-Deploy: <b>${walletModeLabel}</b>
• Frekuensi Cek: <b>Setiap ${intervalLabel}</b>
• Suffix Nama: <b>${suffixDisplay}</b>
• Mode Gas: <b>${gasModeLabel}</b>
• Gas Base Saat Ini: <code>${gasInfo.gasPriceGwei} Gwei</code> (${gasInfo.recommendation})
• Mode Eksekusi: <b>${config.dryRun ? '🧪 Dry Run (Simulasi)' : '⚡ Live Mainnet (Base)'}</b>
• Dev Buy Minimal: <code>${config.devBuyEth} ETH</code>
• Total Token Dideploy: <b>${state.totalDeployedCount || 0} token</b>

👛 <b>DETAIL SALDO &amp; STATUS 3 WALLET:</b>
${walletsDetailedStr}
━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    await ctx.replyWithHTML(msg, Markup.inlineKeyboard([
      [Markup.button.callback('👛 Kelola 3 Wallet Terpisah', 'cmd_wallets_menu')],
      [
        Markup.button.callback(walletMode === 'all_wallets' ? '✅ 👥 Semua 3 Wallet' : '👥 Semua 3 Wallet', 'cmd_wallet_mode_all'),
        Markup.button.callback(walletMode === 'primary_only' ? '✅ 👤 Hanya Wallet Utama' : '👤 Hanya Wallet Utama', 'cmd_wallet_mode_primary')
      ],
      [Markup.button.callback('🔄 Refresh Status & Gas', 'cmd_status')],
      [
        Markup.button.callback('⛽ Atur Mode Gas', 'cmd_gas_menu'),
        Markup.button.callback('⏱️ Atur Durasi', 'cmd_interval_menu')
      ],
      [
        Markup.button.callback(state.autoDeploy ? '⚡ Auto-Deploy: 🟢 AKTIF' : '⚡ Auto-Deploy: 🔴 NONAKTIF', 'cmd_toggle_autodeploy'),
        Markup.button.callback('⬅️ Dashboard', 'cmd_start_menu')
      ]
    ]));
  }

  async sendSettingsMessage(ctx) {
    const airdropEntries = getAirdropEntries();
    let airdropDetails = '<code>Belum diisi</code>';
    if (airdropEntries.length > 0) {
      const totalAmt = airdropEntries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      airdropDetails = `<b>${airdropEntries.length} Wallet</b> (Total: <code>${totalAmt.toLocaleString()}</code> token)\n`;
      airdropDetails += airdropEntries.map(e => `  • <code>${e.account.substring(0, 6)}...${e.account.substring(e.account.length - 4)}</code>: <code>${Number(e.amount).toLocaleString()}</code>`).join('\n');
    }
    const intervalMins = storage.getIntervalMinutes();
    const intervalLabel = intervalMins >= 60 ? `${intervalMins / 60} Jam` : `${intervalMins} Menit`;
    const currentSuffix = storage.getRepeatSuffix();
    const suffixDisplay = currentSuffix.toUpperCase() === 'NONE' ? 'Tanpa Suffix (1x)' : `"${currentSuffix}" (2x)`;
    const gasMode = storage.getGasMode();
    const gasLabels = {
      ultra_low: '⚡ Super Hemat (0.0005 Gwei)',
      low: '🟢 Hemat Biaya (0.0010 Gwei)',
      standard: '🔵 Normal (Default)'
    };

    const currentFee = storage.getFeePercent();

    const msg = 
`⚙️ <b>PENGATURAN PARAMETER CLANKER (DEFAULT)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
⏱️ <b>Durasi Auto-Deploy:</b> <code>Setiap ${intervalLabel}</code>
🏷️ <b>Suffix Nama Token:</b> <code>${suffixDisplay}</code>
⛽ <b>Mode Gas Fee:</b> <code>${gasLabels[gasMode] || gasMode}</code>
💰 <b>Dev Buy:</b> <code>${config.devBuyEth} ETH</code> (Mode Biaya Terendah)
💸 <b>Buy & Sell Fee:</b> <code>${currentFee}%</code> (${currentFee}% Buy Fee & ${currentFee}% Sell Fee)
🛡️ <b>Sniper Tax:</b> <code>${config.sniperTaxDurationSec} detik</code> (Decay ${config.startingSniperFeePercent || 80}% -&gt; ${currentFee}%)
🏛️ <b>Creator Vault:</b> <code>${config.creatorVaultPercent}%</code> (Lockup ${config.creatorVaultLockupDays} hari)
🏊 <b>Pool Type:</b> <code>${config.poolType} (10 Range Positions)</code>
⏱️ <b>Airdrop Lockup:</b> <code>${config.airdropLockupDays} hari / instan</code>
🎁 <b>Airdrop Recipients:</b>
${airdropDetails}
━━━━━━━━━━━━━━━━━━━━━━━━━━
<i>Parameter ini otomatis diterapkan pada setiap auto-deploy dan manual deploy.</i>`;

    await ctx.replyWithHTML(msg, Markup.inlineKeyboard([
      [
        Markup.button.callback('⏱️ Ubah Durasi', 'cmd_interval_menu'),
        Markup.button.callback('🏷️ Ganti Suffix', 'cmd_suffix_menu')
      ],
      [
        Markup.button.callback('⛽ Atur Mode Gas', 'cmd_gas_menu'),
        Markup.button.callback('💸 Atur Fee Buy/Sell', 'cmd_fee_menu')
      ],
      [
        Markup.button.callback('⬅️ Dashboard', 'cmd_start_menu')
      ]
    ]));
  }

  async sendFeeMenu(ctx) {
    const currentFee = storage.getFeePercent();
    const check = (pct) => (pct === currentFee ? ' ✅' : '');

    const msg = 
`💸 <b>PENGATURAN FEE BUY & SELL TOKEN (BASE)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 <b>Fee Aktif Saat Ini:</b> <code>${currentFee}%</code> Buy & <code>${currentFee}%</code> Sell

Pilih fee transaksi yang akan diterapkan pada setiap token baru yang dideploy:

• <b>3% (Volume Tinggi)</b>: Biaya rendah, menarik volume trading paling tinggi dan ramah trader.
• <b>5% (Moderat / Seimbang)</b>: Keseimbangan optimal antara likuiditas dan penerimaan fee creator.
• <b>10% (Maksimum On-Chain Clanker v4)</b>: Batas tertinggi mutlak yang diizinkan oleh smart contract Clanker v4 di Base Network (1000 bps). Memaksimalkan perolehan fee bagi creator dari setiap buy dan sell.

<i>⚠️ Catatan: Smart contract Clanker v4 di Base me-revert transaksi jika fee di atas 10%. Pilihan 10% adalah fee legal tertinggi yang diizinkan on-chain.</i>`;

    await ctx.replyWithHTML(msg, Markup.inlineKeyboard([
      [
        Markup.button.callback(`💰 3% Fee${check(3)}`, 'set_fee_3'),
        Markup.button.callback(`💰 5% Fee${check(5)}`, 'set_fee_5'),
        Markup.button.callback(`💰 10% Fee (Max)${check(10)}`, 'set_fee_10')
      ],
      [
        Markup.button.callback('⚙️ Kembali ke Pengaturan', 'cmd_settings'),
        Markup.button.callback('⬅️ Dashboard', 'cmd_start_menu')
      ]
    ]));
  }

  async sendGasMenu(ctx) {
    const gasInfo = await clankerService.getGasInfo();
    const currentMode = storage.getGasMode();

    const msg = 
`⛽ <b>PENGATURAN BIAYA GAS PEMBUATAN TOKEN (BASE)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 <b>Kondisi Jaringan Base Saat Ini:</b>
• Base Gas Price: <code>${gasInfo.gasPriceGwei} Gwei</code>
• Status: <b>${gasInfo.recommendation}</b>
• Mode Gas Aktif: <b>${currentMode.toUpperCase()}</b>

💡 <b>Pilihan Strategi Gas Fee:</b>
1. <b>🟢 Hemat Biaya (Rekomendasi):</b>
   Menetapkan priority tip terendah (0.0010 Gwei) yang aman dan cepat terkonfirmasi di jaringan Base L2 tanpa membuang ETH berlebih.
2. <b>⚡ Super Hemat (Ultra Low):</b>
   Menetapkan tip minimal absolut (0.0005 Gwei) untuk penghematan saldo maksimal.
3. <b>🔵 Normal:</b>
   Mengikuti estimasi standar RPC Base.

👇 <i>Pilih mode gas yang Anda inginkan:</i>`;

    await ctx.replyWithHTML(msg, Markup.inlineKeyboard([
      [
        Markup.button.callback(`${currentMode === 'low' ? '🔘 ' : '⚪ '}🟢 Hemat (0.001 Gwei)`, 'set_gas_low'),
        Markup.button.callback(`${currentMode === 'ultra_low' ? '🔘 ' : '⚪ '}⚡ Super Hemat`, 'set_gas_ultra_low')
      ],
      [
        Markup.button.callback(`${currentMode === 'standard' ? '🔘 ' : '⚪ '}🔵 Normal (Standar)`, 'set_gas_standard')
      ],
      [
        Markup.button.callback('🔄 Refresh Gas Price', 'cmd_gas_menu'),
        Markup.button.callback('⬅️ Kembali', 'cmd_start_menu')
      ]
    ]));
  }

  async sendAIMenu(ctx) {
    await ctx.reply('🧠 Menganalisis kondisi pasar on-chain, volume multi-chain, dan sentimen pasar secara mandiri...');
    const analysis = await aiEngine.analyzeMarketConditions();
    const memory = aiEngine.getMemory();
    const learnedKeywords = (memory.successfulPatterns?.topKeywords || []).slice(0, 10).join(', ');

    const heatBar = '🟩'.repeat(Math.round(analysis.heatScore / 10)) + '⬜'.repeat(10 - Math.round(analysis.heatScore / 10));

    const respanKey = storage.getRespanApiKey();
    const maskedKey = respanKey ? `${respanKey.slice(0, 6)}...${respanKey.slice(-4)}` : 'Belum diatur (/setrespan)';
    const respanModel = storage.getRespanModel();

    const msg = 
`🧠 <b>AI AUTONOMOUS MARKET BRAIN &amp; SENTIMEN ON-CHAIN</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 <b>Respan AI Gateway (Gemini 4 Carbon):</b>
• Status API: <b>${respanKey ? '🟢 Terhubung' : '🔴 Belum Diatur'}</b> (<code>${maskedKey}</code>)
• Model Aktif: <code>${escapeHtml(respanModel)}</code>
• Fitur: <i>Chat AI (<code>/ai &lt;pertanyaan&gt;</code>), Pembuat Konsep Token (<code>/aitoken</code>)</i>

📊 <b>Indeks Kehangatan Pasar (Market Heat):</b>
• Skor: <b>${analysis.heatScore}/100</b> [${heatBar}]
• Status Pasar: <b>${analysis.stateEmoji} ${analysis.marketState}</b>
• Gas Base L2: <code>${analysis.gasGwei} Gwei</code>
• Volume DEX 24j: <b>$${Math.round(analysis.totalVolume24hUsd).toLocaleString()}</b>
• Rata-rata Volume/Token: <b>$${Math.round(analysis.avgVolumeUsd).toLocaleString()}</b>

💡 <b>Rekomendasi Keputusan AI:</b>
<i>"${analysis.recommendedAction}"</i>

📚 <b>Pembelajaran Mandiri AI (Self-Learning Memory):</b>
• Kata Kunci Terbaik: <code>${learnedKeywords || 'AI, BASE, FINANCE, PUMP'}</code>
• Token Dipelajari: <b>${memory.learnedDeployCount || 0} token</b>

👇 <i>Pilihan Aksi AI:</i>`;

    await ctx.replyWithHTML(msg, Markup.inlineKeyboard([
      [
        Markup.button.callback('🎨 Buat Konsep Token AI Baru', 'cmd_ai_generate_new'),
        Markup.button.callback('🔑 Info / Set API Key', 'cmd_ai_setkey_info')
      ],
      [
        Markup.button.callback('🔥 Scan Trending Pasar Sekarang', 'cmd_trending_all'),
        Markup.button.callback('🐦 Cek X / Twitter Alpha', 'cmd_x_radar')
      ],
      [
        Markup.button.callback('🔄 Refresh Analisis AI', 'cmd_ai_menu'),
        Markup.button.callback('⬅️ Dashboard', 'cmd_start_menu')
      ]
    ]));
  }

  async sendXRadarMenu(ctx) {
    await ctx.reply('🐦 Memindai alpha tweet dan mention tokoh-tokoh terkemuka ekosistem Base...');
    const signals = await xRadarService.getXAlphaTrending();

    if (!signals || signals.length === 0) {
      return ctx.reply('Belum ada sinyal alpha X yang terdeteksi saat ini.');
    }

    this.trendingCache = signals;

    await ctx.replyWithHTML(
`🐦 <b>X / TWITTER ALPHA RADAR (BASE &amp; WEB3 ECOSYSTEM)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Menemukan <b>${signals.length} Sinyal Alpha</b> dari tokoh &amp; akun resmi terkemuka.
AI otomatis menentukan Nama, Ticker ($SYMBOL), &amp; mengambil avatar/foto sebagai logo token:`);

    for (const [index, item] of signals.entries()) {
      const caption = 
`#${index + 1} 🐦 <b>${escapeHtml(item.accountName)}</b> (<code>${escapeHtml(item.accountHandle)}</code>)
━━━━━━━━━━━━━━━━━━━━━━━━━━
🪙 Rekomendasi Token: <b>${escapeHtml(item.name)}</b> (<code>$${escapeHtml(item.symbol)}</code>)
💬 Tweet Alpha: <i>"${escapeHtml(item.tweetText)}"</i>
❤️ Likes: <b>${item.likes.toLocaleString()}</b> | 🔁 Reposts: <b>${item.reposts.toLocaleString()}</b>
🔗 <a href="${item.sourceUrl}">Lihat Tweet Asli</a>`;

      const buttons = [
        [Markup.button.callback(`🚀 Deploy Proyek Ini via Clanker`, `d_idx_${index}`)]
      ];

      try {
        if (item.imageUrl && item.imageUrl.startsWith('http')) {
          await ctx.replyWithPhoto(item.imageUrl, {
            caption,
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard(buttons)
          });
        } else {
          await ctx.replyWithHTML(caption, Markup.inlineKeyboard(buttons));
        }
      } catch (e) {
        await ctx.replyWithHTML(caption, Markup.inlineKeyboard(buttons));
      }
    }

    await ctx.replyWithHTML(
`💡 <i>Anda juga bisa memasukkan teks tweet atau narasi sendiri dengan mengetik:</i>
👉 <code>/x [isi tweet / narasi proyek]</code>`,
      Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh Radar X', 'cmd_x_radar')],
        [Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')]
      ])
    );
  }

  async sendSuffixSelection(ctx) {
    const current = storage.getRepeatSuffix();
    const isNone = current.toUpperCase() === 'NONE';
    const display = isNone ? 'Tanpa Suffix (1x)' : current;

    const msg = 
`🏷️ <b>PENGATURAN SUFFIX NAMA TOKEN</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Suffix Saat Ini: <b>${display}</b>

Pilih kata akhiran yang ingin ditambahkan pada duplikasi deploy token (2x pengulangan), atau ketik custom dengan format:
👉 <code>/suffix [KATA_PILIHAN]</code>
<i>Contoh: <code>/suffix Finance</code> atau <code>/suffix Coin</code></i>`;

    await ctx.replyWithHTML(msg, Markup.inlineKeyboard([
      [
        Markup.button.callback(`${current === 'BASE' ? '🔘 ' : '⚪ '}BASE`, 'set_suffix_BASE'),
        Markup.button.callback(`${current === 'Finance' ? '🔘 ' : '⚪ '}Finance`, 'set_suffix_Finance')
      ],
      [
        Markup.button.callback(`${current === 'Coin' ? '🔘 ' : '⚪ '}Coin`, 'set_suffix_Coin'),
        Markup.button.callback(`${current === 'AI' ? '🔘 ' : '⚪ '}AI`, 'set_suffix_AI')
      ],
      [
        Markup.button.callback(`${current === 'Meme' ? '🔘 ' : '⚪ '}Meme`, 'set_suffix_Meme'),
        Markup.button.callback(`${isNone ? '🔘 ' : '⚪ '}Tanpa Suffix (1x)`, 'set_suffix_NONE')
      ],
      [
        Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')
      ]
    ]));
  }

  async sendIntervalSelection(ctx) {
    const current = storage.getIntervalMinutes();
    const label = current >= 60 ? `${current / 60} Jam` : `${current} Menit`;
    const msg = 
`⏱️ <b>PENGATURAN DURASI AUTO-DEPLOY</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Durasi Saat Ini: <b>Setiap ${label}</b>

Pilih frekuensi otomatisasi pengecekan dan auto-deploy token trending baru:`;

    await ctx.replyWithHTML(msg, Markup.inlineKeyboard([
      [
        Markup.button.callback(`${current === 15 ? '🔘 ' : '⚪ '}15 Menit`, 'set_interval_15'),
        Markup.button.callback(`${current === 30 ? '🔘 ' : '⚪ '}30 Menit`, 'set_interval_30')
      ],
      [
        Markup.button.callback(`${current === 60 ? '🔘 ' : '⚪ '}1 Jam`, 'set_interval_60'),
        Markup.button.callback(`${current === 120 ? '🔘 ' : '⚪ '}2 Jam`, 'set_interval_120')
      ],
      [
        Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')
      ]
    ]));
  }

  async sendActiveTokensMessage(ctx) {
    await ctx.reply('🔍 Memeriksa likuiditas realtime dan status pembeli token yang telah dideploy...');
    const activeTokens = await vestingMonitor.getActiveTokensList();

    if (!activeTokens || activeTokens.length === 0) {
      return ctx.replyWithHTML(
`💎 <b>STATUS TOKEN AKTIF (LP &gt; $1 / VOL &gt; $5)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Belum ada token yang memiliki likuiditas pool di atas $1 atau volume trading di atas $5.

<i>Bot otomatis memantau setiap token dan akan mengirimkan notifikasi instan saat volume perdagangan menembus $5 atau LP di atas $1 dengan pembeli aktif!</i>`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Cek Ulang', 'cmd_active_tokens')],
          [Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')]
        ])
      );
    }

    let msg = 
`💎 <b>DAFTAR TOKEN AKTIF (LP &gt; $1 / VOL &gt; $5)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Ditemukan <b>${activeTokens.length} Token</b> dengan aktivitas likuiditas/volume aktif:

`;

    for (const t of activeTokens) {
      msg += `🪙 <b>${escapeHtml(t.name)}</b> (<code>$${escapeHtml(t.symbol)}</code>)\n`;
      msg += `• Likuiditas LP: <b>$${t.liquidityUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>\n`;
      msg += `• Volume 24 Jam: <b>$${Number(t.volume24h).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b> ${t.volume24h >= 5.0 ? '🔥 (&gt; $5)' : ''}\n`;
      msg += `• Pembeli: <b>${t.buysCount} Transaksi Beli</b>\n`;
      msg += `• Harga: <code>$${parseFloat(t.priceUsd).toFixed(6)}</code>\n`;
      msg += `• <a href="${t.basescanUrl}">BaseScan</a> | <a href="${t.dexscreenerUrl}">DexScreener</a> | <a href="${t.clankerUrl}">Clanker</a>\n\n`;
    }

    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n<i>Data likuiditas dan volume sinkron secara realtime dari DexScreener Base.</i>`;

    await ctx.replyWithHTML(msg, {
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh Data', 'cmd_active_tokens')],
        [Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')]
      ])
    });
  }

  async sendHistoryMessage(ctx) {
    const history = storage.getDeployedTokens().slice(0, 8);
    if (history.length === 0) {
      return ctx.reply('Belum ada token yang dideploy.');
    }

    let msg = `📜 <b>RIWAYAT DEPLOY TERAKHIR (${history.length} Token):</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    for (const item of history) {
      msg += `• <b>${escapeHtml(item.name)}</b> (<code>$${escapeHtml(item.symbol)}</code>)\n`;
      msg += `  Contract: <code>${item.tokenAddress}</code>\n`;
      msg += `  <a href="${item.basescanUrl}">BaseScan</a> | <a href="${item.dexscreenerUrl}">DexScreener</a> | <a href="${item.clankerUrl}">Clanker</a>\n\n`;
    }

    await ctx.replyWithHTML(msg, {
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')]
      ])
    });
  }

  async sendTrendingMenu(ctx) {
    const msg = 
`🔥 <b>PILIH SUMBER &amp; JARINGAN TRENDING TOKENS (ALL PLATFORMS)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Pilih kategori platform dan jaringan untuk melihat token viral yang siap dideploy ke <b>Base via Clanker</b>:

🌐 <b>1. Semua Trending:</b> Agregasi cerdas multi-platform (OKX, Clanker, Koin Baru Fresh, Elysium, Robinhood, ARC, DexScreener, Solana, Base, ETH, BSC)
🔥 <b>2. OKX Hot Tokens:</b> Token paling hot di OKX Web3 (Trending by Token Score & X Social Hype + Top Gainers)
⭐ <b>3. Koin Baru Exposure Tinggi:</b> Token baru rilis (&lt; 72 jam) dengan volume &amp; transaksi masif dari jaringan manapun
🪐 <b>4. Elysium Network:</b> Token viral & volume masif di jaringan Elysium (EVM L1 / Boxa DEX & Uniswap v4)
🏹 <b>5. Robinhood Network:</b> Token trending di jaringan L2 Robinhood (Arbitrum Orbit / Uniswap v3)
⚡ <b>6. ARC Network:</b> Token trending di ekosistem ARC (Circle EVM Layer-1)
🤖 <b>7. Clanker.world Top Trending Now:</b> Token teratas berdasarkan volume 24j & transaksi on-chain di Clanker.world
🦅 <b>8. DexScreener Trending All-Chain:</b> Token viral multi-chain real-time (Solana, Base, Ethereum, BSC, Arbitrum, dll.)
🔵 <b>9. Base Network:</b> GeckoTerminal Base trending pools
💊 <b>10. Pump.fun (Solana):</b> Meme coins viral di Pump.fun / Solana
🦎 <b>11. CoinGecko Global:</b> Trending search & coins global (Robinhood/Top Gainers)
🚀 <b>12. FOMO Top Boosts:</b> DexScreener boosted tokens lintas chain
🆕 <b>13. DexScreener New Pairs:</b> Pasangan baru Base dengan profil lengkap (profile=1)
💎 <b>14. Ethereum (ETH):</b> GeckoTerminal Ethereum trending pools
🟡 <b>15. BSC (Binance):</b> GeckoTerminal Binance Smart Chain trending
🦄 <b>16. Multi-DEX (Uniswap/Raydium):</b> Top DEX trending multi-platform

👇 <i>Klik kategori pilihan Anda:</i>`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🌐 🔥 Semua Trending (All-in-One)', 'cmd_trending_all'),
        Markup.button.callback('🔥 OKX Hot Tokens', 'cmd_trending_okx')
      ],
      [
        Markup.button.callback('🔥 Koin Baru Exposure Tinggi', 'cmd_trending_fresh'),
        Markup.button.callback('🪐 Elysium Network', 'cmd_trending_elysium')
      ],
      [
        Markup.button.callback('🏹 Robinhood Network', 'cmd_trending_rh'),
        Markup.button.callback('⚡ ARC Network', 'cmd_trending_arc')
      ],
      [
        Markup.button.callback('🤖 Clanker.world Top Trending', 'cmd_trending_clanker'),
        Markup.button.callback('🦅 DexScreener All-Chain', 'cmd_trending_dxall')
      ],
      [
        Markup.button.callback('🔵 Base Trending', 'cmd_trending_base'),
        Markup.button.callback('💊 Pump.fun (Solana)', 'cmd_trending_pump')
      ],
      [
        Markup.button.callback('🦎 CoinGecko Global', 'cmd_trending_cg'),
        Markup.button.callback('🚀 FOMO Top Boosts', 'cmd_trending_fomo')
      ],
      [
        Markup.button.callback('🆕 DexScreener New Pairs', 'cmd_trending_dxnew'),
        Markup.button.callback('🟣 Solana (Gecko)', 'cmd_trending_solana')
      ],
      [
        Markup.button.callback('💎 Ethereum (ETH)', 'cmd_trending_eth'),
        Markup.button.callback('🟡 BSC (Binance)', 'cmd_trending_bsc')
      ],
      [
        Markup.button.callback('🦄 Multi-DEX (Uni/Raydium)', 'cmd_trending_multidex'),
        Markup.button.callback('⬅️ Dashboard', 'cmd_start_menu')
      ]
    ]);

    try {
      await ctx.replyWithHTML(msg, keyboard);
    } catch (e) {
      console.warn('sendTrendingMenu replyWithHTML fallback:', e.message);
      await ctx.reply(msg.replace(/<[^>]+>/g, ''), keyboard);
    }
  }

  async sendTrendingList(ctx, category = 'all') {
    const labels = {
      all: '🌐 Semua Multi-Chain & Platform',
      okx: '🔥 OKX Hot Tokens (Web3 & Social Hype)',
      okxhot: '🔥 OKX Hot Tokens (Web3 & Social Hype)',
      fresh: '🔥 Koin Baru Exposure Tinggi (All-Chain Fresh & High Volume)',
      freshexp: '🔥 Koin Baru Exposure Tinggi (All-Chain Fresh & High Volume)',
      elysium: '🪐 DexScreener & GeckoTerminal (Elysium Network)',
      elys: '🪐 DexScreener & GeckoTerminal (Elysium Network)',
      robinhood: '🏹 GeckoTerminal & DexScreener (Robinhood L2)',
      rh: '🏹 GeckoTerminal & DexScreener (Robinhood L2)',
      arc: '⚡ GeckoTerminal & DexScreener (ARC Network)',
      clanker: '🤖 Clanker.world Top Trending Now',
      dxall: '🦅 DexScreener Trending All-Chain (Lintas Jaringan)',
      base: '🔵 GeckoTerminal (Base)',
      pump: '💊 Pump.fun & Solana Meme',
      coingecko: '🦎 CoinGecko Global Trending',
      fomo: '🚀 DexScreener FOMO Boosts',
      dxnew: '🆕 DexScreener New Pairs (Base)',
      solana: '🟣 GeckoTerminal (Solana)',
      eth: '💎 GeckoTerminal (Ethereum)',
      bsc: '🟡 GeckoTerminal (Binance Smart Chain)',
      multidex: '🦄 Multi-DEX Trending (Uniswap/Raydium)'
    };

    try {
      await ctx.reply(`🔍 Mengambil data token trending [${labels[category] || category}]...`);

      let tokens = [];
      if (category === 'okx' || category === 'okxhot') {
        tokens = await trendingService.getOkxHotTokens();
      } else if (category === 'elysium' || category === 'elys') {
        tokens = await trendingService.getElysiumTrending();
      } else if (category === 'robinhood' || category === 'rh') {
        tokens = await trendingService.getRobinhoodTrending();
      } else if (category === 'arc') {
        tokens = await trendingService.getArcTrending();
      } else if (category === 'fresh' || category === 'freshexp') {
        tokens = await trendingService.getFreshHighExposureTrending();
      } else if (category === 'clanker') {
        tokens = await trendingService.getClankerWorldTrending();
      } else if (category === 'dxall') {
        tokens = await trendingService.getDexScreenerAllChainTrending();
      } else if (category === 'base') {
        tokens = await trendingService.getGeckoTerminalTrending('base');
      } else if (category === 'pump') {
        tokens = await trendingService.getPumpFunTrending();
      } else if (category === 'coingecko') {
        tokens = await trendingService.getCoinGeckoTrending();
      } else if (category === 'fomo') {
        tokens = await trendingService.getFomoBoostedTrending();
      } else if (category === 'dxnew') {
        tokens = await trendingService.getDexScreenerNewPairsBase();
      } else if (category === 'solana') {
        tokens = await trendingService.getGeckoTerminalTrending('solana');
      } else if (category === 'eth') {
        tokens = await trendingService.getEthBscTrending('eth');
      } else if (category === 'bsc') {
        tokens = await trendingService.getEthBscTrending('bsc');
      } else if (category === 'multidex') {
        tokens = await trendingService.getMultiPlatformDexTrending();
      } else {
        tokens = await trendingService.getAllTrendingTokens();
      }

      if (!tokens || tokens.length === 0) {
        return ctx.replyWithHTML(
          `⚠️ Tidak ada token trending yang ditemukan untuk kategori <b>${labels[category] || category}</b> saat ini.`,
          Markup.inlineKeyboard([
            [Markup.button.callback('📑 Pilih Kategori Lain', 'cmd_trending_menu')],
            [Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')]
          ])
        );
      }

      this.trendingCache = tokens.slice(0, 6);

      await ctx.replyWithHTML(`🔥 <b>TOP TRENDING TOKENS [${labels[category] || category}]:</b>`);

      for (const [index, token] of this.trendingCache.entries()) {
        let caption = 
`#${index + 1} 🪙 <b>${escapeHtml(token.name)}</b> (<code>$${escapeHtml(token.symbol)}</code>)
━━━━━━━━━━━━━━━━━━━━━━━━━━
• Sumber: <b>${escapeHtml(token.sourceType)}</b>
• Network Asal: <b>${escapeHtml(token.sourceNetwork)}</b>`;

        if (token.age) {
          caption += `\n• Umur Token: <b>${escapeHtml(token.age)}</b>`;
        }
        if (token.totalTxns) {
          caption += `\n• Total Transaksi: <b>${Number(token.totalTxns).toLocaleString()} txns</b>`;
        }

        const priceNum = parseFloat(token.priceUsd) || 0;
        const priceStr = priceNum < 0.000001 ? priceNum.toExponential(4) : priceNum.toFixed(6);
        const volNum = parseFloat(token.volume24h) || 0;

        caption += `
• Harga: <b>$${priceStr}</b>
• Volume: <b>$${volNum.toLocaleString()}</b>
• Pool: <code>${escapeHtml(token.poolName)}</code>
• Link Asal: <a href="${escapeHtml(token.sourceUrl)}">Info Pool / Token</a>`;

        const buttons = [];
        if (category === 'elysium' || category === 'elys' || token.sourceNetwork?.toLowerCase() === 'elysium') {
          buttons.push([Markup.button.callback(`🪐 Deploy ke Elysium Mainnet`, `d_elys_${index}`)]);
          buttons.push([
            Markup.button.callback(`⚡ Deploy Mandiri (Base)`, `d_basedir_${index}`),
            Markup.button.callback(`🚀 Clanker (Base)`, `d_idx_${index}`)
          ]);
        } else {
          buttons.push([
            Markup.button.callback(`⚡ Deploy Mandiri (Base)`, `d_basedir_${index}`),
            Markup.button.callback(`🚀 Clanker (Base)`, `d_idx_${index}`)
          ]);
          buttons.push([
            Markup.button.callback(`🪐 Deploy ke Elysium`, `d_elys_${index}`)
          ]);
        }

        try {
          if (token.imageUrl && token.imageUrl.startsWith('http')) {
            await ctx.replyWithPhoto(token.imageUrl, {
              caption,
              parse_mode: 'HTML',
              ...Markup.inlineKeyboard(buttons)
            });
          } else {
            await ctx.replyWithHTML(caption, Markup.inlineKeyboard(buttons));
          }
        } catch (e) {
          try {
            await ctx.replyWithHTML(caption, Markup.inlineKeyboard(buttons));
          } catch (e2) {
            const plain = `#${index + 1} 🪙 ${token.name} ($${token.symbol})\n• Sumber: ${token.sourceType}\n• Jaringan: ${token.sourceNetwork}\n• Harga: $${priceStr}\n• Volume: $${volNum.toLocaleString()}\n• Info: ${token.sourceUrl}`;
            await ctx.reply(plain, Markup.inlineKeyboard(buttons));
          }
        }
      }

      const refreshKey = category === 'coingecko' ? 'cg' : (category === 'robinhood' ? 'rh' : (category === 'freshexp' ? 'fresh' : (category === 'elysium' || category === 'elys' ? 'elysium' : category)));

      await ctx.replyWithHTML(
        '👇 <i>Pilih token di atas untuk deploy ke Base, atau ganti kategori:</i>',
        Markup.inlineKeyboard([
          [
            Markup.button.callback('📑 Pilih Kategori Lain', 'cmd_trending_menu'),
            Markup.button.callback('🔄 Refresh', `cmd_trending_${refreshKey}`)
          ],
          [Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')]
        ])
      );
    } catch (err) {
      console.error(`Error in sendTrendingList [${category}]:`, err.message);
      await ctx.replyWithHTML(
        `⚠️ <b>Gagal memuat kategori [${labels[category] || category}]:</b> ${escapeHtml(err.message)}\nSilakan coba lagi atau pilih kategori lain.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('📑 Pilih Kategori Lain', 'cmd_trending_menu')],
          [Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')]
        ])
      );
    }
  }

  async sendBatchDeploymentSummary(ctx, results) {
    let summary = `🎉 <b>HASIL DEPLOYMENT CLANKER (BATCH 2X):</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    for (const res of results) {
      if (res.success) {
        summary += `✅ <b>[${res.index}] ${escapeHtml(res.targetName)}</b> (<code>$${escapeHtml(res.targetSymbol)}</code>)\n`;
        summary += `• Mode: ${res.simulated ? '🧪 Simulasi' : '⚡ Sukses On-Chain'}\n`;
        summary += `• Biaya Dev Buy: <code>${config.devBuyEth} ETH</code>\n`;
        summary += `• Contract: <code>${res.tokenAddress}</code>\n`;
        summary += `• TxHash: <code>${res.txHash}</code>\n`;
        summary += `• <a href="${res.basescanUrl}">BaseScan</a> | <a href="${res.dexscreenerUrl}">DexScreener</a> | <a href="${res.clankerUrl}">Clanker</a>\n\n`;
      } else {
        summary += `❌ <b>[${res.index}] ${escapeHtml(res.targetName)}</b>: Gagal (${escapeHtml(res.error)})\n\n`;
      }
    }
    summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━\nToken siap diperdagangkan di Uniswap v4 Base!`;
    await ctx.replyWithHTML(summary, {
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')]
      ])
    });
  }

  /**
   * Mengirim ringkasan deploy manual ke SEMUA wallet sekaligus
   */
  async sendManualMultiWalletDeploySummary(ctx, token, results) {
    let summary = `🎉 <b>HASIL DEPLOY MANUAL SEMUA WALLET (BASE)</b>\n`;
    summary += `🪙 Token: <b>${escapeHtml(token.name)}</b> (<code>$${escapeHtml(token.symbol)}</code>)\n`;
    summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const res of results) {
      const tag = res.walletName || `Wallet ${res.walletIndex}`;
      const roundTag = res.round > 1 ? ` (Batch ke-${res.round})` : '';

      if (res.success) {
        summary += `✅ <b>${tag}${roundTag}:</b> <b>${escapeHtml(res.targetName)}</b>\n`;
        summary += `• Mode: ${res.simulated ? '🧪 Simulasi (Tanpa Key)' : '⚡ On-Chain Sukses'}\n`;
        summary += `• Deployer: <code>${res.walletAddress}</code>\n`;
        summary += `• Contract: <code>${res.tokenAddress}</code>\n`;
        summary += `• <a href="${res.basescanUrl}">BaseScan</a> | <a href="${res.dexscreenerUrl}">DexScreener</a> | <a href="${res.clankerUrl}">Clanker</a>\n\n`;
      } else {
        summary += `❌ <b>${tag}${roundTag}:</b> Gagal - <i>${escapeHtml(res.error || 'Unknown error')}</i>\n\n`;
      }
    }

    summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ Semua wallet telah selesai mengeksekusi deployment!`;

    await ctx.replyWithHTML(summary, {
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard([
        [Markup.button.callback('👛 Kelola 3 Wallet', 'cmd_wallets_menu')],
        [Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')]
      ])
    });
  }

  /**
   * Mengirimkan penjelasan rinci saat terjadi kendala / error deploy ke Telegram
   */
  async sendDetailedErrorReport({ action, targetName, targetSymbol, errorMessage, recommendation, nextAction }) {
    if (!config.telegramChatId || !this.bot) return;

    let friendlyExplanation = 'Terjadi kendala teknis saat memproses transaksi on-chain atau komunikasi API.';
    const lowerErr = (errorMessage || '').toLowerCase();

    if (lowerErr.includes('insufficient funds') || lowerErr.includes('exceeds balance') || lowerErr.includes('gas * price + value')) {
      friendlyExplanation = '<b>Saldo ETH Kurang:</b> Saldo ETH di wallet deployer tidak mencukupi untuk membayar biaya gas transaksi atau dev buy di Base network.';
      if (!recommendation) recommendation = 'Segera isi sedikit saldo ETH ke wallet deployer di jaringan Base agar auto-deploy dapat terus berjalan lancar.';
    } else if (lowerErr.includes('pool already exists') || lowerErr.includes('pair exists') || lowerErr.includes('already deployed') || lowerErr.includes('transfer_failed')) {
      friendlyExplanation = '<b>Duplikasi Pool/Token:</b> Pool Uniswap v4 atau token dengan parameter/ticker ini sudah terdaftar on-chain di Base.';
      if (!recommendation) recommendation = 'Bot otomatis mencari kandidat token lain yang belum terdaftar agar target deploy per jam terpenuhi.';
    } else if (lowerErr.includes('timeout') || lowerErr.includes('econnreset') || lowerErr.includes('etimedout') || lowerErr.includes('fetch failed')) {
      friendlyExplanation = '<b>Koneksi RPC/API Lambat:</b> Terjadi time out saat menghubungi node RPC Base atau server sumber data.';
      if (!recommendation) recommendation = 'Koneksi jaringan Base sedang padat, bot otomatis beralih ke kandidat berikutnya atau mengulang dengan RPC cadangan.';
    } else if (lowerErr.includes('429') || lowerErr.includes('rate limit')) {
      friendlyExplanation = '<b>Rate Limit API:</b> Terlalu banyak permintaan API ke penyedia data dalam waktu singkat.';
      if (!recommendation) recommendation = 'Bot otomatis menggunakan data cache dan mencoba sumber alternatif.';
    } else if (lowerErr.includes('pinata') || lowerErr.includes('ipfs')) {
      friendlyExplanation = '<b>Gagal Upload Logo IPFS:</b> Upload gambar/logo ke Pinata IPFS mengalami penolakan/kendala.';
      if (!recommendation) recommendation = 'Bot otomatis menggunakan link gambar publik cadangan agar transaksi deploy tetap dapat dilanjutkan.';
    } else if (lowerErr.includes('simulation failed') || lowerErr.includes('execution reverted')) {
      friendlyExplanation = '<b>Simulasi Transaksi Ditolak:</b> Smart contract Clanker menolak transaksi pada tahap pra-eksekusi.';
      if (!recommendation) recommendation = 'Parameter transaksi disesuaikan otomatis dan bot beralih ke kandidat token berikutnya.';
    }

    const message = 
`🚨 <b>LAPORAN DETAIL KENDALA / ERROR SISTEM</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 <b>Aktivitas:</b> ${escapeHtml(action || 'Auto-Deploy On-Chain')}
${targetName ? `🪙 <b>Target Token:</b> <b>${escapeHtml(targetName)}</b> (<code>$${escapeHtml(targetSymbol || 'UNKNOWN')}</code>)\n` : ''}⚠️ <b>Penjelasan Analitis:</b>
${friendlyExplanation}

🔍 <b>Pesan Error Teknis:</b>
<code>${escapeHtml((errorMessage || 'Unknown Error').substring(0, 300))}</code>

💡 <b>Tindakan Otomatis Bot:</b>
${nextAction ? `• ${nextAction}` : '• Melewati kandidat ini dan langsung mencari kandidat baru potensial agar target wajib 1 token/jam tetap terpenuhi.'}
${recommendation ? `\n📌 <b>Saran:</b> <i>${escapeHtml(recommendation)}</i>` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    try {
      await this.bot.telegram.sendMessage(config.telegramChatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
    } catch (e) {
      console.error('Failed to send error notification to Telegram:', e.message);
    }
  }

  // Background poller for auto-deploying new trending tokens (Wajib minimal 1 token per jam)
  startBackgroundPoller(overrideMinutes) {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    const minutes = overrideMinutes || storage.getIntervalMinutes();
    const intervalMs = Math.max(minutes * 60 * 1000, 60000);
    const label = minutes >= 60 ? `${minutes / 60} Jam` : `${minutes} Menit`;
    console.log(`[AutoDeploy Poller] Started. Checking multi-chain trending (Clanker, Fresh High-Exposure, Elysium, Robinhood, ARC, Base, Solana, Pump.fun, CoinGecko, FOMO) every ${label} (${intervalMs / 1000}s)...`);

    this.pollingInterval = setInterval(async () => {
      try {
        const state = storage.getState();
        if (!state.autoDeploy) return;
        if (this.isProcessingCandidate) return;

        this.isProcessingCandidate = true;

        // 1. Dapatkan daftar wallet yang aktif & terkonfigurasi
        const activeWallets = clankerService.getActiveWallets();
        if (!activeWallets || activeWallets.length === 0) {
          console.warn('[AutoDeploy Poller] Tidak ada wallet yang aktif.');
          return;
        }

        // 2. Cek saldo masing-masing wallet yang siap deploy
        const readyWallets = [];
        for (const w of activeWallets) {
          const wInfo = await clankerService.getWalletInfo(w.id);
          const bal = parseFloat(wInfo.balanceEth) || 0;
          if (!config.dryRun && w.hasKey && bal < 0.00005) {
            await this.sendDetailedErrorReport({
              action: `Pemeriksaan Saldo ${w.name}`,
              errorMessage: `Saldo ETH Base tidak mencukupi: ${wInfo.balanceEth} ETH (Dibutuhkan minimal ~0.0001 ETH untuk dev buy + gas)`,
              recommendation: `Kirim sedikit ETH ke alamat: ${wInfo.address}`,
              nextAction: 'Wallet ini dilewati sementara untuk siklus ini.'
            });
          } else {
            readyWallets.push(w);
          }
        }

        if (readyWallets.length === 0) {
          console.warn('[AutoDeploy Poller] Semua wallet memiliki saldo di bawah batas aman.');
          return;
        }

        // 3. Ambil kandidat token hype BERBEDA sejumlah wallet yang siap deploy
        // Radar mencakup OKX Hot Tokens, Clanker, DexScreener, GeckoTerminal, Pump.fun
        let distinctCandidates = [];
        try {
          distinctCandidates = await trendingService.getDistinctNewCandidates(readyWallets.length);
        } catch (fetchErr) {
          console.error('[AutoDeploy Poller] Error getting distinct candidates:', fetchErr);
        }

        if (!distinctCandidates || distinctCandidates.length === 0) {
          await this.sendDetailedErrorReport({
            action: 'Scanning Radar Multi-Chain & OKX Hot Tokens',
            errorMessage: 'Tidak ada kandidat token baru yang ditemukan dari seluruh platform.',
            nextAction: 'Bot akan mencoba kembali pada jadwal pemeriksaan berikutnya.'
          });
          return;
        }

        // 4. Notifikasi Telegram tentang rencana deploy simultan 3 wallet
        if (config.telegramChatId && this.bot) {
          let notice = `⚡ <b>AUTODEPLOY SIMULTAN (${readyWallets.length} WALLET BERBEDA)</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          notice += `Radar hype mendeteksi token potensial berbeda untuk masing-masing wallet:\n\n`;
          for (let i = 0; i < readyWallets.length; i++) {
            const w = readyWallets[i];
            const cand = distinctCandidates[i];
            if (cand) {
              notice += `👛 <b>${w.name}:</b> <b>${escapeHtml(cand.name)}</b> (<code>$${escapeHtml(cand.symbol)}</code>)\n`;
              notice += `  • Sumber: <b>${escapeHtml(cand.sourceType)}</b> (${cand.sourceNetwork}) | Vol: $${Number(cand.volume24h).toLocaleString()}\n`;
            }
          }
          notice += `\n⏳ <i>Mengeksekusi deploy bersamaan ke Base Layer 2 via Clanker v4...</i>`;
          await this.bot.telegram.sendMessage(config.telegramChatId, notice, { parse_mode: 'HTML' }).catch(() => {});
        }

        // 5. Eksekusi simultan deploy token berbeda di tiap wallet
        const results = await clankerService.deployMultiWalletSimultaneous(distinctCandidates);
        const hasSuccess = results && results.some(r => r.success);

        if (hasSuccess) {
          storage.incrementAutoDeployCount();

          if (config.telegramChatId && this.bot) {
            let summary = `🎉 <b>AUTO-DEPLOY SIMULTAN BERHASIL!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            for (const res of results) {
              if (res.success) {
                summary += `✅ <b>${res.walletName}:</b> <b>${escapeHtml(res.targetName)}</b> (<code>$${escapeHtml(res.targetSymbol)}</code>)\n`;
                summary += `• Deployer: <code>${res.walletAddress}</code>\n`;
                summary += `• Contract: <code>${res.tokenAddress}</code>\n`;
                summary += `• Links: <a href="${res.basescanUrl}">BaseScan</a> | <a href="${res.dexscreenerUrl}">DexScreener</a> | <a href="${res.clankerUrl}">Clanker</a>\n\n`;
              } else {
                summary += `⚠️ <b>${res.walletName}:</b> Gagal - <i>${escapeHtml(res.error || 'Unknown error')}</i>\n\n`;
              }
            }
            await this.bot.telegram.sendMessage(config.telegramChatId, summary, {
              parse_mode: 'HTML',
              disable_web_page_preview: true
            }).catch(() => {});
          }
        } else {
          const firstErr = results[0]?.error || 'Simulasi atau transaksi ditolak';
          await this.sendDetailedErrorReport({
            action: 'Auto-Deploy Simultan Multi-Wallet',
            errorMessage: firstErr,
            nextAction: 'Bot akan mengulang kembali pada siklus auto-deploy berikutnya.'
          });
        }
      } catch (err) {
        console.error('[AutoDeploy Poller Error]:', err);
        await this.sendDetailedErrorReport({
          action: 'Siklus Auto-Deploy Rutin',
          errorMessage: err.message || String(err),
          recommendation: 'Sistem mengalami kendala tak terduga. Bot akan mencoba me-recover pada siklus selanjutnya.',
          nextAction: 'Melakukan log error dan mereset status poller.'
        });
      } finally {
        this.isProcessingCandidate = false;
      }
    }, intervalMs);
  }

  // ==========================================
  // MULTI-WALLET MANAGEMENT HELPERS & VIEWS
  // ==========================================

  async sendWalletsMenu(ctx) {
    const wallets = await clankerService.getAllWalletsInfo();
    const walletMode = storage.getAutoDeployWalletMode();
    const modeLabel = walletMode === 'primary_only' ? '👤 Hanya Wallet Utama (W1)' : (walletMode === 'all_wallets' ? '👥 Semua 3 Wallet (Simultan)' : '⚙️ Kustom');

    let msg = `👛 <b>PUSAT KONTROL &amp; PENGATURAN 3 WALLET TERPISAH</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🎯 <b>Target Auto-Deploy Saat Ini:</b> <b>${modeLabel}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Kelola dan atur masing-masing dari 3 wallet secara mandiri. Setiap wallet mendeploy token berbeda secara simultan di Base!\n\n`;

    for (const w of wallets) {
      const isPrimary = w.id === 1;
      const statusKey = w.hasWallet ? '✅ Terpasang' : '⚠️ Belum Dipasang';
      const autoTag = w.enabled ? '🟢 AKTIF' : '🔴 NONAKTIF';
      const deployed = storage.getDeployedTokensByWallet(w.id).length;

      msg += `👛 <b>${escapeHtml(w.name)} ${isPrimary ? '(Utama)' : ''}:</b>\n`;
      msg += `• Kunci: <b>${statusKey}</b>\n`;
      msg += `• Alamat: <code>${w.address}</code>\n`;
      msg += `• Saldo ETH: <b>${w.balanceEth} ETH</b>\n`;
      msg += `• Auto-Deploy: <b>${autoTag}</b> | Total Deploy: <b>${deployed} token</b>\n\n`;
    }

    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `👇 <i>Pilih menu di bawah:</i>`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('1️⃣ Atur Wallet 1 (Utama)', 'cmd_wallet_view_1'),
        Markup.button.callback('2️⃣ Atur Wallet 2', 'cmd_wallet_view_2')
      ],
      [
        Markup.button.callback('3️⃣ Atur Wallet 3', 'cmd_wallet_view_3'),
        Markup.button.callback('🚀 Deploy 3 Wallet Sekaligus', 'cmd_deploy_all_wallets')
      ],
      [
        Markup.button.callback(walletMode === 'all_wallets' ? '✅ 👥 Semua 3 Wallet' : '👥 Aktifkan Semua 3 Wallet', 'cmd_wallet_mode_all'),
        Markup.button.callback(walletMode === 'primary_only' ? '✅ 👤 Hanya Wallet Utama' : '👤 Hanya Wallet Utama', 'cmd_wallet_mode_primary')
      ],
      [
        Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')
      ]
    ]);

    await ctx.replyWithHTML(msg, keyboard);
  }

  async sendWalletDetail(ctx, walletIndex) {
    const idx = Number(walletIndex) || 1;
    const w = await clankerService.getWalletInfo(idx);
    const wConfig = storage.getWalletConfig(idx);
    const deployedTokens = storage.getDeployedTokensByWallet(idx);
    const isPrimary = idx === 1;

    let msg = `👛 <b>PENGATURAN TERPISAH: ${escapeHtml(w.name)}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `• Peran: <b>${isPrimary ? 'Wallet Utama (Primary)' : `Wallet Tambahan #${idx}`}</b>\n`;
    msg += `• Status Kunci: <b>${w.hasWallet ? '✅ Terkonfigurasi' : '⚠️ Belum Dipasang (Klik tombol di bawah)'}</b>\n`;
    msg += `• Alamat Base: <code>${w.address}</code>\n`;
    msg += `• Saldo Base ETH: <b>${w.balanceEth} ETH</b>\n`;
    msg += `• Auto-Deploy Wallet Ini: <b>${w.enabled ? '🟢 AKTIF (ON)' : '🔴 NONAKTIF (OFF)'}</b>\n`;
    msg += `• Dev Buy ETH: <code>${wConfig.devBuyEth || config.devBuyEth} ETH</code>\n`;
    msg += `• Buy & Sell Fee: <code>${wConfig.feePercent !== undefined ? wConfig.feePercent : storage.getFeePercent()}%</code>\n`;
    msg += `• Creator Vault: <code>${wConfig.vaultPercent || config.creatorVaultPercent}%</code>\n`;
    msg += `• Total Token Dideploy: <b>${deployedTokens.length} Token</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `👇 <i>Pilih aksi untuk ${w.name}:</i>`;

    const toggleText = w.enabled ? '🔴 Matikan Auto-Deploy' : '🟢 Aktifkan Auto-Deploy';

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(toggleText, `cmd_wallet_toggle_${idx}`),
        Markup.button.callback('🔑 Pasang / Ubah Key', `cmd_wallet_setkey_${idx}`)
      ],
      [
        Markup.button.callback(`📜 Riwayat Deploy (${deployedTokens.length})`, `cmd_wallet_hist_${idx}`),
        Markup.button.callback('⬅️ Kembali ke 3 Wallet', 'cmd_wallets_menu')
      ]
    ]);

    await ctx.replyWithHTML(msg, keyboard);
  }

  async sendWalletSetKeyPrompt(ctx, walletIndex) {
    const idx = Number(walletIndex) || 1;
    const msg = 
`🔑 <b>PANDUAN MEMASANG PRIVATE KEY WALLET ${idx}:</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Untuk memasang atau mengganti private key Wallet ${idx}, kirimkan pesan dengan format:

<code>/setkey${idx} &lt;0x_private_key_anda&gt;</code>

<b>Contoh:</b>
<code>/setkey${idx} 0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef</code>

🛡️ <b>JAMINAN KEAMANAN:</b>
<i>Bot akan secara otomatis MENGHAPUS (auto-delete) pesan Anda yang berisi private key seketika setelah diterima, sehingga kunci rahasia Anda tidak akan tertinggal di riwayat obrolan Telegram! Kunci disimpan aman pada konfigurasi bot.</i>`;

    await ctx.replyWithHTML(msg, Markup.inlineKeyboard([
      [Markup.button.callback(`⬅️ Kembali ke Wallet ${idx}`, `cmd_wallet_view_${idx}`)]
    ]));
  }

  async handleSetKeyCommand(ctx, walletIndex) {
    const idx = Number(walletIndex) || 1;
    const text = (ctx.message?.text || '').trim();
    const parts = text.split(/\s+/);
    const key = parts[1]?.trim();

    // Delete the incoming message immediately for user security!
    try {
      await ctx.deleteMessage().catch(() => {});
    } catch (e) {}

    if (!key || !key.startsWith('0x') || key.length !== 66) {
      return ctx.replyWithHTML(`⚠️ <b>Format Private Key tidak valid!</b>\nPrivate key harus diawali dengan <code>0x</code> dan memiliki panjang tepat 66 karakter heksadesimal.\n\nContoh: <code>/setkey${idx} 0x1234...</code>`);
    }

    try {
      storage.setWalletPrivateKey(idx, key);
      clankerService.reloadWallets();
      const wInfo = await clankerService.getWalletInfo(idx);

      await ctx.replyWithHTML(
        `✅ <b>BERHASIL! Private Key Wallet ${idx} Telah Dipasang!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `• Wallet: <b>${escapeHtml(wInfo.name)}</b>\n` +
        `• Alamat Base: <code>${wInfo.address}</code>\n` +
        `• Saldo Realtime: <b>${wInfo.balanceEth} ETH</b>\n` +
        `• Pesan Anda telah dihapus secara aman dari riwayat chat demi privasi.\n━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        Markup.inlineKeyboard([
          [Markup.button.callback(`⚙️ Buka Pengaturan Wallet ${idx}`, `cmd_wallet_view_${idx}`)],
          [Markup.button.callback('👛 Pusat 3 Wallet', 'cmd_wallets_menu')]
        ])
      );
    } catch (err) {
      console.error(`Error saving private key for wallet ${idx}:`, err);
      await ctx.replyWithHTML(`❌ <b>Gagal memasang private key:</b> ${escapeHtml(err.message)}`);
    }
  }

  async handleManualDeployWallet(ctx, walletIndex) {
    const idx = Number(walletIndex) || 1;
    const parts = (ctx.message?.text || '').split(' ').slice(1);
    if (parts.length < 2) {
      return ctx.replyWithHTML(
        `⚠️ <b>Format salah untuk Wallet ${idx}!</b>\n` +
        `Gunakan: <code>/deploy${idx} &lt;NamaToken&gt; &lt;Ticker&gt; [URL_Gambar]</code>\n` +
        `Contoh: <code>/deploy${idx} CyberCat CCAT https://example.com/cat.png</code>`
      );
    }

    const name = parts[0];
    const symbol = parts[1].toUpperCase();
    const imageUrl = parts[2] || '';

    await ctx.replyWithHTML(`🚀 Memulai deploy via <b>Wallet ${idx}</b> untuk <b>${escapeHtml(name)}</b> (<code>$${escapeHtml(symbol)}</code>)...\nHarap tunggu proses di Base network.`);

    const res = await clankerService.deployTokenForWallet({
      walletIndex: idx,
      name,
      symbol,
      imageUrl,
      poolAddress: `manual_deploy_w${idx}`
    });

    if (res.success) {
      let msg = `🎉 <b>DEPLOY VIA WALLET ${idx} BERHASIL!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `✅ <b>${escapeHtml(name)}</b> (<code>$${escapeHtml(symbol)}</code>)\n`;
      msg += `• Deployer: <code>${res.walletAddress}</code>\n`;
      msg += `• Contract: <code>${res.tokenAddress}</code>\n`;
      msg += `• Links: <a href="${res.basescanUrl}">BaseScan</a> | <a href="${res.dexscreenerUrl}">DexScreener</a> | <a href="${res.clankerUrl}">Clanker</a>\n`;
      await ctx.replyWithHTML(msg, { disable_web_page_preview: true });
    } else {
      await ctx.replyWithHTML(`❌ <b>Deploy via Wallet ${idx} gagal:</b> ${escapeHtml(res.error || 'Unknown error')}`);
    }
  }

  async handleSetRespanCommand(ctx) {
    const text = (ctx.message?.text || '').trim();
    const parts = text.split(/\s+/);
    const key = parts[1]?.trim();

    // Auto-delete user message containing the key immediately for security
    try {
      await ctx.deleteMessage().catch(() => {});
    } catch (e) {}

    if (!key) {
      const current = storage.getRespanApiKey();
      const masked = current ? `${current.slice(0, 6)}...${current.slice(-4)}` : 'Belum diatur';
      return ctx.replyWithHTML(
        `🔑 <b>KONFIGURASI RESPAN AI GATEWAY:</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `• Status API Key: <code>${masked}</code>\n` +
        `• Model Aktif: <code>${escapeHtml(storage.getRespanModel())}</code>\n` +
        `• Gateway URL: <code>${escapeHtml(config.respanGatewayUrl)}</code>\n\n` +
        `<i>Untuk memasang atau mengganti API Key, kirimkan:</i>\n` +
        `<code>/setrespan YOUR_RESPAN_API_KEY</code>\n\n` +
        `🛡️ <b>Keamanan Terjamin:</b> Pesan yang berisi API key Anda akan otomatis dihapus oleh bot seketika setelah diterima demi privasi.`
      );
    }

    try {
      storage.setRespanApiKey(key);
      const masked = `${key.slice(0, 6)}...${key.slice(-4)}`;
      await ctx.replyWithHTML(
        `✅ <b>RESPAN API KEY BERHASIL DISIMPAN!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `• API Key: <code>${masked}</code>\n` +
        `• Model: <code>${escapeHtml(storage.getRespanModel())}</code>\n` +
        `• Gateway: <code>${escapeHtml(config.respanGatewayUrl)}</code>\n\n` +
        `✨ Sekarang Anda dapat menggunakan:\n` +
        `• <code>/ai &lt;pertanyaan&gt;</code> - Tanya AI tentang crypto, DeFi, & analisis pasar\n` +
        `• <code>/aitoken [topik]</code> - Buat ide token memecoin viral otomatis\n` +
        `• Pesan Anda telah dihapus otomatis demi keamanan & privasi.`
      );
    } catch (err) {
      await ctx.reply(`❌ Gagal menyimpan API key: ${err.message}`);
    }
  }

  async handleSetModelCommand(ctx) {
    const text = (ctx.message?.text || '').trim();
    const parts = text.split(/\s+/).slice(1);
    if (parts.length > 0) {
      const newModel = parts[0].trim();
      const saved = storage.setRespanModel(newModel);
      await ctx.replyWithHTML(
        `✅ <b>Model Respan AI berhasil diubah!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `• Model Aktif: <code>${escapeHtml(saved)}</code>`
      );
    } else {
      const current = storage.getRespanModel();
      await ctx.replyWithHTML(
        `🤖 <b>PENGATURAN MODEL AI RESPAN:</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `• Model Aktif: <code>${escapeHtml(current)}</code>\n\n` +
        `<i>Format penggunaan:</i>\n` +
        `<code>/setmodel respan/gemini-4-carbon:free</code>`
      );
    }
  }

  async handleAskAI(ctx, prompt) {
    const statusMsg = await ctx.reply('🤖 <i>Sedang menganalisis & memproses via Respan Gemini 4 Carbon...</i>', { parse_mode: 'HTML' });
    try {
      const answer = await aiEngine.askAI(prompt);
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

      // Telegram limit is 4096 characters per message
      const maxLen = 4000;
      if (answer.length <= maxLen) {
        return await ctx.reply(answer);
      }

      let remaining = answer;
      while (remaining.length > 0) {
        if (remaining.length <= maxLen) {
          await ctx.reply(remaining);
          break;
        }
        let splitIdx = remaining.lastIndexOf('\n', maxLen);
        if (splitIdx === -1 || splitIdx < 1000) splitIdx = maxLen;
        await ctx.reply(remaining.substring(0, splitIdx));
        remaining = remaining.substring(splitIdx).trim();
      }
    } catch (err) {
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
      await ctx.replyWithHTML(
        `❌ <b>Respan AI Error:</b>\n<code>${escapeHtml(err.message)}</code>\n\n` +
        `<i>Pastikan RESPAN_API_KEY sudah dipasang via <code>/setrespan &lt;api_key&gt;</code>.</i>`
      );
    }
  }

  async handleAITokenCreation(ctx, topic = '') {
    const statusMsg = await ctx.reply('🎨 <i>AI sedang merancang konsep memecoin viral, ticker unik, dan narasi alpha via Respan Gemini 4 Carbon...</i>', { parse_mode: 'HTML' });
    try {
      const token = await aiEngine.generateMemeTokenWithAI(topic, 'ELYSIUM');
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

      this.latestAIToken = token;

      const caption = 
`💎 <b>KONSEP MEMECOIN HASIL KREASI AI (GEMINI 4 CARBON):</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
🪙 <b>Nama:</b> <code>${escapeHtml(token.name)}</code>
🏷️ <b>Ticker:</b> <code>$${escapeHtml(token.symbol)}</code>
🎭 <b>Tema / Kategori:</b> <i>${escapeHtml(token.theme || 'Viral Memecoin')}</i>
📝 <b>Narasi / Lore:</b>
<i>"${escapeHtml(token.description)}"</i>

💡 <i>Sumber: ${escapeHtml(token.sourceType)}</i>
━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 <b>Siap Dideploy Kapan Saja! Pilih Jaringan / Cara Deploy:</b>`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback(`🪐 Deploy ke Elysium (Uniswap V4)`, 'cmd_ai_deploy_elysium')
        ],
        [
          Markup.button.callback(`🔵 Deploy ke Base Mandiri (Uniswap V4)`, 'cmd_ai_deploy_base'),
          Markup.button.callback(`🚀 Deploy via Clanker (Base)`, 'cmd_ai_deploy_clanker')
        ],
        [
          Markup.button.callback('🎲 Buat Konsep AI Baru', 'cmd_ai_generate_new'),
          Markup.button.callback('⬅️ Menu AI', 'cmd_ai_menu')
        ]
      ]);

      await ctx.replyWithHTML(caption, keyboard);
    } catch (err) {
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
      await ctx.replyWithHTML(`❌ <b>Gagal membuat ide token AI:</b>\n<code>${escapeHtml(err.message)}</code>`);
    }
  }

  async sendWalletHistoryMessage(ctx, walletIndex) {
    const idx = Number(walletIndex) || 1;
    const history = storage.getDeployedTokensByWallet(idx).slice(0, 8);
    if (history.length === 0) {
      return ctx.replyWithHTML(
        `📜 Belum ada token yang dideploy oleh <b>Wallet ${idx}</b>.`,
        Markup.inlineKeyboard([
          [Markup.button.callback(`⬅️ Kembali ke Wallet ${idx}`, `cmd_wallet_view_${idx}`)]
        ])
      );
    }

    let msg = `📜 <b>RIWAYAT DEPLOY WALLET ${idx} (${history.length} Token):</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    for (const item of history) {
      msg += `• <b>${escapeHtml(item.name)}</b> (<code>$${escapeHtml(item.symbol)}</code>)\n`;
      msg += `  Contract: <code>${item.tokenAddress}</code>\n`;
      msg += `  <a href="${item.basescanUrl}">BaseScan</a> | <a href="${item.dexscreenerUrl}">DexScreener</a> | <a href="${item.clankerUrl}">Clanker</a>\n\n`;
    }

    await ctx.replyWithHTML(msg, {
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard([
        [Markup.button.callback(`⬅️ Kembali ke Wallet ${idx}`, `cmd_wallet_view_${idx}`)],
        [Markup.button.callback('👛 Pusat 3 Wallet', 'cmd_wallets_menu')]
      ])
    });
  }

  async executeDeployAllWallets(ctx) {
    try {
      await ctx.reply('🔍 Memindai radar token hype terlengkap (OKX, Clanker, DexScreener, GeckoTerminal) untuk 3 wallet...');
      const activeWallets = clankerService.getActiveWallets();
      if (!activeWallets || activeWallets.length === 0) {
        return ctx.reply('⚠️ Tidak ada wallet yang aktif atau memiliki private key.');
      }

      const gasInfo = await clankerService.getGasInfo();
      const distinctCandidates = await trendingService.getDistinctNewCandidates(activeWallets.length);

      let msg = `🚀 <b>MENGEKSEKUSI DEPLOY SIMULTAN (${activeWallets.length} WALLET SEKALIGUS)</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `⛽ Gas Base: <code>${gasInfo.gasPriceGwei} Gwei</code> (${gasInfo.recommendation})\n`;
      msg += `Masing-masing wallet mendeploy token BERBEDA dari radar hype:\n\n`;

      for (let i = 0; i < activeWallets.length; i++) {
        const w = activeWallets[i];
        const cand = distinctCandidates[i];
        if (cand) {
          msg += `👛 <b>${w.name}:</b> <b>${escapeHtml(cand.name)}</b> (<code>$${escapeHtml(cand.symbol)}</code>)\n`;
          msg += `  • Sumber: <i>${escapeHtml(cand.sourceType)}</i> (${cand.sourceNetwork})\n`;
        }
      }
      msg += `\n⏳ <i>Memproses transaksi simultan di Base Layer 2...</i>`;
      await ctx.replyWithHTML(msg);

      const results = await clankerService.deployMultiWalletSimultaneous(distinctCandidates);

      let summaryMsg = `🎉 <b>HASIL DEPLOY SIMULTAN MULTI-WALLET:</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      for (const res of results) {
        if (res.success) {
          summaryMsg += `✅ <b>${res.walletName}:</b> <b>${escapeHtml(res.targetName)}</b> (<code>$${escapeHtml(res.targetSymbol)}</code>)\n`;
          summaryMsg += `• Deployer: <code>${res.walletAddress}</code>\n`;
          summaryMsg += `• Contract: <code>${res.tokenAddress}</code>\n`;
          summaryMsg += `• Links: <a href="${res.basescanUrl}">BaseScan</a> | <a href="${res.dexscreenerUrl}">DexScreener</a> | <a href="${res.clankerUrl}">Clanker</a>\n\n`;
        } else {
          summaryMsg += `❌ <b>${res.walletName}:</b> Gagal - <i>${escapeHtml(res.error || 'Unknown error')}</i>\n\n`;
        }
      }

      await ctx.replyWithHTML(summaryMsg, {
        disable_web_page_preview: true,
        ...Markup.inlineKeyboard([
          [Markup.button.callback('👛 Kelola 3 Wallet', 'cmd_wallets_menu')],
          [Markup.button.callback('⬅️ Dashboard', 'cmd_start_menu')]
        ])
      });
    } catch (err) {
      console.error('Error in executeDeployAllWallets:', err);
      await ctx.replyWithHTML(`❌ <b>Gagal deploy simultan:</b> ${escapeHtml(err.message)}`);
    }
  }

  async sendElysiumMenu(ctx, isEdit = false) {
    const info = await elysiumService.getDeployerInfo();
    const deployedTokens = storage.getElysiumDeployedTokens();
    const totalCount = deployedTokens.length;
    const curLp = storage.getElysiumLpHype();
    const curDevBuy = storage.getElysiumDevBuyHype();
    const curPair = storage.getElysiumPairToken();
    const curDex = storage.getElysiumDexVersion().toUpperCase();
    const curBuyFee = storage.getElysiumBuyFee();
    const curSellFee = storage.getElysiumSellFee();
    const devBuyText = curDevBuy > 0 ? `<b>${curDevBuy} HYPE</b>` : '🔴 <i>Nonaktif (0 HYPE)</i>';

    const addrDisplay = info.address ? `<code>${info.address}</code>` : '⚠️ Belum dikonfigurasi';
    const balanceHypeDisplay = info.balanceHype !== 'Error RPC' ? `<b>${parseFloat(info.balanceHype).toFixed(6)} HYPE</b>` : '⚠️ Gagal cek saldo';
    const balanceUsdcDisplay = `<b>${parseFloat(info.balanceUsdc || 0).toFixed(4)} USDC</b>`;
    const gasDisplay = `<code>${info.gasPriceGwei} Gwei</code>`;

    const dexBadge = curDex === 'V4' ? '✨ <b>Uniswap V4 (Standar Utama & Aktif)</b>' : (curDex === 'V3' ? '🦄 <b>Uniswap V3</b>' : '🥞 <b>Uniswap V2</b>');
    const pairBadge = curPair === 'USDC' ? '💵 <b>TOKEN / USDC (Stablecoin)</b>' : (curPair === 'WETH' ? '📦 <b>TOKEN / WETH (Wrapped)</b>' : (curPair === 'ETH' ? '⚡ <b>TOKEN / ETH (Native)</b>' : '💎 <b>TOKEN / HYPE (Gas Native)</b>'));

    const msg = 
`🪐 <b>ELYSIUM LAUNCHPAD &amp; RADAR HUB (CHAIN ID 99901)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Selamat datang di pusat deploy &amp; monitoring Elysium Mainnet (HyperEVM L2)!

👛 <b>INFO DEPLOYER WALLET:</b>
• Alamat: ${addrDisplay}
• Saldo Gas (HYPE): ${balanceHypeDisplay}
• Saldo USDC: ${balanceUsdcDisplay}
• Estimasi Gas: ${gasDisplay}
• PoolManager V4: <code>${info.v4PoolManager || '0xE2e1...'}</code>
• Position Manager V4: <code>${info.v4PositionManager || '0x1d1C...'}</code>
• Universal Router: <code>${info.universalRouter || '0xA13f...'}</code>

⚙️ <b>SETTING TRADING &amp; LIQUIDITY:</b>
• DEX Engine: ${dexBadge}
• Trading Pair: ${pairBadge}
• Likuiditas Pool (LP): <b>${curLp} HYPE / Quote</b> (0.0001 - 0.0002)
• Dev Buy Otomatis: ${devBuyText}
• Fee Buy &amp; Sell: <b>${curBuyFee}% Buy / ${curSellFee}% Sell</b> (% dari total transaksi USD)
• Penerimaan Fee: <b>⚡ Koin HYPE Asli</b> (Auto Swap-Back ke HYPE)
• Proteksi Default: <b>Anti-Sniper 80% Buy Tax (30 Menit)</b>
• Verifikasi Explorer: <b>100% Otomatis di Elyscan</b>
• Total Token Dideploy: <b>${totalCount} token</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
👇 <i>Pilih aksi di bawah:</i>`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🚀 Deploy Token Baru ke Elysium', 'cmd_elysium_deploy_menu'),
        Markup.button.callback('🔥 Trending Elysium DEX', 'cmd_trending_elysium')
      ],
      [
        Markup.button.callback(`🔄 Pair: ${curPair}`, 'cmd_elysium_pair_menu'),
        Markup.button.callback(`✨ DEX: Uniswap ${curDex}`, 'cmd_elysium_dex_menu')
      ],
      [
        Markup.button.callback(`🏷️ Atur Fee (${curBuyFee}% / ${curSellFee}%)`, 'cmd_elysium_fee_menu'),
        Markup.button.callback('🌾 Harvest Fee ke HYPE', 'cmd_elysium_harvest_menu')
      ],
      [
        Markup.button.callback('⚙️ Atur LP & Dev Buy', 'cmd_elysium_lp_menu'),
        Markup.button.callback(`📜 Riwayat Deploy (${totalCount})`, 'cmd_elysium_history')
      ],
      [
        Markup.button.callback('🔄 Refresh Status & Saldo', 'cmd_elysium_menu'),
        Markup.button.callback('⬅️ Kembali ke Dashboard Utama', 'cmd_start_menu')
      ]
    ]);

    if (isEdit && ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
      } catch {}
    }
    return ctx.replyWithHTML(msg, keyboard);
  }

  async sendElysiumPairMenu(ctx, isEdit = false) {
    const curPair = storage.getElysiumPairToken();
    const curDex = storage.getElysiumDexVersion().toUpperCase();
    const check = (val) => curPair === val ? '✅ ' : '';

    const msg =
`🔄 <b>PENGATURAN TRADING PAIR ELYSIUM (${curDex})</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Pilih quote token pasangan likuiditas yang akan digunakan saat deploy token di Elysium Mainnet:

💎 <b>HYPE (Native Gas):</b> Pasangan default native coin Elysium (0.0001 - 0.0002 HYPE). Di Uniswap V4 disetor langsung sebagai native gas tanpa perlu wrap ke WETH!
⚡ <b>ETH:</b> Pasangan native ETH/HYPE pada chain Elysium.
💵 <b>USDC:</b> Pasangan stablecoin USD Coin (<code>0xb47c...</code>). Jika saldo USDC deployer kosong, bot otomatis menukar sebagian kecil HYPE ke USDC!
📦 <b>WETH:</b> Pasangan Wrapped Elysium WETH9 (<code>0xbA87...</code>).

🎯 <b>Setting Pair Aktif:</b> <b>${curPair}</b>

<i>Pilih pair di bawah atau gunakan:</i> <code>/elysiumpair [hype|eth|usdc|weth]</code>`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`${check('HYPE')}💎 HYPE (Native - Default)`, 'set_elys_pair_HYPE'),
        Markup.button.callback(`${check('ETH')}⚡ ETH (Native)`, 'set_elys_pair_ETH')
      ],
      [
        Markup.button.callback(`${check('USDC')}💵 USDC (USD Coin 6 Dec)`, 'set_elys_pair_USDC'),
        Markup.button.callback(`${check('WETH')}📦 WETH (Wrapped Elysium)`, 'set_elys_pair_WETH')
      ],
      [
        Markup.button.callback('🪐 Kembali ke Menu Elysium', 'cmd_elysium_menu'),
        Markup.button.callback('⬅️ Dashboard Utama', 'cmd_start_menu')
      ]
    ]);

    if (isEdit && ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
      } catch {}
    }
    return ctx.replyWithHTML(msg, keyboard);
  }

  async sendElysiumDexMenu(ctx, isEdit = false) {
    const curDex = storage.getElysiumDexVersion();
    const check = (val) => curDex === val ? '✅ ' : '';

    const msg =
`🦄 <b>PENGATURAN DEX ENGINE ELYSIUM</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Pilih versi protokol DEX yang digunakan untuk membuat pool likuiditas & dev buy:

✨ <b>Uniswap V4 (Default & Standar Elysium Mainnet):</b>
• Singleton PoolManager & Position NFT (UNI-V4-POSM)
• Dukungan Native Gas HYPE langsung (address 0)
• UniversalRouter eksekusi swap berkecepatan tinggi
• 3,240+ pool aktif live di Elysium Mainnet

🦄 <b>Uniswap V3:</b>
• NonfungiblePositionManager NFT
• Concentrated / Full-Range Liquidity
• SwapRouter Single-Hop & Multi-Hop

🥞 <b>Uniswap V2 (Fallback Klasik):</b>
• Router V2 addLiquidityETH
• AMM x*y=k konvensional

🎯 <b>DEX Aktif Saat Ini:</b> <b>Uniswap ${curDex.toUpperCase()}</b>

<i>Pilih DEX di bawah atau gunakan:</i> <code>/elysiumdex [v4|v3|v2]</code>`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`${check('v4')}✨ Uniswap V4 (Standar Utama & Aktif)`, 'set_elys_dex_v4'),
        Markup.button.callback(`${check('v3')}🦄 Uniswap V3`, 'set_elys_dex_v3')
      ],
      [
        Markup.button.callback(`${check('v2')}🥞 Uniswap V2 (Legacy)`, 'set_elys_dex_v2'),
        Markup.button.callback('🔄 Atur Trading Pair', 'cmd_elysium_pair_menu')
      ],
      [
        Markup.button.callback('🪐 Kembali ke Menu Elysium', 'cmd_elysium_menu'),
        Markup.button.callback('⬅️ Dashboard Utama', 'cmd_start_menu')
      ]
    ]);

    if (isEdit && ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
      } catch {}
    }
    return ctx.replyWithHTML(msg, keyboard);
  }

  async sendElysiumLpMenu(ctx, isEdit = false) {
    const curLp = storage.getElysiumLpHype();
    const curDevBuy = storage.getElysiumDevBuyHype();
    const curPair = storage.getElysiumPairToken();
    const curDex = storage.getElysiumDexVersion().toUpperCase();
    const devBuyLabel = curDevBuy > 0 ? `🟢 ${curDevBuy} HYPE` : '🔴 Nonaktif (0 HYPE)';

    const msg = 
`⚙️ <b>PENGATURAN LIKUIDITAS (LP) &amp; DEV BUY ELYSIUM</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Atur jumlah native gas <b>HYPE / Quote</b> yang disetor ke Pool Uniswap ${curDex} (Pair: ${curPair}) dan nominal Dev Buy otomatis saat peluncuran token di Elysium Mainnet:

💧 <b>Setting LP Saat Ini:</b> <code>${curLp} HYPE / Quote</code>
🛒 <b>Setting Dev Buy Saat Ini:</b> <code>${devBuyLabel}</code>
💡 <b>Rentang LP yang Diizinkan:</b> <code>0.0001</code> s/d <code>0.0002 HYPE</code>

<i>Pilih nilai cepat di bawah atau gunakan perintah chat:</i>
• <code>/elysiumlp 0.0001</code> s/d <code>/elysiumlp 0.0002</code>
• <code>/devbuyelys 0.0001</code> (atau <code>/devbuyelys off</code>)`;

    const checkLp = (val) => Number(curLp) === Number(val) ? '✅ ' : '';
    const checkDevBuy = (val) => Number(curDevBuy) === Number(val) ? '✅ ' : '';

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`${checkLp(0.0001)}0.0001 HYPE (Min)`, 'set_elys_lp_0.0001'),
        Markup.button.callback(`${checkLp(0.00012)}0.00012 HYPE`, 'set_elys_lp_0.00012')
      ],
      [
        Markup.button.callback(`${checkLp(0.00015)}0.00015 HYPE`, 'set_elys_lp_0.00015'),
        Markup.button.callback(`${checkLp(0.00018)}0.00018 HYPE`, 'set_elys_lp_0.00018')
      ],
      [
        Markup.button.callback(`${checkLp(0.0002)}0.0002 HYPE (Max)`, 'set_elys_lp_0.0002')
      ],
      [
        Markup.button.callback(`${checkDevBuy(0.0001)}🛒 Dev Buy: 0.0001 HYPE`, 'set_elys_devbuy_0.0001'),
        Markup.button.callback(`${curDevBuy === 0 ? '✅ ' : ''}❌ Dev Buy: OFF`, 'set_elys_devbuy_off')
      ],
      [
        Markup.button.callback('🔄 Ubah Trading Pair', 'cmd_elysium_pair_menu'),
        Markup.button.callback('🪐 Menu Elysium', 'cmd_elysium_menu')
      ]
    ]);

    if (isEdit && ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
      } catch {}
    }
    return ctx.replyWithHTML(msg, keyboard);
  }

  async sendElysiumFeeMenu(ctx, isEdit = false) {
    const curBuyFee = storage.getElysiumBuyFee();
    const curSellFee = storage.getElysiumSellFee();

    const msg = 
`🏷️ <b>PENGATURAN FEE JUAL &amp; BELI (ELYSIUM MAINNET)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Pengaturan fee ini <b>khusus berlaku untuk jaringan Elysium</b> (Chain ID 99901).

💰 <b>Mekanisme Perhitungan Fee:</b>
• Fee dihitung dan dipotong langsung saat swap di DEX Uniswap Elysium.
• Besaran fee adalah <b>persentase (%) dari total nilai transaksi dalam USD</b> pada setiap order Buy maupun Sell.
• Hasil fee dipotong otomatis dan langsung masuk ke wallet deployer (fee wallet).
• <b>Anti-Sniper Protection:</b> Saat 30 menit pertama peluncuran, sniper buy tax 80% aktif untuk menahan bot. Setelah periode sniper usai, otomatis mengikuti <b>Fee Beli (${curBuyFee}%)</b> ini.

📊 <b>Konfigurasi Fee Saat Ini:</b>
• 🟢 <b>Fee Beli (Buy Fee):</b> <b>${curBuyFee}%</b> dari total nilai USD order beli
• 🔴 <b>Fee Jual (Sell Fee):</b> <b>${curSellFee}%</b> dari total nilai USD order jual

👇 <i>Pilih preset kombinasi atau klik angka individual di bawah:</i>

💬 <b>Perintah Chat Langsung:</b>
• <code>/elysfee &lt;buy%&gt; &lt;sell%&gt;</code> (Contoh: <code>/elysfee 3 5</code>)
• <code>/elysbuyfee &lt;%&gt;</code> (Contoh: <code>/elysbuyfee 3</code>)
• <code>/elyssellfee &lt;%&gt;</code> (Contoh: <code>/elyssellfee 5</code>)`;

    const isPreset = (b, s) => (Number(curBuyFee) === b && Number(curSellFee) === s) ? '✅ ' : '';
    const isBuy = (b) => Number(curBuyFee) === b ? '✅ ' : '';
    const isSell = (s) => Number(curSellFee) === s ? '✅ ' : '';

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`${isPreset(0, 0)}0% / 0% (Bebas Fee)`, 'set_elys_fees_0_0'),
        Markup.button.callback(`${isPreset(1, 1)}1% / 1% (Rendah)`, 'set_elys_fees_1_1')
      ],
      [
        Markup.button.callback(`${isPreset(3, 3)}3% / 3% (Standar)`, 'set_elys_fees_3_3'),
        Markup.button.callback(`${isPreset(5, 5)}5% / 5% (Default Rekomendasi)`, 'set_elys_fees_5_5')
      ],
      [
        Markup.button.callback(`${isPreset(3, 5)}3% Buy / 5% Sell`, 'set_elys_fees_3_5'),
        Markup.button.callback(`${isPreset(5, 10)}5% Buy / 10% Sell`, 'set_elys_fees_5_10')
      ],
      [
        Markup.button.callback('── 🟢 Atur Fee Beli (Buy Fee) ──', 'dummy_buy_label')
      ],
      [
        Markup.button.callback(`${isBuy(0)}0%`, 'set_elys_buyfee_0'),
        Markup.button.callback(`${isBuy(1)}1%`, 'set_elys_buyfee_1'),
        Markup.button.callback(`${isBuy(2)}2%`, 'set_elys_buyfee_2'),
        Markup.button.callback(`${isBuy(3)}3%`, 'set_elys_buyfee_3'),
        Markup.button.callback(`${isBuy(5)}5%`, 'set_elys_buyfee_5'),
        Markup.button.callback(`${isBuy(10)}10%`, 'set_elys_buyfee_10')
      ],
      [
        Markup.button.callback('── 🔴 Atur Fee Jual (Sell Fee) ──', 'dummy_sell_label')
      ],
      [
        Markup.button.callback(`${isSell(0)}0%`, 'set_elys_sellfee_0'),
        Markup.button.callback(`${isSell(1)}1%`, 'set_elys_sellfee_1'),
        Markup.button.callback(`${isSell(2)}2%`, 'set_elys_sellfee_2'),
        Markup.button.callback(`${isSell(3)}3%`, 'set_elys_sellfee_3'),
        Markup.button.callback(`${isSell(5)}5%`, 'set_elys_sellfee_5'),
        Markup.button.callback(`${isSell(10)}10%`, 'set_elys_sellfee_10')
      ],
      [
        Markup.button.callback('🌾 Harvest Fee ke HYPE', 'cmd_elysium_harvest_menu'),
        Markup.button.callback('🚀 Ke Panel Deploy', 'cmd_elysium_deploy_menu')
      ],
      [
        Markup.button.callback('🪐 Menu Elysium', 'cmd_elysium_menu')
      ]
    ]);

    if (isEdit && ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
      } catch {}
    }
    return ctx.replyWithHTML(msg, keyboard);
  }

  async sendElysiumHarvestMenu(ctx, isEdit = false) {
    const list = await elysiumService.getHarvestableTokens();
    const autoHarvest = storage.getElysiumAutoHarvestHype();
    const info = await elysiumService.getDeployerInfo();
    const hypeBal = parseFloat(info.balanceHype || 0).toFixed(6);

    let msg = 
`🌾 <b>PANEL HARVEST FEE KE NATIVE HYPE (ELYSIUM)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
🛡️ <b>Proteksi Dompet:</b> Saldo DevBuy dan token cadangan di wallet deployer Anda <b>100% AMAN &amp; DILINDUNGI</b> (bot dilarang keras menjual token milik dev!).

👛 <b>Saldo HYPE Deployer:</b> <b>${hypeBal} HYPE</b>
⚡ <b>Status Auto-Convert HYPE:</b> <b>🔴 NONAKTIF (Aman)</b>

🪙 <b>Daftar Token dengan Saldo Fee Tersedia:</b>\n`;

    const buttons = [];
    if (list.length === 0) {
      msg += `<i>Tidak ada saldo token fee kontrak yang perlu di-harvest saat ini. Seluruh token DevBuy Anda aman di wallet.</i>\n`;
    } else {
      for (const item of list) {
        msg += `• <b>${escapeHtml(item.name)} ($${escapeHtml(item.symbol)})</b>: <code>${item.balanceFormatted}</code> token\n`;
        buttons.push([
          Markup.button.callback(`🌾 Cairkan Semua ${item.symbol} ke HYPE`, `act_harvest_${item.address}`)
        ]);
      }
      buttons.push([
        Markup.button.callback('🌾 Cairkan SEMUA Token Sekaligus ke HYPE', 'act_harvest_all')
      ]);
    }

    msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 <i>Ketik <code>/harvesthype &lt;AlamatToken&gt;</code> untuk mencairkan secara spesifik.</i>`;

    buttons.push([
      Markup.button.callback(autoHarvest ? '⚡ Matikan Auto-Convert' : '⚡ Aktifkan Auto-Convert HYPE', 'toggle_elys_autoharvest'),
      Markup.button.callback('🔄 Refresh', 'cmd_elysium_harvest_menu')
    ]);
    buttons.push([
      Markup.button.callback('🪐 Menu Elysium', 'cmd_elysium_menu'),
      Markup.button.callback('🏷️ Atur Fee', 'cmd_elysium_fee_menu')
    ]);

    const keyboard = Markup.inlineKeyboard(buttons);
    if (isEdit && ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
      } catch {}
    }
    return ctx.replyWithHTML(msg, keyboard);
  }

  async sendElysiumDeployMenu(ctx) {
    const info = await elysiumService.getDeployerInfo();
    const balNum = parseFloat(info.balanceHype) || 0;
    const curLp = storage.getElysiumLpHype();
    const curDevBuy = storage.getElysiumDevBuyHype();
    const curPair = storage.getElysiumPairToken();
    const curDex = storage.getElysiumDexVersion().toUpperCase();
    const curBuyFee = storage.getElysiumBuyFee();
    const curSellFee = storage.getElysiumSellFee();

    const msg = 
`🚀 <b>PANEL DEPLOY TOKEN KE ELYSIUM MAINNET</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
• Saldo Deployer: <b>${balNum.toFixed(6)} HYPE</b> | <b>${parseFloat(info.balanceUsdc || 0).toFixed(4)} USDC</b>
• DEX Engine: <b>Uniswap ${curDex}</b>
• Trading Pair: <b>${curPair}</b>
• Likuiditas (LP): <b>${curLp} HYPE / Quote</b>
• Setting Dev Buy: <b>${curDevBuy > 0 ? `${curDevBuy} HYPE` : 'Nonaktif'}</b>
• Fee Buy / Sell: <b>${curBuyFee}% Buy / ${curSellFee}% Sell</b> (% dari total transaksi USD)

💡 <b>Cara Deploy:</b>
1️⃣ <b>Gunakan Perintah Cepat di Chat:</b>
<code>/deployelysium &lt;Nama&gt; &lt;Ticker&gt; [LP] [Pair] [Fee%]</code>
<i>Contoh:</i>
• <code>/deployelysium PepeElysium PEPE</code> (Gunakan fee aktif: ${curBuyFee}%/${curSellFee}%)
• <code>/deployelysium CyberDog CDOG ${curLp} USDC 3</code>
• <code>/deployelysium RoboAI ROBO ${curLp} ETH 5</code>

2️⃣ <b>Atau Pilih Preset di Bawah:</b>`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`💎 Deploy WELYSIUM (${curPair}, LP ${curLp})`, 'cmd_elysium_deploy_welysium')
      ],
      [
        Markup.button.callback(`⚡ Quick Deploy Token Demo (${curPair})`, 'cmd_elysium_quick_demo')
      ],
      [
        Markup.button.callback(`🏷️ Fee: ${curBuyFee}% B / ${curSellFee}% S`, 'cmd_elysium_fee_menu'),
        Markup.button.callback(`⚙️ LP & Dev Buy`, 'cmd_elysium_lp_menu')
      ],
      [
        Markup.button.callback(`🔄 Ganti Pair (${curPair})`, 'cmd_elysium_pair_menu'),
        Markup.button.callback(`🦄 Ganti DEX (${curDex})`, 'cmd_elysium_dex_menu')
      ],
      [
        Markup.button.callback('🪐 Radar Trending Elysium', 'cmd_trending_elysium'),
        Markup.button.callback('⬅️ Kembali ke Menu Elysium', 'cmd_elysium_menu')
      ]
    ]);

    await ctx.replyWithHTML(msg, keyboard);
  }

  async sendElysiumHistory(ctx) {
    const tokens = storage.getElysiumDeployedTokens();
    if (!tokens || tokens.length === 0) {
      return ctx.replyWithHTML(
        '📜 <b>Belum ada riwayat token yang dideploy di Elysium.</b>\n\n' +
        'Gunakan perintah <code>/deployelysium &lt;Nama&gt; &lt;Ticker&gt;</code> untuk mulai mendeploy.',
        Markup.inlineKeyboard([
          [Markup.button.callback('🚀 Deploy Token Sekarang', 'cmd_elysium_deploy_menu')],
          [Markup.button.callback('⬅️ Menu Elysium', 'cmd_elysium_menu')]
        ])
      );
    }

    let text = `📜 <b>RIWAYAT DEPLOYMENT ELYSIUM MAINNET (${tokens.length} Token Terakhir):</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    for (const [i, t] of tokens.slice(0, 5).entries()) {
      const verifiedBadge = t.isVerified ? '🟢 Verified' : '🟡 Processed';
      const dexLabel = t.dexVersion || 'Uniswap V3';
      const pairLabel = t.pairToken || 'HYPE';
      text += 
`<b>#${i + 1} 🪙 ${escapeHtml(t.name)} ($${escapeHtml(t.symbol)})</b>
• DEX &amp; Pair: <b>${dexLabel}</b> (Pair: <code>${pairLabel}</code>)
• Kontrak: <code>${t.tokenAddress}</code> (${verifiedBadge})
• Pool: <code>${t.poolAddress || 'N/A'}</code> ${t.positionTokenId ? `(NFT #${t.positionTokenId})` : ''}
• LP: <b>${t.quoteDeposited || `${t.hypeDeposited} HYPE`}</b> + <b>${t.tokenDeposited} Token</b>
• Waktu: <i>${new Date(t.deployedAt).toLocaleString('id-ID')}</i>
• Link: <a href="${t.explorerUrl}">Elyscan</a> | <a href="${t.dexscreenerUrl}">DexScreener</a>${t.imageUrl ? ` | <a href="${toHttpImageUrl(t.imageUrl)}">Logo</a>` : ''}
──────────────────────────\n`;
    }

    await ctx.replyWithHTML(text, Markup.inlineKeyboard([
      [Markup.button.callback('🚀 Deploy Token Baru', 'cmd_elysium_deploy_menu')],
      [Markup.button.callback('⬅️ Menu Elysium', 'cmd_elysium_menu')]
    ]));
  }

  async executeDeployElysium(ctx, options = {}) {
    const hypeLp = String(options.hypeLiquidity || storage.getElysiumLpHype() || '0.0001');
    const devBuyHype = String(options.devBuyHype !== undefined ? options.devBuyHype : (storage.getElysiumDevBuyHype() !== undefined ? storage.getElysiumDevBuyHype() : '0.0001'));
    const pairChoice = options.pair || storage.getElysiumPairToken() || 'HYPE';
    const dexVersion = options.dexVersion || storage.getElysiumDexVersion() || 'v4';
    const dexName = dexVersion.toLowerCase() === 'v4' ? 'Uniswap V4' : (dexVersion.toLowerCase() === 'v3' ? 'Uniswap V3' : 'Uniswap V2');
    const curBuyFee = Number(options.buyFee !== undefined ? options.buyFee : storage.getElysiumBuyFee());
    const curSellFee = Number(options.sellFee !== undefined ? options.sellFee : storage.getElysiumSellFee());

    const initialMsg = await ctx.replyWithHTML(
      `🪐 <b>MEMULAI DEPLOYMENT KE ELYSIUM MAINNET (CHAIN ID 99901)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `• Token: <b>${escapeHtml(options.name)}</b> (<code>$${escapeHtml(options.symbol)}</code>)\n` +
      `• Logo: <b>${options.imageUrl ? 'Logo Diterapkan (IPFS) ✅' : 'Default Pinata Logo'}</b>\n` +
      `• DEX Engine: <b>${dexName}</b>\n` +
      `• Trading Pair: <b>TOKEN / ${pairChoice}</b>\n` +
      `• Likuiditas Pool: <b>${hypeLp} HYPE / Quote</b> + <b>20B ${escapeHtml(options.symbol)}</b>\n` +
      `• Dev Buy Otomatis: <b>${Number(devBuyHype) > 0 ? `${devBuyHype} HYPE` : 'Nonaktif'}</b>\n` +
      `• Fee Transaksi: <b>${curBuyFee}% Buy / ${curSellFee}% Sell</b> (dari total transaksi USD)\n` +
      `• Proteksi Sniper: <b>80% Buy Tax (30 Menit Pertama)</b>\n\n` +
      `⏳ <i>Langkah 1/9: Memeriksa saldo HYPE, quote token, &amp; parameter on-chain...</i>`
    );

    const progressUpdates = async (step, msg) => {
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          initialMsg.message_id,
          null,
          `🪐 <b>DEPLOYMENT KE ELYSIUM MAINNET (CHAIN ID 99901)</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `• Token: <b>${escapeHtml(options.name)}</b> (<code>$${escapeHtml(options.symbol)}</code>)\n` +
          `• DEX &amp; Pair: <b>${dexName}</b> (Pair: <code>${pairChoice}</code>)\n` +
          `• Status: <b>Langkah ${step}/9</b>\n\n` +
          `⏳ <i>${escapeHtml(msg)}</i>`,
          { parse_mode: 'HTML' }
        );
      } catch {}
    };

    try {
      const deployOptions = {
        ...options,
        pair: pairChoice,
        dexVersion,
        hypeLiquidity: hypeLp,
        devBuyHype,
        buyFee: curBuyFee,
        sellFee: curSellFee
      };
      const result = await elysiumService.deployToken(deployOptions, progressUpdates);

      const summaryMsg = 
`🎉 <b>TOKEN BERHASIL DIDEPLOY &amp; LIVE DI ELYSIUM MAINNET!</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
🪙 <b>Info Token:</b>
• Nama: <b>${escapeHtml(result.token.name)}</b>
• Ticker: <code>$${escapeHtml(result.token.symbol)}</code>
• Kontrak Token: <code>${result.token.address}</code>
• Logo IPFS/URL: <a href="${toHttpImageUrl(result.token?.imageUrl || options.imageUrl)}">Lihat Gambar Logo</a>
• Total Supply: <b>100.000.000.000 (100B)</b>
• Status Verifikasi: <b>${result.token.isVerified ? '🟢 Verified di Elyscan' : '🟡 Sedang Diproses Elyscan'}</b>

💧 <b>${result.dexVersion} Pool &amp; Likuiditas:</b>
• Trading Pair: <b>TOKEN / ${result.pairToken}</b>
• Alamat Pool (Pair): <code>${result.liquidity.poolAddress}</code>
${result.positionTokenId ? `• Position NFT: <b>${result.dexVersion} Position #${result.positionTokenId}</b>\n` : ''}• Likuiditas Awal: <b>${result.liquidity.quoteDeposited}</b> + <b>${result.liquidity.tokensDeposited}</b>
• Dev Buy Otomatis: <b>${result.liquidity.devBuyHype}</b>
• Harga Awal: <code>${result.liquidity.initialPrice} ${result.pairToken}</code>
• Trading: <b>🟢 AKTIF (Bisa dibeli &amp; dijual langsung!)</b>

🛡️ <b>Proteksi &amp; Pajak (Dipotong dari Total USD):</b>
• Fee Transaksi: <b>${curBuyFee}% Buy / ${curSellFee}% Sell</b> (dari total order USD)
• Sniper Protection: <b>80% Buy Tax (30 Menit Pertama)</b>
${result.lock.address ? `• Timelock: <code>${result.lock.address}</code> (${result.lock.amount} Token)\n` : ''}
🔗 <b>Transaction Hashes:</b>
• Deploy Token: <a href="${result.urls.tokenExplorer}">${result.token.deployTxHash.slice(0, 14)}...</a>
• Add Liquidity: <code>${result.liquidity.addLiquidityTxHash.slice(0, 14)}...</code>
• Enable Trading: <code>${result.liquidity.enableTradingTxHash.slice(0, 14)}...</code>
${result.liquidity.devBuyTxHash ? `• Dev Buy Tx: <code>${result.liquidity.devBuyTxHash.slice(0, 14)}...</code>\n` : ''}━━━━━━━━━━━━━━━━━━━━━━━━━━
👇 <i>Klik tautan di bawah untuk melihat di Explorer &amp; Dex:</i>`;

      const buttons = [
        [
          Markup.button.url('🔍 Lihat di Elyscan', result.urls.tokenExplorer),
          Markup.button.url(result.dexVersion === 'Uniswap V4' ? '🦎 GeckoTerminal' : '📊 DexScreener', result.urls.dexscreener)
        ],
        [
          Markup.button.url('💧 Lihat Pool di Explorer', result.urls.poolExplorer)
        ],
        [
          Markup.button.callback('🪐 Dashboard Elysium', 'cmd_elysium_menu'),
          Markup.button.callback('⬅️ Menu Utama', 'cmd_start_menu')
        ]
      ];

      const rawLogo = result.token?.imageUrl || options.imageUrl || result.imageUrl;
      const photoUrl = toHttpImageUrl(rawLogo);

      if (photoUrl && photoUrl.startsWith('http')) {
        try {
          await ctx.replyWithPhoto(photoUrl, {
            caption: summaryMsg,
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard(buttons)
          });
        } catch (photoErr) {
          console.warn('[ElysiumBot] replyWithPhoto failed, fallback to replyWithHTML:', photoErr.message);
          await ctx.replyWithHTML(summaryMsg, Markup.inlineKeyboard(buttons));
        }
      } else {
        await ctx.replyWithHTML(summaryMsg, Markup.inlineKeyboard(buttons));
      }
    } catch (err) {
      console.error('Error during Elysium deploy:', err);
      await ctx.replyWithHTML(
        `❌ <b>Deployment ke Elysium Gagal!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `• Error: <code>${escapeHtml(err.message)}</code>\n\n` +
        `💡 <i>Pastikan saldo HYPE di wallet deployer mencukupi untuk LP + gas, dan coba lagi.</i>`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Coba Lagi', 'cmd_elysium_deploy_menu')],
          [Markup.button.callback('🪐 Dashboard Elysium', 'cmd_elysium_menu')]
        ])
      );
    }
  }

  async sendBaseDirectMenu(ctx, isEdit = false) {
    const info = await baseDeployService.getDeployerInfo();
    const deployedTokens = storage.getBaseDirectDeployedTokens();
    const totalCount = deployedTokens.length;
    const curLp = storage.getBaseDirectLpEth();
    const curDevBuy = storage.getBaseDirectDevBuyEth();
    const curPair = storage.getBaseDirectPairToken();
    const curDex = storage.getBaseDirectDexVersion().toUpperCase();
    const devBuyText = curDevBuy > 0 ? `<b>${curDevBuy} ETH</b>` : '🔴 <i>Nonaktif (0 ETH)</i>';

    const addrDisplay = info.address ? `<code>${info.address}</code>` : '⚠️ Belum dikonfigurasi';
    const balanceEthDisplay = info.balanceEth !== 'Error RPC' ? `<b>${parseFloat(info.balanceEth).toFixed(6)} ETH</b>` : '⚠️ Gagal cek saldo';
    const balanceUsdcDisplay = `<b>${parseFloat(info.balanceUsdc || 0).toFixed(4)} USDC</b>`;
    const gasDisplay = `<code>${info.gasPriceGwei} Gwei</code>`;

    const dexBadge = curDex === 'V4' ? '✨ <b>Uniswap V4 (Standar Utama & Aktif)</b>' : (curDex === 'V3' ? '🦄 <b>Uniswap V3</b>' : '🥞 <b>Uniswap V2</b>');
    const pairBadge = curPair === 'USDC' ? '💵 <b>TOKEN / USDC (Stablecoin)</b>' : (curPair === 'WETH' ? '📦 <b>TOKEN / WETH (Wrapped)</b>' : '💎 <b>TOKEN / ETH (Native Gas)</b>');

    const msg = 
`⚡ <b>BASE DIRECT LAUNCHPAD - MANDIRI TANPA CLANKER (CHAIN ID 8453)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Pusat deploy & kelola token mandiri di Base Network dengan Uniswap V4/V3/V2 tanpa limitasi Clanker!

👛 <b>INFO DEPLOYER WALLET:</b>
• Alamat: ${addrDisplay}
• Saldo Gas (ETH): ${balanceEthDisplay}
• Saldo USDC: ${balanceUsdcDisplay}
• Estimasi Gas Base: ${gasDisplay}
• PoolManager V4: <code>${info.v4PoolManager}</code>
• Position Manager V4: <code>${info.v4PositionManager}</code>
• Universal Router: <code>${info.universalRouter}</code>

⚙️ <b>SETTING TRADING & LIQUIDITY:</b>
• DEX Engine: ${dexBadge}
• Trading Pair: ${pairBadge}
• Likuiditas Pool (LP): <b>${curLp} ETH / Quote</b>
• Dev Buy Otomatis: ${devBuyText}
• Proteksi Default: <b>Anti-Sniper 80% Buy Tax (30 Menit)</b>
• Fee Default: <b>5% Buy / 5% Sell</b> ke Deployer Wallet
• Total Token Dideploy: <b>${totalCount} token</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
👇 <i>Pilih aksi di bawah:</i>`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🚀 Deploy Token Baru ke Base', 'cmd_base_direct_deploy_menu'),
        Markup.button.callback('🔥 Trending Base Tokens', 'cmd_trending_base')
      ],
      [
        Markup.button.callback(`🔄 Pair: ${curPair}`, 'cmd_base_direct_pair_menu'),
        Markup.button.callback(`✨ DEX: Uniswap ${curDex}`, 'cmd_base_direct_dex_menu')
      ],
      [
        Markup.button.callback('⚙️ Atur LP & Dev Buy', 'cmd_base_direct_lp_menu'),
        Markup.button.callback(`📜 Riwayat Deploy (${totalCount})`, 'cmd_base_direct_history')
      ],
      [
        Markup.button.callback('🔄 Refresh Status & Saldo', 'cmd_base_direct_menu'),
        Markup.button.callback('⬅️ Kembali ke Dashboard Utama', 'cmd_start_menu')
      ]
    ]);

    if (isEdit && ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
      } catch {}
    }
    return ctx.replyWithHTML(msg, keyboard);
  }

  async sendBaseDirectPairMenu(ctx, isEdit = false) {
    const curPair = storage.getBaseDirectPairToken();
    const curDex = storage.getBaseDirectDexVersion().toUpperCase();
    const check = (val) => curPair === val ? '✅ ' : '';

    const msg =
`🔄 <b>PENGATURAN TRADING PAIR BASE MANDIRI (${curDex})</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Pilih quote token pasangan likuiditas yang akan digunakan saat deploy token mandiri di Base Network:

💎 <b>ETH (Native Gas):</b> Pasangan default native coin Base. Di Uniswap V4 disetor langsung sebagai native gas tanpa wrap ke WETH!
💵 <b>USDC:</b> Pasangan stablecoin USD Coin (<code>0x8335...</code>). Jika saldo USDC deployer kosong, bot otomatis menukar sebagian kecil ETH ke USDC!
📦 <b>WETH:</b> Pasangan Wrapped Ether (<code>0x4200...</code>).

🎯 <b>Setting Pair Aktif:</b> <b>${curPair}</b>

<i>Pilih pair di bawah atau gunakan:</i> <code>/basepair [eth|usdc|weth]</code>`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`${check('ETH')}💎 ETH (Native Gas - Default)`, 'set_base_pair_ETH'),
        Markup.button.callback(`${check('USDC')}💵 USDC (USD Coin 6 Dec)`, 'set_base_pair_USDC')
      ],
      [
        Markup.button.callback(`${check('WETH')}📦 WETH (Wrapped Ether)`, 'set_base_pair_WETH'),
        Markup.button.callback('✨ Ganti DEX Engine', 'cmd_base_direct_dex_menu')
      ],
      [
        Markup.button.callback('⚡ Kembali ke Menu Base Mandiri', 'cmd_base_direct_menu'),
        Markup.button.callback('⬅️ Dashboard Utama', 'cmd_start_menu')
      ]
    ]);

    if (isEdit && ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
      } catch {}
    }
    return ctx.replyWithHTML(msg, keyboard);
  }

  async sendBaseDirectDexMenu(ctx, isEdit = false) {
    const curDex = storage.getBaseDirectDexVersion();
    const check = (val) => curDex === val ? '✅ ' : '';

    const msg =
`🦄 <b>PENGATURAN DEX ENGINE BASE MANDIRI</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Pilih versi protokol DEX yang digunakan untuk membuat pool likuiditas & dev buy di Base Network:

✨ <b>Uniswap V4 (Default & Standar Base Terupdate):</b>
• Singleton PoolManager & Position NFT (UNI-V4-POSM)
• Dukungan Native Gas ETH langsung (address 0)
• UniversalRouter eksekusi swap berkecepatan tinggi

🦄 <b>Uniswap V3:</b>
• NonfungiblePositionManager NFT
• Concentrated / Full-Range Liquidity
• SwapRouter Single-Hop & Multi-Hop

🥞 <b>Uniswap V2 (Fallback Klasik):</b>
• Router V2 addLiquidityETH
• AMM x*y=k konvensional

🎯 <b>DEX Aktif Saat Ini:</b> <b>Uniswap ${curDex.toUpperCase()}</b>

<i>Pilih DEX di bawah atau gunakan:</i> <code>/basedex [v4|v3|v2]</code>`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`${check('v4')}✨ Uniswap V4 (Standar Utama & Aktif)`, 'set_base_dex_v4'),
        Markup.button.callback(`${check('v3')}🦄 Uniswap V3`, 'set_base_dex_v3')
      ],
      [
        Markup.button.callback(`${check('v2')}🥞 Uniswap V2 (Legacy)`, 'set_base_dex_v2'),
        Markup.button.callback('🔄 Atur Trading Pair', 'cmd_base_direct_pair_menu')
      ],
      [
        Markup.button.callback('⚡ Kembali ke Menu Base Mandiri', 'cmd_base_direct_menu'),
        Markup.button.callback('⬅️ Dashboard Utama', 'cmd_start_menu')
      ]
    ]);

    if (isEdit && ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
      } catch {}
    }
    return ctx.replyWithHTML(msg, keyboard);
  }

  async sendBaseDirectLpMenu(ctx, isEdit = false) {
    const curLp = storage.getBaseDirectLpEth();
    const curDevBuy = storage.getBaseDirectDevBuyEth();
    const curPair = storage.getBaseDirectPairToken();
    const curDex = storage.getBaseDirectDexVersion().toUpperCase();
    const devBuyLabel = curDevBuy > 0 ? `🟢 ${curDevBuy} ETH` : '🔴 Nonaktif (0 ETH)';

    const msg = 
`⚙️ <b>PENGATURAN LIKUIDITAS (LP) &amp; DEV BUY BASE MANDIRI</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Atur jumlah native gas <b>ETH / Quote</b> yang disetor ke Pool Uniswap ${curDex} (Pair: ${curPair}) dan nominal Dev Buy otomatis saat peluncuran token di Base Mainnet:

💧 <b>Setting LP Saat Ini:</b> <code>${curLp} ETH / Quote</code>
🛒 <b>Setting Dev Buy Saat Ini:</b> <code>${devBuyLabel}</code>
💡 <b>Rentang LP yang Diizinkan:</b> <code>0.00001</code> s/d <code>0.002 ETH</code>

<i>Pilih nilai cepat di bawah atau gunakan perintah chat:</i>
• <code>/baselp 0.00001</code> s/d <code>/baselp 0.002</code>
• <code>/basedevbuy 0.000001</code> (atau <code>/basedevbuy off</code>)`;

    const checkLp = (val) => Number(curLp) === Number(val) ? '✅ ' : '';
    const checkDevBuy = (val) => Number(curDevBuy) === Number(val) ? '✅ ' : '';

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`${checkLp(0.00001)}0.00001 ETH (Min & Default)`, 'set_base_lp_0.00001'),
        Markup.button.callback(`${checkLp(0.00005)}0.00005 ETH`, 'set_base_lp_0.00005')
      ],
      [
        Markup.button.callback(`${checkLp(0.0001)}0.0001 ETH`, 'set_base_lp_0.0001'),
        Markup.button.callback(`${checkLp(0.0002)}0.0002 ETH`, 'set_base_lp_0.0002')
      ],
      [
        Markup.button.callback(`${checkLp(0.0005)}0.0005 ETH`, 'set_base_lp_0.0005'),
        Markup.button.callback(`${checkLp(0.001)}0.001 ETH`, 'set_base_lp_0.001')
      ],
      [
        Markup.button.callback(`${checkDevBuy(0.000001)}🛒 Dev Buy: 0.000001 ETH (Min & Default)`, 'set_base_devbuy_0.000001'),
        Markup.button.callback(`${checkDevBuy(0.00001)}🛒 0.00001 ETH`, 'set_base_devbuy_0.00001')
      ],
      [
        Markup.button.callback(`${checkDevBuy(0.0001)}🛒 0.0001 ETH`, 'set_base_devbuy_0.0001'),
        Markup.button.callback(`${curDevBuy === 0 ? '✅ ' : ''}❌ Dev Buy: OFF`, 'set_base_devbuy_off')
      ],
      [
        Markup.button.callback('🔄 Ubah Trading Pair', 'cmd_base_direct_pair_menu'),
        Markup.button.callback('⚡ Menu Base Mandiri', 'cmd_base_direct_menu')
      ]
    ]);

    if (isEdit && ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
      } catch {}
    }
    return ctx.replyWithHTML(msg, keyboard);
  }

  async sendBaseDirectDeployMenu(ctx) {
    const info = await baseDeployService.getDeployerInfo();
    const balNum = parseFloat(info.balanceEth) || 0;
    const curLp = storage.getBaseDirectLpEth();
    const curDevBuy = storage.getBaseDirectDevBuyEth();
    const curPair = storage.getBaseDirectPairToken();
    const curDex = storage.getBaseDirectDexVersion().toUpperCase();

    const msg = 
`🚀 <b>PANEL DEPLOY TOKEN MANDIRI KE BASE MAINNET</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
• Saldo Deployer: <b>${balNum.toFixed(6)} ETH</b> | <b>${parseFloat(info.balanceUsdc || 0).toFixed(4)} USDC</b>
• DEX Engine: <b>Uniswap ${curDex}</b>
• Trading Pair: <b>${curPair}</b>
• Likuiditas (LP): <b>${curLp} ETH / Quote</b>
• Setting Dev Buy: <b>${curDevBuy > 0 ? `${curDevBuy} ETH` : 'Nonaktif'}</b>

💡 <b>Cara Deploy:</b>
1️⃣ <b>Gunakan Perintah Cepat di Chat:</b>
<code>/basedeploy &lt;Nama&gt; &lt;Ticker&gt; [LP] [Pair] [Fee%]</code>
<i>Contoh:</i>
• <code>/basedeploy BasePepe PEPE</code> (Gunakan setting aktif)
• <code>/basedeploy CyberCat CCAT ${curLp} USDC 5</code>
• <code>/basedeploy RoboBase ROBO ${curLp} ETH 5</code>

2️⃣ <b>Atau Pilih Preset di Bawah:</b>`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`⚡ Quick Deploy Token Demo Base (${curPair})`, 'cmd_base_direct_quick_demo')
      ],
      [
        Markup.button.callback(`🔄 Ganti Pair (${curPair})`, 'cmd_base_direct_pair_menu'),
        Markup.button.callback(`🦄 Ganti DEX (${curDex})`, 'cmd_base_direct_dex_menu')
      ],
      [
        Markup.button.callback('⚙️ Ubah Setting LP & Dev Buy', 'cmd_base_direct_lp_menu'),
        Markup.button.callback('🔥 Radar Trending Base', 'cmd_trending_base')
      ],
      [
        Markup.button.callback('⬅️ Kembali ke Menu Base Mandiri', 'cmd_base_direct_menu')
      ]
    ]);

    await ctx.replyWithHTML(msg, keyboard);
  }

  async sendBaseDirectHistory(ctx) {
    const tokens = storage.getBaseDirectDeployedTokens();
    if (!tokens || tokens.length === 0) {
      return ctx.replyWithHTML(
        '📜 <b>Belum ada riwayat token yang dideploy mandiri di Base.</b>\n\n' +
        'Gunakan perintah <code>/basedeploy &lt;Nama&gt; &lt;Ticker&gt;</code> untuk mulai mendeploy.',
        Markup.inlineKeyboard([
          [Markup.button.callback('🚀 Deploy Token Sekarang', 'cmd_base_direct_deploy_menu')],
          [Markup.button.callback('⬅️ Menu Base Mandiri', 'cmd_base_direct_menu')]
        ])
      );
    }

    let text = `📜 <b>RIWAYAT DEPLOYMENT MANDIRI BASE MAINNET (${tokens.length} Token Terakhir):</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    for (const [i, t] of tokens.slice(0, 5).entries()) {
      const dexLabel = t.dexVersion || 'Uniswap V4';
      const pairLabel = t.pairToken || 'ETH';
      text += 
`<b>#${i + 1} 🪙 ${escapeHtml(t.name)} ($${escapeHtml(t.symbol)})</b>
• DEX &amp; Pair: <b>${dexLabel}</b> (Pair: <code>${pairLabel}</code>)
• Kontrak: <code>${t.tokenAddress}</code>
• Pool: <code>${t.poolAddress || 'N/A'}</code> ${t.positionTokenId ? `(NFT #${t.positionTokenId})` : ''}
• LP: <b>${t.quoteDeposited || `${t.ethDeposited} ETH`}</b> + <b>${t.tokenDeposited} Token</b>
• Waktu: <i>${new Date(t.deployedAt).toLocaleString('id-ID')}</i>
• Link: <a href="${t.explorerUrl}">Basescan</a> | <a href="${t.dexscreenerUrl}">DexScreener</a>${t.imageUrl ? ` | <a href="${toHttpImageUrl(t.imageUrl)}">Logo</a>` : ''}
──────────────────────────\n`;
    }

    await ctx.replyWithHTML(text, Markup.inlineKeyboard([
      [Markup.button.callback('🚀 Deploy Token Baru', 'cmd_base_direct_deploy_menu')],
      [Markup.button.callback('⬅️ Menu Base Mandiri', 'cmd_base_direct_menu')]
    ]));
  }

  async executeDeployBaseDirect(ctx, options = {}) {
    const ethLp = String(options.ethLiquidity || storage.getBaseDirectLpEth() || '0.00001');
    const devBuyEth = String(options.devBuyEth !== undefined ? options.devBuyEth : (storage.getBaseDirectDevBuyEth() !== undefined ? storage.getBaseDirectDevBuyEth() : '0.000001'));
    const pairChoice = options.pair || storage.getBaseDirectPairToken() || 'ETH';
    const dexVersion = options.dexVersion || storage.getBaseDirectDexVersion() || 'v4';
    const dexName = dexVersion.toLowerCase() === 'v4' ? 'Uniswap V4' : (dexVersion.toLowerCase() === 'v3' ? 'Uniswap V3' : 'Uniswap V2');

    const initialMsg = await ctx.replyWithHTML(
      `⚡ <b>MEMULAI DEPLOYMENT MANDIRI KE BASE MAINNET (CHAIN ID 8453)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `• Token: <b>${escapeHtml(options.name)}</b> (<code>$${escapeHtml(options.symbol)}</code>)\n` +
      `• Logo: <b>${options.imageUrl ? 'Logo Diterapkan (IPFS) ✅' : 'Default Pinata Logo'}</b>\n` +
      `• DEX Engine: <b>${dexName}</b>\n` +
      `• Trading Pair: <b>TOKEN / ${pairChoice}</b>\n` +
      `• Likuiditas Pool: <b>${ethLp} ETH / Quote</b> + <b>20B ${escapeHtml(options.symbol)}</b>\n` +
      `• Dev Buy Otomatis: <b>${Number(devBuyEth) > 0 ? `${devBuyEth} ETH` : 'Nonaktif'}</b>\n` +
      `• Fee: <b>${options.buyFee || 5}% Buy / ${options.sellFee || 5}% Sell</b>\n` +
      `• Proteksi Sniper: <b>80% Buy Tax (30 Menit Pertama)</b>\n\n` +
      `⏳ <i>Langkah 1/9: Memeriksa saldo ETH, quote token, &amp; parameter on-chain...</i>`
    );

    const progressUpdates = async (step, msg) => {
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          initialMsg.message_id,
          null,
          `⚡ <b>DEPLOYMENT MANDIRI KE BASE MAINNET (CHAIN ID 8453)</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `• Token: <b>${escapeHtml(options.name)}</b> (<code>$${escapeHtml(options.symbol)}</code>)\n` +
          `• DEX &amp; Pair: <b>${dexName}</b> (Pair: <code>${pairChoice}</code>)\n` +
          `• Status: <b>Langkah ${step}/9</b>\n\n` +
          `⏳ <i>${escapeHtml(msg)}</i>`,
          { parse_mode: 'HTML' }
        );
      } catch {}
    };

    try {
      const deployOptions = {
        ...options,
        pair: pairChoice,
        dexVersion,
        ethLiquidity: ethLp,
        devBuyEth
      };
      const result = await baseDeployService.deployToken(deployOptions, progressUpdates);

      const summaryMsg = 
`🎉 <b>TOKEN BERHASIL DIDEPLOY &amp; LIVE DI BASE MAINNET!</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
🪙 <b>Info Token:</b>
• Nama: <b>${escapeHtml(result.token.name)}</b>
• Ticker: <code>$${escapeHtml(result.token.symbol)}</code>
• Kontrak Token: <code>${result.token.address}</code>
• Logo IPFS/URL: <a href="${toHttpImageUrl(result.token?.imageUrl || options.imageUrl)}">Lihat Gambar Logo</a>
• Total Supply: <b>100.000.000.000 (100B)</b>
• Platform: <b>Direct Launchpad (Mandiri Tanpa Clanker)</b>

💧 <b>${result.dexVersion} Pool &amp; Likuiditas:</b>
• Trading Pair: <b>TOKEN / ${result.pairToken}</b>
• Alamat Pool (Pair): <code>${result.liquidity.poolAddress}</code>
${result.positionTokenId ? `• Position NFT: <b>${result.dexVersion} Position #${result.positionTokenId}</b>\n` : ''}• Likuiditas Awal: <b>${result.liquidity.quoteDeposited}</b> + <b>${result.liquidity.tokensDeposited}</b>
• Dev Buy Otomatis: <b>${result.liquidity.devBuyEth}</b>
• Harga Awal: <code>${result.liquidity.initialPrice} ${result.pairToken}</code>
• Trading: <b>🟢 AKTIF (Bisa dibeli &amp; dijual langsung!)</b>

🛡️ <b>Proteksi &amp; Pajak:</b>
• Sniper Tax: <b>80% Buy Tax (30 Menit Pertama)</b>
• Normal Tax: <b>${options.buyFee || 5}% Buy / ${options.sellFee || 5}% Sell</b>

🔗 <b>Transaction Hashes:</b>
• Deploy Token: <a href="${result.urls.tokenExplorer}">${result.token.deployTxHash.slice(0, 14)}...</a>
• Add Liquidity: <code>${result.liquidity.addLiquidityTxHash.slice(0, 14)}...</code>
• Enable Trading: <code>${result.liquidity.enableTradingTxHash.slice(0, 14)}...</code>
${result.liquidity.devBuyTxHash ? `• Dev Buy Tx: <code>${result.liquidity.devBuyTxHash.slice(0, 14)}...</code>\n` : ''}━━━━━━━━━━━━━━━━━━━━━━━━━━
👇 <i>Klik tautan di bawah untuk melihat di Explorer &amp; Dex:</i>`;

      const buttons = [
        [
          Markup.button.url('🔍 Lihat di Basescan', result.urls.tokenExplorer),
          Markup.button.url('📊 DexScreener', result.urls.dexscreener)
        ],
        [
          Markup.button.url('🦎 GeckoTerminal', result.urls.geckoterminal),
          Markup.button.url('💧 Lihat Pool di Explorer', result.urls.poolExplorer)
        ],
        [
          Markup.button.callback('⚡ Dashboard Base Mandiri', 'cmd_base_direct_menu'),
          Markup.button.callback('⬅️ Menu Utama', 'cmd_start_menu')
        ]
      ];

      const rawLogo = result.token?.imageUrl || options.imageUrl || result.imageUrl;
      const photoUrl = toHttpImageUrl(rawLogo);

      if (photoUrl && photoUrl.startsWith('http')) {
        try {
          await ctx.replyWithPhoto(photoUrl, {
            caption: summaryMsg,
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard(buttons)
          });
        } catch (photoErr) {
          console.warn('[BaseDirectBot] replyWithPhoto failed, fallback to replyWithHTML:', photoErr.message);
          await ctx.replyWithHTML(summaryMsg, Markup.inlineKeyboard(buttons));
        }
      } else {
        await ctx.replyWithHTML(summaryMsg, Markup.inlineKeyboard(buttons));
      }
    } catch (err) {
      console.error('Error during Base Direct deploy:', err);
      await ctx.replyWithHTML(
        `❌ <b>Deployment Mandiri ke Base Gagal!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `• Error: <code>${escapeHtml(err.message)}</code>\n\n` +
        `💡 <i>Pastikan saldo ETH di wallet deployer Base mencukupi untuk LP + gas, dan coba lagi.</i>`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Coba Lagi', 'cmd_base_direct_deploy_menu')],
          [Markup.button.callback('⚡ Dashboard Base Mandiri', 'cmd_base_direct_menu')]
        ])
      );
    }
  }

  startAutoHarvestWorker() {
    if (this.harvestInterval) clearInterval(this.harvestInterval);
    // Dinonaktifkan: Saldo wallet deployer dan hasil devbuy tidak boleh di-harvest secara otomatis
  }

  async start() {
    if (!this.bot) return;
    try {
      console.log('Cleaning any stale webhooks...');
      await this.bot.telegram.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
      console.log('Starting Telegram bot polling...');
      await this.bot.launch();
      console.log('✅ Telegram Bot successfully started and listening for commands!');
    } catch (e) {
      console.error('Failed to launch Telegram bot:', e.message);
    }
  }

  stop() {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    if (this.harvestInterval) clearInterval(this.harvestInterval);
    vestingMonitor.stop();
    if (this.bot) this.bot.stop();
  }

  // ===== ROBINHOOD CHAIN METHODS =====

  async sendRobinhoodMenu(ctx, isEdit = false) {
    let info = { address: '', balanceEth: '0', balanceWeth: '0', balanceUsdg: '0', gasPriceGwei: '0', v4PoolManager: config.robinhoodV4PoolManager, v4PositionManager: config.robinhoodV4PositionManager, universalRouter: config.robinhoodUniversalRouter };
    try { info = await robinhoodService.getDeployerInfo(); } catch (e) { /* ignore */ }
    const deployedTokens = storage.getRobinhoodDeployedTokens();
    const totalCount = deployedTokens.length;
    const curLp = storage.getRobinhoodLpEth();
    const curDevBuy = storage.getRobinhoodDevBuyEth();
    const curPair = storage.getRobinhoodPairToken();
    const curDex = storage.getRobinhoodDexVersion().toUpperCase();
    const curBuyFee = storage.getRobinhoodBuyFee();
    const curSellFee = storage.getRobinhoodSellFee();
    const curV3Fee = storage.getRobinhoodV3FeeTier();
    const devBuyText = curDevBuy > 0 ? `<b>${curDevBuy} ETH</b>` : '🔴 <i>Nonaktif (0 ETH)</i>';

    const addrDisplay = info.address ? `<code>${info.address}</code>` : '⚠️ Belum dikonfigurasi';
    const balEthDisplay = info.balanceEth !== 'Error RPC' ? `<b>${parseFloat(info.balanceEth || 0).toFixed(6)} ETH</b>` : '⚠️ Gagal cek saldo';
    const balWeth = parseFloat(info.balanceWeth || 0);
    const balUsdg = parseFloat(info.balanceUsdg || 0);
    const dexBadge = curDex === 'V4' ? '✨ <b>Uniswap V4 (Standar Utama &amp; Aktif)</b>' : '🦄 <b>Uniswap V3</b>';
    const pairBadge = curPair === 'USDG' ? '💵 <b>TOKEN / USDG (Stablecoin)</b>' : (curPair === 'WETH' ? '📦 <b>TOKEN / WETH (Wrapped)</b>' : '💎 <b>TOKEN / ETH (Native Gas)</b>');

    const msg =
`🏹 <b>ROBINHOOD CHAIN LAUNCHPAD &amp; HUB (CHAIN ID 4663)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Pusat deploy &amp; kelola token mandiri di <b>Robinhood Chain</b> (konfigurasi lengkap setara Elysium)!

👛 <b>INFO DEPLOYER WALLET:</b>
• Alamat: ${addrDisplay}
• Saldo Gas (ETH): ${balEthDisplay}
• Saldo WETH: <b>${balWeth.toFixed(6)} WETH</b>
• Saldo USDG: <b>${balUsdg.toFixed(4)} USDG</b>
• Estimasi Gas: <code>${info.gasPriceGwei} Gwei</code>
• PoolManager V4: <code>${info.v4PoolManager || config.robinhoodV4PoolManager}</code>
• Position Manager V4: <code>${info.v4PositionManager || config.robinhoodV4PositionManager}</code>
• Universal Router: <code>${info.universalRouter || config.robinhoodUniversalRouter}</code>

⚙️ <b>SETTING TRADING &amp; LIQUIDITY:</b>
• DEX Engine: ${dexBadge}
• Trading Pair: ${pairBadge}
• Fee Tier Pool: <b>${curV3Fee / 10000}% (${curV3Fee} bps)</b>
• Likuiditas Pool (LP): <b>${curLp} ETH / Quote</b>
• Dev Buy Otomatis: ${devBuyText}
• Fee Buy &amp; Sell: <b>${curBuyFee}% Buy / ${curSellFee}% Sell</b>
• Proteksi Default: <b>Anti-Sniper 80% Buy Tax (30 Menit)</b>
• Total Token Dideploy: <b>${totalCount} token</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
👇 <i>Pilih menu pengaturan atau deploy di bawah:</i>`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🚀 Deploy Token Baru ke Robinhood', 'cmd_robinhood_deploy_menu'),
        Markup.button.callback('🔥 Trending Robinhood', 'cmd_trending_rh')
      ],
      [
        Markup.button.callback(`🔄 Pair: ${curPair}`, 'cmd_robinhood_pair_menu'),
        Markup.button.callback(`✨ DEX: Uniswap ${curDex}`, 'cmd_robinhood_dex_menu')
      ],
      [
        Markup.button.callback(`🏷️ Atur Fee (${curBuyFee}% / ${curSellFee}%)`, 'cmd_robinhood_fee_menu'),
        Markup.button.callback('⚙️ Atur LP & Dev Buy', 'cmd_robinhood_lp_menu')
      ],
      [
        Markup.button.callback('🛠️ Semua Setting', 'cmd_robinhood_settings'),
        Markup.button.callback(`📜 Riwayat Deploy (${totalCount})`, 'cmd_robinhood_history')
      ],
      [
        Markup.button.callback('🔄 Refresh Status & Saldo', 'cmd_robinhood_menu'),
        Markup.button.callback('⬅️ Kembali ke Dashboard Utama', 'cmd_start_menu')
      ]
    ]);

    if (isEdit && ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
      } catch {}
    }
    return ctx.replyWithHTML(msg, keyboard);
  }

  async sendRobinhoodPairMenu(ctx, isEdit = false) {
    const curPair = storage.getRobinhoodPairToken();
    const curDex = storage.getRobinhoodDexVersion().toUpperCase();
    const check = (val) => curPair === val ? '✅ ' : '';

    const msg =
`🔄 <b>PENGATURAN TRADING PAIR ROBINHOOD (${curDex})</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Pilih quote token pasangan likuiditas yang akan digunakan saat deploy token di Robinhood Chain:

💎 <b>ETH (Native Gas - Default):</b> Pasangan native coin gas ETH di Robinhood Chain. Di Uniswap V4 disetor langsung sebagai native gas (address 0) tanpa wrap!
📦 <b>WETH (Wrapped ETH):</b> Pasangan Wrapped ETH (<code>${config.robinhoodWeth}</code>). Otomatis wrap ETH ke WETH sebelum masuk pool.
💵 <b>USDG (Stablecoin):</b> Pasangan stablecoin USDG di Robinhood Chain (<code>${config.robinhoodUsdg}</code>). Pastikan wallet memiliki saldo USDG.

🎯 <b>Setting Pair Aktif:</b> <b>${curPair}</b>

<i>Pilih pair di bawah atau gunakan:</i> <code>/rhpair [eth|weth|usdg]</code>`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`${check('ETH')}💎 ETH (Native - Default)`, 'set_rh_pair_ETH'),
        Markup.button.callback(`${check('WETH')}📦 WETH (Wrapped ETH)`, 'set_rh_pair_WETH')
      ],
      [
        Markup.button.callback(`${check('USDG')}💵 USDG (Stablecoin)`, 'set_rh_pair_USDG'),
        Markup.button.callback('🦄 Atur DEX Engine', 'cmd_robinhood_dex_menu')
      ],
      [
        Markup.button.callback('🏹 Kembali ke Menu Robinhood', 'cmd_robinhood_menu'),
        Markup.button.callback('⬅️ Dashboard Utama', 'cmd_start_menu')
      ]
    ]);

    if (isEdit && ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
      } catch {}
    }
    return ctx.replyWithHTML(msg, keyboard);
  }

  async sendRobinhoodDexMenu(ctx, isEdit = false) {
    const curDex = storage.getRobinhoodDexVersion();
    const curTier = storage.getRobinhoodV3FeeTier();
    const check = (val) => curDex === val ? '✅ ' : '';
    const checkTier = (val) => Number(curTier) === Number(val) ? '✅ ' : '';

    const msg =
`🦄 <b>PENGATURAN DEX ENGINE ROBINHOOD CHAIN</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Pilih versi protokol DEX &amp; Fee Tier pool untuk membuat likuiditas &amp; dev buy:

✨ <b>Uniswap V4 (Default &amp; Standar Utama):</b>
• Singleton PoolManager &amp; Position NFT
• Dukungan Native Gas ETH langsung (address 0)
• UniversalRouter eksekusi Dev Buy V4 berkecepatan tinggi

🦄 <b>Uniswap V3:</b>
• NonfungiblePositionManager NFT
• Full-Range Liquidity pada Factory V3

🎯 <b>DEX Aktif:</b> <b>Uniswap ${curDex.toUpperCase()}</b> | <b>Fee Tier:</b> <b>${curTier / 10000}% (${curTier} bps)</b>

<i>Pilih DEX &amp; Fee Tier di bawah atau ketik:</i> <code>/rhdex [v4|v3]</code>`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`${check('v4')}✨ Uniswap V4 (Default)`, 'set_rh_dex_v4'),
        Markup.button.callback(`${check('v3')}🦄 Uniswap V3`, 'set_rh_dex_v3')
      ],
      [
        Markup.button.callback('── 📊 Fee Tier Pool (LP Swap Fee) ──', 'dummy_rh_tier')
      ],
      [
        Markup.button.callback(`${checkTier(100)}0.01%`, 'set_rh_v3tier_100'),
        Markup.button.callback(`${checkTier(500)}0.05%`, 'set_rh_v3tier_500'),
        Markup.button.callback(`${checkTier(3000)}0.3%`, 'set_rh_v3tier_3000'),
        Markup.button.callback(`${checkTier(10000)}1% (Meme)`, 'set_rh_v3tier_10000')
      ],
      [
        Markup.button.callback('🔄 Atur Trading Pair', 'cmd_robinhood_pair_menu'),
        Markup.button.callback('⚙️ Atur LP & Dev Buy', 'cmd_robinhood_lp_menu')
      ],
      [
        Markup.button.callback('🏹 Kembali ke Menu Robinhood', 'cmd_robinhood_menu'),
        Markup.button.callback('⬅️ Dashboard Utama', 'cmd_start_menu')
      ]
    ]);

    if (isEdit && ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
      } catch {}
    }
    return ctx.replyWithHTML(msg, keyboard);
  }

  async sendRobinhoodLpMenu(ctx, isEdit = false) {
    const curLp = storage.getRobinhoodLpEth();
    const curDevBuy = storage.getRobinhoodDevBuyEth();
    const curPair = storage.getRobinhoodPairToken();
    const curDex = storage.getRobinhoodDexVersion().toUpperCase();
    const devBuyLabel = curDevBuy > 0 ? `🟢 ${curDevBuy} ETH` : '🔴 Nonaktif (0 ETH)';

    const msg =
`⚙️ <b>PENGATURAN LIKUIDITAS (LP) &amp; DEV BUY ROBINHOOD</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Atur jumlah <b>ETH / Quote</b> yang disetor ke Pool Uniswap ${curDex} (Pair: ${curPair}) dan nominal Dev Buy otomatis saat peluncuran token:

💧 <b>Setting LP Saat Ini:</b> <code>${curLp} ETH</code>
🛒 <b>Setting Dev Buy Saat Ini:</b> <code>${devBuyLabel}</code>
💡 <b>Rentang LP yang Diizinkan:</b> <code>0.000001</code> s/d <code>0.002 ETH</code>

<i>Pilih preset cepat di bawah atau ketik perintah chat:</i>
• <code>/rhlp 0.00001</code> s/d <code>/rhlp 0.002</code>
• <code>/devbuyrh 0.000001</code> (atau <code>/devbuyrh off</code>)`;

    const checkLp = (val) => Number(curLp) === Number(val) ? '✅ ' : '';
    const checkDevBuy = (val) => Number(curDevBuy) === Number(val) ? '✅ ' : '';

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`${checkLp(0.00001)}0.00001 ETH (Default)`, 'set_rh_lp_0.00001'),
        Markup.button.callback(`${checkLp(0.00005)}0.00005 ETH`, 'set_rh_lp_0.00005')
      ],
      [
        Markup.button.callback(`${checkLp(0.0001)}0.0001 ETH`, 'set_rh_lp_0.0001'),
        Markup.button.callback(`${checkLp(0.0005)}0.0005 ETH`, 'set_rh_lp_0.0005')
      ],
      [
        Markup.button.callback(`${checkLp(0.001)}0.001 ETH`, 'set_rh_lp_0.001'),
        Markup.button.callback(`${checkLp(0.002)}0.002 ETH (Max)`, 'set_rh_lp_0.002')
      ],
      [
        Markup.button.callback('── 🛒 Atur Dev Buy Otomatis ──', 'dummy_rh_devbuy')
      ],
      [
        Markup.button.callback(`${checkDevBuy(0.000001)}0.000001 ETH`, 'set_rh_devbuy_0.000001'),
        Markup.button.callback(`${checkDevBuy(0.00001)}0.00001 ETH`, 'set_rh_devbuy_0.00001'),
        Markup.button.callback(`${checkDevBuy(0.0001)}0.0001 ETH`, 'set_rh_devbuy_0.0001'),
        Markup.button.callback(`${curDevBuy === 0 ? '✅ ' : ''}❌ OFF`, 'set_rh_devbuy_off')
      ],
      [
        Markup.button.callback('🔄 Ubah Trading Pair', 'cmd_robinhood_pair_menu'),
        Markup.button.callback('🏹 Menu Robinhood', 'cmd_robinhood_menu')
      ]
    ]);

    if (isEdit && ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
      } catch {}
    }
    return ctx.replyWithHTML(msg, keyboard);
  }

  async sendRobinhoodFeeMenu(ctx, isEdit = false) {
    const curBuyFee = storage.getRobinhoodBuyFee();
    const curSellFee = storage.getRobinhoodSellFee();

    const msg =
`🏷️ <b>PENGATURAN FEE JUAL &amp; BELI (ROBINHOOD CHAIN)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Pengaturan fee ini <b>khusus berlaku untuk jaringan Robinhood Chain</b> (Chain ID 4663).

💰 <b>Mekanisme Fee &amp; Proteksi Sniper:</b>
• Fee dipotong otomatis on-chain saat swap beli maupun jual dan dikirim ke Fee Wallet (deployer).
• <b>Anti-Sniper Protection:</b> Saat 30 menit pertama peluncuran, sniper buy tax <b>80%</b> aktif untuk menahan bot sniper. Setelah periode sniper selesai, pajak beli otomatis mengikuti <b>Fee Beli (${curBuyFee}%)</b> ini.

📊 <b>Konfigurasi Fee Saat Ini:</b>
• 🟢 <b>Fee Beli (Buy Fee):</b> <b>${curBuyFee}%</b>
• 🔴 <b>Fee Jual (Sell Fee):</b> <b>${curSellFee}%</b>

👇 <i>Pilih preset kombinasi atau klik persentase individual di bawah:</i>

💬 <b>Perintah Chat Langsung:</b>
• <code>/rhfee &lt;buy%&gt; &lt;sell%&gt;</code> (Contoh: <code>/rhfee 3 5</code>)
• <code>/rhbuyfee &lt;%&gt;</code> | <code>/rhsellfee &lt;%&gt;</code>`;

    const isPreset = (b, s) => (Number(curBuyFee) === b && Number(curSellFee) === s) ? '✅ ' : '';
    const isBuy = (b) => Number(curBuyFee) === b ? '✅ ' : '';
    const isSell = (s) => Number(curSellFee) === s ? '✅ ' : '';

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`${isPreset(0, 0)}0% / 0% (Bebas Fee)`, 'set_rh_fees_0_0'),
        Markup.button.callback(`${isPreset(1, 1)}1% / 1% (Rendah)`, 'set_rh_fees_1_1')
      ],
      [
        Markup.button.callback(`${isPreset(3, 3)}3% / 3% (Standar)`, 'set_rh_fees_3_3'),
        Markup.button.callback(`${isPreset(5, 5)}5% / 5% (Default)`, 'set_rh_fees_5_5')
      ],
      [
        Markup.button.callback(`${isPreset(3, 5)}3% Buy / 5% Sell`, 'set_rh_fees_3_5'),
        Markup.button.callback(`${isPreset(5, 10)}5% Buy / 10% Sell`, 'set_rh_fees_5_10')
      ],
      [
        Markup.button.callback('── 🟢 Atur Fee Beli (Buy Fee) ──', 'dummy_rh_buy')
      ],
      [
        Markup.button.callback(`${isBuy(0)}0%`, 'set_rh_buyfee_0'),
        Markup.button.callback(`${isBuy(1)}1%`, 'set_rh_buyfee_1'),
        Markup.button.callback(`${isBuy(2)}2%`, 'set_rh_buyfee_2'),
        Markup.button.callback(`${isBuy(3)}3%`, 'set_rh_buyfee_3'),
        Markup.button.callback(`${isBuy(5)}5%`, 'set_rh_buyfee_5'),
        Markup.button.callback(`${isBuy(10)}10%`, 'set_rh_buyfee_10')
      ],
      [
        Markup.button.callback('── 🔴 Atur Fee Jual (Sell Fee) ──', 'dummy_rh_sell')
      ],
      [
        Markup.button.callback(`${isSell(0)}0%`, 'set_rh_sellfee_0'),
        Markup.button.callback(`${isSell(1)}1%`, 'set_rh_sellfee_1'),
        Markup.button.callback(`${isSell(2)}2%`, 'set_rh_sellfee_2'),
        Markup.button.callback(`${isSell(3)}3%`, 'set_rh_sellfee_3'),
        Markup.button.callback(`${isSell(5)}5%`, 'set_rh_sellfee_5'),
        Markup.button.callback(`${isSell(10)}10%`, 'set_rh_sellfee_10')
      ],
      [
        Markup.button.callback('🚀 Ke Panel Deploy', 'cmd_robinhood_deploy_menu'),
        Markup.button.callback('🏹 Menu Robinhood', 'cmd_robinhood_menu')
      ]
    ]);

    if (isEdit && ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
      } catch {}
    }
    return ctx.replyWithHTML(msg, keyboard);
  }

  async sendRobinhoodDeployMenu(ctx, isEdit = false) {
    const curLp = storage.getRobinhoodLpEth();
    const curDevBuy = storage.getRobinhoodDevBuyEth();
    const curPair = storage.getRobinhoodPairToken();
    const curDex = storage.getRobinhoodDexVersion().toUpperCase();
    const curBuyFee = storage.getRobinhoodBuyFee();
    const curSellFee = storage.getRobinhoodSellFee();

    const msg =
`🚀 <b>DEPLOY TOKEN KE ROBINHOOD CHAIN (ID: 4663)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Gunakan perintah berikut untuk deploy token ERC-20 mandiri ke Robinhood Chain (Gas ETH):

<b>Format perintah:</b>
<code>/deployrobinhood [NamaToken] [TICKER] [Pair] [LpETH] [Fee%] [ImageUrl]</code>

<b>Contoh siap pakai (sesuai setting aktif):</b>
<code>/deployrobinhood MoonToken MOON ${curPair} ${curLp} ${curBuyFee}</code>

⚙️ <b>Setting Aktif:</b>
• DEX Engine: <b>Uniswap ${curDex}</b>
• Trading Pair: <b>TOKEN / ${curPair}</b>
• LP Awal: <b>${curLp} ETH</b> + <b>20B Token</b>
• Dev Buy: <b>${curDevBuy > 0 ? curDevBuy + ' ETH' : 'Nonaktif'}</b>
• Fee: <b>${curBuyFee}% Buy / ${curSellFee}% Sell</b>
• Anti-Sniper: <b>80% Buy Tax (30 Menit)</b>
• Team Lock: <b>6B Token (3 Jam)</b>`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🎯 Quick Demo Deploy', 'cmd_robinhood_quick_demo'),
        Markup.button.callback('⚙️ Ubah Setting', 'cmd_robinhood_settings')
      ],
      [
        Markup.button.callback(`🔄 Pair: ${curPair}`, 'cmd_robinhood_pair_menu'),
        Markup.button.callback(`🏷️ Fee: ${curBuyFee}%/${curSellFee}%`, 'cmd_robinhood_fee_menu')
      ],
      [
        Markup.button.callback('💧 Atur LP & Dev Buy', 'cmd_robinhood_lp_menu'),
        Markup.button.callback('🏹 Kembali ke Menu Robinhood', 'cmd_robinhood_menu')
      ]
    ]);

    if (isEdit && ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
      } catch {}
    }
    return ctx.replyWithHTML(msg, keyboard);
  }

  async sendRobinhoodSettingsMenu(ctx, isEdit = false) {
    const curLp = storage.getRobinhoodLpEth();
    const curDevBuy = storage.getRobinhoodDevBuyEth();
    const curPair = storage.getRobinhoodPairToken();
    const curDex = storage.getRobinhoodDexVersion().toUpperCase();
    const curBuyFee = storage.getRobinhoodBuyFee();
    const curSellFee = storage.getRobinhoodSellFee();
    const curV3Fee = storage.getRobinhoodV3FeeTier();

    const msg =
`⚙️ <b>PUSAT SETTING ROBINHOOD CHAIN DEPLOY</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Atur seluruh parameter deploy Robinhood Chain langsung lewat tombol interaktif di bawah atau via perintah chat:

🔧 <b>PARAMETER AKTIF SAAT INI:</b>
• DEX Engine: <b>Uniswap ${curDex}</b>
• Trading Pair: <b>${curPair}</b>
• Fee Tier Pool: <b>${curV3Fee / 10000}% (${curV3Fee} bps)</b>
• Likuiditas Pool (LP): <b>${curLp} ETH</b>
• Dev Buy Otomatis: <b>${curDevBuy > 0 ? curDevBuy + ' ETH' : 'Nonaktif'}</b>
• Fee Beli / Jual: <b>${curBuyFee}% Buy / ${curSellFee}% Sell</b>
• Anti-Sniper: <b>80% Buy Tax (30 Menit)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 <b>PERINTAH CHAT CEPAT:</b>
• <code>/rhpair [eth|weth|usdg]</code> • <code>/rhdex [v4|v3]</code>
• <code>/rhlp [0.000001-0.002]</code> • <code>/devbuyrh [jumlah|off]</code>
• <code>/rhfee [buy] [sell]</code> • <code>/rhbuyfee [0-25]</code> • <code>/rhsellfee [0-25]</code>`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`🔄 Pair: ${curPair}`, 'cmd_robinhood_pair_menu'),
        Markup.button.callback(`🦄 DEX: Uniswap ${curDex}`, 'cmd_robinhood_dex_menu')
      ],
      [
        Markup.button.callback(`💧 LP & Dev Buy (${curLp} ETH)`, 'cmd_robinhood_lp_menu'),
        Markup.button.callback(`🏷️ Fee (${curBuyFee}% / ${curSellFee}%)`, 'cmd_robinhood_fee_menu')
      ],
      [
        Markup.button.callback('🚀 Panel Deploy Token', 'cmd_robinhood_deploy_menu'),
        Markup.button.callback('🏹 Menu Robinhood', 'cmd_robinhood_menu')
      ]
    ]);

    if (isEdit && ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
      } catch {}
    }
    return ctx.replyWithHTML(msg, keyboard);
  }

  async executeDeployRobinhood(ctx, options = {}) {
    const name = (options.name || '').trim();
    const symbol = (options.symbol || '').trim().toUpperCase();
    if (!name || !symbol) {
      return ctx.replyWithHTML('⚠️ <b>Nama dan ticker token wajib diisi!</b>\nContoh: <code>/deployrobinhood MoonToken MOON</code>');
    }

    const ethLp = String(options.ethLiquidity || storage.getRobinhoodLpEth() || '0.00001');
    const devBuyEth = String(options.devBuyEth !== undefined ? options.devBuyEth : storage.getRobinhoodDevBuyEth());
    const pairChoice = (options.pair || storage.getRobinhoodPairToken() || 'ETH').toUpperCase();
    const dexVersion = (options.dexVersion || storage.getRobinhoodDexVersion() || 'v4').toLowerCase();
    const dexName = dexVersion === 'v4' ? 'Uniswap V4' : 'Uniswap V3';
    const curBuyFee = Number(options.buyFee !== undefined ? options.buyFee : storage.getRobinhoodBuyFee());
    const curSellFee = Number(options.sellFee !== undefined ? options.sellFee : storage.getRobinhoodSellFee());
    const feeTier = Number(options.feeTier || storage.getRobinhoodV3FeeTier() || 10000);

    const initialMsg = await ctx.replyWithHTML(
      `🏹 <b>MEMULAI DEPLOYMENT KE ROBINHOOD CHAIN (ID 4663)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `• Token: <b>${escapeHtml(name)}</b> (<code>$${escapeHtml(symbol)}</code>)\n` +
      `• Logo: <b>${options.imageUrl ? 'Logo Diterapkan (IPFS) ✅' : 'Default Pinata Logo'}</b>\n` +
      `• DEX Engine: <b>${dexName}</b>\n` +
      `• Trading Pair: <b>TOKEN / ${pairChoice}</b>\n` +
      `• Likuiditas Pool: <b>${ethLp} ETH / Quote</b> + <b>20B ${escapeHtml(symbol)}</b>\n` +
      `• Dev Buy Otomatis: <b>${Number(devBuyEth) > 0 ? `${devBuyEth} ETH` : 'Nonaktif'}</b>\n` +
      `• Fee Transaksi: <b>${curBuyFee}% Buy / ${curSellFee}% Sell</b>\n` +
      `• Proteksi Sniper: <b>80% Buy Tax (30 Menit Pertama)</b>\n\n` +
      `⏳ <i>Langkah 1/8: Memeriksa saldo ETH, quote token, &amp; parameter on-chain...</i>`
    );

    const progressUpdates = async (step, msg) => {
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          initialMsg.message_id,
          null,
          `🏹 <b>DEPLOYMENT KE ROBINHOOD CHAIN (ID 4663)</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `• Token: <b>${escapeHtml(name)}</b> (<code>$${escapeHtml(symbol)}</code>)\n` +
          `• DEX &amp; Pair: <b>${dexName}</b> (Pair: <code>${pairChoice}</code>)\n` +
          `• Status: <b>Langkah ${step}/8</b>\n\n` +
          `⏳ <i>${escapeHtml(msg)}</i>`,
          { parse_mode: 'HTML' }
        );
      } catch {}
    };

    try {
      const deployOptions = {
        ...options,
        name,
        symbol,
        imageUrl: options.imageUrl || '',
        pair: pairChoice,
        dexVersion,
        feeTier,
        ethLiquidity: ethLp,
        devBuyEth,
        buyFee: curBuyFee,
        sellFee: curSellFee,
        totalSupply: options.totalSupply || config.robinhoodDefaultTotalSupply
      };

      const result = await robinhoodService.deployToken(deployOptions, progressUpdates);

      const summaryMsg =
`🎉 <b>TOKEN BERHASIL DIDEPLOY &amp; LIVE DI ROBINHOOD CHAIN!</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
🪙 <b>Info Token:</b>
• Nama: <b>${escapeHtml(result.token.name)}</b>
• Ticker: <code>$${escapeHtml(result.token.symbol)}</code>
• Kontrak Token: <code>${result.token.address}</code>
• Logo IPFS/URL: <a href="${toHttpImageUrl(result.token?.imageUrl || options.imageUrl)}">Lihat Gambar Logo</a>
• Total Supply: <b>${Number(result.token.totalSupply || 100000000000).toLocaleString()}</b>

💧 <b>${result.dexVersion} Pool &amp; Likuiditas:</b>
• Trading Pair: <b>TOKEN / ${result.pairToken}</b>
• Alamat Pool (Pair): <code>${result.liquidity.poolAddress}</code>
${result.positionTokenId ? `• Position NFT: <b>${result.dexVersion} Position #${result.positionTokenId}</b>\n` : ''}• Likuiditas Awal: <b>${result.liquidity.quoteDeposited}</b> + <b>${result.liquidity.tokensDeposited}</b>
• Dev Buy Otomatis: <b>${result.liquidity.devBuyEth}</b>
• Harga Awal: <code>${result.liquidity.initialPrice} ${result.pairToken}</code>
• Trading: <b>🟢 AKTIF (Bisa dibeli &amp; dijual langsung!)</b>

🛡️ <b>Proteksi &amp; Pajak:</b>
• Fee Transaksi: <b>${curBuyFee}% Buy / ${curSellFee}% Sell</b>
• Sniper Protection: <b>80% Buy Tax (30 Menit Pertama)</b>
${result.lock?.address ? `• Timelock: <code>${result.lock.address}</code> (${result.lock.amount} Token)\n` : ''}
🔗 <b>Transaction Hashes:</b>
• Deploy Token: <a href="${result.urls.tokenExplorer}">${result.token.deployTxHash.slice(0, 14)}...</a>
• Add Liquidity: <code>${result.liquidity.addLiquidityTxHash.slice(0, 14)}...</code>
• Enable Trading: <code>${result.liquidity.enableTradingTxHash.slice(0, 14)}...</code>
${result.liquidity.devBuyTxHash ? `• Dev Buy Tx: <code>${result.liquidity.devBuyTxHash.slice(0, 14)}...</code>\n` : ''}━━━━━━━━━━━━━━━━━━━━━━━━━━
👇 <i>Klik tautan di bawah untuk melihat di Blockscout Explorer &amp; DEX:</i>`;

      const buttons = [
        [
          Markup.button.url('🔍 Lihat di Blockscout', result.urls.tokenExplorer),
          Markup.button.url('📊 DexScreener', result.urls.dexscreener)
        ],
        [
          Markup.button.url('💧 Lihat Pool di Explorer', result.urls.poolExplorer)
        ],
        [
          Markup.button.callback('🏹 Dashboard Robinhood', 'cmd_robinhood_menu'),
          Markup.button.callback('⬅️ Menu Utama', 'cmd_start_menu')
        ]
      ];

      const rawLogo = result.token?.imageUrl || options.imageUrl;
      const photoUrl = toHttpImageUrl(rawLogo);

      if (photoUrl && photoUrl.startsWith('http')) {
        try {
          await ctx.replyWithPhoto(photoUrl, {
            caption: summaryMsg,
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard(buttons)
          });
        } catch (photoErr) {
          console.warn('[RobinhoodBot] replyWithPhoto failed, fallback to replyWithHTML:', photoErr.message);
          await ctx.replyWithHTML(summaryMsg, Markup.inlineKeyboard(buttons));
        }
      } else {
        await ctx.replyWithHTML(summaryMsg, Markup.inlineKeyboard(buttons));
      }
    } catch (err) {
      console.error('[executeDeployRobinhood] error:', err);
      await ctx.replyWithHTML(
        `❌ <b>Deployment ke Robinhood Chain Gagal!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `• Error: <code>${escapeHtml(err.message)}</code>\n\n` +
        `💡 <i>Pastikan saldo ETH di wallet deployer mencukupi untuk LP + Dev Buy + gas, lalu coba lagi.</i>`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Coba Lagi', 'cmd_robinhood_deploy_menu')],
          [Markup.button.callback('🏹 Dashboard Robinhood', 'cmd_robinhood_menu')]
        ])
      );
    }
  }

  async sendRobinhoodHistory(ctx) {
    const tokens = storage.getRobinhoodDeployedTokens();
    if (!tokens || tokens.length === 0) {
      const msg = '📭 <b>Belum ada token yang dideploy di Robinhood Chain.</b>\n\nGunakan <code>/deployrobinhood Nama TICKER</code> untuk mulai deploy token pertama Anda!';
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Deploy Sekarang', 'cmd_robinhood_deploy_menu')],
        [Markup.button.callback('🏹 Menu Robinhood', 'cmd_robinhood_menu')]
      ]);
      try {
        if (ctx.callbackQuery) {
          await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
        } else {
          await ctx.replyWithHTML(msg, keyboard);
        }
      } catch { await ctx.replyWithHTML(msg, keyboard); }
      return;
    }

    const explorerBase = config.robinhoodExplorer || 'https://robinhoodchain.blockscout.com';
    const recent = tokens.slice(0, 5);
    let msg = `📜 <b>RIWAYAT DEPLOY ROBINHOOD CHAIN (${tokens.length} token)</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

    for (let i = 0; i < recent.length; i++) {
      const t = recent[i];
      const date = t.deployedAt ? new Date(t.deployedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-';
      const shortAddr = t.tokenAddress ? `${t.tokenAddress.slice(0, 8)}...${t.tokenAddress.slice(-6)}` : '-';
      const pair = t.pairToken || t.pair || '-';
      const lpEth = t.ethDeposited || t.ethLiquidity || '-';
      const buyF = t.buyFee ?? t.buyFeePercent ?? '-';
      const sellF = t.sellFee ?? t.sellFeePercent ?? '-';
      msg +=
        `\n<b>${i + 1}. ${escapeHtml(t.name)} ($${escapeHtml(t.symbol)})</b>\n` +
        `• Alamat: <a href="${explorerBase}/address/${t.tokenAddress}"><code>${shortAddr}</code></a>\n` +
        `• Pair: ${pair} | DEX: ${String(t.dexVersion || '-').toUpperCase()}\n` +
        `• LP: ${lpEth} ETH | Fee: ${buyF}%B / ${sellF}%S\n` +
        `• Deploy: ${date}\n`;
    }

    if (tokens.length > 5) msg += `\n<i>... dan ${tokens.length - 5} token lainnya.</i>`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🚀 Deploy Token Baru', 'cmd_robinhood_deploy_menu')],
      [Markup.button.callback('🏹 Menu Robinhood', 'cmd_robinhood_menu')]
    ]);
    try {
      if (ctx.callbackQuery) {
        await ctx.editMessageText(msg, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: keyboard.reply_markup });
      } else {
        await ctx.replyWithHTML(msg, { disable_web_page_preview: true, ...keyboard });
      }
    } catch { await ctx.replyWithHTML(msg, { disable_web_page_preview: true, ...keyboard }); }
  }
}

export const botApp = new TelegramBotApp();
