// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Scroll L1ETHGateway impl (`0x1fee6a6dC49095FB9C84D61aa4b8A07284b2A1d0`).
/// Proxy `0x7F2b8C31F88B6006c382775eea88297Ec1e3E905`.
/// finalizeWithdrawETH is the lock-release verb (`depositETH` alone is not).
/// Fixture only — not a finding.
contract L1ETHGateway {
    function depositETH(uint256 amount, uint256 gasLimit) external payable {
        amount;
        gasLimit;
    }

    function depositETHAndCall(address to, uint256 amount, bytes calldata data, uint256 gasLimit) external payable {
        to;
        amount;
        data;
        gasLimit;
    }

    function finalizeWithdrawETH(address from, address to, uint256 amount, bytes calldata data) external payable {
        from;
        to;
        amount;
        data;
    }
}
