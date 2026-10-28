// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Scroll L1WETHGateway impl (`0xe25e…c24`). Proxy `0x7AC440cAe8EB6328de4fA621163a792c1EA9D4fE`.
/// finalizeWithdrawERC20 is the lock-release verb. Fixture only — not a finding.
contract L1WETHGateway {
    function depositERC20(address token, uint256 amount, uint256 gasLimit) external payable {
        token;
        amount;
        gasLimit;
    }

    function depositERC20AndCall(address token, address to, uint256 amount, bytes calldata data, uint256 gasLimit) external payable {
        token;
        to;
        amount;
        data;
        gasLimit;
    }

    function finalizeWithdrawERC20(address token, address from, address to, uint256 amount, bytes calldata data) external {
        token;
        from;
        to;
        amount;
        data;
    }
}
