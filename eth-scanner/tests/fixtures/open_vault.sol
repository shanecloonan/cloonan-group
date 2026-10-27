// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Public withdraw with no nearby auth keyword. Heuristic lead only.
contract OpenVault {
    function withdraw() external {
        payable(msg.sender).transfer(address(this).balance);
    }
}
