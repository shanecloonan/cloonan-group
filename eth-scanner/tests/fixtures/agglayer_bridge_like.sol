// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// AgglayerBridge impl (`0x66E0…5Ad`; proxy `0x2a3D…2EDe`).
/// Polygon zkEVM / Agglayer L1 lock-release. bridgeAsset + claimAsset.
/// Must not win as generic custody-movers. Fixture only — not a finding.
contract AgglayerBridge {
    function bridgeAsset(
        uint32 destinationNetwork,
        address destinationAddress,
        uint256 amount,
        address token,
        bool forceUpdateGlobalExitRoot,
        bytes calldata permitData
    ) external payable {
        destinationNetwork;
        destinationAddress;
        amount;
        token;
        forceUpdateGlobalExitRoot;
        permitData;
    }

    function claimAsset(
        bytes32[32] calldata smtProofLocalExitRoot,
        bytes32[32] calldata smtProofRollupExitRoot,
        uint256 globalIndex,
        bytes32 mainnetExitRoot,
        bytes32 rollupExitRoot,
        uint32 originNetwork,
        address originTokenAddress,
        uint32 destinationNetwork,
        address destinationAddress,
        uint256 amount,
        bytes calldata metadata
    ) external {
        smtProofLocalExitRoot;
        smtProofRollupExitRoot;
        globalIndex;
        mainnetExitRoot;
        rollupExitRoot;
        originNetwork;
        originTokenAddress;
        destinationNetwork;
        destinationAddress;
        amount;
        metadata;
    }

    function claimMessage() external {}

    function updateGlobalExitRoot() external {}

    function getTokenWrappedAddress(uint32 originNetwork, address originTokenAddress) external view returns (address) {
        originNetwork;
        originTokenAddress;
        return address(0);
    }
}
