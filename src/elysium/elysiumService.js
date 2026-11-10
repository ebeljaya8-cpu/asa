import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
import { config } from '../config.js';
import { storage } from '../storage.js';
import { pinataService } from '../pinataService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const contractsDir = path.join(__dirname, 'contracts');

// Load Artifacts
const elysiumTokenArtifact = JSON.parse(fs.readFileSync(path.join(contractsDir, 'ElysiumToken.json'), 'utf8'));
const wrappedElysiumArtifact = JSON.parse(fs.readFileSync(path.join(contractsDir, 'WrappedElysium.json'), 'utf8'));
const teamTokenLockArtifact = JSON.parse(fs.readFileSync(path.join(contractsDir, 'TeamTokenLock.json'), 'utf8'));

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

// Math & Utility Constants
const Q96 = 2n ** 96n;
const POOL_KEY_TYPE = 'tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)';
const EXACT_INPUT_SINGLE_TYPE = `tuple(${POOL_KEY_TYPE} poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)`;

// Helper to delay between rapid calls to Conduit RPC
const pace = (ms = 1200) => new Promise(r => setTimeout(r, ms));

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

// TickMath: exact sqrtRatioX96 from tick
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

function getLiquidityForAmounts(sqrtRatioX96, sqrtRatioAX96, sqrtRatioBX96, amount0, amount1) {
  if (sqrtRatioAX96 > sqrtRatioBX96) [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  if (sqrtRatioX96 <= sqrtRatioAX96) {
    return getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0);
  } else if (sqrtRatioX96 < sqrtRatioBX96) {
    const l0 = getLiquidityForAmount0(sqrtRatioX96, sqrtRatioBX96, amount0);
    const l1 = getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioX96, amount1);
    return l0 < l1 ? l0 : l1;
  } else {
    return getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1);
  }
}

// Compute Uniswap V4 PoolId
function computePoolId(poolKey) {
  const defaultAbi = ethers.AbiCoder.defaultAbiCoder();
  const encoded = defaultAbi.encode(
    ['address', 'address', 'uint24', 'int24', 'address'],
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
  );
  return ethers.keccak256(encoded);
}

// Resilient Provider that handles Conduit rate limits (-32017 / 429) automatically
export class ResilientJsonRpcProvider extends ethers.JsonRpcProvider {
  constructor(url, network, options = {}) {
    super(url, network, options);
    this.pollingInterval = 3500; // 3.5s interval to prevent flooding Conduit RPC
  }

  async send(method, params) {
    const maxRetries = 10;
    let delay = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await super.send(method, params);
      } catch (err) {
        const errMsg = String(err?.message || '');
        const errData = JSON.stringify(err || {});
        const isRateLimit =
          err?.code === -32017 ||
          err?.error?.code === -32017 ||
          errMsg.includes('Rate Limit Exceeded') ||
          errMsg.includes('-32017') ||
          errData.includes('-32017') ||
          errMsg.includes('429') ||
          errMsg.includes('Too Many Requests') ||
          errMsg.includes('could not coalesce error');

        if (isRateLimit && attempt < maxRetries) {
          const jitter = Math.floor(Math.random() * 800);
          const waitTime = delay + jitter;
          console.warn(`[ElysiumRPC] Rate limit hit on ${method} (-32017). Menunggu ${waitTime}ms sebelum retry (Percobaan ${attempt}/${maxRetries})...`);
          await new Promise(r => setTimeout(r, waitTime));
          delay = Math.min(Math.floor(delay * 1.6), 12000); // Exponential backoff up to 12s
          continue;
        }

        throw err;
      }
    }
  }
}

