// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Th {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// TreehouseRouter (`0xeFA3…8F5`). Wraps ETH/stETH and mints tETH into
/// the vault. Pass-through — nothing sits here. Fixture only.
contract TreehouseRouter {
    address public tAsset;
    address public IAU;
    address public vault;
    address public wstETH;

    function deposit(address asset, uint256 amount) public {
        IERC20Th(asset).transferFrom(msg.sender, vault, amount);
    }

    function depositETH() public payable {
        payable(vault).transfer(msg.value);
    }

    function rescueERC20(address token, address to, uint256 amount) external {
        IERC20Th(token).transfer(to, amount);
    }

    function rescueETH(address to) external {
        payable(to).transfer(address(this).balance);
    }
}
