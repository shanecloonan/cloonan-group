// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20DM {
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Polygon Plasma DepositManager impl (`0xb00aa68b87256e2f22058fb2ba3246eec54a44fc`).
/// Proxy `0x401F…188b`. depositEther locks ETH — must be *bridge*, not staking
/// (sibling StakeManager `function stake` must not win). Fixture only.
contract DepositManager {
    function depositEther() external payable {}

    function depositERC20(address token, uint256 amount) external {
        IERC20DM(token).transferFrom(msg.sender, address(this), amount);
    }

    function depositERC20ForUser(address token, address user, uint256 amount) external {
        IERC20DM(token).transferFrom(msg.sender, address(this), amount);
        user;
    }

    function depositBulk(address[] calldata tokens, uint256[] calldata amounts, address user) external {
        tokens;
        amounts;
        user;
    }
}

contract StakeManagerSibling {
    function stake(uint256 amount) external payable {
        amount;
    }
    function unstake(uint256 amount) external {
        amount;
    }
    function getReward() external {}
}