export class ElysiumService {
  constructor() {
    let rpc = config.elysiumRpcUrl || 'https://rpc.elysium.kinetiq.xyz';
    if (config.elysiumApiKey && !rpc.includes('apiKey=')) {
      rpc += (rpc.includes('?') ? '&' : '?') + `apiKey=${config.elysiumApiKey}`;
    }
    this.rpcUrl = rpc;
    this.chainId = config.elysiumChainId || 99901;
    this.explorerUrl = config.elysiumExplorer || 'https://elyscan.live';
    this.provider = new ResilientJsonRpcProvider(this.rpcUrl, this.chainId, { staticNetwork: true });

    // Uniswap V4 Verified Contracts
    this.v4PoolManager = config.elysiumV4PoolManager || '0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1';
    this.v4PositionManager = config.elysiumV4PositionManager || '0x1d1C51b9d07fD27d36412A2b66CC23D19Eb3E518';
    this.permit2Address = config.elysiumPermit2 || '0x000000000022D473030F116dDEE9F6B43aC78BA3';
    this.universalRouter = config.elysiumUniversalRouter || '0xA13f7611115752DEB2B13813BDDE16A5073e4b45';
    this.v4DexRouter = config.elysiumV4DexRouter || '0x6c3C2eFa01a8240C00a683E36502F656f0c15Fd6';

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
    const buyFee = storage.getElysiumBuyFee();
    const sellFee = storage.getElysiumSellFee();

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
        buyFee,
        sellFee,
        v4PoolManager: this.v4PoolManager,
        v4PositionManager: this.v4PositionManager,
        universalRouter: this.universalRouter,
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
        buyFee,
        sellFee,
        v4PoolManager: this.v4PoolManager,
        v4PositionManager: this.v4PositionManager,
        universalRouter: this.universalRouter,
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
        buyFee,
        sellFee,
        v4PoolManager: this.v4PoolManager,
        v4PositionManager: this.v4PositionManager,
        universalRouter: this.universalRouter,
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
        await pace(4000);
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

    const dexVersion = (options.dexVersion || storage.getElysiumDexVersion() || 'v4').toLowerCase();
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
      quoteAddress = dexVersion === 'v4' ? ethers.ZeroAddress : (config.elysiumWeth || this.wethAddress);
      quoteSymbol = pairChoice === 'ETH' ? 'ETH' : 'HYPE';
      quoteDecimals = 18;
    }

    const name = (options.name || 'Elysium Token').trim();
    const symbol = (options.symbol || 'ELYS').trim().toUpperCase();
    const totalSupply = options.totalSupply ? BigInt(options.totalSupply) : ethers.parseEther('100000000000'); // 100B default
    const feeWallet = options.feeWallet && ethers.isAddress(options.feeWallet) ? options.feeWallet : wallet.address;
    const buyFee = Number(options.buyFee !== undefined ? options.buyFee : storage.getElysiumBuyFee());
    const sellFee = Number(options.sellFee !== undefined ? options.sellFee : storage.getElysiumSellFee());
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

    // Logo / Image Handling (Similar to Clanker IPFS flow)
    let rawImageUrl = options.imageUrl || (isWrappedElysiumOriginal 
      ? 'https://raw.githubusercontent.com/ebeljaya8-cpu/asa/main/data/elysium-logo.png' 
      : 'https://assets.coingecko.com/coins/images/placeholder.png');

    let finalImageUrl = rawImageUrl;
    if (rawImageUrl && !rawImageUrl.startsWith('ipfs://')) {
      try {
        notify(1, 'Memproses & mengunggah logo token ke IPFS via Pinata...');
        finalImageUrl = await pinataService.uploadFromUrl(rawImageUrl, `${symbol.toLowerCase()}.png`);
        notify(1, `Logo token IPFS siap: ${finalImageUrl}`);
      } catch (imgErr) {
        console.warn('[ElysiumService] Pinata upload skipped, using direct URL:', imgErr.message);
      }
    }

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
    await pace();

    // Step 3: TeamTokenLock (Optional)
    let lockAddress = '';
    let lockDeployTxHash = '';
    let lockTransferTxHash = '';
    let lockReleaseTime = 0;

    if (lockTokens > 0n) {
      notify(4, `Mendeploy kontrak TeamTokenLock (Lock ${ethers.formatUnits(lockTokens, 18)} token selama ${lockHours} jam)...`);
      const lockFactory = new ethers.ContractFactory(teamTokenLockArtifact.abi, teamTokenLockArtifact.bytecode, wallet);
      const block = await this.provider.getBlock('latest').catch(() => null);
      lockReleaseTime = (block ? block.timestamp : Math.floor(Date.now() / 1000)) + (lockHours * 3600);

      const lockTx = await lockFactory.deploy(tokenAddress, wallet.address, lockReleaseTime);
      await lockTx.waitForDeployment();
      lockAddress = await lockTx.getAddress();
      lockDeployTxHash = lockTx.deploymentTransaction().hash;

      await pace();
      notify(4, `Mengirim token ke kontrak lock ${lockAddress}...`);
      const transferTx = await tokenContract.transfer(lockAddress, lockTokens);
      await transferTx.wait();
      lockTransferTxHash = transferTx.hash;
      notify(4, `Lock berhasil! Tx: ${lockTransferTxHash}`);
      await pace();
    }

