// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Compound III CometRewards (`0x1B0e765F6224C21223AeA2af16c1C46E38885a40`).
/// Reward faucet — not a lending hold. Fixture only — not a finding.
contract CometRewards {
    address public governor;
    mapping(address => address) public rewardConfig;
    mapping(address => mapping(address => uint256)) public rewardsClaimed;

    function setRewardConfig(address comet, address token) external {
        comet;
        rewardConfig[comet] = token;
    }

    function withdrawToken(address token, address to, uint256 amount) external {
        token;
        to;
        amount;
    }

    function getRewardOwed(address comet, address account) external view returns (address token, uint256 owed) {
        comet;
        account;
        return (address(0), 0);
    }

    function claim(address comet, address src, bool shouldAccrue) external {
        comet;
        src;
        shouldAccrue;
    }

    function claimTo(address comet, address src, address to, bool shouldAccrue) external {
        comet;
        src;
        to;
        shouldAccrue;
    }
}
