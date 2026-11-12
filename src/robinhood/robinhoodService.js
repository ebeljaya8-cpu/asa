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

// Load Artifacts (same contract as Elysium - compatible ERC20 with tax+antisnipe)
const robinhoodTokenArtifact = JSON.parse(fs.readFileSync(path.join(contractsDir, 'RobinhoodToken.json'), 'utf8'));
const teamTokenLockArtifact = JSON.parse(fs.readFileSync(path.join(contractsDir, 'TeamTokenLock.json'), 'utf8'));

// === Robinhood Chain (Chain ID: 4663) Contract Addresses ===
// Uniswap V4
const RH_V4_POOL_MANAGER   = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
const RH_V4_POSITION_MGR   = '0x58daec3116aae6d93017baaea7749052e8a04fa7';
const RH_UNIVERSAL_ROUTER  = '0x204FAca1764B154221e35c0d20aBb3c525710498';
// Uniswap V3
const RH_V3_FACTORY        = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa';
const RH_V3_POSITION_MGR   = '0x73991a25c818bf1f1128deaab1492d45638de0d3';
// Permit2 (standard across chains)
const RH_PERMIT2           = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
// Tokens
const RH_WETH              = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'; // WETH on Robinhood
const RH_USDG              = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'; // USDG (primary stablecoin)
// Explorer
const RH_EXPLORER          = 'https://robinhoodchain.blockscout.com';
const RH_RPC               = 'https://rpc.mainnet.chain.robinhood.com';
const RH_CHAIN_ID          = 4663;

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

// Math & Utility Constants
const Q96 = 2n ** 96n;
const POOL_KEY_TYPE = 'tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)';
const EXACT_INPUT_SINGLE_TYPE = `tuple(${POOL_KEY_TYPE} poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)`;

const pace = (ms = 1200) => new Promise(r => setTimeout(r, ms));

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

function computePoolId(poolKey) {
  const defaultAbi = ethers.AbiCoder.defaultAbiCoder();
  const encoded = defaultAbi.encode(
    ['address', 'address', 'uint24', 'int24', 'address'],
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
  );
  return ethers.keccak256(encoded);
}

export class RobinhoodService {
  constructor() {
    this.rpcUrl = config.robinhoodRpcUrl || RH_RPC;
    this.chainId = parseInt(config.robinhoodChainId || RH_CHAIN_ID, 10);
    this.explorerUrl = config.robinhoodExplorer || RH_EXPLORER;
    this.provider = new ethers.JsonRpcProvider(this.rpcUrl, this.chainId, { staticNetwork: true });

    // Uniswap V4
    this.v4PoolManager       = config.robinhoodV4PoolManager || RH_V4_POOL_MANAGER;
    this.v4PositionManager   = config.robinhoodV4PositionManager || RH_V4_POSITION_MGR;
    this.universalRouter     = config.robinhoodUniversalRouter || RH_UNIVERSAL_ROUTER;
    this.permit2Address      = config.robinhoodPermit2 || RH_PERMIT2;

    // Uniswap V3
    this.v3Factory           = config.robinhoodV3Factory || RH_V3_FACTORY;
    this.v3PositionManager   = config.robinhoodV3PositionManager || RH_V3_POSITION_MGR;
    // Note: V3 SwapRouter is not publicly verified on RH yet - devbuy will fallback to V4 path

    // Tokens
    this.wethAddress         = config.robinhoodWeth || RH_WETH;
    this.usdgAddress         = config.robinhoodUsdg || RH_USDG;
  }

  getDeployerWallet() {
    const pk = config.robinhoodPrivateKey || config.elysiumPrivateKey || storage.getWalletPrivateKey(1);
    if (!pk || !pk.startsWith('0x') || pk.length !== 66) return null;
    return new ethers.Wallet(pk, this.provider);
  }

