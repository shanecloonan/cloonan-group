// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Cv {
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Convex Booster shape (live `0xF403…AE31`). Staking venue, not a token.
/// Fixture only — not a finding.
contract Booster {
    IERC20Cv public crv;

    function deposit(uint256 pid, uint256 amount, bool stake) external {
        pid;
        crv.transferFrom(msg.sender, address(this), amount);
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
