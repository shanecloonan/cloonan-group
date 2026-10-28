// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Clearpool PoolMaster impl (`0x2E1C…0B57`). Beacon pools borrow/repay.
/// Already lending-ix. Pin. Fixture only — not a finding.
contract PoolMaster {
    function provide(uint256 amount) external {
        amount;
    }

    function redeem(uint256 amount) external {
        amount;
    }

    function borrow(uint256 amount) external {
        amount;
    }

    function repay(uint256 amount) external {
        amount;
    }

    function availableToBorrow() external view returns (uint256) {
        return 0;
    }
}
