import { ethers } from 'ethers';
import { elysiumService } from '../src/elysium/elysiumService.js';

const PAIR_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function transfer(address to, uint256 value) external returns (bool)',
  'function burn(address to) external returns (uint256 amount0, uint256 amount1)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)'
];

const WHYPE_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function withdraw(uint256) external'
];

async function main() {
  const wallet = elysiumService.getDeployerWallet();
  if (!wallet) throw new Error('Deployer wallet tidak ditemukan');
  const provider = wallet.provider;

  console.log('=== MEMULAI PENARIKAN SISA LIKUIDITAS UNISWAP V2 DI ELYSIUM ===');
  console.log('Deployer Wallet:', wallet.address);

  const startNativeBal = await provider.getBalance(wallet.address);
  console.log('Saldo Native HYPE Awal:', ethers.formatEther(startNativeBal), 'HYPE');

  const whypeAddr = '0xbA876237B0F021A6c6D852d6c26E107997cC5E81';
  const whype = new ethers.Contract(whypeAddr, WHYPE_ABI, wallet);
  const startWhypeBal = await whype.balanceOf(wallet.address);
  console.log('Saldo WHYPE Awal:', ethers.formatEther(startWhypeBal), 'WHYPE');

  const targetPairs = [
    { id: 3, addr: '0xC8D850d8308E354f3bcb3DF131E54596b26da6aE', name: 'Boxa ($BOXA)' },
    { id: 4, addr: '0x96c42E9e6c206258de7570C094E99F6e3F2E7cbb', name: 'Bitcoin ($BTC)' },
    { id: 5, addr: '0xA587Cb09246389A670105Be98ba4bAa3775bB6d7', name: 'Dacity Coin ($DACITY)' },
    { id: 6, addr: '0xDDFb71490Ccf1D4bb89C5444cDD7f98dA3FdE342', name: 'Forg ($FORG)' },
    { id: 7, addr: '0x4d331650805A3794D08187FA8768E1bB0D01A2bc', name: 'FLOAT ($FLOAT)' },
    { id: 8, addr: '0x011E29b641343609bad56529764B2ED0d858962c', name: 'Big Titty Coin ($BTC)' },
    { id: 9, addr: '0x84e03487729A2518521a7F129EeCbFB494cB1A4b', name: 'PepeElysium ($PEPE)' },
    { id: 10, addr: '0x0aE5DA2Add9b2852Bb7773E9746F25Afc4e7039F', name: 'Clanker ($CLANKER)' },
    { id: 11, addr: '0x0bC62094eA345fd53DB8897FC0277Dac55483f8f', name: 'Twoprint ($PRINT)' },
    { id: 12, addr: '0x31a2483104022De3565Ac476C29118BB796f3D4c', name: 'Aether ($AETHER)' }
  ];

  for (const item of targetPairs) {
    console.log(`\n--- Memproses Pair #${item.id} [${item.name}]: ${item.addr} ---`);
    const pair = new ethers.Contract(item.addr, PAIR_ABI, wallet);
    const lpBal = await pair.balanceOf(wallet.address);
    console.log(`Saldo LP Token: ${lpBal.toString()}`);

    if (lpBal <= 0n) {
      console.log('Tidak ada saldo LP pada pair ini, melewati...');
      continue;
    }

    try {
      console.log(`1. Mentransfer ${lpBal.toString()} LP token ke pair contract...`);
      const txTransfer = await pair.transfer(item.addr, lpBal);
      await txTransfer.wait();
      console.log(`   Transfer sukses! Tx: ${txTransfer.hash}`);

      console.log(`2. Melakukan burn() untuk menarik underlying token & WHYPE...`);
      const txBurn = await pair.burn(wallet.address);
      const receipt = await txBurn.wait();
      console.log(`   Burn sukses! Tx: ${txBurn.hash}`);
    } catch (err) {
      console.error(`   Gagal memproses pair #${item.id}:`, err.message);
    }
  }

  // Unwrap seluruh WHYPE yang terkumpul
  console.log('\n--- Memeriksa Hasil WHYPE Yang Terkumpul ---');
  const curWhype = await whype.balanceOf(wallet.address);
  console.log(`Total WHYPE di wallet sekarang: ${ethers.formatEther(curWhype)} WHYPE`);

  if (curWhype > 0n) {
    console.log(`Meng-unwrap ${ethers.formatEther(curWhype)} WHYPE menjadi Native HYPE...`);
    const txUnwrap = await whype.withdraw(curWhype);
    await txUnwrap.wait();
    console.log(`Unwrap sukses! Tx: ${txUnwrap.hash}`);
  }

  const finalNative = await provider.getBalance(wallet.address);
  const finalWhype = await whype.balanceOf(wallet.address);
  console.log('\n=== REKAP SALDO AKHIR ===');
  console.log('Saldo Native HYPE:', ethers.formatEther(finalNative), 'HYPE');
  console.log('Saldo WHYPE:', ethers.formatEther(finalWhype), 'WHYPE');
}

main().catch(console.error);