    // Step 4: Add Liquidity (Uniswap V4 default, V3 & V2 fallback)
    let poolAddress = '';
    let addLiquidityTxHash = '';
    let positionTokenId = null;
    let quoteDepositedDisplay = '';
    let initialPrice = 0;

    if (dexVersion === 'v4') {
      notify(5, `Menyiapkan likuiditas Uniswap V4 (Pair: ${symbol}/${quoteSymbol}, Fee: ${feeTier / 10000}%)...`);
      const posm = new ethers.Contract(this.v4PositionManager, V4_POSITION_MANAGER_ABI, wallet);
      const permit2 = new ethers.Contract(this.permit2Address, PERMIT2_ABI, wallet);

      let quoteDepositWei = hypeLpWei;
      let quoteAddressV4 = quoteAddress;

      if (quoteSymbol === 'USDC') {
        const usdcContract = new ethers.Contract(this.usdcAddress, ERC20_ABI, wallet);
        let curUsdc = await usdcContract.balanceOf(wallet.address);

        // Auto convert small HYPE to USDC via V3 swap if needed
        if (curUsdc < 1000n) {
          notify(5, `Menukar ${hypeLp} HYPE ke USDC via Router untuk modal likuiditas pool...`);
          const whypeContract = new ethers.Contract(this.wethAddress, ERC20_ABI, wallet);
          const swapRouter = new ethers.Contract(this.v3SwapRouter, SWAP_ROUTER_ABI, wallet);
          const wrapTx = await whypeContract.deposit({ value: hypeLpWei });
          await wrapTx.wait();
          await (await whypeContract.approve(this.v3SwapRouter, hypeLpWei)).wait();

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
          await pace();
        }

        quoteDepositWei = curUsdc;
        quoteDepositedDisplay = `${ethers.formatUnits(quoteDepositWei, 6)} USDC`;
        quoteAddressV4 = this.usdcAddress;
        initialPrice = Number(ethers.formatUnits(quoteDepositWei, 6)) / Number(ethers.formatUnits(tokenLp, 18));

        notify(5, `Approve USDC ke Permit2 & PositionManager...`);
        const appUsdcTx = await usdcContract.approve(this.permit2Address, ethers.MaxUint256);
        await appUsdcTx.wait();
        const p2AppUsdc = await permit2.approve(this.usdcAddress, this.v4PositionManager, '1461501637330902918203684832716283019655932542975', 281474976710655);
        await p2AppUsdc.wait();
        await pace();
      } else if (quoteSymbol === 'WETH') {
        quoteDepositWei = hypeLpWei;
        quoteDepositedDisplay = `${hypeLp} WETH`;
        quoteAddressV4 = this.wethAddress;
        initialPrice = Number(hypeLp) / Number(ethers.formatUnits(tokenLp, 18));

        notify(5, `Wrap HYPE -> WETH & Approve Permit2...`);
        const whypeContract = new ethers.Contract(this.wethAddress, ERC20_ABI, wallet);
        const wrapTx = await whypeContract.deposit({ value: hypeLpWei });
        await wrapTx.wait();
        const appWethTx = await whypeContract.approve(this.permit2Address, ethers.MaxUint256);
        await appWethTx.wait();
        const p2AppWeth = await permit2.approve(this.wethAddress, this.v4PositionManager, '1461501637330902918203684832716283019655932542975', 281474976710655);
        await p2AppWeth.wait();
        await pace();
      } else {
        // Native HYPE / ETH (Address 0 in Uniswap V4)
        quoteDepositWei = hypeLpWei;
        quoteDepositedDisplay = `${hypeLp} ${quoteSymbol}`;
        quoteAddressV4 = ethers.ZeroAddress;
        initialPrice = Number(hypeLp) / Number(ethers.formatUnits(tokenLp, 18));
      }

      // Approve Meme Token ke Permit2 & PositionManager
      notify(5, `Approve ${symbol} ke Permit2 & Uniswap V4 PositionManager...`);
      const appTokenTx = await tokenContract.approve(this.permit2Address, ethers.MaxUint256);
      await appTokenTx.wait();
      const p2AppToken = await permit2.approve(tokenAddress, this.v4PositionManager, '1461501637330902918203684832716283019655932542975', 281474976710655);
      await p2AppToken.wait();
      await pace();

      // Uniswap V4 Token Ordering (currency0 strictly < currency1)
      const isToken0 = quoteAddressV4 === ethers.ZeroAddress 
        ? false 
        : (BigInt(tokenAddress.toLowerCase()) < BigInt(quoteAddressV4.toLowerCase()));

      const currency0 = isToken0 ? tokenAddress : quoteAddressV4;
      const currency1 = isToken0 ? quoteAddressV4 : tokenAddress;
      const amount0Desired = isToken0 ? tokenLp : quoteDepositWei;
      const amount1Desired = isToken0 ? quoteDepositWei : tokenLp;

      const tickSpacing = feeTier >= 10000 ? 200 : (feeTier >= 3000 ? 60 : 10);
      const poolKey = {
        currency0,
        currency1,
        fee: feeTier,
        tickSpacing,
        hooks: ethers.ZeroAddress
      };

      const poolId = computePoolId(poolKey);
      poolAddress = poolId;

      // SqrtPriceX96 Calculation
      const sqrtPriceX96 = encodePriceSqrt(amount1Desired, amount0Desired);

      notify(5, `Menginisialisasi Pool Uniswap V4 (PoolId: ${poolId.slice(0, 10)}...)...`);
      try {
        const initTx = await posm.initializePool(poolKey, sqrtPriceX96);
        await initTx.wait();
        await pace();
      } catch (initErr) {
        // Ignore if already initialized
        console.warn('[ElysiumService] initializePool notice:', initErr.message);
      }

      // Full-Range Tick Calculation
      const minTick = -887200;
      const maxTick = 887200;
      const tickLower = Math.ceil(minTick / tickSpacing) * tickSpacing;
      const tickUpper = Math.floor(maxTick / tickSpacing) * tickSpacing;
      const spA = getSqrtRatioAtTick(tickLower);
      const spB = getSqrtRatioAtTick(tickUpper);
      const liquidity = getLiquidityForAmounts(sqrtPriceX96, spA, spB, amount0Desired, amount1Desired);

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

      notify(5, `Menyetor likuiditas ke Uniswap V4 PositionManager...`);
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

      notify(5, `Likuiditas Uniswap V4 berhasil disetor! Pool ID: ${poolId} ${positionTokenId ? `(NFT #${positionTokenId})` : ''}`);
      await pace();

    } else if (dexVersion === 'v3') {
      notify(5, `Menyiapkan likuiditas Uniswap V3 (Pair: ${symbol}/${quoteSymbol}, Fee Tier: ${feeTier / 10000}%)...`);
      
      const whypeContract = new ethers.Contract(this.wethAddress, ERC20_ABI, wallet);
      const npm = new ethers.Contract(this.v3PositionManager, POSITION_MANAGER_ABI, wallet);
      const factory = new ethers.Contract(this.v3Factory, V3_FACTORY_ABI, wallet);
      const swapRouter = new ethers.Contract(this.v3SwapRouter, SWAP_ROUTER_ABI, wallet);

      let quoteDepositWei;

      if (quoteSymbol === 'USDC') {
        const usdcContract = new ethers.Contract(this.usdcAddress, ERC20_ABI, wallet);
        let curUsdc = await usdcContract.balanceOf(wallet.address);

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
          await pace();
        }

        quoteDepositWei = curUsdc;
        quoteDepositedDisplay = `${ethers.formatUnits(quoteDepositWei, 6)} USDC`;
        
        notify(5, `Approve USDC ke NonfungiblePositionManager...`);
        const appUsdcTx = await usdcContract.approve(this.v3PositionManager, ethers.MaxUint256);
        await appUsdcTx.wait();
        initialPrice = Number(ethers.formatUnits(quoteDepositWei, 6)) / Number(ethers.formatUnits(tokenLp, 18));
      } else {
        quoteDepositWei = hypeLpWei;
        quoteDepositedDisplay = `${hypeLp} ${quoteSymbol}`;

        notify(5, `Wrap ${hypeLp} HYPE -> WHYPE & Approve PositionManager...`);
        const wrapTx = await whypeContract.deposit({ value: hypeLpWei });
        await wrapTx.wait();
        const appWhypeTx = await whypeContract.approve(this.v3PositionManager, ethers.MaxUint256);
        await appWhypeTx.wait();
        initialPrice = Number(hypeLp) / Number(ethers.formatUnits(tokenLp, 18));
      }

      notify(5, `Approve ${symbol} ke NonfungiblePositionManager...`);
      const appTokenTx = await tokenContract.approve(this.v3PositionManager, ethers.MaxUint256);
      await appTokenTx.wait();
      await pace();

      const isToken0 = tokenAddress.toLowerCase() < quoteAddress.toLowerCase();
      const token0 = isToken0 ? tokenAddress : quoteAddress;
      const token1 = isToken0 ? quoteAddress : tokenAddress;
      const amount0Desired = isToken0 ? tokenLp : quoteDepositWei;
      const amount1Desired = isToken0 ? quoteDepositWei : tokenLp;

      const sqrtPriceX96 = encodePriceSqrt(amount1Desired, amount0Desired);

      notify(5, `Membuat & menginisialisasi Pool Uniswap V3 (Fee: ${feeTier})...`);
      const initTx = await npm.createAndInitializePoolIfNecessary(token0, token1, feeTier, sqrtPriceX96);
      await initTx.wait();
      await pace();

      poolAddress = await factory.getPool(token0, token1, feeTier);

      const tickSpacing = Number(await factory.feeAmountTickSpacing(feeTier));
      const minTick = -887272;
      const maxTick = 887272;
      const tickLower = Math.ceil(minTick / tickSpacing) * tickSpacing;
      const tickUpper = Math.floor(maxTick / tickSpacing) * tickSpacing;

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
      await pace();

    } else {
      // Uniswap V2 Fallback
      quoteDepositedDisplay = `${hypeLp} HYPE`;
      initialPrice = Number(hypeLp) / Number(ethers.formatUnits(tokenLp, 18));
      notify(5, `Menyetor likuiditas ke Uniswap V2 (${hypeLp} HYPE + ${ethers.formatUnits(tokenLp, 18)} ${symbol})...`);
      const router = new ethers.Contract(this.routerAddress, ROUTER_ABI, wallet);
      
      const approveTx = await tokenContract.approve(this.routerAddress, ethers.MaxUint256);
      await approveTx.wait();
      await pace();

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
      await pace();
    }

    // Step 5: Configure Pair on token
    notify(6, 'Mendeteksi Pool Pair dan mengonfigurasi Anti-Sniper...');
    // In Uniswap V4, tokens flow to/from the singleton PoolManager
    const pairToConfigure = dexVersion === 'v4' ? this.v4PoolManager : poolAddress;
    const setPairTx = await tokenContract.setPair(pairToConfigure);
    await setPairTx.wait();
    const setPairTxHash = setPairTx.hash;
    await pace();

    // Step 6: Enable Trading
    notify(7, 'Mengaktifkan trading on-chain (enableTrading)...');
    const enableTradingTx = await tokenContract.enableTrading();
    await enableTradingTx.wait();
    const enableTradingTxHash = enableTradingTx.hash;
    notify(7, `Trading telah AKTIF dan bisa ditradingkan! Tx: ${enableTradingTxHash}`);
    await pace();

    // Step 7: Dev Buy
    let devBuyTxHash = '';
    if (devBuyWei > 0n) {
      if (dexVersion === 'v4') {
        notify(8, `Menjalankan Dev Buy sebesar ${devBuyHype} HYPE via Uniswap V4 (UniversalRouter)...`);
        try {
          const ur = new ethers.Contract(this.universalRouter, UNIVERSAL_ROUTER_ABI, wallet);
          const deadline = Math.floor(Date.now() / 1000) + 600;

          const tickSpacing = feeTier >= 10000 ? 200 : (feeTier >= 3000 ? 60 : 10);
          const poolKey = {
            currency0: ethers.ZeroAddress,
            currency1: tokenAddress,
            fee: feeTier,
            tickSpacing,
            hooks: ethers.ZeroAddress
          };

          // actions: SWAP_EXACT_IN_SINGLE (0x06), SETTLE (0x0b), TAKE (0x0e)
          const p0 = abiCoder.encode(
            [EXACT_INPUT_SINGLE_TYPE],
            [{
              poolKey,
              zeroForOne: true,
              amountIn: devBuyWei,
              amountOutMinimum: 0n,
              hookData: '0x'
            }]
          );
          const p1 = abiCoder.encode(['address', 'uint256', 'bool'], [ethers.ZeroAddress, devBuyWei, false]);
          const p2 = abiCoder.encode(['address', 'address', 'uint256'], [tokenAddress, wallet.address, 0n]);

          const v4Input = abiCoder.encode(['bytes', 'bytes[]'], ['0x060b0e', [p0, p1, p2]]);
          const buyTx = await ur.execute('0x10', [v4Input], deadline, { value: devBuyWei });
          await buyTx.wait();
          devBuyTxHash = buyTx.hash;
          notify(8, `Dev Buy Uniswap V4 sebesar ${devBuyHype} HYPE berhasil dieksekusi! Tx: ${devBuyTxHash}`);
          await pace();
        } catch (buyErr) {
          console.warn('Dev Buy V4 warning:', buyErr.message);
          notify(8, `Peringatan Dev Buy V4: ${buyErr.message}`);
        }
      } else if (dexVersion === 'v3') {
        notify(8, `Menjalankan Dev Buy sebesar ${devBuyHype} HYPE via Uniswap V3...`);
        try {
          const whypeContract = new ethers.Contract(this.wethAddress, ERC20_ABI, wallet);
          const swapRouter = new ethers.Contract(this.v3SwapRouter, SWAP_ROUTER_ABI, wallet);

          const wrapDevTx = await whypeContract.deposit({ value: devBuyWei });
          await wrapDevTx.wait();
          const appDevTx = await whypeContract.approve(this.v3SwapRouter, devBuyWei);
          await appDevTx.wait();

          const devBuyDeadline = Math.floor(Date.now() / 1000) + 600;

          if (quoteSymbol === 'USDC') {
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
          await pace();
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
          await pace();
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

    const dexName = dexVersion === 'v4' ? 'Uniswap V4' : (dexVersion === 'v3' ? 'Uniswap V3' : 'Uniswap V2');

    // Save record to storage
    const record = storage.saveElysiumDeployedToken({
      name,
      symbol,
      imageUrl: finalImageUrl,
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

    const poolExplorerUrl = dexVersion === 'v4'
      ? `${this.explorerUrl}/address/${this.v4PoolManager}`
      : `${this.explorerUrl}/address/${poolAddress}`;

    const dexscreenerUrl = dexVersion === 'v4'
      ? `https://www.geckoterminal.com/elysium/pools/${poolAddress}`
      : `https://dexscreener.com/elysium/${poolAddress}`;

    return {
      success: true,
      dexVersion: dexName,
      pairToken: quoteSymbol,
      positionTokenId,
      token: {
        name,
        symbol,
        address: tokenAddress,
        imageUrl: finalImageUrl,
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
        poolExplorer: poolExplorerUrl,
        dexscreener: dexscreenerUrl
      },
      record
    };
  }

  async getHarvestableTokens() {
    const wallet = this.getDeployerWallet();
    if (!wallet) return [];

    const deployed = storage.getElysiumDeployedTokens();
    const tokenAddresses = new Set();
    deployed.forEach(t => {
      if (t.tokenAddress) tokenAddresses.add(t.tokenAddress.toLowerCase());
    });
    // Known / user tokens fallback
    tokenAddresses.add('0x2975075a7282ce8a8c27b0ecbf146ad56ce8993b');

    const results = [];
    for (const addr of tokenAddresses) {
      try {
        const tokenContract = new ethers.Contract(addr, [
          'function name() view returns (string)',
          'function symbol() view returns (string)',
          'function balanceOf(address) view returns (uint256)'
        ], wallet);

        const [name, symbol, bal] = await Promise.all([
          tokenContract.name().catch(() => 'Unknown'),
          tokenContract.symbol().catch(() => 'TOKEN'),
          tokenContract.balanceOf(wallet.address).catch(() => 0n)
        ]);

        if (bal > 0n) {
          results.push({
            address: ethers.getAddress(addr),
            name,
            symbol,
            balanceRaw: bal.toString(),
            balanceFormatted: Number(ethers.formatUnits(bal, 18)).toLocaleString('id-ID', { maximumFractionDigits: 2 }),
            hasBalance: true
          });
        }
      } catch (e) {
        console.warn(`Error checking balance for ${addr}:`, e.message);
      }
    }
    return results;
  }

  async harvestTokenToHype(options = {}) {
    const wallet = this.getDeployerWallet();
    if (!wallet) {
      throw new Error('Wallet deployer Elysium tidak terkonfigurasi');
    }

    const tokenAddress = options.tokenAddress;
    if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
      throw new Error('Alamat token tidak valid');
    }

    const tokenContract = new ethers.Contract(tokenAddress, [
      'function name() view returns (string)',
      'function symbol() view returns (string)',
      'function balanceOf(address) view returns (uint256)',
      'function allowance(address,address) view returns (uint256)',
      'function approve(address,uint256) returns (bool)'
    ], wallet);

    const [name, symbol, tokenBal] = await Promise.all([
      tokenContract.name().catch(() => 'Unknown'),
      tokenContract.symbol().catch(() => 'TOKEN'),
      tokenContract.balanceOf(wallet.address)
    ]);

    if (tokenBal === 0n) {
      return {
        success: false,
        message: `Tidak ada saldo token ${symbol} untuk di-harvest di wallet deployer.`,
        tokenAddress,
        symbol,
        tokensSwapped: '0',
        hypeReceived: '0'
      };
    }

    let amountToSwap = options.amount ? BigInt(options.amount) : tokenBal;
    if (amountToSwap > tokenBal) {
      amountToSwap = tokenBal;
    }

    if (amountToSwap === 0n) {
      return {
        success: false,
        message: 'Nominal token 0.',
        tokenAddress,
        symbol,
        tokensSwapped: '0',
        hypeReceived: '0'
      };
    }

    const routerAddr = this.v4DexRouter || '0x6c3C2eFa01a8240C00a683E36502F656f0c15Fd6';
    const allowance = await tokenContract.allowance(wallet.address, routerAddr);
    if (allowance < amountToSwap) {
      const appTx = await tokenContract.approve(routerAddr, ethers.MaxUint256);
      await appTx.wait();
    }

    const routerIface = new ethers.Interface([
      'function swap((uint8 dexType, address tokenIn, address tokenOut, address pool, uint24 fee, int24 tickSpacing, address hook, bytes hookData, address recipient, bytes32 extraData)[] routes, address to, uint256 amountIn, uint256 minAmountOut, uint256 deadline)'
    ]);

    const route = [{
      dexType: 2, // Uniswap V4
      tokenIn: tokenAddress,
      tokenOut: ethers.ZeroAddress, // Native HYPE
      pool: ethers.ZeroAddress,
      fee: 10000,
      tickSpacing: 200,
      hook: ethers.ZeroAddress,
      hookData: '0x',
      recipient: this.v4PoolManager,
      extraData: ethers.ZeroHash
    }];

    const routerContract = new ethers.Contract(routerAddr, routerIface, wallet);
    const deadline = Math.floor(Date.now() / 1000) + 600;

    const balBefore = await this.provider.getBalance(wallet.address);
    let gasLimit = 350000n;
    try {
      const estimated = await routerContract.swap.estimateGas(route, ethers.ZeroAddress, amountToSwap, 0n, deadline);
      gasLimit = (estimated * 13n) / 10n;
    } catch (e) {
      console.warn('Gas estimation warning for harvest:', e.message);
    }

    const tx = await routerContract.swap(route, ethers.ZeroAddress, amountToSwap, 0n, deadline, { gasLimit });
    const receipt = await tx.wait();

    const balAfter = await this.provider.getBalance(wallet.address);
    const hypeDiff = balAfter > balBefore ? (balAfter - balBefore) : 0n;

    return {
      success: true,
      txHash: tx.hash,
      tokenAddress,
      name,
      symbol,
      tokensSwapped: ethers.formatUnits(amountToSwap, 18),
      hypeReceived: ethers.formatEther(hypeDiff),
      newHypeBalance: ethers.formatEther(balAfter),
      explorerUrl: `${this.explorerUrl}/tx/${tx.hash}`
    };
  }

  async autoHarvestAll() {
    const list = await this.getHarvestableTokens();
    const results = [];
    for (const item of list) {
      try {
        const res = await this.harvestTokenToHype({ tokenAddress: item.address });
        if (res.success && parseFloat(res.tokensSwapped) > 0) {
          results.push(res);
        }
      } catch (err) {
        console.warn(`[AutoHarvest] Gagal auto-harvest ${item.symbol}:`, err.message);
      }
    }
    return results;
  }
}

export const elysiumService = new ElysiumService();
