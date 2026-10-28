// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface AggregatorV3Interface {
    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80);
}

/// Vault-shaped hold that reads a Chainlink-like feed with no freshness term.
/// Fixture only — not a finding and not an exploit.
contract OracleVaultLike {
    AggregatorV3Interface public feed;
    mapping(address => uint256) public balanceOf;

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function withdraw(uint256 amt) external {
        balanceOf[msg.sender] -= amt;
        payable(msg.sender).transfer(amt);
    }

    function spot() public view returns (int256) {
        (, int256 answer, , , ) = feed.latestRoundData();
        return answer;
    }
}
