// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Minimal Foundry fixture so the L4 runner can detect a project.
/// No attacker harness. `forge test` is optional in CI.
contract PlaceholderTest {
    function test_fixture_compiles() public pure {
        assert(true);
    }
}
