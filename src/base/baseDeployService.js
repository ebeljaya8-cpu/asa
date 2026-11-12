import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
import { config } from '../config.js';
import { storage } from '../storage.js';
import { pinataService } from '../pinataService.js';
import { fetchQuoteUsdPrice, computeClankerMarketCapPosition } from '../utils/marketCapMath.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const contractsDir = path.join(__dirname, 'contracts');

// Load Artifacts
const baseTokenArtifact = JSON.parse(fs.readFileSync(path.join(contractsDir, 'BaseToken.json'), 'utf8'));

// Uniswap V4 ABIs
const V4_POSITION_MANAGER_ABI = [
  'function initializePool((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint160 sqrtPriceX96) external payable returns (int24)',
  'function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable',
  'function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)',
  'function nextTokenId() view returns (uint256)',
  'function poolManager() view returns (address)',
  'function permit2() view returns (address)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
];

const PERMIT2_ABI = [
  'function approve(address token, address spender, uint160 amount, uint48 expiration) external',
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)'
];

const UNIVERSAL_ROUTER_ABI = [
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) external payable',
  'function V4_POSITION_MANAGER() view returns (address)',
  'function poolManager() view returns (address)'
];

// Uniswap V3 ABIs
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

// Uniswap V2 ABIs
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

// Math & Utility Constants
const Q96 = 2n ** 96n;
const POOL_KEY_TYPE = 'tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)';
const EXACT_INPUT_SINGLE_TYPE = `tuple(${POOL_KEY_TYPE} poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)`;

const pace = (ms = 1000) => new Promise(r => setTimeout(r, ms));

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

