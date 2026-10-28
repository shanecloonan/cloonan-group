// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Low-level call site — fixture to keep the EXT regex from breaking IR lift.
contract CallsiteVault {
    function ping(address target) external {
        (bool ok, ) = target.call("");
        require(ok);
    }

    function deposit(address token, uint256 amt) external {
        token.call(abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), amt));
    }
}
