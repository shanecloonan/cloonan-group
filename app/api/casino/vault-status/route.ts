import { NextResponse } from "next/server";
import { getVaultChainStatuses, isAnyVaultDeployed } from "@/lib/casino/vault-config";

export const dynamic = "force-dynamic";

/** GET /api/casino/vault-status — which chains have a deployed CasinoVault. */
export async function GET() {
  const chains = getVaultChainStatuses();
  return NextResponse.json({
    anyDeployed: isAnyVaultDeployed(),
    operatorConfigured: !!process.env.CASINO_OPERATOR_KEY,
    operatorWebhookConfigured: !!process.env.CASINO_OPERATOR_SECRET,
    serviceRoleConfigured: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    chains,
  });
}
