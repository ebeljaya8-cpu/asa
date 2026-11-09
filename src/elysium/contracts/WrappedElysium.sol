// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ── DEPLOY CONFIG (final, user 2026-11-09 ~23:54 WIB) ─────────────────────
// Chain: Elysium mainnet (Kinetiq L2), chain ID 99901, gas HYPE.
// Deployer / owner: 0x1afab1f6B0D565544EffB26fCA7D6b5e9CB46C81
// feeWallet:        0x1afab1f6B0D565544EffB26fCA7D6b5e9CB46C81 (constructor arg 1)
// airdrop1:         0x58f6e5e38c1197D8bCEb528885ca249aB4297A3f (10B, arg 2)
// airdrop2:         0x02CFD6682B5dC354B451BfC4c5b60D6AcA4e85cF (10B, arg 3)
// 80B minted to deployer at creation; 6B moved to TeamTokenLock (3h, beneficiary = deployer wallet).
// Liquidity: 0.02 HYPE + 20B WELYSIUM into a Uniswap V2-style WELYSIUM/HYPE pool,
// then setPair(pool) + enableTrading() so the token is tradable immediately.
// Router address is NOT hardcoded here — it must be verified from official Elysium docs / explorer
// and passed to scripts/deploy.js via UNISWAP_V2_ROUTER. Never guess it.
// ──────────────────────────────────────────────────────────────────────────

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Wrapped Elysium (WELYSIUM)
/// @notice Fixed supply 100B. 5% buy/sell fee to the team wallet.
///         30-min sniper protection: 80% buy tax in the first 30 minutes after trading opens, 5% sell tax.
///         10% of supply airdropped to each of two wallets at creation; 6% locked for the team (3h timelock).
contract WrappedElysium is ERC20, Ownable {
    string public constant description = "Wrapped Elysium (WELYSIUM) - a community token on Elysium, Kinetiq's Hyperliquid L2. Fixed supply of 100B, 5% buy/sell fee to the team wallet, 30-minute sniper protection on launch.";

    uint256 public constant TOTAL_SUPPLY = 100_000_000_000 * 10 ** 18;
    uint256 public constant AIRDROP_AMOUNT = 10_000_000_000 * 10 ** 18; // 10% each

    address public immutable feeWallet;
    address public immutable airdrop1;
    address public immutable airdrop2;

    address public pair;
    bool public tradingEnabled;
    uint256 public launchTime;

    uint256 public constant SNIPER_WINDOW = 30 minutes;
    uint256 public constant BUY_FEE = 5;
    uint256 public constant SELL_FEE = 5;
    uint256 public constant SNIPER_BUY_FEE = 80;

    mapping(address => bool) public isExcludedFromFees;

    event PairSet(address indexed pair);
    event TradingEnabled(uint256 launchTime);

    constructor(address _feeWallet, address _airdrop1, address _airdrop2)
        ERC20("Wrapped Elysium", "WELYSIUM")
        Ownable(msg.sender)
    {
        feeWallet = _feeWallet;
        airdrop1 = _airdrop1;
        airdrop2 = _airdrop2;
        isExcludedFromFees[msg.sender] = true;
        isExcludedFromFees[_feeWallet] = true;
        isExcludedFromFees[address(this)] = true;

        _mint(_airdrop1, AIRDROP_AMOUNT);
        _mint(_airdrop2, AIRDROP_AMOUNT);
        // 80B to deployer: 74B team/liquidity + 6B to be moved into the 3h timelock
        _mint(msg.sender, TOTAL_SUPPLY - 2 * AIRDROP_AMOUNT);
    }

    function setPair(address _pair) external onlyOwner {
        pair = _pair;
        emit PairSet(_pair);
    }

    function enableTrading() external onlyOwner {
        require(!tradingEnabled, "already enabled");
        require(pair != address(0), "pair not set");
        tradingEnabled = true;
        launchTime = block.timestamp;
        emit TradingEnabled(launchTime);
    }

    function setExcludedFromFees(address account, bool excluded) external onlyOwner {
        isExcludedFromFees[account] = excluded;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            if (!tradingEnabled) {
                require(from == owner() || from == feeWallet || from == address(this), "trading not enabled");
            } else if (pair != address(0) && (from == pair || to == pair) && !isExcludedFromFees[from] && !isExcludedFromFees[to]) {
                uint256 fee;
                if (from == pair) {
                    fee = block.timestamp < launchTime + SNIPER_WINDOW ? SNIPER_BUY_FEE : BUY_FEE;
                } else {
                    fee = SELL_FEE;
                }
                uint256 feeAmount = (value * fee) / 100;
                if (feeAmount > 0) {
                    super._update(from, feeWallet, feeAmount);
                    value -= feeAmount;
                }
            }
        }
        super._update(from, to, value);
    }
}
