# CasinoVault (Foundry)

Compile and test the on-chain vault before Base deployment.

## Setup

```powershell
cd infra/contracts/ethereum
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge build
```

## Deploy (example)

Set `DEPLOYER_KEY`, `OWNER`, `OPERATOR`, then:

```powershell
forge script script/DeployCasinoVault.s.sol:DeployCasinoVault --rpc-url $BASE_SEPOLIA_RPC --broadcast
```

Wire the deployed address into `.env` as `NEXT_PUBLIC_CASINO_VAULT_ETHEREUM_BASE` (or the matching chain).
