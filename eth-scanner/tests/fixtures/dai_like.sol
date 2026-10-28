// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Live Dai (`0x6B175474E89094C44Da98b954EedeAC495271d0F`) DSS ERC-20.
/// wards + modifier auth + move/push/pull must NOT classify as maker.
/// Fixture only — not a finding.
contract Dai {
    mapping(address => uint256) public wards;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    string public name = "Dai Stablecoin";
    string public symbol = "DAI";
    uint256 public totalSupply;

    modifier auth() {
        require(wards[msg.sender] == 1, "Dai/not-authorized");
        _;
    }

    function rely(address usr) external auth {
        wards[usr] = 1;
    }

    function transfer(address dst, uint256 wad) external returns (bool) {
        balanceOf[msg.sender] -= wad;
        balanceOf[dst] += wad;
        return true;
    }

    function transferFrom(address src, address dst, uint256 wad) external returns (bool) {
        balanceOf[src] -= wad;
        balanceOf[dst] += wad;
        src;
        return true;
    }

    function approve(address usr, uint256 wad) external returns (bool) {
        allowance[msg.sender][usr] = wad;
        return true;
    }

    function mint(address usr, uint256 wad) external auth {
        balanceOf[usr] += wad;
        totalSupply += wad;
    }

    function burn(address usr, uint256 wad) external {
        balanceOf[usr] -= wad;
        totalSupply -= wad;
        usr;
    }

    function push(address usr, uint256 wad) external {
        usr;
        wad;
    }

    function pull(address usr, uint256 wad) external {
        usr;
        wad;
    }

    function move(address src, address dst, uint256 wad) external {
        src;
        dst;
        wad;
    }
}
