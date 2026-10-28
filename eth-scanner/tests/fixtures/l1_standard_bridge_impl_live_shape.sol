// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20SB {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// Live L1StandardBridge implementation (`0xb37a11aadf167b2f0b8dd85372de4bc66cd4a891`).
/// Proxy `0x99C9…4bE1` is L1ChugSplashProxy-only. ContractName=`L1StandardBridge`.
/// Fixture only — not a finding. Not the full 319k verified blob.
contract L1StandardBridge {
    mapping(address => mapping(address => uint256)) public deposits;

    function depositETH(uint32 minGasLimit, bytes calldata extraData) external payable {
        minGasLimit;
        extraData;
    }

    function depositERC20(address l1Token, address l2Token, uint256 amount, uint32 minGasLimit, bytes calldata extraData) external {
        IERC20SB(l1Token).transferFrom(msg.sender, address(this), amount);
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

    function finalizeERC20Withdrawal(address l1Token, address l2Token, address from, address to, uint256 amount, bytes calldata extraData) external {
        deposits[l1Token][l2Token] -= amount;
        IERC20SB(l1Token).transfer(to, amount);
        from;
        extraData;
    }

    function bridgeETH(uint32 minGasLimit, bytes calldata extraData) external payable {
        minGasLimit;
        extraData;
    }

    function finalizeBridgeETH(address from, address to, uint256 amount, bytes calldata extraData) external payable {
        from;
        to;
        amount;
        extraData;
    }
}
