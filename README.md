# 🤖 Clanker x GeckoTerminal Auto-Deploy Telegram Bot (Base Network)

Bot Telegram cerdas untuk mendeteksi token trending secara otomatis dari **GeckoTerminal (Base Network)** dan mendeploy token tersebut ke **Clanker Protocol (Uniswap v4)** di Base chain.

---

## 🌟 Fitur Utama

1. **Scraping Real-Time GeckoTerminal**:
   - Otomatis mengambil token trending di Base network.
   - Mengambil nama token, ticker/symbol, dan logo resmi resolusi tinggi.
   - Menampilkan harga terkini, volume 24 jam, dan FDV.

2. **Clanker Protocol v4 Deployment (Base Chain)**:
   - **Dev Buy Otomatis**: Default `0.000001 ETH`.
   - **Deskripsi Profesional**: Menghasilkan deskripsi token DeFi kelas institusi secara otomatis untuk metadata on-chain.
   - **Permanent Fee 3%**: Static fee Uniswap v4 (1.5% Clanker + 1.5% Paired pool).
   - **Sniper Tax 120 Detik**: Proteksi anti-sniper bot dengan decay fee dari 50% ke 3% selama 120 detik pertama.
   - **Creator Vault 5%**: Alokasi vault 5% otomatis dikunci ke creator address.
   - **Pool Project (10 Range Positions)**: Menggunakan konfigurasi likuiditas Uniswap v4 `POOL_POSITIONS.Project`.
   - **Airdrop Support**: Dukungan airdrop menggunakan Merkle Tree dengan durasi lockup 1 hari atau instan ke wallet yang ditentukan.
   - **2x Pengulangan Batch dengan Suffix "BASE"**:
     Setiap token trending yang dideploy akan dibuat 2 kali:
     - Deploy 1: `[Nama Asli]` dengan ticker `$TICKER`
     - Deploy 2: `[Nama Asli] BASE` dengan ticker `$TICKER`

3. **Kontrol Interaktif Telegram**:
   - Menu tombol interaktif (Inline Keyboard).
   - Tombol instan 1-klik untuk mendeploy token trending langsung dari chat.
   - Mode **Auto-Deploy** yang memonitor GeckoTerminal di latar belakang dan otomatis mendeploy token baru tanpa perlu disentuh.
   - Monitoring saldo wallet deployer di Base network.
   - Riwayat link transaksi langsung ke **BaseScan**, **DexScreener**, dan **Clanker.world**.

---

## 📁 Struktur Folder

```
clanker-gecko-bot/
├── src/
│   ├── config.js         # Konfigurasi & pembaca variabel .env
│   ├── storage.js        # Penyimpanan token yang telah dideploy & state bot
│   ├── geckoService.js   # Scraper API GeckoTerminal untuk token trending
│   ├── clankerService.js # Interaksi smart contract Clanker v4 (viem & clanker-sdk)
│   └── bot.js            # Engine bot Telegram (Telegraf)
├── data/
│   ├── deployed_tokens.json  # Database riwayat token yang sudah dideploy
│   └── bot_state.json        # Status state auto-deploy & setting
├── .env                  # File konfigurasi privat (Wallet & Bot Token)
├── .env.example          # Template konfigurasi
├── package.json          # Dependensi project (ESM)
├── index.js              # Entry point aplikasi
└── README.md             # Dokumentasi lengkap
```

---

## 🚀 Panduan Setup & Instalasi

### 1. Masuk ke Direktori Proyek
Proyek berada di:
```bash
cd C:\Users\amz\.gemini\antigravity-ide\scratch\clanker-gecko-bot
```

### 2. Konfigurasi File `.env`
Buka file `.env` di text editor dan sesuaikan isinya:

