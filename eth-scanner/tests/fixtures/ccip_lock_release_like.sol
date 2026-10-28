// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Ccip {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Chainlink CCIP LockReleaseTokenPool (tETH `0x8113…8435`).
/// Locks the token here. Must be bridge, not generic custody.
/// Fixture only — not a finding.
contract LockReleaseTokenPool {
    IERC20Ccip public token;

    function lockOrBurn(address sender, uint256 amount) external {
        sender;
        amount;
    }

    function releaseOrMint(address receiver, uint256 amount) external {
        token.transfer(receiver, amount);
    }

    function provideLiquidity(uint256 amount) external {
        token.transferFrom(msg.sender, address(this), amount);
    }

    function withdrawLiquidity(uint256 amount) external {
        token.transfer(msg.sender, amount);
    }
}