  async getDeployerInfo() {
    const wallet = this.getDeployerWallet();
    const dexVersion = storage.getRobinhoodDexVersion();
    const pairToken  = storage.getRobinhoodPairToken();
    const v3FeeTier  = storage.getRobinhoodV3FeeTier();
    const buyFee     = storage.getRobinhoodBuyFee();
    const sellFee    = storage.getRobinhoodSellFee();

    if (!wallet) {
      return {
        configured: false,
        address: null,
        balanceEth: '0',
        balanceWeth: '0',
        balanceUsdg: '0',
        gasPriceGwei: '0',
        network: 'Robinhood Chain',
        chainId: this.chainId,
        rpcUrl: this.rpcUrl,
        explorerUrl: this.explorerUrl,
        dexVersion, pairToken, v3FeeTier, buyFee, sellFee,
        v4PoolManager: this.v4PoolManager,
        v4PositionManager: this.v4PositionManager,
        universalRouter: this.universalRouter,
        v3Factory: this.v3Factory
      };
    }

    try {
      const wethContract = new ethers.Contract(this.wethAddress, ERC20_ABI, this.provider);
      const usdgContract = new ethers.Contract(this.usdgAddress, ERC20_ABI, this.provider);

      const [balance, feeData, wethBal, usdgBal] = await Promise.all([
        this.provider.getBalance(wallet.address),
        this.provider.getFeeData(),
        wethContract.balanceOf(wallet.address).catch(() => 0n),
        usdgContract.balanceOf(wallet.address).catch(() => 0n)
      ]);

      const gasPriceGwei = feeData.gasPrice ? ethers.formatUnits(feeData.gasPrice, 'gwei') : '0';

      return {
        configured: true,
        address: wallet.address,
        balanceEth: ethers.formatEther(balance),
        balanceEthRaw: balance,
        balanceWeth: ethers.formatEther(wethBal),
        balanceUsdg: ethers.formatUnits(usdgBal, 18).substring(0, 8),
        gasPriceGwei,
        network: 'Robinhood Chain',
        chainId: this.chainId,
        rpcUrl: this.rpcUrl,
        explorerUrl: this.explorerUrl,
        dexVersion, pairToken, v3FeeTier, buyFee, sellFee,
        v4PoolManager: this.v4PoolManager,
        v4PositionManager: this.v4PositionManager,
        universalRouter: this.universalRouter,
        v3Factory: this.v3Factory
      };
    } catch (err) {
      return {
        configured: true,
        address: wallet.address,
        balanceEth: 'Error RPC',
        balanceWeth: '0',
        balanceUsdg: '0',
        gasPriceGwei: '0',
        error: err.message,
        network: 'Robinhood Chain',
        chainId: this.chainId,
        rpcUrl: this.rpcUrl,
        explorerUrl: this.explorerUrl,
        dexVersion, pairToken, v3FeeTier, buyFee, sellFee
      };
    }
  }

