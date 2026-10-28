// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Treehouse tETH Vault (`0x551d…761B`). Holds allowable assets.
/// Already vault via eth-custody-withdraw. Pin. Fixture only.
contract Vault {
    address public tAsset;
    address public strategyStorage;

    function withdraw(address asset, uint256 amount) external {
        asset;
        amount;
        payable(msg.sender).transfer(address(this).balance);
    }

    function getTAsset() external view returns (address) {
        return tAsset;
    }

    function rescueETH(address to) external {
        payable(to).transfer(address(this).balance);
    }
}
