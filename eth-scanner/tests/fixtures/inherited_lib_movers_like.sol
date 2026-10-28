// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20L {
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Primary only inherits the mover via `using VaultLogic for` / library call.
/// File-path + using-for matching must keep the library mover. Fixture only — not a finding.
contract VaultV3 {
    using VaultLogic for address;

    IERC20L public token;

    function deposit(uint256 amount) external {
        address(token).pull(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        amount;
    }

    function convertToShares(uint256 assets) public view returns (uint256) { return assets; }
    function convertToAssets(uint256 shares) public view returns (uint256) { return shares; }
    function totalAssets() public view returns (uint256) { return 1; }
}

library VaultLogic {
    function pull(address token, address from, uint256 amount) internal {
        IERC20L(token).transferFrom(from, address(this), amount);
    }
}
