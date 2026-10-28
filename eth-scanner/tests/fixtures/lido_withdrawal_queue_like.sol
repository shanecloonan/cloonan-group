// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IWstETHQ {
    function unwrap(uint256 amount) external returns (uint256);
    function getWstETHByStETH(uint256 amount) external view returns (uint256);
}

/// Lido WithdrawalQueueERC721 impl (`0xe42c…d9`). Proxy `0x889e…B1`.
/// Sibling IWstETH.unwrap / getWstETHByStETH must not demote share-wrap.
/// Queue holds claimable ETH. Fixture only — not a finding.
contract WithdrawalQueueERC721 {
    IWstETHQ public WSTETH;
    mapping(uint256 => address) public ownerOf;

    function requestWithdrawals(uint256[] calldata amounts, address owner) public returns (uint256[] memory) {
        amounts;
        owner;
        uint256[] memory ids;
        return ids;
    }

    function claimWithdrawals(uint256[] calldata requestIds, uint256[] calldata hints) external {
        requestIds;
        hints;
    }

    function finalize(uint256 lastId, uint256 maxShareRate) external payable {
        lastId;
        maxShareRate;
    }

    function _enqueue(uint256 amountOfStETH, address owner) internal returns (uint256) {
        uint256 amountOfStETH2 = WSTETH.unwrap(0);
        amountOfStETH;
        owner;
        return amountOfStETH2;
    }

    function _claim(uint256 requestId) internal {
        requestId;
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        from;
        to;
        tokenId;
    }
}