```env
# 1. Token Telegram dari @BotFather
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz

# 2. (Opsional) ID Telegram Anda agar bot hanya merespon Anda (Cek di @userinfobot)
TELEGRAM_CHAT_ID=

# 3. Private Key Wallet Deployer di Base Network (Format: 0x...)
# Pastikan wallet memiliki sedikit saldo ETH Base untuk gas fee & dev buy
PRIVATE_KEY=0xyour_private_key_here

# 4. Mode Simulasi (Set false untuk deploy live ke Base mainnet)
DRY_RUN=false

# 5. Setting Otomatisasi
AUTO_DEPLOY=false
DEV_BUY_ETH=0.000001
PERMANENT_FEE_PERCENT=3
SNIPER_TAX_DURATION_SEC=120
CREATOR_VAULT_PERCENT=5
CREATOR_VAULT_LOCKUP_DAYS=7
REPEAT_DEPLOY_COUNT=2
REPEAT_SUFFIX=BASE
```

> **Tips Keamanan**:
> - Gunakan wallet khusus (burner/deployer wallet) dan isi dengan saldo ETH secukupnya untuk transaksi deploy.
> - Saat pertama kali mencoba, Anda bisa membiarkan `DRY_RUN=true` untuk melihat simulasi token address yang dihasilkan CREATE2 tanpa mengeluarkan gas fee sama sekali.

### 3. Jalankan Bot
Jalankan perintah berikut di terminal:
```bash
npm start
```

---

## 📱 Daftar Perintah Bot Telegram

Kirim perintah berikut ke bot Telegram Anda:

| Perintah | Deskripsi |
| :--- | :--- |
| `/start` | Menampilkan dashboard utama, status bot, saldo ETH, dan tombol aksi cepat. |
| `/trending` | Menampilkan daftar token trending teratas dari GeckoTerminal Base lengkap dengan foto, harga, volume, dan tombol `[ 🚀 Deploy via Clanker (2x) ]`. |
| `/autodeploy on` | Mengaktifkan auto-deploy otomatis jika ada token trending baru. |
| `/autodeploy off` | Menonaktifkan auto-deploy otomatis (hanya mode manual). |
| `/autodeploy primary` | Mengaktifkan auto-deploy HANYA untuk Wallet Utama (W1). |
| `/autodeploy all` | Mengaktifkan auto-deploy untuk SEMUA 3 Wallet secara simultan. |
| `/walletmode [all|primary]` | Beralih antara mode auto-deploy semua wallet atau hanya wallet utama. |
| `/deploy <Nama> <Ticker> [URL_Gambar]` | Mendeploy token kustom secara manual (akan membuat versi reguler dan versi "BASE"). |
| `/status` | Mengecek saldo ETH deployer, status RPC Base, dan jumlah token yang telah diluncurkan. |
| `/history` | Menampilkan daftar token yang sudah dideploy beserta tautan langsung ke BaseScan, DexScreener, dan Clanker. |
| `/settings` | Melihat parameter default (Dev Buy, Fee, Sniper Tax, Creator Vault, Suffix). |
| `/help` | Menampilkan petunjuk dan format penggunaan. |

---

## ⚙️ Detail Parameter Default

1. **Dev Buy**: `0.000001 ETH` ditransaksikan otomatis saat pembuatan pool untuk menginisialisasi pergerakan awal token.
2. **Permanent Fee**: `3%` Static Fee Uniswap v4 (dibagi rata `1.5%` Clanker hook + `1.5%` paired token pool).
3. **Sniper Tax**: Anti-snipe protection selama `120 detik` di mana fee dimulai dari 50% dan meluruh secara bertahap ke 3% untuk mencegah bot frontrunning.
4. **Creator Vault**: `5%` dari total suplai dialokasikan ke vault terkunci milik pembuat token.
5. **Pool Range Positions**: Menggunakan `PoolPositions.Project` (10 rentang likuiditas konsentrasi Uniswap v4).
6. **Suffix Pengulangan**: Deploy pertama `$TICKER` dengan nama asli, dan deploy kedua `$TICKER` dengan nama `[Nama] BASE`.
7. **Airdrop Support**: Jika alamat wallet airdrop dimasukkan di `AIRDROP_WALLETS`, bot secara otomatis membentuk OpenZeppelin Merkle Tree dan mendaftarkannya ke Clanker airdrop hook dengan durasi lockup 1 hari atau instan.
