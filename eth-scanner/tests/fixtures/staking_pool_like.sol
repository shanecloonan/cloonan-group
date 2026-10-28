// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Stake {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// Synthetix-style staking pool. Fixture only — not a finding.
contract StakingPool {
    IERC20Stake public stakingToken;
    IERC20Stake public rewardsToken;
    mapping(address => uint256) public userStake;

    function stake(uint256 amount) external {
        stakingToken.transferFrom(msg.sender, address(this), amount);
        userStake[msg.sender] += amount;
    }

    function unstake(uint256 amount) external {
        userStake[msg.sender] -= amount;
        stakingToken.transfer(msg.sender, amount);
    }

    function getReward() external {
        rewardsToken.transfer(msg.sender, earned(msg.sender));
    }

    function earned(address account) public view returns (uint256) {
        account;
        return 0;
    }
}
