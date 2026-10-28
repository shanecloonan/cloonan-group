// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20B {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// OP Stack L1StandardBridge (`0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1`).
/// Escrows ERC-20 on L1 (ETH lives in the portal after Bedrock).
/// `depositETH` alone is too common (Renzo RestakeManager) — lock-release
/// verbs are finalizeETHWithdrawal / bridgeETH. Fixture only — not a finding.
contract L1StandardBridge {
    mapping(address => mapping(address => uint256)) public deposits;

    function depositETH(uint32 minGasLimit, bytes calldata extraData) external payable {
        minGasLimit;
        extraData;
    }

    function depositERC20(
        address l1Token,
        address l2Token,
        uint256 amount,
        uint32 minGasLimit,
        bytes calldata extraData
    ) external {
        IERC20B(l1Token).transferFrom(msg.sender, address(this), amount);
        deposits[l1Token][l2Token] += amount;
        minGasLimit;
        extraData;
    }

    function finalizeETHWithdrawal(address from, address to, uint256 amount, bytes calldata extraData) external payable {
        from;
        to;
        amount;
        extraData;
    }

    function finalizeERC20Withdrawal(
        address l1Token,
        address l2Token,
        address from,
        address to,
        uint256 amount,
        bytes calldata extraData
    ) external {
        deposits[l1Token][l2Token] -= amount;
        IERC20B(l1Token).transfer(to, amount);
        from;
        extraData;
    }

    function bridgeETH(uint32 minGasLimit, bytes calldata extraData) external payable {
        minGasLimit;
        extraData;
    }

    function bridgeERC20(address localToken, address remoteToken, uint256 amount, uint32 minGasLimit, bytes calldata extraData) external {
        localToken;
        remoteToken;
        amount;
        minGasLimit;
        extraData;
    }
}
