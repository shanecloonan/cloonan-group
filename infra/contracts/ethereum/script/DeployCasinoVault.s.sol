// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../CasinoVault.sol";

contract DeployCasinoVault is Script {
    function run() external {
        address owner = vm.envAddress("CASINO_VAULT_OWNER");
        address operator = vm.envAddress("CASINO_VAULT_OPERATOR");
        uint256 key = vm.envUint("DEPLOYER_KEY");

        vm.startBroadcast(key);
        new CasinoVault(owner, operator);
        vm.stopBroadcast();
    }
}
