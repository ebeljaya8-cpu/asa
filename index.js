import { config } from './src/config.js';
import { botApp } from './src/bot.js';
import { clankerService } from './src/clankerService.js';
import { geckoService } from './src/geckoService.js';

console.log('========================================================');
console.log('🤖 CLANKER x GECKOTERMINAL AUTO DEPLOY TELEGRAM BOT');
console.log('========================================================');
console.log(`• Network: Base (Chain ID ${config.chainId})`);
console.log(`• RPC URL: ${config.rpcUrl}`);
console.log(`• Dry Run Mode: ${config.dryRun ? 'ON (Simulasi)' : 'OFF (Live)'}`);
console.log(`• Auto-Deploy: ${config.autoDeploy ? 'ENABLED' : 'DISABLED'}`);
console.log(`• Dev Buy: ${config.devBuyEth} ETH`);
console.log(`• Permanent Fee: ${config.permanentFeePercent}%`);
console.log(`• Sniper Tax: ${config.sniperTaxDurationSec}s`);
console.log(`• Creator Vault: ${config.creatorVaultPercent}%`);
console.log(`• Repeat Batch: ${config.repeatCount}x (Suffix: "${config.repeatSuffix}")`);
console.log('========================================================');

async function main() {
  const wallet = await clankerService.getWalletInfo();
  console.log(`💳 Wallet Address: ${wallet.address}`);
  console.log(`💰 Base ETH Balance: ${wallet.balanceEth} ETH`);

  if (!config.privateKey) {
    console.log('ℹ️ Catatan: PRIVATE_KEY belum diisi di .env. Bot akan berjalan dalam mode simulasi / dry-run.');
  }

  if (!config.telegramToken) {
    console.log('⚠️ TELEGRAM_BOT_TOKEN belum diisi di .env.');
    console.log('💡 Masukkan token dari @BotFather di file .env untuk mengaktifkan bot Telegram!');
    console.log('\n--- Uji Coba Scraper GeckoTerminal ---');
    const tokens = await geckoService.getTrendingTokens();
    console.log(`Ditemukan ${tokens.length} token trending di Base:`);
    tokens.slice(0, 3).forEach((t, i) => {
      console.log(` [${i + 1}] ${t.name} ($${t.symbol}) - Vol: $${Number(t.volume24h).toLocaleString()} - Logo: ${t.imageUrl}`);
    });
    console.log('\nBot siap digunakan. Isi .env dan jalankan `npm start` kembali.');
    return;
  }

  // Lightweight HTTP Health-Check Server (Ideal for Railway & Cloud deployment)
  const port = process.env.PORT || 3000;
  const http = await import('http');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      service: 'Clanker Gecko Telegram Bot',
      network: 'Base',
      wallet: wallet.address,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    }));
  });

  server.listen(port, () => {
    console.log(`🌐 Health-check server listening on port ${port} (Railway ready)`);
  });

  botApp.init();
  await botApp.start();

  // Enable graceful stop
  process.once('SIGINT', () => {
    server.close();
    botApp.stop();
  });
  process.once('SIGTERM', () => {
    server.close();
    botApp.stop();
  });
}

main().catch(err => {
  console.error('Fatal error starting bot:', err);
  process.exit(1);
});
