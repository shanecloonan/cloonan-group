// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Usual {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function mint(address, uint256) external;
    function burnFrom(address, uint256) external;
}

/// Usual DaoCollateral impl (`0x0eEc…AF4e`; proxy `0xde6e…8b04`).
/// Swaps RWA to the treasury and mints USD0. Converter — cool.
/// Fixture only — not a finding.
contract DaoCollateral {
    IERC20Usual public usd0;
    address public treasury;

    function swap(address rwaToken, uint256 amount, uint256 minAmountOut) public {
        IERC20Usual(rwaToken).transferFrom(msg.sender, treasury, amount);
        usd0.mint(msg.sender, minAmountOut);
    }

    function swapWithPermit(address rwaToken, uint256 amount, uint256 minAmountOut) external {
        swap(rwaToken, amount, minAmountOut);
    }

    function swapRwaToStbc(address rwaToken, uint256 amount) external {
        swap(rwaToken, amount, amount);
    }

    function swapRwaToStbcIntent(address rwaToken, uint256 amount) external {
        swap(rwaToken, amount, amount);
    }

    function redeem(address rwaToken, uint256 amount, uint256 minAmountOut) external {
        usd0.burnFrom(msg.sender, amount);
        IERC20Usual(rwaToken).transfer(msg.sender, minAmountOut);
    }
}
