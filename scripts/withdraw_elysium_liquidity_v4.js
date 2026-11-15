import { ethers } from 'ethers';
import { elysiumService } from '../src/elysium/elysiumService.js';

async function main() {
  const wallet = elysiumService.getDeployerWallet();
  if (!wallet) throw new Error('Wallet deployer tidak ditemukan');
  const provider = wallet.provider;

  console.log('=== MEMULAI PENARIKAN LIKUIDITAS DI ELYSIUM (TAHAP 3: UNISWAP V4) ===');
  console.log('Deployer Wallet:', wallet.address);
  let balHypeBefore = await provider.getBalance(wallet.address);
  console.log('Saldo Native HYPE Saat Ini:', ethers.formatEther(balHypeBefore), 'HYPE');

  const whypeAddr = '0xbA876237B0F021A6c6D852d6c26E107997cC5E81';
  const whypeAbi = [
    'function balanceOf(address) view returns (uint256)',
    'function withdraw(uint256) external'
  ];
  const whype = new ethers.Contract(whypeAddr, whypeAbi, wallet);

  const posmAddr = '0x1d1C51b9d07fD27d36412A2b66CC23D19Eb3E518';
  const posmAbi = [
    'function getPoolAndPositionInfo(uint256 tokenId) view returns (tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, uint256 info)',
    'function getPositionLiquidity(uint256 tokenId) view returns (uint128)',
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable'
  ];
  const posm = new ethers.Contract(posmAddr, posmAbi, wallet);

  // Find all V4 token IDs owned by user
  console.log('Mencari seluruh Position NFT V4 milik user...');
  const filter = {
    address: posmAddr,
    topics: [
      ethers.id('Transfer(address,address,uint256)'),
      null,
      ethers.zeroPadValue(wallet.address, 32)
    ],
    fromBlock: 0,
    toBlock: 'latest'
  };
  const logs = await provider.getLogs(filter);
  const tokenIds = [...new Set(logs.map(l => ethers.toBigInt(l.topics[3]).toString()))];
  console.log(`Ditemukan ${tokenIds.length} Position NFT V4.`);

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (let i = 0; i < tokenIds.length; i++) {
    const tid = tokenIds[i];
    try {
      const owner = await posm.ownerOf(tid);
      if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
        skipCount++;
        continue;
      }

      const liq = await posm.getPositionLiquidity(tid);
      if (liq === 0n) {
        skipCount++;
        continue;
      }

      const res = await posm.getPoolAndPositionInfo(tid);
      const key = res.poolKey;

      const actions = '0x0111'; // DECREASE_LIQUIDITY (0x01), TAKE_PAIR (0x11)
      const p0 = abiCoder.encode(
        ['uint256', 'uint128', 'uint128', 'uint128', 'bytes'],
        [tid, liq, 0n, 0n, '0x']
      );
      const p1 = abiCoder.encode(
        ['address', 'address', 'address'],
        [key.currency0, key.currency1, wallet.address]
      );
      const unlockData = abiCoder.encode(['bytes', 'bytes[]'], [actions, [p0, p1]]);
      const deadline = Math.floor(Date.now() / 1000) + 1200;

      const tx = await posm.modifyLiquidities(unlockData, deadline);
      await tx.wait();
      successCount++;
      console.log(`[${i + 1}/${tokenIds.length}] V4 #${tid} BERHASIL ditarik! Tx: ${tx.hash}`);

    } catch (err) {
      failCount++;
      console.warn(`[${i + 1}/${tokenIds.length}] V4 #${tid} Gagal: ${err.message.slice(0, 70)}`);
    }
  }

  console.log(`\nRingkasan V4: ${successCount} berhasil ditarik, ${skipCount} dilewati (sudah kosong), ${failCount} gagal.`);

  // Unwrap any WHYPE
  const curWhype = await whype.balanceOf(wallet.address);
  if (curWhype > 0n) {
    console.log('Meng-unwrap', ethers.formatEther(curWhype), 'WHYPE -> Native HYPE...');
    const txUnwrap = await whype.withdraw(curWhype);
    await txUnwrap.wait();
    console.log('Unwrap selesai! Tx:', txUnwrap.hash);
  }

  const finalBal = await provider.getBalance(wallet.address);
  console.log('\n=== SELESAI ===');
  console.log('Saldo Akhir Native HYPE di Wallet:', ethers.formatEther(finalBal), 'HYPE');
}

main().catch(console.error);