  async deployToken(options = {}, onProgress = null) {
    const notify = (step, msg) => {
      console.log(`[RobinhoodDeploy] Step ${step}: ${msg}`);
      if (typeof onProgress === 'function') {
        try { onProgress(step, msg); } catch {}
      }
    };

    const wallet = this.getDeployerWallet();
    if (!wallet) {
      throw new Error('Private key deployer Robinhood belum dikonfigurasi di .env (ROBINHOOD_PRIVATE_KEY / ELYSIUM_PRIVATE_KEY / PRIVATE_KEY)');
    }

    notify(1, 'Memeriksa saldo ETH, pair token, dan kesiapan jaringan Robinhood Chain...');
    const balance = await this.provider.getBalance(wallet.address);

    const dexVersion = (options.dexVersion || storage.getRobinhoodDexVersion() || 'v4').toLowerCase();
    const pairChoice = (options.pair || storage.getRobinhoodPairToken() || 'ETH').toUpperCase().trim();
    const feeTier    = Number(options.feeTier || storage.getRobinhoodV3FeeTier() || 10000);

    const ethLp     = String(options.ethLiquidity || storage.getRobinhoodLpEth() || config.robinhoodDefaultLpEth || '0.00001');
    const devBuyEth = String(options.devBuyEth !== undefined ? options.devBuyEth : (storage.getRobinhoodDevBuyEth() ?? '0.000001'));
    const targetMarketCapUsd = Number(options.targetMarketCapUsd !== undefined ? options.targetMarketCapUsd : storage.getRobinhoodTargetMcap());
    const useSingleSidedMcap = targetMarketCapUsd > 0 && dexVersion !== 'v2';

    const ethLpWei  = useSingleSidedMcap ? 0n : ethers.parseEther(ethLp);
    const devBuyWei = ethers.parseEther(devBuyEth);
    const gasReserveWei = ethers.parseEther('0.0005');
    const totalRequiredWei = ethLpWei + devBuyWei + gasReserveWei;

    if (balance < totalRequiredWei) {
      const curEth = ethers.formatEther(balance);
      const reqEth = ethers.formatEther(totalRequiredWei);
      throw new Error(`Saldo ETH tidak mencukupi di Robinhood Chain! Anda memiliki ${curEth} ETH, dibutuhkan minimal ${reqEth} ETH (${useSingleSidedMcap ? 'Mode MCap $' + targetMarketCapUsd + ' 0 ETH LP' : 'LP ' + ethLp + ' ETH'} + Dev Buy ${devBuyEth} + gas).`);
    }

    // Resolve Quote Token
    let quoteAddress;
    let quoteSymbol;
    let quoteDecimals = 18;

    if (pairChoice === 'USDG') {
      quoteAddress = this.usdgAddress;
      quoteSymbol  = 'USDG';
      quoteDecimals = 18;
    } else if (pairChoice === 'WETH') {
      quoteAddress = this.wethAddress;
      quoteSymbol  = 'WETH';
    } else {
      // ETH or native - use ZeroAddress in V4, WETH in V3
      quoteAddress = dexVersion === 'v4' ? ethers.ZeroAddress : this.wethAddress;
      quoteSymbol  = 'ETH';
    }

    const name          = (options.name || 'Robinhood Token').trim();
    const symbol        = (options.symbol || 'RBTK').trim().toUpperCase();
    let totalSupply = ethers.parseEther('100000000000');
    if (options.totalSupply !== undefined && options.totalSupply !== null && options.totalSupply !== '') {
      const rawStr = String(options.totalSupply).trim();
      const rawBig = BigInt(rawStr);
      // If passed as human unit (e.g. "100000000000"), convert to 18 decimals
      totalSupply = rawBig < 10n ** 15n ? ethers.parseEther(rawStr) : rawBig;
    }
    const feeWallet     = options.feeWallet && ethers.isAddress(options.feeWallet) ? options.feeWallet : wallet.address;
    const buyFee        = Number(options.buyFee !== undefined ? options.buyFee : storage.getRobinhoodBuyFee());
    const sellFee       = Number(options.sellFee !== undefined ? options.sellFee : storage.getRobinhoodSellFee());
    const sniperBuyFee  = Number(options.sniperBuyFee ?? 80);
    const sniperWindowMinutes = Number(options.sniperWindowMinutes ?? 30);
    const tokenLp       = options.tokenLiquidity ? BigInt(options.tokenLiquidity) : ethers.parseEther('20000000000');
    const lockTokens    = options.lockAmount !== undefined ? BigInt(options.lockAmount) : ethers.parseEther('6000000000');
    const lockHours     = Number(options.lockHours ?? 3);

    // Logo / IPFS Upload
    let rawImageUrl = options.imageUrl || 'https://assets.coingecko.com/coins/images/placeholder.png';
    let finalImageUrl = rawImageUrl;
    if (rawImageUrl && !rawImageUrl.startsWith('ipfs://')) {
      try {
        notify(1, 'Memproses & mengunggah logo token ke IPFS via Pinata...');
        finalImageUrl = await pinataService.uploadFromUrl(rawImageUrl, `${symbol.toLowerCase()}.png`);
        notify(1, `Logo token IPFS siap: ${finalImageUrl}`);
      } catch (imgErr) {
        console.warn('[RobinhoodService] Pinata upload skipped:', imgErr.message);
      }
    }

    // Deploy ERC-20 Token
    notify(2, `Mendeploy ERC-20 Token: ${name} ($${symbol}) di Robinhood Chain (ID: ${this.chainId})...`);
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();

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

    const tupleType = 'tuple(string name, string symbol, uint256 totalSupply, address feeWallet, uint256 buyFee, uint256 sellFee, uint256 sniperBuyFee, uint256 sniperWindowMinutes, address airdrop1, uint256 airdropAmount1, address airdrop2, uint256 airdropAmount2)';
    const tokenFactory = new ethers.ContractFactory(robinhoodTokenArtifact.abi, robinhoodTokenArtifact.bytecode, wallet);
    const deployTx = await tokenFactory.deploy(tokenParams);
    await deployTx.waitForDeployment();
    const tokenAddress = await deployTx.getAddress();
    const tokenContract = deployTx;
    const deployTxHash = deployTx.deploymentTransaction().hash;
    const tokenConstructorArgsHex = abiCoder.encode([tupleType], [tokenParams]).slice(2);

    notify(3, `Token berhasil dideploy di ${tokenAddress}! Tx: ${deployTxHash}`);
    await pace();

    // TeamTokenLock (Optional)
    let lockAddress = '';
    let lockDeployTxHash = '';
    let lockTransferTxHash = '';
    let lockReleaseTime = 0;

    if (lockTokens > 0n) {
      notify(4, `Mendeploy kontrak TeamTokenLock (${ethers.formatUnits(lockTokens, 18)} token selama ${lockHours} jam)...`);
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

    // Add Liquidity
    let poolAddress = '';
    let addLiquidityTxHash = '';
    let positionTokenId = null;
    let quoteDepositedDisplay = '';
    let initialPrice = 0;
    let realizedMcapUsd = 0;

    if (dexVersion === 'v4') {
      notify(5, `Menyiapkan likuiditas Uniswap V4 (Pair: ${symbol}/${quoteSymbol}, Fee: ${feeTier / 10000}%${useSingleSidedMcap ? `, Target MCap $${targetMarketCapUsd.toLocaleString()}` : ''})...`);
      const posm   = new ethers.Contract(this.v4PositionManager, V4_POSITION_MANAGER_ABI, wallet);
      const permit2 = new ethers.Contract(this.permit2Address, PERMIT2_ABI, wallet);

      let quoteDepositWei  = 0n;
      let quoteAddressV4   = quoteSymbol === 'USDG' ? this.usdgAddress : (quoteSymbol === 'WETH' ? this.wethAddress : ethers.ZeroAddress);

      if (!useSingleSidedMcap) {
        if (quoteSymbol === 'USDG') {
          const usdgContract = new ethers.Contract(this.usdgAddress, ERC20_ABI, wallet);
          quoteDepositWei = await usdgContract.balanceOf(wallet.address);
          if (quoteDepositWei === 0n) {
            throw new Error('Saldo USDG di deployer wallet kosong (0 USDG)! Silakan isi USDG atau ganti pair ke ETH / WETH via /rhpair ETH.');
          }
          quoteDepositedDisplay = `${ethers.formatUnits(quoteDepositWei, 18)} USDG`;
          initialPrice = Number(ethers.formatUnits(quoteDepositWei, 18)) / Number(ethers.formatUnits(tokenLp, 18));
          const appUsdg = await usdgContract.approve(this.permit2Address, ethers.MaxUint256);
          await appUsdg.wait();
          await permit2.approve(this.usdgAddress, this.v4PositionManager, '1461501637330902918203684832716283019655932542975', 281474976710655);
          await pace();
        } else if (quoteSymbol === 'WETH') {
          quoteDepositWei = ethLpWei;
          quoteDepositedDisplay = `${ethLp} WETH`;
          initialPrice = Number(ethLp) / Number(ethers.formatUnits(tokenLp, 18));
          notify(5, 'Wrap ETH -> WETH & Approve Permit2...');
          const wethContract = new ethers.Contract(this.wethAddress, ERC20_ABI, wallet);
          await (await wethContract.deposit({ value: ethLpWei })).wait();
          await (await wethContract.approve(this.permit2Address, ethers.MaxUint256)).wait();
          await permit2.approve(this.wethAddress, this.v4PositionManager, '1461501637330902918203684832716283019655932542975', 281474976710655);
          await pace();
        } else {
          quoteDepositWei = ethLpWei;
          quoteDepositedDisplay = `${ethLp} ETH`;
          initialPrice = Number(ethLp) / Number(ethers.formatUnits(tokenLp, 18));
        }
      }

      // Approve Token
      notify(5, `Approve ${symbol} ke Permit2 & Uniswap V4 PositionManager...`);
      await (await tokenContract.approve(this.permit2Address, ethers.MaxUint256)).wait();
      await permit2.approve(tokenAddress, this.v4PositionManager, '1461501637330902918203684832716283019655932542975', 281474976710655);
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

        currency0      = isToken0 ? tokenAddress : quoteAddressV4;
        currency1      = isToken0 ? quoteAddressV4 : tokenAddress;
        amount0Desired = isToken0 ? tokenLp : quoteDepositWei;
        amount1Desired = isToken0 ? quoteDepositWei : tokenLp;
        sqrtPriceX96   = encodePriceSqrt(amount1Desired, amount0Desired);

        const minTick = -887200;
        const maxTick = 887200;
        tickLower = Math.ceil(minTick / tickSpacing) * tickSpacing;
        tickUpper = Math.floor(maxTick / tickSpacing) * tickSpacing;
        const spA       = getSqrtRatioAtTick(tickLower);
        const spB       = getSqrtRatioAtTick(tickUpper);
        liquidity = getLiquidityForAmounts(sqrtPriceX96, spA, spB, amount0Desired, amount1Desired);
      }

      const poolKey = { currency0, currency1, fee: feeTier, tickSpacing, hooks: ethers.ZeroAddress };
      const poolId = computePoolId(poolKey);
      poolAddress = poolId;

      notify(5, `Menginisialisasi Pool Uniswap V4 (PoolId: ${poolId.slice(0, 10)}...)...`);
      try {
        const initTx = await posm.initializePool(poolKey, sqrtPriceX96);
        await initTx.wait();
        await pace();
      } catch (initErr) {
        console.warn('[RobinhoodService] initializePool notice:', initErr.message);
      }

      const actions = '0x020d14';
      const param0  = abiCoder.encode(
        [POOL_KEY_TYPE, 'int24', 'int24', 'uint256', 'uint128', 'uint128', 'address', 'bytes'],
        [poolKey, tickLower, tickUpper, liquidity, amount0Desired, amount1Desired, wallet.address, '0x']
      );
      const param1       = abiCoder.encode(['address', 'address'], [currency0, currency1]);
      const param2       = abiCoder.encode(['address', 'address'], [currency0, wallet.address]);
      const unlockData   = abiCoder.encode(['bytes', 'bytes[]'], [actions, [param0, param1, param2]]);
      const deadline     = Math.floor(Date.now() / 1000) + 1200;

      notify(5, `Menyetor likuiditas ke Uniswap V4 PositionManager Robinhood...`);
      const msgValue = currency0 === ethers.ZeroAddress ? amount0Desired : 0n;
      const mintTx = await posm.modifyLiquidities(unlockData, deadline, { value: msgValue });
      const mintReceipt = await mintTx.wait();
      addLiquidityTxHash = mintTx.hash;

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
      notify(5, `Menyiapkan likuiditas Uniswap V3 (Pair: ${symbol}/${quoteSymbol}, Fee: ${feeTier / 10000}%${useSingleSidedMcap ? `, Target MCap $${targetMarketCapUsd.toLocaleString()}` : ''})...`);
      const npm      = new ethers.Contract(this.v3PositionManager, POSITION_MANAGER_ABI, wallet);
      const factory  = new ethers.Contract(this.v3Factory, V3_FACTORY_ABI, wallet);
      const wethContract = new ethers.Contract(this.wethAddress, ERC20_ABI, wallet);

      let quoteDepositWei = 0n;
      const pairTokenAddress = quoteSymbol === 'USDG' ? this.usdgAddress : this.wethAddress;

      if (!useSingleSidedMcap) {
        if (quoteSymbol === 'USDG') {
          const usdgContract = new ethers.Contract(this.usdgAddress, ERC20_ABI, wallet);
          quoteDepositWei = await usdgContract.balanceOf(wallet.address);
          if (quoteDepositWei === 0n) {
            throw new Error('Saldo USDG di deployer wallet kosong (0 USDG)! Silakan isi USDG atau ganti pair ke ETH / WETH via /rhpair ETH.');
          }
          quoteDepositedDisplay = `${ethers.formatUnits(quoteDepositWei, 18)} USDG`;
          await (await usdgContract.approve(this.v3PositionManager, ethers.MaxUint256)).wait();
          initialPrice = Number(ethers.formatUnits(quoteDepositWei, 18)) / Number(ethers.formatUnits(tokenLp, 18));
        } else {
          quoteDepositWei = ethLpWei;
          quoteDepositedDisplay = `${ethLp} ${quoteSymbol}`;
          notify(5, `Wrap ${ethLp} ETH -> WETH & Approve PositionManager...`);
          await (await wethContract.deposit({ value: ethLpWei })).wait();
          await (await wethContract.approve(this.v3PositionManager, ethers.MaxUint256)).wait();
          initialPrice = Number(ethLp) / Number(ethers.formatUnits(tokenLp, 18));
        }
      }

      await (await tokenContract.approve(this.v3PositionManager, ethers.MaxUint256)).wait();
      await pace();

      const tickSpacing = Number(await factory.feeAmountTickSpacing(feeTier));
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
        const isToken0     = tokenAddress.toLowerCase() < pairTokenAddress.toLowerCase();
        token0       = isToken0 ? tokenAddress : pairTokenAddress;
        token1       = isToken0 ? pairTokenAddress : tokenAddress;
        amount0Desired = isToken0 ? tokenLp : quoteDepositWei;
        amount1Desired = isToken0 ? quoteDepositWei : tokenLp;
        sqrtPriceX96 = encodePriceSqrt(amount1Desired, amount0Desired);

        const minTick = -887272;
        const maxTick = 887272;
        tickLower = Math.ceil(minTick / tickSpacing) * tickSpacing;
        tickUpper = Math.floor(maxTick / tickSpacing) * tickSpacing;
      }

      notify(5, `Membuat & menginisialisasi Pool Uniswap V3 (Fee: ${feeTier})...`);
      const initTx = await npm.createAndInitializePoolIfNecessary(token0, token1, feeTier, sqrtPriceX96);
      await initTx.wait();
      await pace();

      poolAddress = await factory.getPool(token0, token1, feeTier);

      notify(5, `Menyetor likuiditas ke Uniswap V3...`);
      const deadline = Math.floor(Date.now() / 1000) + 1200;
      const mintTx = await npm.mint({
        token0, token1, fee: feeTier, tickLower, tickUpper,
        amount0Desired, amount1Desired,
        amount0Min: 0n, amount1Min: 0n,
        recipient: wallet.address, deadline
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
      // No V2 router on Robinhood yet - fallback message
      quoteDepositedDisplay = `${ethLp} ETH`;
      initialPrice = Number(ethLp) / Number(ethers.formatUnits(tokenLp, 18));
      throw new Error('Uniswap V2 tidak tersedia di Robinhood Chain. Gunakan v4 atau v3.');
    }

    // Step: Configure Pair & Enable Trading
    notify(6, 'Mengonfigurasi Pair Anti-Sniper...');
    const pairToConfigure = dexVersion === 'v4' ? this.v4PoolManager : poolAddress;
    const setPairTx = await tokenContract.setPair(pairToConfigure);
    await setPairTx.wait();
    const setPairTxHash = setPairTx.hash;
    await pace();

    notify(7, 'Mengaktifkan trading on-chain (enableTrading)...');
    const enableTradingTx = await tokenContract.enableTrading();
    await enableTradingTx.wait();
    const enableTradingTxHash = enableTradingTx.hash;
    notify(7, `Trading telah AKTIF! Tx: ${enableTradingTxHash}`);
    await pace();

    // Dev Buy (V4 ETH/WETH via UniversalRouter)
    let devBuyTxHash = '';
    if (devBuyWei > 0n && dexVersion === 'v4' && (quoteSymbol === 'ETH' || quoteSymbol === 'WETH')) {
      notify(8, `Menjalankan Dev Buy sebesar ${devBuyEth} ${quoteSymbol} via Uniswap V4 UniversalRouter...`);
      try {
        const ur       = new ethers.Contract(this.universalRouter, UNIVERSAL_ROUTER_ABI, wallet);
        const deadline = Math.floor(Date.now() / 1000) + 600;
        const tickSpacing = feeTier >= 10000 ? 200 : (feeTier >= 3000 ? 60 : 10);
        const quoteAddrV4 = quoteSymbol === 'ETH' ? ethers.ZeroAddress : this.wethAddress;

        if (quoteSymbol === 'WETH') {
          const wethContract = new ethers.Contract(this.wethAddress, ERC20_ABI, wallet);
          const permit2 = new ethers.Contract(this.permit2Address, PERMIT2_ABI, wallet);
          await (await wethContract.deposit({ value: devBuyWei })).wait();
          await (await wethContract.approve(this.permit2Address, ethers.MaxUint256)).wait();
          await permit2.approve(this.wethAddress, this.universalRouter, '1461501637330902918203684832716283019655932542975', 281474976710655);
        }

        const isToken0 = quoteAddrV4 === ethers.ZeroAddress
          ? false
          : (BigInt(tokenAddress.toLowerCase()) < BigInt(quoteAddrV4.toLowerCase()));
        const currency0 = isToken0 ? tokenAddress : quoteAddrV4;
        const currency1 = isToken0 ? quoteAddrV4 : tokenAddress;
        const zeroForOne = !isToken0; // buying token with quote

        const poolKey = {
          currency0,
          currency1,
          fee: feeTier,
          tickSpacing,
          hooks: ethers.ZeroAddress
        };

        const p0 = abiCoder.encode(
          [EXACT_INPUT_SINGLE_TYPE],
          [{ poolKey, zeroForOne, amountIn: devBuyWei, amountOutMinimum: 0n, hookData: '0x' }]
        );
        const p1 = abiCoder.encode(['address', 'uint256', 'bool'], [quoteAddrV4, devBuyWei, quoteSymbol !== 'ETH']);
        const p2 = abiCoder.encode(['address', 'address', 'uint256'], [tokenAddress, wallet.address, 0n]);

        const v4Input = abiCoder.encode(['bytes', 'bytes[]'], ['0x060b0e', [p0, p1, p2]]);
        const msgVal  = quoteSymbol === 'ETH' ? devBuyWei : 0n;
        const buyTx   = await ur.execute('0x10', [v4Input], deadline, { value: msgVal });
        await buyTx.wait();
        devBuyTxHash = buyTx.hash;
        notify(8, `Dev Buy V4 sebesar ${devBuyEth} ${quoteSymbol} berhasil! Tx: ${devBuyTxHash}`);
        await pace();
      } catch (buyErr) {
        console.warn('[RobinhoodService] Dev Buy warning:', buyErr.message);
        notify(8, `Peringatan Dev Buy: ${buyErr.message}`);
      }
    }

    const dexName = dexVersion === 'v4' ? 'Uniswap V4' : 'Uniswap V3';

    // Save record
    const record = storage.saveRobinhoodDeployedToken({
      name, symbol, imageUrl: finalImageUrl,
      totalSupply: ethers.formatUnits(totalSupply, 18),
      tokenAddress, poolAddress, lockAddress,
      deployerAddress: wallet.address, feeWallet,
      buyFee, sellFee, dexVersion: dexName,
      pairToken: quoteSymbol,
      quoteDeposited: quoteDepositedDisplay,
      ethDeposited: useSingleSidedMcap ? '0' : ethLp,
      targetMarketCapUsd: useSingleSidedMcap ? (realizedMcapUsd || targetMarketCapUsd) : 0,
      devBuyEth,
      tokenDeposited: ethers.formatUnits(tokenLp, 18),
      initialPriceEth: initialPrice,
      positionTokenId, v3FeeTier: feeTier,
      deployTx: deployTxHash,
      lockTx: lockTransferTxHash || lockDeployTxHash,
      addLiquidityTx: addLiquidityTxHash,
      setPairTx: setPairTxHash,
      enableTradingTx: enableTradingTxHash,
      devBuyTx: devBuyTxHash,
      isVerified: false
    });

    const poolExplorerUrl = `${this.explorerUrl}/address/${dexVersion === 'v4' ? this.v4PoolManager : poolAddress}`;
    const dexscreenerUrl  = `https://dexscreener.com/robinhood/${poolAddress}`;
    const geckoterminalUrl = `https://www.geckoterminal.com/robinhood/pools/${poolAddress}`;

    return {
      success: true,
      dexVersion: dexName,
      pairToken: quoteSymbol,
      positionTokenId,
      token: {
        name, symbol,
        address: tokenAddress,
        imageUrl: finalImageUrl,
        totalSupply: ethers.formatUnits(totalSupply, 18),
        deployTxHash,
        isVerified: false
      },
      lock: {
        address: lockAddress,
        amount: ethers.formatUnits(lockTokens, 18),
        releaseTime: lockReleaseTime,
        txHash: lockTransferTxHash || lockDeployTxHash
      },
      liquidity: {
        dexName, poolAddress, quoteToken: quoteSymbol,
        quoteDeposited: quoteDepositedDisplay,
        positionTokenId,
        ethDeposited: useSingleSidedMcap ? '0 ETH' : `${ethLp} ETH`,
        targetMarketCapUsd: useSingleSidedMcap ? (realizedMcapUsd || targetMarketCapUsd) : 0,
        devBuyEth: devBuyTxHash ? `${devBuyEth} ETH` : (devBuyWei > 0n ? `${devBuyEth} ETH (Attempted)` : '0 ETH'),
        tokensDeposited: `${ethers.formatUnits(tokenLp, 18)} ${symbol}`,
        initialPrice,
        addLiquidityTxHash, setPairTxHash, enableTradingTxHash, devBuyTxHash
      },
      urls: {
        tokenExplorer: `${this.explorerUrl}/address/${tokenAddress}`,
        poolExplorer: poolExplorerUrl,
        dexscreener: dexscreenerUrl,
        geckoterminal: geckoterminalUrl
      },
      record
    };
  }
}

export const robinhoodService = new RobinhoodService();

