// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Aura {
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Aura Booster shape (live `0xA57b8d98dAE62B26Ec3bcC4a365338157060B234`). Convex-family staking venue.
/// Fixture only — not a finding.
contract Booster {
    IERC20Aura public aura;

    function deposit(uint256 pid, uint256 amount, bool stake) external {
        pid;
        aura.transferFrom(msg.sender, address(this), amount);
        stake;
    }
    function withdraw(uint256 pid, uint256 amount) external {
        pid;
        amount;
    }
    function earmarkRewards(uint256 pid) external { pid; }
    function earmarkFees() external {}
    function poolInfo(uint256) external view returns (address, address, address, address, address, bool) {
        return (address(0), address(0), address(0), address(0), address(0), false);
    }
}
