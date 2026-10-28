// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Rz {
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Renzo RestakeManager impl (`0xd5b3…aa0`). Holds collaterals for ezETH.
/// Must be staking, not generic custody. Fixture only — not a finding.
contract RestakeManager {
    IERC20Rz public ezETH;
    address public renzoOracle;
    address public operatorDelegator;

    function deposit(address collateralToken, uint256 amount, uint256 minOut) external {
        IERC20Rz(collateralToken).transferFrom(msg.sender, address(this), amount);
        minOut;
    }

    function depositETH(uint256 minOut) external payable {
        minOut;
    }

    function pendingWithdrawals(address) external view returns (uint256) {
        return 0;
    }
}
