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

// Uniswap V2 Minimal ABIs
const ROUTER_ABI = [
  'function factory() external pure returns (address)',
  'function WETH() external pure returns (address)',
  'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)'
];

const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
  'function createPair(address tokenA, address tokenB) external returns (address pair)'
];

export class ElysiumService {
  constructor() {
    this.rpcUrl = config.elysiumRpcUrl || 'https://rpc.elysium.kinetiq.xyz';
    this.chainId = config.elysiumChainId || 99901;
    this.routerAddress = config.elysiumRouter || '0x3320b5685c1c4a0d2a5b0ca30dcee095142bf076';
    this.explorerUrl = config.elysiumExplorer || 'https://elyscan.live';
    this.provider = new ethers.JsonRpcProvider(this.rpcUrl, this.chainId, { staticNetwork: true });
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
    if (!wallet) {
      return {
        configured: false,
        address: null,
        balanceHype: '0',
        gasPriceGwei: '0',
        network: 'Elysium Mainnet',
        chainId: this.chainId,
        rpcUrl: this.rpcUrl,
        explorerUrl: this.explorerUrl,
        routerAddress: this.routerAddress
      };
    }

    try {
      const [balance, feeData] = await Promise.all([
        this.provider.getBalance(wallet.address),
        this.provider.getFeeData()
      ]);

      const gasPriceGwei = feeData.gasPrice ? ethers.formatUnits(feeData.gasPrice, 'gwei') : '0';

      return {
        configured: true,
        address: wallet.address,
        balanceHype: ethers.formatEther(balance),
        balanceHypeRaw: balance,
        gasPriceGwei,
        network: 'Elysium Mainnet',
        chainId: this.chainId,
        rpcUrl: this.rpcUrl,
        explorerUrl: this.explorerUrl,
        routerAddress: this.routerAddress
      };
    } catch (err) {
      return {
        configured: true,
        address: wallet.address,
        balanceHype: 'Error RPC',
        gasPriceGwei: '0',
        error: err.message,
        network: 'Elysium Mainnet',
        chainId: this.chainId,
        rpcUrl: this.rpcUrl,
        explorerUrl: this.explorerUrl,
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

    notify(1, 'Memeriksa saldo HYPE dan kesiapan jaringan Elysium...');
    const balance = await this.provider.getBalance(wallet.address);
    const hypeLp = String(options.hypeLiquidity || config.elysiumDefaultLpHype || '0.01');
    const hypeLpWei = ethers.parseEther(hypeLp);
    const gasReserveWei = ethers.parseEther('0.003'); // Cadangan gas
    const totalRequiredWei = hypeLpWei + gasReserveWei;

    if (balance < totalRequiredWei) {
      const curHype = ethers.formatEther(balance);
      const reqHype = ethers.formatEther(totalRequiredWei);
      throw new Error(`Saldo HYPE tidak mencukupi! Anda memiliki ${curHype} HYPE, dibutuhkan minimal ${reqHype} HYPE (LP ${hypeLp} HYPE + gas).`);
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

    // Step 4: Add Liquidity
    notify(5, `Menyetor likuiditas ke Uniswap V2 (${hypeLp} HYPE + ${ethers.formatUnits(tokenLp, 18)} ${symbol})...`);
    const router = new ethers.Contract(this.routerAddress, ROUTER_ABI, wallet);
    
    // Approve Router
    const approveTx = await tokenContract.approve(this.routerAddress, ethers.MaxUint256);
    await approveTx.wait();

    const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 mins
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
    const addLiquidityTxHash = addLiqTx.hash;
    notify(5, `Likuiditas berhasil disetor! Tx: ${addLiquidityTxHash}`);

    // Step 5: Get Pool & setPair
    notify(6, 'Mendeteksi Pool Pair dan mengonfigurasi Anti-Sniper...');
    const factoryAddress = await router.factory();
    const wethAddress = await router.WETH();
    const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, wallet);
    const poolAddress = await factory.getPair(tokenAddress, wethAddress);

    const setPairTx = await tokenContract.setPair(poolAddress);
    await setPairTx.wait();
    const setPairTxHash = setPairTx.hash;

    // Step 6: Enable Trading
    notify(7, 'Mengaktifkan trading on-chain (enableTrading)...');
    const enableTradingTx = await tokenContract.enableTrading();
    await enableTradingTx.wait();
    const enableTradingTxHash = enableTradingTx.hash;
    notify(7, `Trading telah AKTIF dan bisa ditradingkan! Tx: ${enableTradingTxHash}`);

    // Calculate Initial Price
    const initialPriceHype = Number(hypeLp) / Number(ethers.formatUnits(tokenLp, 18));

    // Step 7: Verifikasi Kontrak di Elyscan (Async)
    let isTokenVerified = false;
    let isLockVerified = false;
    if (options.autoVerify !== false) {
      notify(8, 'Melakukan verifikasi kontrak di explorer Elyscan...');
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
      hypeDeposited: hypeLp,
      tokenDeposited: ethers.formatUnits(tokenLp, 18),
      initialPriceHype,
      deployTx: deployTxHash,
      lockTx: lockTransferTxHash || lockDeployTxHash,
      addLiquidityTx: addLiquidityTxHash,
      setPairTx: setPairTxHash,
      enableTradingTx: enableTradingTxHash,
      isVerified: isTokenVerified
    });

    return {
      success: true,
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
        poolAddress,
        hypeDeposited: `${hypeLp} HYPE`,
        tokensDeposited: `${ethers.formatUnits(tokenLp, 18)} ${symbol}`,
        initialPriceHype,
        addLiquidityTxHash,
        setPairTxHash,
        enableTradingTxHash
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
