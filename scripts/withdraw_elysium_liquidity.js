import { ethers } from 'ethers';
import { elysiumService } from '../src/elysium/elysiumService.js';

async function main() {
  const wallet = elysiumService.getDeployerWallet();
  if (!wallet) throw new Error('Wallet deployer tidak ditemukan');
  const provider = wallet.provider;

  console.log('=== MEMULAI PENARIKAN LIKUIDITAS DI ELYSIUM (TAHAP 2: UNISWAP V3) ===');
  console.log('Deployer Wallet:', wallet.address);
  let balHypeBefore = await provider.getBalance(wallet.address);
  console.log('Saldo Native HYPE Saat Ini:', ethers.formatEther(balHypeBefore), 'HYPE');

  const whypeAddr = '0xbA876237B0F021A6c6D852d6c26E107997cC5E81';
  const whypeAbi = [
    'function balanceOf(address) view returns (uint256)',
    'function withdraw(uint256) external'
  ];
  const whype = new ethers.Contract(whypeAddr, whypeAbi, wallet);

  // ==========================================
  // TAHAP 2: UNISWAP V3 (NFT 357, 358, 359, 360)
  // ==========================================
  console.log('\n--- 2. Penarikan Likuiditas Uniswap V3 ---');
  const v3PosmAddr = '0xF025e0Fe9E331A0eF05c2ad3C4E9C64b625cda6f';
  const v3Abi = [
    'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
    'function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint256 amount0, uint256 amount1)',
    'function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external payable returns (uint256 amount0, uint256 amount1)'
  ];
  const v3Posm = new ethers.Contract(v3PosmAddr, v3Abi, wallet);

  const v3Tokens = [357, 358, 359, 360];
  const deadline = Math.floor(Date.now() / 1000) + 1200;

  for (const tid of v3Tokens) {
    console.log(`\nMemproses V3 Position #${tid}...`);
    const pos = await v3Posm.positions(tid);
    if (pos.liquidity > 0n) {
      console.log(`Mengurangi likuiditas ${pos.liquidity.toString()}...`);
      const txDec = await v3Posm.decreaseLiquidity({
        tokenId: tid,
        liquidity: pos.liquidity,
        amount0Min: 0n,
        amount1Min: 0n,
        deadline
      });
      await txDec.wait();
      console.log(`Decrease V3 #${tid} selesai! Tx: ${txDec.hash}`);
    } else {
      console.log(`V3 #${tid} sudah memiliki 0 liquidity.`);
    }

    console.log(`Mengambil (collect) tokens & fee dari V3 #${tid}...`);
    const txCol = await v3Posm.collect({
      tokenId: tid,
      recipient: wallet.address,
      amount0Max: 2n ** 128n - 1n,
      amount1Max: 2n ** 128n - 1n
    });
    await txCol.wait();
    console.log(`Collect V3 #${tid} selesai! Tx: ${txCol.hash}`);
  }

  // Cek & unwrap WHYPE dari V3
  let curWhype = await whype.balanceOf(wallet.address);
  console.log('\nSaldo WHYPE setelah V3:', ethers.formatEther(curWhype), 'WHYPE');
  if (curWhype > 0n) {
    console.log('Meng-unwrap', ethers.formatEther(curWhype), 'WHYPE -> Native HYPE...');
    const txUnwrap = await whype.withdraw(curWhype);
    await txUnwrap.wait();
    console.log('Unwrap V3 selesai! Tx:', txUnwrap.hash);
  }

  let balHypeAfterV3 = await provider.getBalance(wallet.address);
  console.log('Saldo Native HYPE setelah Tahap 2:', ethers.formatEther(balHypeAfterV3), 'HYPE');
}

main().catch(console.error);
