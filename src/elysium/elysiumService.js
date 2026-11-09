import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
import { config } from '../config.js';
import { storage } from '../storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const contractsDir = path.join(__dirname, 'contracts');

// Load Artifacts
const elysiumTokenArtifact = JSON.parse(fs.readFileSync(path.join(contractsDir, 'ElysiumToken.json'), 'utf8'));
const wrappedElysiumArtifact = JSON.parse(fs.readFileSync(path.join(contractsDir, 'WrappedElysium.json'), 'utf8'));
const teamTokenLockArtifact = JSON.parse(fs.readFileSync(path.join(contractsDir, 'TeamTokenLock.json'), 'utf8'));

// Uniswap V3 Verified ABIs
const V3_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
  'function feeAmountTickSpacing(uint24 fee) external view returns (int24)'
];

const POSITION_MANAGER_ABI = [
  'function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)',
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function factory() external view returns (address)',
  'function WETH9() external view returns (address)',
  'event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)'
];

const SWAP_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
  'function factory() external view returns (address)',
  'function WETH9() external view returns (address)'
];

const ERC20_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function approve(address spender, uint256 value) external returns (bool)',
  'function transfer(address to, uint256 value) external returns (bool)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function deposit() external payable',
  'function withdraw(uint256 amount) external'
];

// Uniswap V2 ABIs (Fallback)
const ROUTER_ABI = [
  'function factory() external pure returns (address)',
  'function WETH() external pure returns (address)',
  'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)'
];

const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
  'function createPair(address tokenA, address tokenB) external returns (address pair)'
];

// Calculate sqrtPriceX96 using integer square root
function encodePriceSqrt(amount1, amount0) {
  const numerator = BigInt(amount1) * (2n ** 192n);
  const ratio = numerator / BigInt(amount0);
  let z = ratio;
  let x = (z + 1n) / 2n;
  let y = z;
  while (x < y) {
    y = x;
    x = (x + (z / x)) / 2n;
  }
  return y;
}

export class ElysiumService {
  constructor() {
    this.rpcUrl = config.elysiumRpcUrl || 'https://rpc.elysium.kinetiq.xyz';
    this.chainId = config.elysiumChainId || 99901;
    this.explorerUrl = config.elysiumExplorer || 'https://elyscan.live';
    this.provider = new ethers.JsonRpcProvider(this.rpcUrl, this.chainId, { staticNetwork: true });

    // Uniswap V3 Verified Contracts
    this.v3Factory = config.elysiumV3Factory || '0x1707327F626496A7b5b3872e7E4d2879Df7d7a9f';
    this.v3PositionManager = config.elysiumV3PositionManager || '0xF025e0Fe9E331A0eF05c2ad3C4E9C64b625cda6f';
    this.v3SwapRouter = config.elysiumV3SwapRouter || '0x003aa18c6E682dB80Cf4aa17261CcbFfd28690CE';
    this.v3Quoter = config.elysiumV3Quoter || '0x94a7d36e2AE728d6A2B2ee533b0a260385596D8b';
    this.wethAddress = config.elysiumWeth || '0xbA876237B0F021A6c6D852d6c26E107997cC5E81'; // WHYPE / WETH9
    this.usdcAddress = config.elysiumUsdc || '0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65'; // USDC

    // Uniswap V2 Router (Fallback)
    this.routerAddress = config.elysiumRouter || '0x3320b5685c1c4a0d2a5b0ca30dcee095142bf076';
  }

  getDeployerWallet() {
    const pk = config.elysiumPrivateKey || storage.getWalletPrivateKey(1);
    if (!pk || !pk.startsWith('0x') || pk.length !== 66) {
      return null;
    }
    return new ethers.Wallet(pk, this.provider);
  }

