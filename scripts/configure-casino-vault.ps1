# Allowlist an ERC-20 on a deployed CasinoVault (owner must sign).
#
#   $env:CASINO_VAULT = "0x..."
#   $env:ALLOW_TOKEN = "0x..."      # e.g. USDC on Base Sepolia
#   $env:DEPLOYER_KEY = "0x..."     # must be vault owner
#   $env:RPC_URL = "https://sepolia.base.org"
#   .\scripts\configure-casino-vault.ps1

param([string]$RpcUrl = $env:RPC_URL)

$ErrorActionPreference = "Stop"
if (-not $env:CASINO_VAULT) { throw "Set CASINO_VAULT" }
if (-not $env:ALLOW_TOKEN) { throw "Set ALLOW_TOKEN" }
if (-not $env:DEPLOYER_KEY) { throw "Set DEPLOYER_KEY (vault owner)" }
if (-not $RpcUrl) { throw "Set RPC_URL or pass -RpcUrl" }

$root = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $root "infra\contracts\ethereum")
try {
  forge script script/ConfigureCasinoVault.s.sol:ConfigureCasinoVault --rpc-url $RpcUrl --broadcast
  Write-Host "Token allowlisted on vault $($env:CASINO_VAULT)"
} finally {
  Pop-Location
}
