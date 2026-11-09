// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ── DEPLOY CONFIG (final, user 2026-11-09 ~23:54 WIB) ─────────────────────
// Holds the 6% team allocation of WELYSIUM (6,000,000,000).
// Constructor: (token = deployed WELYSIUM address,
//               beneficiary = 0x1afab1f6B0D565544EffB26fCA7D6b5e9CB46C81,
//               releaseTime = deployment time + 3 hours)
// ──────────────────────────────────────────────────────────────────────────

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Holds the 6% team allocation of WELYSIUM. release() sends the full balance
///         to the beneficiary once releaseTime (deployment + 3 hours) has passed.
contract TeamTokenLock {
    IERC20 public immutable token;
    address public immutable beneficiary;
    uint256 public immutable releaseTime;

    event Released(uint256 amount);

    constructor(address _token, address _beneficiary, uint256 _releaseTime) {
        token = IERC20(_token);
        beneficiary = _beneficiary;
        releaseTime = _releaseTime;
    }

    function release() external {
        require(block.timestamp >= releaseTime, "locked");
        uint256 amount = token.balanceOf(address(this));
        require(amount > 0, "nothing to release");
        token.transfer(beneficiary, amount);
        emit Released(amount);
    }
}
