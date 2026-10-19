import { Telegraf, Markup } from 'telegraf';
import { config, getAirdropEntries } from './config.js';
import { storage } from './storage.js';
import { geckoService } from './geckoService.js';
import { trendingService } from './trendingService.js';
import { clankerService } from './clankerService.js';
import { vestingMonitor } from './vestingMonitor.js';
import { aiEngine } from './aiEngine.js';
import { xRadarService } from './xRadarService.js';

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export class TelegramBotApp {
  constructor() {
    this.token = config.telegramToken;
    this.bot = null;
    this.pollingInterval = null;
    this.isProcessingCandidate = false;
    this.trendingCache = [];
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
`📖 <b>PANDUAN LENGKAP PERINTAH BOT:</b>
• <code>/start</code> - Membuka dashboard utama & menu interaktif
• <code>/trending</code> - Daftar token trending lintas platform (+ Tombol Deploy)
  <i>Pilihan langsung: <code>/trending fresh</code>, <code>/trending robinhood</code>, <code>/trending arc</code>, <code>/trending base</code>, <code>/trending all</code></i>
• <code>/autodeploy on</code> - Aktifkan auto-deploy otomatis jika ada trending baru
• <code>/autodeploy off</code> - Matikan auto-deploy otomatis
• <code>/interval [15|30|60|120]</code> - Atur frekuensi auto-deploy (15m, 30m, 1j, 2j)
• <code>/active</code> - Cek token yang sudah selesai vesting 1 hari & memiliki LP > $1
• <code>/deploy &lt;Nama&gt; &lt;Ticker&gt; [ImageUrl]</code> - Deploy token manual via Clanker
• <code>/status</code> - Cek saldo ETH wallet & status bot
• <code>/history</code> - Riwayat token yang berhasil dideploy
• <code>/settings</code> - Detail parameter deploy (fee, anti-snipe, vault, airdrop)
━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>Fitur Khusus:</b>
1. <b>Mode Hemat Saldo:</b> Dev Buy minimal (<code>${config.devBuyEth} ETH</code>) & gas teroptimasi.
2. <b>Realtime Vesting Alert:</b> Notifikasi otomatis setelah token melewati lockup 1 hari jika likuiditas LP &gt; $1 dan ada pembeli.
3. <b>Batch Duplikasi:</b> Deploy 2 versi per token (versi reguler dan versi akhiran <code>BASE</code>).`;

      await ctx.replyWithHTML(helpMsg, Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')]
      ]));
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
        if (['rh', 'robinhood'].includes(arg)) {
          return this.sendTrendingList(ctx, 'robinhood');
        }
        if (['arc'].includes(arg)) {
          return this.sendTrendingList(ctx, 'arc');
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

    // /ai or /market command (Autonomous AI Market Intelligence)
    bot.command(['ai', 'market'], async (ctx) => {
      await this.sendAIMenu(ctx);
    });

    // /x or /alpha command (X / Twitter Radar)
    bot.command(['x', 'alpha', 'twitter'], async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1);
      if (parts.length > 0) {
        const text = parts.join(' ');
        const candidate = xRadarService.parseCustomTweet(text);
        await ctx.replyWithHTML(`🐦 <b>KANDIDAT DARI X TWEET:</b>\n\n• Nama: <b>${escapeHtml(candidate.name)}</b> (<code>$${escapeHtml(candidate.symbol)}</code>)\n• Narasi: <i>${escapeHtml(text)}</i>\n\n<i>Memulai deploy ke Base via Clanker...</i>`);
        const results = await clankerService.deployTrendingBatch(candidate);
        return this.sendBatchDeploymentSummary(ctx, results);
      }
      await this.sendXRadarMenu(ctx);
    });

    // /autodeploy [on|off]
    bot.command('autodeploy', async (ctx) => {
      const text = ctx.message.text.split(' ')[1]?.toLowerCase();
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
        `⚡ <b>Status Auto-Deploy:</b> ${statusText}\n\n${newState ? 'Bot otomatis memantau GeckoTerminal dan mendeploy token trending baru (2x pengulangan dengan akhiran BASE)!' : 'Auto-deploy dinonaktifkan. Anda tetap dapat mendeploy manual lewat tombol /trending.'}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Kembali ke Dashboard', 'cmd_start_menu')]
        ])
      );
    });

    // /deploy <name> <symbol> <imageUrl>
    bot.command('deploy', async (ctx) => {
      const parts = ctx.message.text.split(' ').slice(1);
      if (parts.length < 2) {
        return ctx.replyWithHTML('⚠️ <b>Format salah!</b>\nGunakan: <code>/deploy &lt;NamaToken&gt; &lt;Ticker&gt; [URL_Gambar]</code>\nContoh: <code>/deploy SuperDog SDOG https://example.com/logo.png</code>');
      }

      const name = parts[0];
      const symbol = parts[1].toUpperCase();
      const imageUrl = parts[2] || '';

      await ctx.replyWithHTML(`🚀 Memulai deploy batch untuk <b>${escapeHtml(name)}</b> (<code>$${escapeHtml(symbol)}</code>)...\nHarap tunggu proses di Base network.`);
      
      const batchResults = await clankerService.deployTrendingBatch({
        name,
        symbol,
        imageUrl,
        poolAddress: 'manual_deploy'
      });

      await this.sendBatchDeploymentSummary(ctx, batchResults);
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
      await ctx.replyWithHTML(`⚡ <b>Status Auto-Deploy berhasil diubah ke:</b> ${statusText}`);
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

    bot.action('cmd_x_radar', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await this.sendXRadarMenu(ctx);
    });

    bot.action('cmd_help', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply('Ketik /help untuk membaca panduan lengkap perintah.');
    });

    // Dynamic Deploy Button Action with short callback data (safe < 64 bytes)
    bot.action(/^d_idx_(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery('Memulai proses deploy...').catch(() => {});
      const idx = parseInt(ctx.match[1], 10);
      let targetToken = this.trendingCache ? this.trendingCache[idx] : null;

      if (!targetToken) {
        const trending = await geckoService.getTrendingTokens();
        targetToken = trending[idx];
      }

      if (!targetToken) {
        return ctx.reply('⚠️ Data token tidak ditemukan. Silakan buka /trending untuk memperbarui daftar.');
      }

      const activeSuffix = storage.getRepeatSuffix();
      const isNone = activeSuffix.toUpperCase() === 'NONE';
      const suffixText = isNone 
        ? `1. <code>${escapeHtml(targetToken.name)}</code> (1x Deploy)` 
        : `1. <code>${escapeHtml(targetToken.name)}</code>\n2. <code>${escapeHtml(targetToken.name)} ${escapeHtml(activeSuffix)}</code>`;

      await ctx.replyWithHTML(`⏳ <b>Memulai Deploy Clanker</b> untuk <b>${escapeHtml(targetToken.name)}</b> (<code>$${escapeHtml(targetToken.symbol)}</code>)...\n${suffixText}`);

      const results = await clankerService.deployTrendingBatch(targetToken);
      await this.sendBatchDeploymentSummary(ctx, results);
    });

    bot.action(/^deploy_(.+)$/, async (ctx) => {
      await ctx.answerCbQuery('Memulai proses deploy...').catch(() => {});
      const targetPoolId = ctx.match[1];
      
      const trending = await geckoService.getTrendingTokens();
      const targetToken = trending.find(t => t.id === targetPoolId || t.poolAddress === targetPoolId);

      if (!targetToken) {
        return ctx.reply('⚠️ Data token tidak ditemukan atau sudah kadaluarsa di cache GeckoTerminal. Silakan refresh /trending.');
      }

      const activeSuffix = storage.getRepeatSuffix();
      const isNone = activeSuffix.toUpperCase() === 'NONE';
      const suffixText = isNone 
        ? `1. <code>${escapeHtml(targetToken.name)}</code> (1x Deploy)` 
        : `1. <code>${escapeHtml(targetToken.name)}</code>\n2. <code>${escapeHtml(targetToken.name)} ${escapeHtml(activeSuffix)}</code>`;

      await ctx.replyWithHTML(`⏳ <b>Memulai Deploy Clanker</b> untuk <b>${escapeHtml(targetToken.name)}</b> (<code>$${escapeHtml(targetToken.symbol)}</code>)...\n${suffixText}`);

      const results = await clankerService.deployTrendingBatch(targetToken);
      await this.sendBatchDeploymentSummary(ctx, results);
    });
  }

  async sendStartMenu(ctx) {
    const state = storage.getState();
    const wallet = await clankerService.getWalletInfo();
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

    const message = 
`💎 <b>CLANKER x GECKOTERMINAL AUTO-DEPLOY (BASE)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Selamat datang di pusat kontrol bot token launchpad Base!

📊 <b>STATUS SISTEM:</b>
• Auto-Deploy: <b>${autoStatus}</b>
• Frekuensi Cek: <b>Setiap ${intervalLabel}</b>
• Mode Saldo: <b>Dev Buy Minimal (${config.devBuyEth} ETH) ✅</b>
• Mode Gas: <b>${gasModeLabel}</b> (Gas Base: <code>${gasInfo.gasPriceGwei} Gwei</code>)
• Wallet: <code>${wallet.address}</code>
• Saldo ETH: <b>${wallet.balanceEth} ETH</b>
• Token Dideploy: <b>${state.totalDeployedCount || 0} token</b>

⚙️ <b>SMART CONTRACT &amp; TOKENOMICS:</b>
• Deskripsi: <b>Institutional Pro DeFi Metadata</b>
• Fee: <b>3% Permanent</b> | Anti-Snipe: <b>120 Detik</b>
• Creator Vault: <b>5%</b> | Pool: <b>Project (10 Range)</b>
• Batch Duplikasi: <b>${suffixDisplay}</b>
• Airdrop: <b>Merkle Tree 1-Hari Terpasang</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
👇 <i>Pilih menu di bawah:</i>`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🔥 Trending Multi-Chain', 'cmd_trending_menu'),
        Markup.button.callback('🐦 X / Twitter Radar', 'cmd_x_radar')
      ],
      [
        Markup.button.callback('🧠 AI Market Brain', 'cmd_ai_menu'),
        Markup.button.callback('⚡ Toggle Auto-Deploy', 'cmd_toggle_autodeploy')
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
    const wallet = await clankerService.getWalletInfo();
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

    const msg = 
`📊 <b>STATUS BOT, WALLET &amp; BIAYA GAS BASE</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
• Auto-Deploy: <b>${autoStatus}</b>
• Frekuensi Cek: <b>Setiap ${intervalLabel}</b>
• Suffix Nama: <b>${suffixDisplay}</b>
• Mode Gas: <b>${gasModeLabel}</b>
• Gas Base Saat Ini: <code>${gasInfo.gasPriceGwei} Gwei</code> (${gasInfo.recommendation})
• Mode: <b>${config.dryRun ? '🧪 Dry Run (Simulasi)' : '⚡ Live Mainnet (Base)'}</b>
• Dev Buy: <code>${config.devBuyEth} ETH</code> (Biaya Terendah)
• Deployer: <code>${wallet.address}</code>
• Saldo ETH: <b>${wallet.balanceEth} ETH</b>
• Total Dideploy: <b>${state.totalDeployedCount || 0} token</b>
• Pinata IPFS: <b>Aktif &amp; Terhubung ✅</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    await ctx.replyWithHTML(msg, Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Refresh Status & Gas', 'cmd_status')],
      [
        Markup.button.callback('⛽ Atur Mode Gas', 'cmd_gas_menu'),
        Markup.button.callback('⏱️ Atur Durasi', 'cmd_interval_menu')
      ],
      [
        Markup.button.callback('⚡ Ubah Auto-Deploy', 'cmd_toggle_autodeploy'),
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

    const msg = 
`⚙️ <b>PENGATURAN PARAMETER CLANKER (DEFAULT)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
⏱️ <b>Durasi Auto-Deploy:</b> <code>Setiap ${intervalLabel}</code>
🏷️ <b>Suffix Nama Token:</b> <code>${suffixDisplay}</code>
⛽ <b>Mode Gas Fee:</b> <code>${gasLabels[gasMode] || gasMode}</code>
💰 <b>Dev Buy:</b> <code>${config.devBuyEth} ETH</code> (Mode Biaya Terendah)
💸 <b>Permanent Fee:</b> <code>${config.permanentFeePercent}%</code> (Static Fee Uniswap v4)
🛡️ <b>Sniper Tax:</b> <code>${config.sniperTaxDurationSec} detik</code> (Decay 50% -&gt; 3%)
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

    const msg = 
`🧠 <b>AI AUTONOMOUS MARKET BRAIN &amp; SENTIMEN ON-CHAIN</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
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

🌐 <b>1. Semua Trending:</b> Agregasi cerdas multi-platform (Clanker, Koin Baru Fresh, Robinhood, ARC, DexScreener, Solana, Base, ETH, BSC)
🔥 <b>2. Koin Baru Exposure Tinggi:</b> Token baru rilis (<72j) dengan volume &amp; transaksi masif dari jaringan manapun
🏹 <b>3. Robinhood Network:</b> Token trending di jaringan L2 Robinhood (Arbitrum Orbit / Uniswap v3)
⚡ <b>4. ARC Network:</b> Token trending di ekosistem ARC (Circle EVM Layer-1)
🤖 <b>5. Clanker.world Top Trending Now:</b> Token teratas berdasarkan volume 24j &amp; transaksi on-chain di Clanker.world
🦅 <b>6. DexScreener Trending All-Chain:</b> Token viral multi-chain real-time (Solana, Base, Ethereum, BSC, Arbitrum, dll.)
🔵 <b>7. Base Network:</b> GeckoTerminal Base trending pools
💊 <b>8. Pump.fun (Solana):</b> Meme coins viral di Pump.fun / Solana
🦎 <b>9. CoinGecko Global:</b> Trending search &amp; coins global (Robinhood/Top Gainers)
🚀 <b>10. FOMO Top Boosts:</b> DexScreener boosted tokens lintas chain
🆕 <b>11. DexScreener New Pairs:</b> Pasangan baru Base dengan profil lengkap (profile=1)
💎 <b>12. Ethereum (ETH):</b> GeckoTerminal Ethereum trending pools
🟡 <b>13. BSC (Binance):</b> GeckoTerminal Binance Smart Chain trending
🦄 <b>14. Multi-DEX (Uniswap/Raydium):</b> Top DEX trending multi-platform

👇 <i>Klik kategori pilihan Anda:</i>`;

    await ctx.replyWithHTML(msg, Markup.inlineKeyboard([
      [
        Markup.button.callback('🌐 🔥 Semua Trending (All-in-One)', 'cmd_trending_all')
      ],
      [
        Markup.button.callback('🔥 Koin Baru Exposure Tinggi', 'cmd_trending_fresh')
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
    ]));
  }

  async sendTrendingList(ctx, category = 'all') {
    const labels = {
      all: '🌐 Semua Multi-Chain & Platform',
      fresh: '🔥 Koin Baru Exposure Tinggi (All-Chain Fresh & High Volume)',
      freshexp: '🔥 Koin Baru Exposure Tinggi (All-Chain Fresh & High Volume)',
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

    await ctx.reply(`🔍 Mengambil data token trending [${labels[category] || category}]...`);

    let tokens = [];
    if (category === 'robinhood' || category === 'rh') {
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
      return ctx.replyWithHTML(`⚠️ Tidak ada token trending yang ditemukan untuk kategori <b>${labels[category] || category}</b> saat ini.`);
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

      caption += `
• Harga: <b>$${parseFloat(token.priceUsd).toFixed(6)}</b>
• Volume: <b>$${Number(token.volume24h).toLocaleString()}</b>
• Pool: <code>${escapeHtml(token.poolName)}</code>
• Link Asal: <a href="${token.sourceUrl}">Info Pool / Token</a>`;

      const buttons = [
        [Markup.button.callback(`🚀 Deploy ke Base via Clanker`, `d_idx_${index}`)]
      ];

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
        await ctx.replyWithHTML(caption, Markup.inlineKeyboard(buttons));
      }
    }

    const refreshKey = category === 'coingecko' ? 'cg' : (category === 'robinhood' ? 'rh' : (category === 'freshexp' ? 'fresh' : category));

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
    console.log(`[AutoDeploy Poller] Started. Checking multi-chain trending (Clanker, Fresh High-Exposure, Robinhood, ARC, Base, Solana, Pump.fun, CoinGecko, FOMO) every ${label} (${intervalMs / 1000}s)...`);

    this.pollingInterval = setInterval(async () => {
      try {
        const state = storage.getState();
        if (!state.autoDeploy) return;
        if (this.isProcessingCandidate) return;

        this.isProcessingCandidate = true;

        // 1. Cek saldo wallet sebelum eksekusi
        const wallet = await clankerService.getWalletInfo();
        if (!config.dryRun && wallet.hasWallet) {
          const balanceNum = parseFloat(wallet.balanceEth) || 0;
          if (balanceNum < 0.00005) {
            await this.sendDetailedErrorReport({
              action: `Pemeriksaan Saldo Pra-Deploy (${label})`,
              errorMessage: `Saldo ETH Base tidak mencukupi: ${wallet.balanceEth} ETH (Dibutuhkan minimal ~0.0001 ETH untuk dev buy + gas)`,
              recommendation: `Kirim sedikit ETH ke alamat deployer: ${wallet.address}`,
              nextAction: 'Siklus deploy ditunda sementara sampai saldo mencukupi.'
            });
            return;
          }
        }

        // 2. Ambil seluruh kandidat token trending dari semua platform
        let allCandidates = [];
        try {
          allCandidates = await trendingService.getAllTrendingTokens();
        } catch (fetchErr) {
          await this.sendDetailedErrorReport({
            action: 'Pengambilan Data Trending Lintas Platform',
            errorMessage: fetchErr.message,
            nextAction: 'Mencoba mengambil token cadangan langsung dari Clanker.world...'
          });
          allCandidates = await trendingService.getClankerWorldTrending().catch(() => []);
        }

        if (!allCandidates || allCandidates.length === 0) {
          await this.sendDetailedErrorReport({
            action: 'Scanning Trending Multi-Chain',
            errorMessage: 'Tidak ada data trending yang ditemukan dari Clanker.world, GeckoTerminal, atau DexScreener.',
            recommendation: 'Periksa koneksi internet server atau endpoint API sumber data.',
            nextAction: 'Bot akan mencoba kembali pada jadwal pemeriksaan berikutnya.'
          });
          return;
        }

        // 3. Loop kandidat: jika token sudah pernah dideploy dengan nama/symbol yang sama,
        // otomatis langsung cari kandidat lain potensial sampai berhasil deploy minimal 1 token!
        let deployedSuccessfully = false;
        let attemptIndex = 0;
        const maxAttempts = 15;
        const skippedDuplicates = [];

        for (const candidate of allCandidates) {
          if (deployedSuccessfully || attemptIndex >= maxAttempts) break;

          // Cek apakah token dengan nama atau ticker ini sudah pernah dideploy
          if (storage.isTokenAlreadyDeployed(candidate.symbol, candidate.name)) {
            skippedDuplicates.push(`${candidate.name} ($${candidate.symbol})`);
            console.log(`[AutoDeploy] Token "${candidate.name}" ($${candidate.symbol}) sudah pernah di-deploy. Otomatis mencari kandidat potensial berikutnya...`);
            continue; // Langsung lewati dan cari kandidat berikutnya!
          }

          attemptIndex++;
          console.log(`[AutoDeploy] Mencoba deploy kandidat #${attemptIndex}: "${candidate.name}" ($${candidate.symbol}) dari ${candidate.sourceType}...`);

          // Beritahu Telegram kandidat yang sedang diproses
          if (config.telegramChatId && this.bot) {
            let notice = `⚡ <b>AUTODEPLOY SIKLUS RUTIN (MINIMAL 1 JAM = 1 TOKEN)</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            if (skippedDuplicates.length > 0) {
              notice += `ℹ️ <i>Melewati ${skippedDuplicates.length} token yang sudah pernah di-deploy (${skippedDuplicates.slice(0, 3).join(', ')}${skippedDuplicates.length > 3 ? '...' : ''}). Mencari kandidat baru potensial:</i>\n\n`;
            }
            notice += `🎯 <b>Kandidat Terpilih:</b> <b>${escapeHtml(candidate.name)}</b> (<code>$${escapeHtml(candidate.symbol)}</code>)\n`;
            notice += `• Sumber: <b>${escapeHtml(candidate.sourceType)}</b> (${candidate.sourceNetwork})\n`;
            notice += `• Volume 24j: <b>$${Number(candidate.volume24h).toLocaleString()}</b>\n\n`;
            notice += `⏳ <i>Mengeksekusi deploy ke Base Layer 2 via Clanker v4...</i>`;
            await this.bot.telegram.sendMessage(config.telegramChatId, notice, { parse_mode: 'HTML' }).catch(() => {});
          }

          // Eksekusi deploy token
          const results = await clankerService.deployTrendingBatch(candidate);
          const hasSuccess = results && results.some(r => r.success);

          if (hasSuccess) {
            deployedSuccessfully = true;
            storage.incrementAutoDeployCount();

            // Kirim notifikasi sukses lengkap ke Telegram
            if (config.telegramChatId && this.bot) {
              let summary = `🎉 <b>AUTO-DEPLOY BERHASIL! (Target 1 Token/Jam Terpenuhi)</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
              if (skippedDuplicates.length > 0) {
                summary += `ℹ️ <i>Melewati ${skippedDuplicates.length} token yang sudah pernah ada agar tidak terjadi duplikasi.</i>\n\n`;
              }
              for (const res of results) {
                if (res.success) {
                  summary += `✅ <b>${escapeHtml(res.targetName)}</b> (<code>$${escapeHtml(res.targetSymbol)}</code>)\n`;
                  summary += `• Contract: <code>${res.tokenAddress}</code>\n`;
                  summary += `• Links: <a href="${res.basescanUrl}">BaseScan</a> | <a href="${res.dexscreenerUrl}">DexScreener</a> | <a href="${res.clankerUrl}">Clanker</a>\n\n`;
                } else {
                  summary += `⚠️ <i>Batch variasi gagal: ${escapeHtml(res.error || 'Unknown')}</i>\n\n`;
                }
              }
              await this.bot.telegram.sendMessage(config.telegramChatId, summary, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
              }).catch(() => {});
            }
            break; // Selesai! Target 1 token tercapai.
          } else {
            // Deploy kandidat ini gagal! Kirim penjelasan detail ke Telegram lalu lanjut cari kandidat berikutnya
            const firstError = results[0]?.error || 'Penyedia RPC / Smart contract Clanker menolak transaksi';
            await this.sendDetailedErrorReport({
              action: `Deploy Kandidat #${attemptIndex}`,
              targetName: candidate.name,
              targetSymbol: candidate.symbol,
              errorMessage: firstError,
              nextAction: 'Otomatis langsung mencari dan mengeksekusi kandidat potensial berikutnya agar target 1 token per jam tetap tercapai.'
            });
            console.log(`[AutoDeploy] Deploy gagal untuk "${candidate.name}": ${firstError}. Lanjut ke kandidat berikutnya...`);
          }
        }

        // 4. JIKA SEMUA KANDIDAT SUDAH PERNAH DIDEPLOY ATAU GAGAL:
        // Bot TIDAK boleh menyerah, karena setiap minimal 1 jam bot WAJIB deploy 1 token!
        // Buat kandidat berbasis AI Alpha unik agar target deploy 1 jam pasti tercapai!
        if (!deployedSuccessfully) {
          console.log('[AutoDeploy] Semua kandidat trending umum sudah pernah dideploy / gagal. Menghasilkan kandidat AI Alpha unik baru agar target wajib 1 jam tetap terpenuhi...');
          
          const memory = aiEngine.getMemory();
          const keywords = (memory.successfulPatterns?.topKeywords || ['BASE', 'ALPHA', 'CLANKER', 'AI']).filter(k => k.length > 2);
          const randomKw1 = keywords[Math.floor(Math.random() * keywords.length)] || 'BASE';
          const randomKw2 = keywords[Math.floor(Math.random() * keywords.length)] || 'ALPHA';
          const uniqueSuffix = Date.now().toString().slice(-4);
          
          const aiCandidate = {
            name: `${randomKw1} ${randomKw2}`,
            symbol: `${randomKw1.slice(0, 3)}${randomKw2.slice(0, 2)}${uniqueSuffix.slice(-1)}`.toUpperCase(),
            imageUrl: 'https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw/295953fa-15ed-4d3c-241d-b6c1758c6200/original',
            volume24h: '10000',
            sourceType: 'AI Autonomous Alpha (Anti-Skip Guard)',
            sourceNetwork: 'BASE',
            poolAddress: `ai_generated_${Date.now()}`
          };

          if (config.telegramChatId && this.bot) {
            await this.bot.telegram.sendMessage(
              config.telegramChatId,
              `🤖 <b>MEMENUHI TARGET WAJIB (1 JAM = 1 TOKEN)</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `ℹ️ <i>Semua token trending reguler saat ini sudah pernah dideploy sebelumnya (${skippedDuplicates.length} token dilewati).\n` +
              `Sesuai aturan wajib deploy tiap jam, AI membentuk token Alpha potensial baru:</i>\n\n` +
              `🪙 <b>${escapeHtml(aiCandidate.name)}</b> (<code>$${escapeHtml(aiCandidate.symbol)}</code>)\n` +
              `⏳ <i>Mengeksekusi deploy ke Base...</i>`,
              { parse_mode: 'HTML' }
            ).catch(() => {});
          }

          const fallbackResults = await clankerService.deployTrendingBatch(aiCandidate);
          if (fallbackResults && fallbackResults.some(r => r.success)) {
            deployedSuccessfully = true;
            storage.incrementAutoDeployCount();

            if (config.telegramChatId && this.bot) {
              let summary = `🎉 <b>AUTO-DEPLOY BERHASIL (Target 1 Jam Tercapai!)</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
              for (const res of fallbackResults) {
                if (res.success) {
                  summary += `✅ <b>${escapeHtml(res.targetName)}</b> (<code>$${escapeHtml(res.targetSymbol)}</code>)\n` +
                             `• Contract: <code>${res.tokenAddress}</code>\n` +
                             `• Links: <a href="${res.basescanUrl}">BaseScan</a> | <a href="${res.dexscreenerUrl}">DexScreener</a> | <a href="${res.clankerUrl}">Clanker</a>\n\n`;
                }
              }
              await this.bot.telegram.sendMessage(config.telegramChatId, summary, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
              }).catch(() => {});
            }
          } else {
            const fbError = fallbackResults[0]?.error || 'Simulasi atau transaksi ditolak';
            await this.sendDetailedErrorReport({
              action: 'Deploy AI Autonomous Fallback',
              targetName: aiCandidate.name,
              targetSymbol: aiCandidate.symbol,
              errorMessage: fbError,
              recommendation: 'Periksa saldo ETH atau stabilitas RPC Base.',
              nextAction: 'Bot akan mengulang kembali pada jam berikutnya.'
            });
          }
        }
      } catch (err) {
        console.error('[AutoDeploy Poller Error]:', err);
        await this.sendDetailedErrorReport({
          action: 'Siklus Auto-Deploy Rutin',
          errorMessage: err.message || String(err),
          recommendation: 'Sistem mengalami error tak terduga. Bot akan mencoba me-recover pada siklus selanjutnya.',
          nextAction: 'Melakukan log error dan mereset status poller.'
        });
      } finally {
        this.isProcessingCandidate = false;
      }
    }, intervalMs);
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
    vestingMonitor.stop();
    if (this.bot) this.bot.stop();
  }
}

export const botApp = new TelegramBotApp();
