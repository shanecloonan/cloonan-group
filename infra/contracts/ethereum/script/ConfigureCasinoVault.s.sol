// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../CasinoVault.sol";

/// Allowlist ERC-20 tokens on a deployed vault (owner key required).
contract ConfigureCasinoVault is Script {
    function run() external {
        address vaultAddr = vm.envAddress("CASINO_VAULT");
        address tokenAddr = vm.envAddress("ALLOW_TOKEN");
        uint256 key = vm.envUint("DEPLOYER_KEY");

        CasinoVault vault = CasinoVault(vaultAddr);
        vm.startBroadcast(key);
        vault.setTokenAllowed(IERC20(tokenAddr), true);
        vm.stopBroadcast();
    }
}
