# CasinoVault (Foundry)

Compile and test the on-chain vault before mainnet/Base deployment.

## Setup

```powershell
cd infra/contracts/ethereum
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge build
forge test
```

## Deploy (Sepolia example)

From the repo root, set env vars then run the helper script:

```powershell
$env:DEPLOYER_KEY = "0x..."           # pays gas
$env:CASINO_VAULT_OWNER = "0x..."     # Ownable owner (multisig recommended)
$env:CASINO_VAULT_OPERATOR = "0x..." # EIP-712 signer — must match CASINO_OPERATOR_KEY address
$env:BASE_SEPOLIA_RPC = "https://sepolia.base.org"

.\scripts\deploy-casino-vault.ps1 -RpcUrl $env:BASE_SEPOLIA_RPC -EnvSuffix ETHEREUM_SEPOLIA
```

Or manually:

```powershell
cd infra/contracts/ethereum
forge script script/DeployCasinoVault.s.sol:DeployCasinoVault --rpc-url $env:BASE_SEPOLIA_RPC --broadcast
```

## Wire the app

In `.env.local`:

```env
NEXT_PUBLIC_CASINO_VAULT_ETHEREUM_SEPOLIA=0xDeployedVaultAddress
NEXT_PUBLIC_CASINO_RPC_ETHEREUM_SEPOLIA=https://sepolia.base.org
CASINO_OPERATOR_KEY=0x...   # private key for the OPERATOR address above
```

Restart Next.js. `/casino/wallet` will enable deposit/withdraw on that chain; `/api/casino/vault-status` reports readiness.

Allowed ERC-20 tokens must be allowlisted on the contract after deploy (`setAllowedToken`).