  async getDeployerInfo() {
    const wallet = this.getDeployerWallet();
    const dexVersion = storage.getElysiumDexVersion();
    const pairToken = storage.getElysiumPairToken();
    const v3FeeTier = storage.getElysiumV3FeeTier();

    if (!wallet) {
      return {
        configured: false,
        address: null,
        balanceHype: '0',
        balanceWhype: '0',
        balanceUsdc: '0',
        gasPriceGwei: '0',
        network: 'Elysium Mainnet',
        chainId: this.chainId,
        rpcUrl: this.rpcUrl,
        explorerUrl: this.explorerUrl,
        dexVersion,
        pairToken,
        v3FeeTier,
        v3Factory: this.v3Factory,
        v3PositionManager: this.v3PositionManager,
        v3SwapRouter: this.v3SwapRouter,
        routerAddress: this.routerAddress
      };
    }

    try {
      const whypeContract = new ethers.Contract(this.wethAddress, ERC20_ABI, this.provider);
      const usdcContract = new ethers.Contract(this.usdcAddress, ERC20_ABI, this.provider);

      const [balance, feeData, whypeBal, usdcBal] = await Promise.all([
        this.provider.getBalance(wallet.address),
        this.provider.getFeeData(),
        whypeContract.balanceOf(wallet.address).catch(() => 0n),
        usdcContract.balanceOf(wallet.address).catch(() => 0n)
      ]);

      const gasPriceGwei = feeData.gasPrice ? ethers.formatUnits(feeData.gasPrice, 'gwei') : '0';

      return {
        configured: true,
        address: wallet.address,
        balanceHype: ethers.formatEther(balance),
        balanceHypeRaw: balance,
        balanceWhype: ethers.formatEther(whypeBal),
        balanceUsdc: ethers.formatUnits(usdcBal, 6),
        gasPriceGwei,
        network: 'Elysium Mainnet',
        chainId: this.chainId,
        rpcUrl: this.rpcUrl,
        explorerUrl: this.explorerUrl,
        dexVersion,
        pairToken,
        v3FeeTier,
        v3Factory: this.v3Factory,
        v3PositionManager: this.v3PositionManager,
        v3SwapRouter: this.v3SwapRouter,
        routerAddress: this.routerAddress
      };
    } catch (err) {
      return {
        configured: true,
        address: wallet.address,
        balanceHype: 'Error RPC',
        balanceWhype: '0',
        balanceUsdc: '0',
        gasPriceGwei: '0',
        error: err.message,
        network: 'Elysium Mainnet',
        chainId: this.chainId,
        rpcUrl: this.rpcUrl,
        explorerUrl: this.explorerUrl,
        dexVersion,
        pairToken,
        v3FeeTier,
        v3Factory: this.v3Factory,
        v3PositionManager: this.v3PositionManager,
        v3SwapRouter: this.v3SwapRouter,
        routerAddress: this.routerAddress
      };
    }
  }

