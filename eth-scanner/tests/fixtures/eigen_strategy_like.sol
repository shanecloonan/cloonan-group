// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20E {
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Live EigenLayer StrategyManager shape (`0x8586…075A`). Staking, not generic vault.
/// Fixture only — not a finding.
contract StrategyManager {
    uint256 public totalShares;

    function depositIntoStrategy(address strategy, address token, uint256 amount) external returns (uint256) {
        IERC20E(token).transferFrom(msg.sender, strategy, amount);
        totalShares += amount;
        return amount;
    }

    function withdrawSharesAsTokens(address staker, address strategy, address token, uint256 shares) external {
        staker;
        strategy;
        token;
        shares;
    }

    function burnShares(address staker, uint256 shares) external {
        staker;
        shares;
    }
}
