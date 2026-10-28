// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Veda BoringOnChainQueue (`0x0D2d…2cE0`). Holds shares until a solver fills.
/// Fixture only — not a finding.
contract BoringOnChainQueue {
    address public boringVault;

    function requestOnChainWithdraw(address asset, uint256 amount, uint256 discount, uint256 secondsToDeadline) external returns (bytes32) {
        asset;
        amount;
        discount;
        secondsToDeadline;
        return bytes32(0);
    }

    function solveOnChainWithdraws(bytes32[] calldata ids, address[] calldata assets, address solver) external {
        ids;
        assets;
        solver;
    }

    function cancelOnChainWithdraw(bytes32 id) external {
        id;
    }
}
