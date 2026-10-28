// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Sky USDS impl (`0x1923…102`). DSS ERC-20 receipt — cool-archive as token.
/// Fixture only — not a finding.
contract Usds {
    mapping(address => uint256) public wards;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    string public name = "USDS Stablecoin";
    string public symbol = "USDS";
    uint256 public totalSupply;

    modifier auth() {
        require(wards[msg.sender] == 1, "Usds/not-authorized");
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
