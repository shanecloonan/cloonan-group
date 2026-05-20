# Deploy CasinoVault.sol via Foundry (Ethereum Sepolia example).
# Prerequisites: forge installed, OpenZeppelin installed under infra/contracts/ethereum
#
# Usage:
#   $env:DEPLOYER_KEY = "0x..."
#   $env:CASINO_VAULT_OWNER = "0x..."
#   $env:CASINO_VAULT_OPERATOR = "0x..."
#   $env:ETHEREUM_SEPOLIA_RPC = "https://rpc.sepolia.org"
#   .\scripts\deploy-casino-vault.ps1 -RpcUrl $env:ETHEREUM_SEPOLIA_RPC -EnvSuffix ETHEREUM_SEPOLIA

param(
  [string]$RpcUrl = "https://rpc.sepolia.org",
  [string]$EnvSuffix = "ETHEREUM_SEPOLIA"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$contracts = Join-Path $root "infra\contracts\ethereum"

if (-not $env:DEPLOYER_KEY) { throw "Set DEPLOYER_KEY (hex private key)" }
if (-not $env:CASINO_VAULT_OWNER) { throw "Set CASINO_VAULT_OWNER (multisig or admin)" }
if (-not $env:CASINO_VAULT_OPERATOR) { throw "Set CASINO_VAULT_OPERATOR (EIP-712 signer)" }

Push-Location $contracts
try {
  if (-not (Test-Path "lib\openzeppelin-contracts")) {
    Write-Host "Installing OpenZeppelin..."
    forge install OpenZeppelin/openzeppelin-contracts --no-commit
  }
  forge build
  Write-Host "Broadcasting DeployCasinoVault to $RpcUrl ..."
  forge script script/DeployCasinoVault.s.sol:DeployCasinoVault --rpc-url $RpcUrl --broadcast
  Write-Host ""
  Write-Host "Copy the deployed CasinoVault address into .env.local:"
  Write-Host "  NEXT_PUBLIC_CASINO_VAULT_$EnvSuffix=0x..."
  Write-Host "  CASINO_OPERATOR_KEY must match CASINO_VAULT_OPERATOR on-chain"
} finally {
  Pop-Location
}
