// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../CasinoVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 1_000_000e6);
    }
}

contract CasinoVaultTest is Test {
    CasinoVault vault;
    MockUSDC token;
    address owner = address(0xA11CE);
    address operator = address(0xB0B);
    address player = address(0xC0FFEE);

    function setUp() public {
        vm.prank(owner);
        vault = new CasinoVault(owner, operator);
        token = new MockUSDC();
        vm.prank(owner);
        vault.setTokenAllowed(token, true);
        token.transfer(player, 100_000e6);
    }

    function testDepositIncreasesBalance() public {
        vm.startPrank(player);
        token.approve(address(vault), 1000e6);
        vault.deposit(token, 1000e6);
        vm.stopPrank();
        assertEq(token.balanceOf(address(vault)), 1000e6);
    }
}
