// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Plain ERC-721 collection. No marketplace / escrow — demote as nft.
/// Fixture only — not a finding.
contract CoolCatsLike {
    mapping(uint256 => address) private _owner;
    mapping(address => uint256) public balanceOf;

    function ownerOf(uint256 tokenId) public view returns (address) {
        return _owner[tokenId];
    }

    function tokenURI(uint256 tokenId) public pure returns (string memory) {
        tokenId;
        return "";
    }

    function setApprovalForAll(address operator, bool approved) external {
        operator;
        approved;
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        require(_owner[tokenId] == from);
        _owner[tokenId] = to;
        balanceOf[from] -= 1;
        balanceOf[to] += 1;
    }
}
