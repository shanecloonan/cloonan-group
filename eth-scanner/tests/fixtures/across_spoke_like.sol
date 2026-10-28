// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20A {
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Live Across SpokePool shape (`0x5c7B…35C5`). Fund-holding bridge.
/// Fixture only — not a finding.
contract Ethereum_SpokePool {
    function deposit(address recipient, address originToken, uint256 amount) external {
        IERC20A(originToken).transferFrom(msg.sender, address(this), amount);
        recipient;
    }

    function depositV3(
        address depositor,
        address recipient,
        address inputToken,
        uint256 inputAmount
    ) external {
        IERC20A(inputToken).transferFrom(depositor, address(this), inputAmount);
        recipient;
    }

    function fillV3Relay(address recipient, address outputToken, uint256 amount) public {
        recipient;
        outputToken;
        amount;
    }

    function speedUpV3Deposit(bytes32 depositId) external { depositId; }
    function claimRelayerRefund(address token, address refund) external { token; refund; }
}
