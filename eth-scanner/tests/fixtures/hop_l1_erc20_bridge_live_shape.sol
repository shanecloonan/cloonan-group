// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Live Hop L1 ERC20 Bridge (`0x3666f603Cc164936C1b87e207F36BEBa4AC5f18a`).
/// Etherscan 2026-10-28: ContractName=`L1_ERC20_Bridge`, verified, not a proxy.
/// L1 ETH (`0xb890…777f`) is still unverified (empty SourceCode + Sourcify 404).
/// Bonder `stake`/`unstake` must not beat lock-release. Fixture only — not a finding.
contract L1_ERC20_Bridge {
    mapping(address => uint256) public getCredit;

    function sendToL2(uint256 chainId, address recipient, uint256 amount, uint256 bonderFee, uint256 amountOutMin, uint256 deadline) external {
        chainId;
        recipient;
        amount;
        bonderFee;
        amountOutMin;
        deadline;
    }

    function bondWithdrawal(address recipient, uint256 amount, bytes32 transferNonce, uint256 bonderFee) external {
        recipient;
        amount;
        transferNonce;
        bonderFee;
    }

    function settleBondedWithdrawals(address bonder, bytes32[] calldata transferIds, uint256 totalAmount) external {
        bonder;
        transferIds;
        totalAmount;
    }

    function withdraw(address recipient, uint256 amount, bytes32 transferNonce, uint256 bonderFee, bytes32 rootHash, uint256 transferRootTotalAmount, bytes32[] calldata proof) external {
        recipient;
        amount;
        transferNonce;
        bonderFee;
        rootHash;
        transferRootTotalAmount;
        proof;
    }

    function bondTransferRoot(bytes32 rootHash, uint256 destinationChainId, uint256 totalAmount) external {
        rootHash;
        destinationChainId;
        totalAmount;
    }

    function confirmTransferRoot(uint256 originChainId, bytes32 rootHash, uint256 destinationChainId, uint256 totalAmount, uint256 rootCommittedAt) external {
        originChainId;
        rootHash;
        destinationChainId;
        totalAmount;
        rootCommittedAt;
    }

    function stake(address bonder, uint256 amount) external payable {
        getCredit[bonder] += amount;
    }
    function unstake(uint256 amount) external {
        getCredit[msg.sender] -= amount;
    }
}
