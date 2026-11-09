// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ElysiumToken
/// @notice Configurable ERC20 token for Elysium (HyperEVM L2) with anti-sniper protection, buy/sell tax, airdrops, and Uniswap V2 pair integration.
contract ElysiumToken is ERC20, Ownable {
    struct TokenParams {
        string name;
        string symbol;
        uint256 totalSupply;
        address feeWallet;
        uint256 buyFee;
        uint256 sellFee;
        uint256 sniperBuyFee;
        uint256 sniperWindowMinutes;
        address airdrop1;
        uint256 airdropAmount1;
        address airdrop2;
        uint256 airdropAmount2;
    }

    uint256 public immutable totalSupplyAmount;
    address public immutable feeWallet;
    uint256 public immutable buyFee;
    uint256 public immutable sellFee;
    uint256 public immutable sniperBuyFee;
    uint256 public immutable sniperWindow;

    address public pair;
    bool public tradingEnabled;
    uint256 public launchTime;

    mapping(address => bool) public isExcludedFromFees;

    event PairSet(address indexed pair);
    event TradingEnabled(uint256 launchTime);

    constructor(TokenParams memory params)
        ERC20(params.name, params.symbol)
        Ownable(msg.sender)
    {
        totalSupplyAmount = params.totalSupply;
        feeWallet = params.feeWallet != address(0) ? params.feeWallet : msg.sender;
        buyFee = params.buyFee;
        sellFee = params.sellFee;
        sniperBuyFee = params.sniperBuyFee;
        sniperWindow = params.sniperWindowMinutes * 1 minutes;

        isExcludedFromFees[msg.sender] = true;
        isExcludedFromFees[feeWallet] = true;
        isExcludedFromFees[address(this)] = true;

        uint256 airdropTotal = 0;
        if (params.airdrop1 != address(0) && params.airdropAmount1 > 0) {
            _mint(params.airdrop1, params.airdropAmount1);
            airdropTotal += params.airdropAmount1;
        }
        if (params.airdrop2 != address(0) && params.airdropAmount2 > 0) {
            _mint(params.airdrop2, params.airdropAmount2);
            airdropTotal += params.airdropAmount2;
        }

        require(params.totalSupply >= airdropTotal, "Supply less than airdrops");
        _mint(msg.sender, params.totalSupply - airdropTotal);
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

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            if (!tradingEnabled) {
                require(from == owner() || from == feeWallet || from == address(this), "trading not enabled");
            } else if (pair != address(0) && (from == pair || to == pair) && !isExcludedFromFees[from] && !isExcludedFromFees[to]) {
                uint256 fee;
                if (from == pair) {
                    fee = (sniperWindow > 0 && block.timestamp < launchTime + sniperWindow) ? sniperBuyFee : buyFee;
                } else {
                    fee = sellFee;
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