  async verifyContractOnElyscan(address, contractType, constructorArgsHex) {
    try {
      let standardInputPath;
      let contractName;

      if (contractType === 'WrappedElysium') {
        standardInputPath = path.join(contractsDir, 'standard-input-wrapped-elysium.json');
        contractName = 'contracts/WrappedElysium.sol:WrappedElysium';
      } else if (contractType === 'TeamTokenLock') {
        standardInputPath = path.join(contractsDir, 'standard-input-wrapped-elysium.json');
        contractName = 'contracts/TeamTokenLock.sol:TeamTokenLock';
      } else {
        standardInputPath = path.join(contractsDir, 'standard-input-elysium-token.json');
        contractName = 'contracts/ElysiumToken.sol:ElysiumToken';
      }

      if (!fs.existsSync(standardInputPath)) {
        return { success: false, message: 'Standard input file not found' };
      }

      const standardInput = fs.readFileSync(standardInputPath, 'utf8');
      const blob = new Blob([standardInput], { type: 'application/json' });
      const formData = new FormData();
      formData.set('compiler_version', 'v0.8.20+commit.a1b79de6');
      formData.set('license_type', '3'); // MIT
      formData.append('files[0]', blob, 'standard-input.json');
      formData.set('contract_name', contractName);
      formData.set('autodetect_constructor_args', 'false');
      formData.set('constructor_args', (constructorArgsHex || '').replace(/^0x/, ''));

      const postUrl = `${this.explorerUrl}/api/verify?a=${address}&m=standard-input`;
      const res = await fetch(postUrl, {
        method: 'POST',
        body: formData
      });

      const resJson = await res.json().catch(() => null);
      if (!res.ok) {
        return { success: false, message: resJson?.message || 'Verification submit failed' };
      }

      // Poll verification status (up to 8 attempts = ~32 seconds)
      for (let i = 0; i < 8; i++) {
        await new Promise(r => setTimeout(r, 4000));
        const statusRes = await fetch(`${this.explorerUrl}/api/verify?status=${address}`);
        const statusJson = await statusRes.json().catch(() => null);
        if (statusJson?.verified) {
          return { success: true, name: statusJson.name };
        }
      }

      return { success: true, message: 'Submitted, verification in progress' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  async deployToken(options = {}, onProgress = null) {
    const notify = (step, msg) => {
      console.log(`[ElysiumDeploy] Step ${step}: ${msg}`);
      if (typeof onProgress === 'function') {
        try { onProgress(step, msg); } catch {}
      }
    };

    const wallet = this.getDeployerWallet();
    if (!wallet) {
      throw new Error('Private key deployer Elysium belum dikonfigurasi di .env (ELYSIUM_PRIVATE_KEY / PRIVATE_KEY)');
    }

    notify(1, 'Memeriksa saldo HYPE, pair token, dan kesiapan jaringan Elysium...');
    const balance = await this.provider.getBalance(wallet.address);

    const dexVersion = (options.dexVersion || storage.getElysiumDexVersion() || 'v3').toLowerCase();
    const pairChoice = (options.pair || storage.getElysiumPairToken() || 'HYPE').toUpperCase().trim();
    const feeTier = Number(options.feeTier || storage.getElysiumV3FeeTier() || 10000);

    const hypeLp = String(options.hypeLiquidity || storage.getElysiumLpHype() || config.elysiumDefaultLpHype || '0.0001');
    const devBuyHype = String(options.devBuyHype !== undefined ? options.devBuyHype : (storage.getElysiumDevBuyHype() !== undefined ? storage.getElysiumDevBuyHype() : '0.0001'));
    const hypeLpWei = ethers.parseEther(hypeLp);
    const devBuyWei = ethers.parseEther(devBuyHype);
    const gasReserveWei = ethers.parseEther('0.0005'); // Minimal cadangan gas Elysium (~0.1 Gwei)
    const totalRequiredWei = hypeLpWei + devBuyWei + gasReserveWei;

    if (balance < totalRequiredWei) {
      const curHype = ethers.formatEther(balance);
      const reqHype = ethers.formatEther(totalRequiredWei);
      throw new Error(`Saldo HYPE tidak mencukupi! Anda memiliki ${curHype} HYPE, dibutuhkan minimal ${reqHype} HYPE (LP ${hypeLp} HYPE + Dev Buy ${devBuyHype} HYPE + gas).`);
    }

    // Resolve Quote Token (HYPE, ETH, WETH, USDC)
    let quoteAddress;
    let quoteSymbol;
    let quoteDecimals = 18;

    if (pairChoice === 'USDC') {
      quoteAddress = config.elysiumUsdc || this.usdcAddress;
      quoteSymbol = 'USDC';
      quoteDecimals = 6;
    } else if (pairChoice === 'WETH') {
      quoteAddress = config.elysiumWeth || this.wethAddress;
      quoteSymbol = 'WETH';
      quoteDecimals = 18;
    } else {
      // HYPE or ETH
      quoteAddress = config.elysiumWeth || this.wethAddress;
      quoteSymbol = pairChoice === 'ETH' ? 'ETH' : 'HYPE';
      quoteDecimals = 18;
    }

    const name = (options.name || 'Elysium Token').trim();
    const symbol = (options.symbol || 'ELYS').trim().toUpperCase();
    const totalSupply = options.totalSupply ? BigInt(options.totalSupply) : ethers.parseEther('100000000000'); // 100B default
    const feeWallet = options.feeWallet && ethers.isAddress(options.feeWallet) ? options.feeWallet : wallet.address;
    const buyFee = Number(options.buyFee ?? 5);
    const sellFee = Number(options.sellFee ?? 5);
    const sniperBuyFee = Number(options.sniperBuyFee ?? 80);
    const sniperWindowMinutes = Number(options.sniperWindowMinutes ?? 30);
    const tokenLp = options.tokenLiquidity ? BigInt(options.tokenLiquidity) : ethers.parseEther('20000000000'); // 20B LP default
    const lockTokens = options.lockAmount !== undefined ? BigInt(options.lockAmount) : ethers.parseEther('6000000000'); // 6B Lock default
    const lockHours = Number(options.lockHours ?? 3);
    const airdrop1 = options.airdrop1 && ethers.isAddress(options.airdrop1) ? options.airdrop1 : (options.isWelysium ? '0x58f6e5e38c1197D8bCEb528885ca249aB4297A3f' : ethers.ZeroAddress);
    const airdropAmount1 = airdrop1 !== ethers.ZeroAddress ? (options.airdropAmount1 ? BigInt(options.airdropAmount1) : ethers.parseEther('10000000000')) : 0n;
    const airdrop2 = options.airdrop2 && ethers.isAddress(options.airdrop2) ? options.airdrop2 : (options.isWelysium ? '0x02CFD6682B5dC354B451BfC4c5b60D6AcA4e85cF' : ethers.ZeroAddress);
    const airdropAmount2 = airdrop2 !== ethers.ZeroAddress ? (options.airdropAmount2 ? BigInt(options.airdropAmount2) : ethers.parseEther('10000000000')) : 0n;

    const isWrappedElysiumOriginal = options.isWelysium || (name.toLowerCase() === 'wrapped elysium' && symbol === 'WELYSIUM');

    let tokenAddress;
    let tokenContract;
    let deployTxHash;
    let tokenConstructorArgsHex;

    notify(2, `Mendeploy ERC-20 Token: ${name} ($${symbol})...`);
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();

    if (isWrappedElysiumOriginal) {
      const weFactory = new ethers.ContractFactory(wrappedElysiumArtifact.abi, wrappedElysiumArtifact.bytecode, wallet);
      const feeW = feeWallet;
      const ad1 = airdrop1 !== ethers.ZeroAddress ? airdrop1 : '0x58f6e5e38c1197D8bCEb528885ca249aB4297A3f';
      const ad2 = airdrop2 !== ethers.ZeroAddress ? airdrop2 : '0x02CFD6682B5dC354B451BfC4c5b60D6AcA4e85cF';
      
      const deployTx = await weFactory.deploy(feeW, ad1, ad2);
      await deployTx.waitForDeployment();
      tokenAddress = await deployTx.getAddress();
      tokenContract = deployTx;
      deployTxHash = deployTx.deploymentTransaction().hash;

      tokenConstructorArgsHex = abiCoder.encode(
        ['address', 'address', 'address'],
        [feeW, ad1, ad2]
      ).slice(2);
    } else {
      const etFactory = new ethers.ContractFactory(elysiumTokenArtifact.abi, elysiumTokenArtifact.bytecode, wallet);
      const tokenParams = {
        name,
        symbol,
        totalSupply,
        feeWallet,
        buyFee,
        sellFee,
        sniperBuyFee,
        sniperWindowMinutes,
        airdrop1,
        airdropAmount1,
        airdrop2,
        airdropAmount2
      };

      const tupleType = 'tuple(string name, string symbol, uint256 totalSupply, address feeWallet, uint256 buyFee, uint256 sellFee, uint256 sniperBuyFee, uint256 sniperWindowMinutes, address airdrop1, uint256 airdropAmount1, address airdrop2, uint256 airdropAmount2)';
      const deployTx = await etFactory.deploy(tokenParams);
      await deployTx.waitForDeployment();
      tokenAddress = await deployTx.getAddress();
      tokenContract = deployTx;
      deployTxHash = deployTx.deploymentTransaction().hash;

      tokenConstructorArgsHex = abiCoder.encode([tupleType], [tokenParams]).slice(2);
    }

    notify(3, `Token berhasil dideploy di ${tokenAddress}! Tx: ${deployTxHash}`);

    // Step 3: TeamTokenLock (Optional)
    let lockAddress = '';
    let lockDeployTxHash = '';
    let lockTransferTxHash = '';
    let lockReleaseTime = 0;

    if (lockTokens > 0n) {
      notify(4, `Mendeploy kontrak TeamTokenLock (Lock ${ethers.formatUnits(lockTokens, 18)} token selama ${lockHours} jam)...`);
      const lockFactory = new ethers.ContractFactory(teamTokenLockArtifact.abi, teamTokenLockArtifact.bytecode, wallet);
      const block = await this.provider.getBlock('latest');
      lockReleaseTime = (block ? block.timestamp : Math.floor(Date.now() / 1000)) + (lockHours * 3600);

      const lockTx = await lockFactory.deploy(tokenAddress, wallet.address, lockReleaseTime);
      await lockTx.waitForDeployment();
      lockAddress = await lockTx.getAddress();
      lockDeployTxHash = lockTx.deploymentTransaction().hash;

      notify(4, `Mengirim token ke kontrak lock ${lockAddress}...`);
      const transferTx = await tokenContract.transfer(lockAddress, lockTokens);
      await transferTx.wait();
      lockTransferTxHash = transferTx.hash;
      notify(4, `Lock berhasil! Tx: ${lockTransferTxHash}`);
    }

    // Step 4: Add Liquidity (Uniswap V3 by default, Uniswap V2 fallback)
    let poolAddress = '';
    let addLiquidityTxHash = '';
    let positionTokenId = null;
    let quoteDepositedDisplay = '';
    let initialPrice = 0;

    if (dexVersion === 'v3') {
      notify(5, `Menyiapkan likuiditas Uniswap V3 (Pair: ${symbol}/${quoteSymbol}, Fee Tier: ${feeTier / 10000}%)...`);
      
      const whypeContract = new ethers.Contract(this.wethAddress, ERC20_ABI, wallet);
      const npm = new ethers.Contract(this.v3PositionManager, POSITION_MANAGER_ABI, wallet);
      const factory = new ethers.Contract(this.v3Factory, V3_FACTORY_ABI, wallet);
      const swapRouter = new ethers.Contract(this.v3SwapRouter, SWAP_ROUTER_ABI, wallet);

      let quoteDepositWei;

      if (quoteSymbol === 'USDC') {
        const usdcContract = new ethers.Contract(this.usdcAddress, ERC20_ABI, wallet);
        let curUsdc = await usdcContract.balanceOf(wallet.address);

        // If deployer wallet doesn't have USDC, auto-swap hypeLp to USDC via Uniswap V3 WHYPE/USDC pool
        if (curUsdc < 1000n) {
          notify(5, `Menukar ${hypeLp} HYPE ke USDC via Uniswap V3 Router untuk pasangan pool...`);
          const wrapTx = await whypeContract.deposit({ value: hypeLpWei });
          await wrapTx.wait();
          const appWhypeTx = await whypeContract.approve(this.v3SwapRouter, hypeLpWei);
          await appWhypeTx.wait();

          const deadline = Math.floor(Date.now() / 1000) + 600;
          const swapToUsdc = await swapRouter.exactInputSingle({
            tokenIn: this.wethAddress,
            tokenOut: this.usdcAddress,
            fee: 10000,
            recipient: wallet.address,
            deadline,
            amountIn: hypeLpWei,
            amountOutMinimum: 0n,
            sqrtPriceLimitX96: 0n
          });
          await swapToUsdc.wait();
          curUsdc = await usdcContract.balanceOf(wallet.address);
        }

        quoteDepositWei = curUsdc;
        quoteDepositedDisplay = `${ethers.formatUnits(quoteDepositWei, 6)} USDC`;
        
        notify(5, `Approve USDC ke NonfungiblePositionManager...`);
        const appUsdcTx = await usdcContract.approve(this.v3PositionManager, ethers.MaxUint256);
        await appUsdcTx.wait();
        initialPrice = Number(ethers.formatUnits(quoteDepositWei, 6)) / Number(ethers.formatUnits(tokenLp, 18));
      } else {
        // HYPE, ETH, or WETH (uses WHYPE)
        quoteDepositWei = hypeLpWei;
        quoteDepositedDisplay = `${hypeLp} ${quoteSymbol}`;

        notify(5, `Wrap ${hypeLp} HYPE -> WHYPE & Approve PositionManager...`);
        const wrapTx = await whypeContract.deposit({ value: hypeLpWei });
        await wrapTx.wait();
        const appWhypeTx = await whypeContract.approve(this.v3PositionManager, ethers.MaxUint256);
        await appWhypeTx.wait();
        initialPrice = Number(hypeLp) / Number(ethers.formatUnits(tokenLp, 18));
      }

      // Approve token to PositionManager
      notify(5, `Approve ${symbol} ke NonfungiblePositionManager...`);
      const appTokenTx = await tokenContract.approve(this.v3PositionManager, ethers.MaxUint256);
      await appTokenTx.wait();

      // Determine token0 and token1 ordering (strictly sorted by address)
      const isToken0 = tokenAddress.toLowerCase() < quoteAddress.toLowerCase();
      const token0 = isToken0 ? tokenAddress : quoteAddress;
      const token1 = isToken0 ? quoteAddress : tokenAddress;
      const amount0Desired = isToken0 ? tokenLp : quoteDepositWei;
      const amount1Desired = isToken0 ? quoteDepositWei : tokenLp;

      // Calculate sqrtPriceX96
      const sqrtPriceX96 = encodePriceSqrt(amount1Desired, amount0Desired);

      // Create and initialize pool
      notify(5, `Membuat & menginisialisasi Pool Uniswap V3 (Fee: ${feeTier})...`);
      const initTx = await npm.createAndInitializePoolIfNecessary(token0, token1, feeTier, sqrtPriceX96);
      await initTx.wait();

      // Fetch pool address
      poolAddress = await factory.getPool(token0, token1, feeTier);

      // Compute full-range tick limits
      const tickSpacing = Number(await factory.feeAmountTickSpacing(feeTier));
      const minTick = -887272;
      const maxTick = 887272;
      const tickLower = Math.ceil(minTick / tickSpacing) * tickSpacing;
      const tickUpper = Math.floor(maxTick / tickSpacing) * tickSpacing;

      // Mint Full-Range Liquidity Position
      notify(5, `Menyetor likuiditas penuh (Full-Range Mint) ke Uniswap V3...`);
      const deadline = Math.floor(Date.now() / 1000) + 1200;
      const mintTx = await npm.mint({
        token0,
        token1,
        fee: feeTier,
        tickLower,
        tickUpper,
        amount0Desired,
        amount1Desired,
        amount0Min: 0n,
        amount1Min: 0n,
        recipient: wallet.address,
        deadline
      });
      const mintReceipt = await mintTx.wait();
      addLiquidityTxHash = mintTx.hash;

      // Extract Position NFT ID
      if (mintReceipt.logs) {
        for (const log of mintReceipt.logs) {
          try {
            const parsed = npm.interface.parseLog(log);
            if (parsed && parsed.name === 'IncreaseLiquidity') {
              positionTokenId = parsed.args.tokenId.toString();
              break;
            }
          } catch {}
        }
      }

      notify(5, `Likuiditas Uniswap V3 berhasil disetor! Pool: ${poolAddress} ${positionTokenId ? `(NFT #${positionTokenId})` : ''}`);

    } else {
      // Uniswap V2 Fallback
      quoteDepositedDisplay = `${hypeLp} HYPE`;
      initialPrice = Number(hypeLp) / Number(ethers.formatUnits(tokenLp, 18));
      notify(5, `Menyetor likuiditas ke Uniswap V2 (${hypeLp} HYPE + ${ethers.formatUnits(tokenLp, 18)} ${symbol})...`);
      const router = new ethers.Contract(this.routerAddress, ROUTER_ABI, wallet);
      
      const approveTx = await tokenContract.approve(this.routerAddress, ethers.MaxUint256);
      await approveTx.wait();

      const deadline = Math.floor(Date.now() / 1000) + 1200;
      const addLiqTx = await router.addLiquidityETH(
        tokenAddress,
        tokenLp,
        0,
        0,
        wallet.address,
        deadline,
        { value: hypeLpWei }
      );
      await addLiqTx.wait();
      addLiquidityTxHash = addLiqTx.hash;

      const factoryAddress = await router.factory();
      const wethAddress = await router.WETH();
      const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, wallet);
      poolAddress = await factory.getPair(tokenAddress, wethAddress);
      notify(5, `Likuiditas Uniswap V2 berhasil disetor! Tx: ${addLiquidityTxHash}`);
    }

    // Step 5: Configure Pair on token
    notify(6, 'Mendeteksi Pool Pair dan mengonfigurasi Anti-Sniper...');
    const setPairTx = await tokenContract.setPair(poolAddress);
    await setPairTx.wait();
    const setPairTxHash = setPairTx.hash;

    // Step 6: Enable Trading
    notify(7, 'Mengaktifkan trading on-chain (enableTrading)...');
    const enableTradingTx = await tokenContract.enableTrading();
    await enableTradingTx.wait();
    const enableTradingTxHash = enableTradingTx.hash;
    notify(7, `Trading telah AKTIF dan bisa ditradingkan! Tx: ${enableTradingTxHash}`);

    // Step 7: Dev Buy
    let devBuyTxHash = '';
    if (devBuyWei > 0n) {
      if (dexVersion === 'v3') {
        notify(8, `Menjalankan Dev Buy sebesar ${devBuyHype} HYPE via Uniswap V3...`);
        try {
          const whypeContract = new ethers.Contract(this.wethAddress, ERC20_ABI, wallet);
          const swapRouter = new ethers.Contract(this.v3SwapRouter, SWAP_ROUTER_ABI, wallet);

          // Wrap Dev Buy HYPE to WHYPE
          const wrapDevTx = await whypeContract.deposit({ value: devBuyWei });
          await wrapDevTx.wait();
          const appDevTx = await whypeContract.approve(this.v3SwapRouter, devBuyWei);
          await appDevTx.wait();

          const devBuyDeadline = Math.floor(Date.now() / 1000) + 600;

          if (quoteSymbol === 'USDC') {
            // Multi-hop Dev Buy: HYPE -> USDC -> TOKEN
            const usdcContract = new ethers.Contract(this.usdcAddress, ERC20_ABI, wallet);
            const swapToUsdc = await swapRouter.exactInputSingle({
              tokenIn: this.wethAddress,
              tokenOut: this.usdcAddress,
              fee: 10000,
              recipient: wallet.address,
              deadline: devBuyDeadline,
              amountIn: devBuyWei,
              amountOutMinimum: 0n,
              sqrtPriceLimitX96: 0n
            });
            await swapToUsdc.wait();
            const usdcAmt = await usdcContract.balanceOf(wallet.address);
            await (await usdcContract.approve(this.v3SwapRouter, usdcAmt)).wait();

            const buyTokenTx = await swapRouter.exactInputSingle({
              tokenIn: this.usdcAddress,
              tokenOut: tokenAddress,
              fee: feeTier,
              recipient: wallet.address,
              deadline: devBuyDeadline,
              amountIn: usdcAmt,
              amountOutMinimum: 0n,
              sqrtPriceLimitX96: 0n
            });
            await buyTokenTx.wait();
            devBuyTxHash = buyTokenTx.hash;
          } else {
            // Direct Dev Buy: WHYPE -> TOKEN
            const devBuyTx = await swapRouter.exactInputSingle({
              tokenIn: this.wethAddress,
              tokenOut: tokenAddress,
              fee: feeTier,
              recipient: wallet.address,
              deadline: devBuyDeadline,
              amountIn: devBuyWei,
              amountOutMinimum: 0n,
              sqrtPriceLimitX96: 0n
            });
            await devBuyTx.wait();
            devBuyTxHash = devBuyTx.hash;
          }
          notify(8, `Dev Buy sebesar ${devBuyHype} HYPE berhasil dieksekusi! Tx: ${devBuyTxHash}`);
        } catch (buyErr) {
          console.warn('Dev Buy V3 warning:', buyErr.message);
          notify(8, `Peringatan Dev Buy: ${buyErr.message}`);
        }
      } else {
        notify(8, `Menjalankan Dev Buy sebesar ${devBuyHype} HYPE via Uniswap V2...`);
        try {
          const router = new ethers.Contract(this.routerAddress, ROUTER_ABI, wallet);
          const path = [await router.WETH(), tokenAddress];
          const devBuyDeadline = Math.floor(Date.now() / 1000) + 600;
          const devBuyTx = await router.swapExactETHForTokens(
            0,
            path,
            wallet.address,
            devBuyDeadline,
            { value: devBuyWei }
          );
          await devBuyTx.wait();
          devBuyTxHash = devBuyTx.hash;
          notify(8, `Dev Buy sebesar ${devBuyHype} HYPE berhasil dieksekusi! Tx: ${devBuyTxHash}`);
        } catch (buyErr) {
          console.warn('Dev Buy V2 warning:', buyErr.message);
          notify(8, `Peringatan Dev Buy: ${buyErr.message}`);
        }
      }
    }

    // Step 8: Verifikasi Kontrak di Elyscan (Async)
    let isTokenVerified = false;
    let isLockVerified = false;
    if (options.autoVerify !== false) {
      notify(9, 'Melakukan verifikasi kontrak di explorer Elyscan...');
      try {
        const verifyTokenRes = await this.verifyContractOnElyscan(
          tokenAddress,
          isWrappedElysiumOriginal ? 'WrappedElysium' : 'ElysiumToken',
          tokenConstructorArgsHex
        );
        isTokenVerified = verifyTokenRes.success;

        if (lockAddress) {
          const lockArgsHex = abiCoder.encode(
            ['address', 'address', 'uint256'],
            [tokenAddress, wallet.address, lockReleaseTime]
          ).slice(2);
          const verifyLockRes = await this.verifyContractOnElyscan(lockAddress, 'TeamTokenLock', lockArgsHex);
          isLockVerified = verifyLockRes.success;
        }
      } catch (err) {
        console.warn('Elyscan verification warning:', err.message);
      }
    }

    const dexName = dexVersion === 'v3' ? 'Uniswap V3' : 'Uniswap V2';

    // Save record to storage
    const record = storage.saveElysiumDeployedToken({
      name,
      symbol,
      totalSupply: ethers.formatUnits(totalSupply, 18),
      tokenAddress,
      poolAddress,
      lockAddress,
      deployerAddress: wallet.address,
      feeWallet,
      buyFee,
      sellFee,
      dexVersion: dexName,
      pairToken: quoteSymbol,
      quoteDeposited: quoteDepositedDisplay,
      hypeDeposited: hypeLp,
      devBuyHype: devBuyHype,
      tokenDeposited: ethers.formatUnits(tokenLp, 18),
      initialPriceHype: initialPrice,
      positionTokenId,
      v3FeeTier: feeTier,
      deployTx: deployTxHash,
      lockTx: lockTransferTxHash || lockDeployTxHash,
      addLiquidityTx: addLiquidityTxHash,
      setPairTx: setPairTxHash,
      enableTradingTx: enableTradingTxHash,
      devBuyTx: devBuyTxHash,
      isVerified: isTokenVerified
    });

    return {
      success: true,
      dexVersion: dexName,
      pairToken: quoteSymbol,
      positionTokenId,
      token: {
        name,
        symbol,
        address: tokenAddress,
        totalSupply: ethers.formatUnits(totalSupply, 18),
        deployTxHash,
        isVerified: isTokenVerified
      },
      lock: {
        address: lockAddress,
        amount: ethers.formatUnits(lockTokens, 18),
        releaseTime: lockReleaseTime,
        txHash: lockTransferTxHash || lockDeployTxHash,
        isVerified: isLockVerified
      },
      liquidity: {
        dexName,
        poolAddress,
        quoteToken: quoteSymbol,
        quoteDeposited: quoteDepositedDisplay,
        positionTokenId,
        hypeDeposited: `${hypeLp} HYPE`,
        devBuyHype: devBuyTxHash ? `${devBuyHype} HYPE` : (devBuyWei > 0n ? `${devBuyHype} HYPE (Attempted)` : '0 HYPE'),
        tokensDeposited: `${ethers.formatUnits(tokenLp, 18)} ${symbol}`,
        initialPrice,
        initialPriceHype: initialPrice,
        addLiquidityTxHash,
        setPairTxHash,
        enableTradingTxHash,
        devBuyTxHash
      },
      urls: {
        tokenExplorer: `${this.explorerUrl}/address/${tokenAddress}`,
        poolExplorer: `${this.explorerUrl}/address/${poolAddress}`,
        dexscreener: `https://dexscreener.com/elysium/${poolAddress}`
      },
      record
    };
  }
}

export const elysiumService = new ElysiumService();
