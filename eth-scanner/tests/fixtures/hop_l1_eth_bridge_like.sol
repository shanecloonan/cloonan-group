// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Hop L1 ETH lock-release bridge (`0xb8901acB165ed027E32754E0FFe830802919777f`).
/// Pass 11: Etherscan + Sourcify still have no verified blob (empty SourceCode).
/// Keep this shape fixture. Bonder `stake`/`unstake` must not win as staking.
/// Fixture only — not a finding.
contract L1_ETH_Bridge {
    mapping(address => uint256) public getCredit;
    mapping(uint256 => uint256) public chainBalance;

    function sendToL2(
        uint256 chainId,
        address recipient,
        uint256 amount,
        address relayer,
        uint256 relayerFee
    ) external payable {
        chainBalance[chainId] += amount;
        recipient;
        relayer;
        relayerFee;
    }

    function bondTransferRoot(bytes32 rootHash, uint256 destinationChainId, uint256 totalAmount) external {
        rootHash;
        destinationChainId;
        totalAmount;
    }

    function confirmTransferRoot(
        uint256 originChainId,
        bytes32 rootHash,
        uint256 destinationChainId,
        uint256 totalAmount,
        uint256 rootCommittedAt
    ) external {
        originChainId;
        rootHash;
        destinationChainId;
        totalAmount;
        rootCommittedAt;
    }

    function challengeTransferRoot(bytes32 rootHash, uint256 originalAmount) external payable {
        rootHash;
        originalAmount;
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

    function withdraw(
        address recipient,
        uint256 amount,
        bytes32 transferNonce,
        uint256 bonderFee,
        uint256 amountOutMin,
        uint256 deadline,
        bytes32 rootHash,
        uint256 transferRootTotalAmount,
        uint256 transferIdTreeIndex,
        bytes32[] calldata proof
    ) external {
        recipient;
        amount;
        transferNonce;
        bonderFee;
        amountOutMin;
        deadline;
        rootHash;
        transferRootTotalAmount;
        transferIdTreeIndex;
        proof;
    }

    // Bonder collateral — must not win as staking over lock-release verbs.
    function stake(address bonder, uint256 amount) external payable {
        getCredit[bonder] += amount;
    }
    function unstake(uint256 amount) external {
        getCredit[msg.sender] -= amount;
    }
}
