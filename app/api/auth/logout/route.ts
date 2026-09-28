import { clearSession } from "@/lib/server/auth";
import { ok } from "@/lib/server/http";
import { rejectCrossSiteRequest } from "@/lib/server/request-origin";

export async function POST(req: Request) {
  // Un site tiers déconnectait n'importe qui d'un simple formulaire : la route
  // ne lit aucun corps, seule la provenance est contrôlée.
  const crossSite = rejectCrossSiteRequest(req, { requireJson: false });
  if (crossSite) return crossSite;

  await clearSession();
  return ok({ success: true });
}