function getSqrtRatioAtTick(tick) {
  const absTick = tick < 0 ? -tick : tick;
  if (absTick > 887272) throw new Error('Tick out of bounds');

  let ratio = (absTick & 0x1) !== 0 ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
  if ((absTick & 0x2) !== 0) ratio = (ratio * 0xfff97272373d413259a46990570e21b7n) >> 128n;
  if ((absTick & 0x4) !== 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n;
  if ((absTick & 0x8) !== 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n;
  if ((absTick & 0x10) !== 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n;
  if ((absTick & 0x20) !== 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n;
  if ((absTick & 0x40) !== 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n;
  if ((absTick & 0x80) !== 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n;
  if ((absTick & 0x100) !== 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83a49184521n) >> 128n;
  if ((absTick & 0x200) !== 0) ratio = (ratio * 0xf97957f9eed7efc0297058a9e7f41e57n) >> 128n;
  if ((absTick & 0x400) !== 0) ratio = (ratio * 0xf2fa7a00f165e3fed864438df377a28cn) >> 128n;
  if ((absTick & 0x800) !== 0) ratio = (ratio * 0xe60b881308b29b400fb8e40f7d54ee4dn) >> 128n;
  if ((absTick & 0x1000) !== 0) ratio = (ratio * 0xcc9a4cb3e778401309f193eb778396cbn) >> 128n;
  if ((absTick & 0x2000) !== 0) ratio = (ratio * 0xa3713f003b55584e0303112c3f87508an) >> 128n;
  if ((absTick & 0x4000) !== 0) ratio = (ratio * 0x6735e58c9735d6dbf4e91024840e69ben) >> 128n;
  if ((absTick & 0x8000) !== 0) ratio = (ratio * 0x2a9cb990053d2d20739945657ef928ebn) >> 128n;
  if ((absTick & 0x10000) !== 0) ratio = (ratio * 0x7181a0e60882362b66d3a8244f77c7an) >> 128n;
  if ((absTick & 0x20000) !== 0) ratio = (ratio * 0x3228d4924a3500d005697266febd11n) >> 128n;
  if ((absTick & 0x40000) !== 0) ratio = (ratio * 0x9ef4e2f89633e9b1191029n) >> 128n;
  if ((absTick & 0x80000) !== 0) ratio = (ratio * 0x9a444a56975a6n) >> 128n;

  if (tick > 0) ratio = (2n ** 256n - 1n) / ratio;
  return (ratio >> 32n) + ((ratio % (1n << 32n)) === 0n ? 0n : 1n);
}

function getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0) {
  if (sqrtRatioAX96 > sqrtRatioBX96) [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  const intermediate = (sqrtRatioAX96 * sqrtRatioBX96) / Q96;
  return (amount0 * intermediate) / (sqrtRatioBX96 - sqrtRatioAX96);
}

function getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1) {
  if (sqrtRatioAX96 > sqrtRatioBX96) [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  return (amount1 * Q96) / (sqrtRatioBX96 - sqrtRatioAX96);
}

function getLiquidityForAmounts(sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, amount0, amount1) {
  if (sqrtRatioAX96 > sqrtRatioBX96) [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  if (sqrtPriceX96 <= sqrtRatioAX96) {
    return getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0);
  } else if (sqrtPriceX96 < sqrtRatioBX96) {
    const l0 = getLiquidityForAmount0(sqrtPriceX96, sqrtRatioBX96, amount0);
    const l1 = getLiquidityForAmount1(sqrtRatioAX96, sqrtPriceX96, amount1);
    return l0 < l1 ? l0 : l1;
  } else {
    return getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1);
  }
}

function computePoolId(poolKey) {
  const defaultAbi = ethers.AbiCoder.defaultAbiCoder();
  const encoded = defaultAbi.encode(
    ['address', 'address', 'uint24', 'int24', 'address'],
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
  );
  return ethers.keccak256(encoded);
}

export class ResilientBaseJsonRpcProvider extends ethers.JsonRpcProvider {
  constructor(url, network, options = {}) {
    super(url, network, options);
    this.pollingInterval = 2500;
  }

  async send(method, params) {
    const maxRetries = 6;
    let delay = 1200;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await super.send(method, params);
      } catch (err) {
        const errMsg = String(err?.message || '');
        const isTransient =
          errMsg.includes('429') ||
          errMsg.includes('Too Many Requests') ||
          errMsg.includes('rate limit') ||
          errMsg.includes('could not coalesce error') ||
          errMsg.includes('ECONNRESET');

        if (isTransient && attempt < maxRetries) {
          const jitter = Math.floor(Math.random() * 500);
          const waitTime = delay + jitter;
          console.warn(`[BaseRPC] Retry on ${method} (${attempt}/${maxRetries}) after ${waitTime}ms: ${errMsg.slice(0, 80)}`);
          await new Promise(r => setTimeout(r, waitTime));
          delay = Math.min(Math.floor(delay * 1.5), 8000);
          continue;
        }

        throw err;
      }
    }
  }
}

export class BaseDeployService {
  constructor() {
    this.rpcUrl = config.rpcUrl || 'https://mainnet.base.org';
    this.chainId = 8453;
    this.explorerUrl = config.baseExplorer || 'https://basescan.org';
    this.provider = new ResilientBaseJsonRpcProvider(this.rpcUrl, this.chainId, { staticNetwork: true });

    // Uniswap V4 Verified Contracts on Base
    this.v4PoolManager = config.baseV4PoolManager || '0x498581fF718922c3f8e6A244956aF099B2652b2b';
    this.v4PositionManager = config.baseV4PositionManager || '0x7C5f5A4bBd8fD63184577525326123B519429bDc';
    this.permit2Address = config.basePermit2 || '0x000000000022D473030F116dDEE9F6B43aC78BA3';
    this.universalRouter = config.baseUniversalRouter || '0x6fF5693b99212Da76ad316178A184AB56D299b43';

    // Uniswap V3 Verified Contracts on Base
    this.v3Factory = config.baseV3Factory || '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
    this.v3PositionManager = config.baseV3PositionManager || '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
    this.v3SwapRouter = config.baseV3SwapRouter || '0x2626664c2603336E57B271c5C0b26F421741e481';

    // Uniswap V2 Verified Contracts on Base
    this.v2Router = config.baseV2Router || '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24';
    this.v2Factory = config.baseV2Factory || '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6';

    // Tokens on Base
    this.wethAddress = config.baseWeth || '0x4200000000000000000000000000000000000006';
    this.usdcAddress = config.baseUsdc || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  }

  getDeployerWallet(walletIndex = 1) {
    const pk = storage.getWalletPrivateKey(walletIndex);
    if (!pk || !pk.startsWith('0x') || pk.length !== 66) {
      return null;
    }
    return new ethers.Wallet(pk, this.provider);
  }

  async getDeployerInfo(walletIndex = 1) {
    const wallet = this.getDeployerWallet(walletIndex);
    const dexVersion = storage.getBaseDirectDexVersion();
    const pairToken = storage.getBaseDirectPairToken();
    const v3FeeTier = storage.getBaseDirectV3FeeTier();

    if (!wallet) {
      return {
        configured: false,
        address: null,
        balanceEth: '0',
        balanceWeth: '0',
        balanceUsdc: '0',
        gasPriceGwei: '0',
        network: 'Base Mainnet',
        chainId: this.chainId,
        rpcUrl: this.rpcUrl,
        explorerUrl: this.explorerUrl,
        dexVersion,
        pairToken,
        v3FeeTier,
        v4PoolManager: this.v4PoolManager,
        v4PositionManager: this.v4PositionManager,
        universalRouter: this.universalRouter,
        v3Factory: this.v3Factory,
        v3PositionManager: this.v3PositionManager,
        v3SwapRouter: this.v3SwapRouter,
        v2Router: this.v2Router
      };
    }

    try {
      const wethContract = new ethers.Contract(this.wethAddress, ERC20_ABI, this.provider);
      const usdcContract = new ethers.Contract(this.usdcAddress, ERC20_ABI, this.provider);

      const [balance, feeData, wethBal, usdcBal] = await Promise.all([
        this.provider.getBalance(wallet.address),
        this.provider.getFeeData(),
        wethContract.balanceOf(wallet.address).catch(() => 0n),
        usdcContract.balanceOf(wallet.address).catch(() => 0n)
      ]);

      const gasPriceGwei = feeData.gasPrice ? ethers.formatUnits(feeData.gasPrice, 'gwei') : '0';

      return {
        configured: true,
        address: wallet.address,
        balanceEth: ethers.formatEther(balance),
        balanceEthRaw: balance,
        balanceWeth: ethers.formatEther(wethBal),
        balanceUsdc: ethers.formatUnits(usdcBal, 6),
        gasPriceGwei,
        network: 'Base Mainnet',
        chainId: this.chainId,
        rpcUrl: this.rpcUrl,
        explorerUrl: this.explorerUrl,
        dexVersion,
        pairToken,
        v3FeeTier,
        v4PoolManager: this.v4PoolManager,
        v4PositionManager: this.v4PositionManager,
        universalRouter: this.universalRouter,
        v3Factory: this.v3Factory,
        v3PositionManager: this.v3PositionManager,
        v3SwapRouter: this.v3SwapRouter,
        v2Router: this.v2Router
      };
    } catch (err) {
      return {
        configured: true,
        address: wallet.address,
        balanceEth: 'Error RPC',
        balanceWeth: '0',
        balanceUsdc: '0',
        gasPriceGwei: '0',
        error: err.message,
        network: 'Base Mainnet',
        chainId: this.chainId,
        rpcUrl: this.rpcUrl,
        explorerUrl: this.explorerUrl,
        dexVersion,
        pairToken,
        v3FeeTier,
        v4PoolManager: this.v4PoolManager,
        v4PositionManager: this.v4PositionManager,
        universalRouter: this.universalRouter,
        v3Factory: this.v3Factory,
        v3PositionManager: this.v3PositionManager,
        v3SwapRouter: this.v3SwapRouter,
        v2Router: this.v2Router
      };
    }
  }

  async deployToken(options = {}, onProgress = null) {
    const notify = (step, msg) => {
      console.log(`[BaseDirectDeploy] Step ${step}: ${msg}`);
      if (typeof onProgress === 'function') {
        try { onProgress(step, msg); } catch {}
      }
    };

    const walletIndex = options.walletIndex || 1;
    const wallet = this.getDeployerWallet(walletIndex);
    if (!wallet) {
      throw new Error(`Private key deployer Base (Wallet ${walletIndex}) belum dikonfigurasi di .env atau pengaturan bot.`);
    }

    notify(1, 'Memeriksa saldo ETH, kuotasi pair, dan status jaringan Base...');
    const balance = await this.provider.getBalance(wallet.address);

    const dexVersion = (options.dexVersion || storage.getBaseDirectDexVersion() || 'v4').toLowerCase();
    const pairChoice = (options.pair || storage.getBaseDirectPairToken() || 'ETH').toUpperCase().trim();
    const feeTier = Number(options.feeTier || storage.getBaseDirectV3FeeTier() || 10000);

    const ethLp = String(options.ethLiquidity || storage.getBaseDirectLpEth() || config.baseDirectDefaultLpEth || '0.00001');
    const devBuyEth = String(options.devBuyEth !== undefined ? options.devBuyEth : (storage.getBaseDirectDevBuyEth() !== undefined ? storage.getBaseDirectDevBuyEth() : '0.000001'));
    const targetMarketCapUsd = Number(options.targetMarketCapUsd !== undefined ? options.targetMarketCapUsd : storage.getBaseDirectTargetMcap());
    const useSingleSidedMcap = targetMarketCapUsd > 0 && dexVersion !== 'v2';

    const ethLpWei = useSingleSidedMcap ? 0n : ethers.parseEther(ethLp);
    const devBuyWei = ethers.parseEther(devBuyEth);
    const gasReserveWei = ethers.parseEther('0.0001'); // Gas reserve on Base L2 (~0.01 Gwei)
    const totalRequiredWei = ethLpWei + devBuyWei + gasReserveWei;

    if (balance < totalRequiredWei) {
      const curEth = ethers.formatEther(balance);
      const reqEth = ethers.formatEther(totalRequiredWei);
      throw new Error(`Saldo ETH di Base tidak mencukupi! Anda memiliki ${curEth} ETH, dibutuhkan minimal ${reqEth} ETH (${useSingleSidedMcap ? 'Mode MCap $' + targetMarketCapUsd + ' 0 ETH LP' : 'LP ' + ethLp + ' ETH'} + Dev Buy ${devBuyEth} ETH + gas).`);
    }

    // Resolve Quote Token (ETH, USDC, WETH)
    let quoteAddress;
    let quoteSymbol;
    let quoteDecimals = 18;

    if (pairChoice === 'USDC') {
      quoteAddress = this.usdcAddress;
      quoteSymbol = 'USDC';
      quoteDecimals = 6;
    } else if (pairChoice === 'WETH') {
      quoteAddress = this.wethAddress;
      quoteSymbol = 'WETH';
      quoteDecimals = 18;
    } else {
      // ETH Native
      quoteAddress = dexVersion === 'v4' ? ethers.ZeroAddress : this.wethAddress;
      quoteSymbol = 'ETH';
      quoteDecimals = 18;
    }

    // Parameters
    const name = options.name || 'Base Direct Token';
    const symbol = (options.symbol || 'BASE').toUpperCase();
    const totalSupplyStr = options.totalSupply || config.baseDirectDefaultTotalSupply || '100000000000';
    const totalSupply = ethers.parseUnits(totalSupplyStr, 18);
    const buyFee = Number(options.buyFee !== undefined ? options.buyFee : 5);
    const sellFee = Number(options.sellFee !== undefined ? options.sellFee : 5);
    const sniperBuyFee = 80;
    const sniperWindowMinutes = 30;
    const feeWallet = options.feeWallet || config.baseFeeWallet || wallet.address;

    // Logo Handling via Pinata IPFS
    let uploadedLogoUrl = options.imageUrl || '';
    if (uploadedLogoUrl && uploadedLogoUrl.startsWith('http')) {
      notify(2, `Mengunggah logo token ke IPFS via Pinata (${symbol}_logo.png)...`);
      try {
        uploadedLogoUrl = await pinataService.uploadFromUrl(uploadedLogoUrl, `${symbol}_logo.png`);
        notify(2, `Logo IPFS siap: ${uploadedLogoUrl}`);
      } catch (e) {
        console.warn('[BaseDeploy] Logo upload skipped:', e.message);
      }
    }

    // Step 3: Deploy Token Contract
    notify(3, `Deploying kontrak ERC-20 ${name} ($${symbol}) ke Base Mainnet...`);
    const tokenFactory = new ethers.ContractFactory(baseTokenArtifact.abi, baseTokenArtifact.bytecode, wallet);
    const tokenParams = {
      name,
      symbol,
      totalSupply,
      feeWallet,
      buyFee,
      sellFee,
      sniperBuyFee,
      sniperWindowMinutes,
      airdrop1: ethers.ZeroAddress,
      airdropAmount1: 0n,
      airdrop2: ethers.ZeroAddress,
      airdropAmount2: 0n
    };

    const tokenContract = await tokenFactory.deploy(tokenParams);
    await tokenContract.waitForDeployment();
    const tokenAddress = await tokenContract.getAddress();
    const deployTx = tokenContract.deploymentTransaction();
    const deployTxHash = deployTx?.hash || '';
    notify(3, `Kontrak token terdeploy di ${tokenAddress}! Tx: ${deployTxHash}`);
    await pace();

    // Step 4: Add Liquidity
    const tokenLp = ethers.parseUnits('20000000000', 18); // 20B token in initial pool
    let poolAddress = '';
    let addLiquidityTxHash = '';
    let positionTokenId = null;
    let initialPrice = 0;
    let realizedMcapUsd = 0;
    let quoteDepositedDisplay = `${ethLp} ${quoteSymbol}`;

    const abiCoder = ethers.AbiCoder.defaultAbiCoder();

    if (dexVersion === 'v4') {
      notify(4, `Menyiapkan likuiditas Uniswap V4 (Pair: ${symbol}/${quoteSymbol}${useSingleSidedMcap ? `, Target MCap $${targetMarketCapUsd.toLocaleString()}` : ''})...`);
      const posm = new ethers.Contract(this.v4PositionManager, V4_POSITION_MANAGER_ABI, wallet);
      const permit2 = new ethers.Contract(this.permit2Address, PERMIT2_ABI, wallet);
      const wethContract = new ethers.Contract(this.wethAddress, ERC20_ABI, wallet);

      let quoteDepositWei = 0n;
      let quoteAddressV4 = quoteSymbol === 'USDC' ? this.usdcAddress : (quoteSymbol === 'WETH' ? this.wethAddress : ethers.ZeroAddress);

      if (!useSingleSidedMcap) {
        if (quoteSymbol === 'USDC') {
          const usdcContract = new ethers.Contract(this.usdcAddress, ERC20_ABI, wallet);
          let curUsdc = await usdcContract.balanceOf(wallet.address);

          if (curUsdc < 1000n) {
            notify(4, `Menukar ${ethLp} ETH ke USDC via Uniswap V3 Router untuk pasangan pool...`);
            const wrapTx = await wethContract.deposit({ value: ethLpWei });
            await wrapTx.wait();
            const appWethTx = await wethContract.approve(this.v3SwapRouter, ethLpWei);
            await appWethTx.wait();

            const swapRouter = new ethers.Contract(this.v3SwapRouter, SWAP_ROUTER_ABI, wallet);
            const deadline = Math.floor(Date.now() / 1000) + 600;
            const swapTx = await swapRouter.exactInputSingle({
              tokenIn: this.wethAddress,
              tokenOut: this.usdcAddress,
              fee: 500, // 0.05% WETH/USDC tier
              recipient: wallet.address,
              deadline,
              amountIn: ethLpWei,
              amountOutMinimum: 0n,
              sqrtPriceLimitX96: 0n
            });
            await swapTx.wait();
            curUsdc = await usdcContract.balanceOf(wallet.address);
            notify(4, `Konversi USDC berhasil: ${ethers.formatUnits(curUsdc, 6)} USDC!`);
          }

          quoteDepositWei = curUsdc;
          quoteDepositedDisplay = `${ethers.formatUnits(curUsdc, 6)} USDC`;
          initialPrice = Number(ethers.formatUnits(curUsdc, 6)) / Number(ethers.formatUnits(tokenLp, 18));

          const appUsdcTx = await usdcContract.approve(this.permit2Address, ethers.MaxUint256);
          await appUsdcTx.wait();
          const p2AppUsdc = await permit2.approve(this.usdcAddress, this.v4PositionManager, '1461501637330902918203684832716283019655932542975', 281474976710655);
          await p2AppUsdc.wait();
          await pace();
        } else if (quoteSymbol === 'WETH') {
          quoteDepositWei = ethLpWei;
          quoteDepositedDisplay = `${ethLp} WETH`;
          initialPrice = Number(ethLp) / Number(ethers.formatUnits(tokenLp, 18));

          notify(4, `Wrapping ${ethLp} ETH menjadi WETH...`);
          const wrapTx = await wethContract.deposit({ value: ethLpWei });
          await wrapTx.wait();
          const appWethTx = await wethContract.approve(this.permit2Address, ethers.MaxUint256);
          await appWethTx.wait();
          const p2AppWeth = await permit2.approve(this.wethAddress, this.v4PositionManager, '1461501637330902918203684832716283019655932542975', 281474976710655);
          await p2AppWeth.wait();
          await pace();
        } else {
          quoteDepositWei = ethLpWei;
          quoteDepositedDisplay = `${ethLp} ETH`;
          initialPrice = Number(ethLp) / Number(ethers.formatUnits(tokenLp, 18));
        }
      }

      // Approve Meme Token ke Permit2 & PositionManager
      notify(4, `Approve ${symbol} ke Permit2 & Uniswap V4 PositionManager...`);
      const appTokenTx = await tokenContract.approve(this.permit2Address, ethers.MaxUint256);
      await appTokenTx.wait();
      const p2AppToken = await permit2.approve(tokenAddress, this.v4PositionManager, '1461501637330902918203684832716283019655932542975', 281474976710655);
      await p2AppToken.wait();
      await pace();

      const tickSpacing = feeTier >= 10000 ? 200 : (feeTier >= 3000 ? 60 : 10);
      let currency0, currency1, amount0Desired, amount1Desired, sqrtPriceX96, tickLower, tickUpper, liquidity;

      if (useSingleSidedMcap) {
        const quoteUsdPrice = await fetchQuoteUsdPrice(quoteSymbol);
        const mcapPos = computeClankerMarketCapPosition({
          targetMarketCapUsd,
          quoteUsdPrice,
          totalSupplyWei: totalSupply,
          tokenDecimals: 18,
          quoteDecimals,
          tokenAddress,
          quoteAddress: quoteAddressV4,
          tokenLpWei: tokenLp,
          feeTier
        });
        currency0 = mcapPos.currency0;
        currency1 = mcapPos.currency1;
        amount0Desired = mcapPos.amount0Desired;
        amount1Desired = mcapPos.amount1Desired;
        sqrtPriceX96 = mcapPos.sqrtPriceX96;
        tickLower = mcapPos.tickLower;
        tickUpper = mcapPos.tickUpper;
        liquidity = mcapPos.liquidity;
        initialPrice = mcapPos.initialPriceQuotePerToken;
        realizedMcapUsd = Math.round(mcapPos.initialMcapUsd);
        quoteDepositedDisplay = `0 ${quoteSymbol} (Single-Sided MCap $${realizedMcapUsd.toLocaleString()})`;
      } else {
        const isToken0 = quoteAddressV4 === ethers.ZeroAddress
          ? false
          : (BigInt(tokenAddress.toLowerCase()) < BigInt(quoteAddressV4.toLowerCase()));

        currency0 = isToken0 ? tokenAddress : quoteAddressV4;
        currency1 = isToken0 ? quoteAddressV4 : tokenAddress;
        amount0Desired = isToken0 ? tokenLp : quoteDepositWei;
        amount1Desired = isToken0 ? quoteDepositWei : tokenLp;
        sqrtPriceX96 = encodePriceSqrt(amount1Desired, amount0Desired);

        const minTick = -887200;
        const maxTick = 887200;
        tickLower = Math.ceil(minTick / tickSpacing) * tickSpacing;
        tickUpper = Math.floor(maxTick / tickSpacing) * tickSpacing;
        const spA = getSqrtRatioAtTick(tickLower);
        const spB = getSqrtRatioAtTick(tickUpper);
        liquidity = getLiquidityForAmounts(sqrtPriceX96, spA, spB, amount0Desired, amount1Desired);
      }

      const poolKey = {
        currency0,
        currency1,
        fee: feeTier,
        tickSpacing,
        hooks: ethers.ZeroAddress
      };

      const poolId = computePoolId(poolKey);
      poolAddress = poolId;

      notify(4, `Menginisialisasi Pool Uniswap V4 di Base (PoolId: ${poolId.slice(0, 10)}...)...`);
      try {
        const initTx = await posm.initializePool(poolKey, sqrtPriceX96);
        await initTx.wait();
        await pace();
      } catch (initErr) {
        console.warn('[BaseDeploy] initializePool notice:', initErr.message);
      }

      // Actions: MINT_POSITION (0x02), SETTLE_PAIR (0x0d), SWEEP (0x14)
      const actions = '0x020d14';
      const param0 = abiCoder.encode(
        [POOL_KEY_TYPE, 'int24', 'int24', 'uint256', 'uint128', 'uint128', 'address', 'bytes'],
        [poolKey, tickLower, tickUpper, liquidity, amount0Desired, amount1Desired, wallet.address, '0x']
      );
      const param1 = abiCoder.encode(['address', 'address'], [currency0, currency1]);
      const param2 = abiCoder.encode(['address', 'address'], [currency0, wallet.address]);
      const unlockData = abiCoder.encode(['bytes', 'bytes[]'], [actions, [param0, param1, param2]]);
      const deadline = Math.floor(Date.now() / 1000) + 1200;

      notify(4, 'Menyetor likuiditas ke Uniswap V4 PositionManager...');
      const msgValue = currency0 === ethers.ZeroAddress ? amount0Desired : 0n;
      const mintTx = await posm.modifyLiquidities(unlockData, deadline, { value: msgValue });
      const mintReceipt = await mintTx.wait();
      addLiquidityTxHash = mintTx.hash;

      // Extract Position NFT ID
      if (mintReceipt.logs) {
        for (const log of mintReceipt.logs) {
          if (log.address.toLowerCase() === this.v4PositionManager.toLowerCase() &&
              log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
            try {
              positionTokenId = ethers.toBigInt(log.topics[3] || log.data).toString();
              break;
            } catch {}
          }
        }
      }

      notify(4, `Likuiditas Uniswap V4 berhasil disetor! Pool ID: ${poolId} ${positionTokenId ? `(NFT #${positionTokenId})` : ''}`);
      await pace();

    } else if (dexVersion === 'v3') {
      notify(4, `Menyiapkan likuiditas Uniswap V3 di Base (Pair: ${symbol}/${quoteSymbol}, Fee: ${feeTier / 10000}%${useSingleSidedMcap ? `, Target MCap $${targetMarketCapUsd.toLocaleString()}` : ''})...`);
      const wethContract = new ethers.Contract(this.wethAddress, ERC20_ABI, wallet);
      const npm = new ethers.Contract(this.v3PositionManager, POSITION_MANAGER_ABI, wallet);
      const factory = new ethers.Contract(this.v3Factory, V3_FACTORY_ABI, wallet);

      let quoteDepositWei = 0n;
      const pairTokenAddress = quoteSymbol === 'USDC' ? this.usdcAddress : this.wethAddress;

      if (!useSingleSidedMcap) {
        if (quoteSymbol === 'USDC') {
          const usdcContract = new ethers.Contract(this.usdcAddress, ERC20_ABI, wallet);
          let curUsdc = await usdcContract.balanceOf(wallet.address);

          if (curUsdc < 1000n) {
            notify(4, `Menukar ${ethLp} ETH ke USDC via Uniswap V3 Router...`);
            const wrapTx = await wethContract.deposit({ value: ethLpWei });
            await wrapTx.wait();
            const appWethTx = await wethContract.approve(this.v3SwapRouter, ethLpWei);
            await appWethTx.wait();

            const swapRouter = new ethers.Contract(this.v3SwapRouter, SWAP_ROUTER_ABI, wallet);
            const deadline = Math.floor(Date.now() / 1000) + 600;
            const swapTx = await swapRouter.exactInputSingle({
              tokenIn: this.wethAddress,
              tokenOut: this.usdcAddress,
              fee: 500,
              recipient: wallet.address,
              deadline,
              amountIn: ethLpWei,
              amountOutMinimum: 0n,
              sqrtPriceLimitX96: 0n
            });
            await swapTx.wait();
            curUsdc = await usdcContract.balanceOf(wallet.address);
            notify(4, `Konversi USDC berhasil: ${ethers.formatUnits(curUsdc, 6)} USDC!`);
          }

          quoteDepositWei = curUsdc;
          quoteDepositedDisplay = `${ethers.formatUnits(curUsdc, 6)} USDC`;
          initialPrice = Number(ethers.formatUnits(curUsdc, 6)) / Number(ethers.formatUnits(tokenLp, 18));

          const appUsdcTx = await usdcContract.approve(this.v3PositionManager, quoteDepositWei);
          await appUsdcTx.wait();
        } else {
          quoteDepositWei = ethLpWei;
          quoteDepositedDisplay = `${ethLp} ${quoteSymbol}`;
          initialPrice = Number(ethLp) / Number(ethers.formatUnits(tokenLp, 18));

          notify(4, `Deposit & Wrap ${ethLp} ETH ke WETH...`);
          const wrapTx = await wethContract.deposit({ value: ethLpWei });
          await wrapTx.wait();
          const appWethTx = await wethContract.approve(this.v3PositionManager, ethLpWei);
          await appWethTx.wait();
        }
      }

      notify(4, `Approve ${symbol} ke Uniswap V3 PositionManager...`);
      const appTokenTx = await tokenContract.approve(this.v3PositionManager, tokenLp);
      await appTokenTx.wait();

      const tickSpacing = feeTier >= 10000 ? 200 : (feeTier >= 3000 ? 60 : 10);
      let token0, token1, amount0Desired, amount1Desired, sqrtPriceX96, tickLower, tickUpper;

      if (useSingleSidedMcap) {
        const quoteUsdPrice = await fetchQuoteUsdPrice(quoteSymbol);
        const mcapPos = computeClankerMarketCapPosition({
          targetMarketCapUsd,
          quoteUsdPrice,
          totalSupplyWei: totalSupply,
          tokenDecimals: 18,
          quoteDecimals,
          tokenAddress,
          quoteAddress: pairTokenAddress,
          tokenLpWei: tokenLp,
          feeTier
        });
        token0 = mcapPos.currency0;
        token1 = mcapPos.currency1;
        amount0Desired = mcapPos.amount0Desired;
        amount1Desired = mcapPos.amount1Desired;
        sqrtPriceX96 = mcapPos.sqrtPriceX96;
        tickLower = mcapPos.tickLower;
        tickUpper = mcapPos.tickUpper;
        initialPrice = mcapPos.initialPriceQuotePerToken;
        realizedMcapUsd = Math.round(mcapPos.initialMcapUsd);
        quoteDepositedDisplay = `0 ${quoteSymbol} (Single-Sided MCap $${realizedMcapUsd.toLocaleString()})`;
      } else {
        const isToken0 = BigInt(tokenAddress.toLowerCase()) < BigInt(pairTokenAddress.toLowerCase());
        token0 = isToken0 ? tokenAddress : pairTokenAddress;
        token1 = isToken0 ? pairTokenAddress : tokenAddress;
        amount0Desired = isToken0 ? tokenLp : quoteDepositWei;
        amount1Desired = isToken0 ? quoteDepositWei : tokenLp;
        sqrtPriceX96 = encodePriceSqrt(amount1Desired, amount0Desired);

        const minTick = -887200;
        const maxTick = 887200;
        tickLower = Math.ceil(minTick / tickSpacing) * tickSpacing;
        tickUpper = Math.floor(maxTick / tickSpacing) * tickSpacing;
      }

      notify(4, 'Membuat & menginisialisasi Pool Uniswap V3 di Base...');
      let existingPool = await factory.getPool(token0, token1, feeTier);
      if (!existingPool || existingPool === ethers.ZeroAddress) {
        const createPoolTx = await npm.createAndInitializePoolIfNecessary(token0, token1, feeTier, sqrtPriceX96);
        await createPoolTx.wait();
        poolAddress = await factory.getPool(token0, token1, feeTier);
      } else {
        poolAddress = existingPool;
      }

      const deadline = Math.floor(Date.now() / 1000) + 1200;

      notify(4, 'Menyetor likuiditas ke Uniswap V3 PositionManager...');
      const mintParams = {
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
      };

      const mintTx = await npm.mint(mintParams);
      const mintReceipt = await mintTx.wait();
      addLiquidityTxHash = mintTx.hash;

      if (mintReceipt.logs) {
        for (const log of mintReceipt.logs) {
          if (log.address.toLowerCase() === this.v3PositionManager.toLowerCase() &&
              log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
            try {
              positionTokenId = ethers.toBigInt(log.topics[3] || log.data).toString();
              break;
            } catch {}
          }
        }
      }

      notify(4, `Likuiditas Uniswap V3 berhasil disetor! Pool: ${poolAddress} ${positionTokenId ? `(NFT #${positionTokenId})` : ''}`);
      await pace();

    } else {
      // Uniswap V2 Fallback
      notify(4, `Menyetor likuiditas ke Uniswap V2 di Base (${ethLp} ETH + 20B ${symbol})...`);
      const router = new ethers.Contract(this.v2Router, ROUTER_ABI, wallet);
      const appTx = await tokenContract.approve(this.v2Router, tokenLp);
      await appTx.wait();

      const deadline = Math.floor(Date.now() / 1000) + 1200;
      const addLiqTx = await router.addLiquidityETH(
        tokenAddress,
        tokenLp,
        0n,
        0n,
        wallet.address,
        deadline,
        { value: ethLpWei }
      );
      await addLiqTx.wait();
      addLiquidityTxHash = addLiqTx.hash;

      const factoryAddress = await router.factory();
      const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, wallet);
      poolAddress = await factory.getPair(tokenAddress, this.wethAddress);
      notify(4, `Likuiditas Uniswap V2 berhasil disetor! Tx: ${addLiquidityTxHash}`);
      await pace();
    }

    // Step 5: Configure Pair on Token
    notify(5, 'Mengonfigurasi Pair trading & Anti-Sniper protection...');
    const pairToConfigure = dexVersion === 'v4' ? this.v4PoolManager : poolAddress;
    const setPairTx = await tokenContract.setPair(pairToConfigure);
    await setPairTx.wait();
    const setPairTxHash = setPairTx.hash;
    await pace();

    // Step 6: Enable Trading
    notify(6, 'Mengaktifkan trading on-chain (enableTrading)...');
    const enableTradingTx = await tokenContract.enableTrading();
    await enableTradingTx.wait();
    const enableTradingTxHash = enableTradingTx.hash;
    notify(6, `Trading telah AKTIF dan bisa ditradingkan! Tx: ${enableTradingTxHash}`);
    await pace();

    // Step 7: Dev Buy
    let devBuyTxHash = '';
    if (devBuyWei > 0n) {
      if (dexVersion === 'v4' && (quoteSymbol === 'ETH' || quoteSymbol === 'WETH')) {
        notify(7, `Menjalankan Dev Buy sebesar ${devBuyEth} ${quoteSymbol} via Uniswap V4 (UniversalRouter)...`);
        try {
          const ur = new ethers.Contract(this.universalRouter, UNIVERSAL_ROUTER_ABI, wallet);
          const deadline = Math.floor(Date.now() / 1000) + 600;
          const quoteAddrV4 = quoteSymbol === 'ETH' ? ethers.ZeroAddress : this.wethAddress;

          if (quoteSymbol === 'WETH') {
            const wethContract = new ethers.Contract(this.wethAddress, ERC20_ABI, wallet);
            const permit2 = new ethers.Contract(this.permit2Address, PERMIT2_ABI, wallet);
            await (await wethContract.deposit({ value: devBuyWei })).wait();
            await (await wethContract.approve(this.permit2Address, ethers.MaxUint256)).wait();
            await (await permit2.approve(this.wethAddress, this.universalRouter, '1461501637330902918203684832716283019655932542975', 281474976710655)).wait();
          }

          const isToken0 = quoteAddrV4 === ethers.ZeroAddress
            ? false
            : (BigInt(tokenAddress.toLowerCase()) < BigInt(quoteAddrV4.toLowerCase()));
          const currency0 = isToken0 ? tokenAddress : quoteAddrV4;
          const currency1 = isToken0 ? quoteAddrV4 : tokenAddress;
          const zeroForOne = !isToken0;

          const tickSpacing = feeTier >= 10000 ? 200 : (feeTier >= 3000 ? 60 : 10);
          const poolKey = {
            currency0,
            currency1,
            fee: feeTier,
            tickSpacing,
            hooks: ethers.ZeroAddress
          };

          const p0 = abiCoder.encode(
            [EXACT_INPUT_SINGLE_TYPE],
            [{
              poolKey,
              zeroForOne,
              amountIn: devBuyWei,
              amountOutMinimum: 0n,
              hookData: '0x'
            }]
          );
          const p1 = abiCoder.encode(['address', 'uint256', 'bool'], [quoteAddrV4, devBuyWei, quoteSymbol !== 'ETH']);
          const p2 = abiCoder.encode(['address', 'address', 'uint256'], [tokenAddress, wallet.address, 0n]);

          const v4Input = abiCoder.encode(['bytes', 'bytes[]'], ['0x060b0e', [p0, p1, p2]]);
          const buyTx = await ur.execute('0x10', [v4Input], deadline, { value: quoteSymbol === 'ETH' ? devBuyWei : 0n });
          await buyTx.wait();
          devBuyTxHash = buyTx.hash;
          notify(7, `Dev Buy Uniswap V4 sebesar ${devBuyEth} ${quoteSymbol} berhasil dieksekusi! Tx: ${devBuyTxHash}`);
          await pace();
        } catch (buyErr) {
          console.warn('[BaseDeploy] Dev Buy V4 warning:', buyErr.message);
          notify(7, `Peringatan Dev Buy V4: ${buyErr.message}`);
        }
      } else if (dexVersion === 'v3') {
        notify(7, `Menjalankan Dev Buy sebesar ${devBuyEth} ETH via Uniswap V3...`);
        try {
          const wethContract = new ethers.Contract(this.wethAddress, ERC20_ABI, wallet);
          const swapRouter = new ethers.Contract(this.v3SwapRouter, SWAP_ROUTER_ABI, wallet);

          const wrapDevTx = await wethContract.deposit({ value: devBuyWei });
          await wrapDevTx.wait();
          const appDevTx = await wethContract.approve(this.v3SwapRouter, devBuyWei);
          await appDevTx.wait();

          const devBuyDeadline = Math.floor(Date.now() / 1000) + 600;
          const buyTx = await swapRouter.exactInputSingle({
            tokenIn: this.wethAddress,
            tokenOut: tokenAddress,
            fee: feeTier,
            recipient: wallet.address,
            deadline: devBuyDeadline,
            amountIn: devBuyWei,
            amountOutMinimum: 0n,
            sqrtPriceLimitX96: 0n
          });
          await buyTx.wait();
          devBuyTxHash = buyTx.hash;
          notify(7, `Dev Buy Uniswap V3 sebesar ${devBuyEth} ETH berhasil dieksekusi! Tx: ${devBuyTxHash}`);
          await pace();
        } catch (buyErr) {
          console.warn('[BaseDeploy] Dev Buy V3 warning:', buyErr.message);
          notify(7, `Peringatan Dev Buy V3: ${buyErr.message}`);
        }
      } else {
        notify(7, `Menjalankan Dev Buy sebesar ${devBuyEth} ETH via Uniswap V2...`);
        try {
          const router = new ethers.Contract(this.v2Router, ROUTER_ABI, wallet);
          const deadline = Math.floor(Date.now() / 1000) + 600;
          const pathArr = [this.wethAddress, tokenAddress];
          const buyTx = await router.swapExactETHForTokens(
            0n,
            pathArr,
            wallet.address,
            deadline,
            { value: devBuyWei }
          );
          await buyTx.wait();
          devBuyTxHash = buyTx.hash;
          notify(7, `Dev Buy Uniswap V2 sebesar ${devBuyEth} ETH berhasil dieksekusi! Tx: ${devBuyTxHash}`);
          await pace();
        } catch (buyErr) {
          console.warn('[BaseDeploy] Dev Buy V2 warning:', buyErr.message);
          notify(7, `Peringatan Dev Buy V2: ${buyErr.message}`);
        }
      }
    }

    // Step 8: Save Record to Storage
    notify(8, 'Menyimpan riwayat deployment token ke database bot...');
    const record = {
      id: Date.now().toString(),
      name,
      symbol,
      imageUrl: uploadedLogoUrl,
      totalSupply: totalSupplyStr,
      tokenAddress,
      poolAddress,
      positionTokenId,
      v3FeeTier: feeTier,
      dexVersion: dexVersion === 'v4' ? 'Uniswap V4' : (dexVersion === 'v3' ? 'Uniswap V3' : 'Uniswap V2'),
      pairToken: quoteSymbol,
      quoteDeposited: quoteDepositedDisplay,
      ethDeposited: useSingleSidedMcap ? '0' : ethLp,
      targetMarketCapUsd: useSingleSidedMcap ? (realizedMcapUsd || targetMarketCapUsd) : 0,
      devBuyEth: Number(devBuyEth) > 0 ? devBuyEth : '0',
      tokenDeposited: '20,000,000,000',
      initialPriceEth: initialPrice,
      deployerAddress: wallet.address,
      feeWallet,
      buyFee,
      sellFee,
      deployTx: deployTxHash,
      addLiquidityTx: addLiquidityTxHash,
      setPairTx: setPairTxHash,
      enableTradingTx: enableTradingTxHash,
      devBuyTx: devBuyTxHash,
      isVerified: true
    };

    const savedEntry = storage.saveBaseDirectDeployedToken(record);

    // Format explorer URLs
    const tokenExplorerUrl = `${this.explorerUrl}/token/${tokenAddress}`;
    const poolExplorerUrl = poolAddress ? `${this.explorerUrl}/address/${poolAddress}` : '';
    const dexscreenerUrl = poolAddress
      ? `https://dexscreener.com/base/${poolAddress}`
      : `https://dexscreener.com/base/${tokenAddress}`;
    const geckoterminalUrl = poolAddress
      ? `https://www.geckoterminal.com/base/pools/${poolAddress}`
      : `https://www.geckoterminal.com/base/pools/${tokenAddress}`;

    notify(9, `Deployment Selesai! Token live di Base Mainnet: ${tokenAddress}`);

    return {
      success: true,
      network: 'Base Mainnet',
      chainId: this.chainId,
      dexVersion: record.dexVersion,
      pairToken: quoteSymbol,
      token: {
        name,
        symbol,
        address: tokenAddress,
        imageUrl: uploadedLogoUrl,
        totalSupply: totalSupplyStr,
        deployTxHash,
        isVerified: true
      },
      liquidity: {
        poolAddress,
        addLiquidityTxHash,
        enableTradingTxHash,
        devBuyTxHash,
        devBuyEth: Number(devBuyEth) > 0 ? `${devBuyEth} ETH` : '0 ETH',
        quoteDeposited: quoteDepositedDisplay,
        tokensDeposited: '20,000,000,000',
        initialPrice,
        targetMarketCapUsd: useSingleSidedMcap ? (realizedMcapUsd || targetMarketCapUsd) : 0
      },
      positionTokenId,
      urls: {
        tokenExplorer: tokenExplorerUrl,
        poolExplorer: poolExplorerUrl,
        dexscreener: dexscreenerUrl,
        geckoterminal: geckoterminalUrl
      },
      record: savedEntry
    };
  }
}

export const baseDeployService = new BaseDeployService();

