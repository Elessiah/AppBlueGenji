/**
 * Acceptation des changements du traitement des données
 * (`lib/shared/privacy-changes.ts`).
 *
 * Le corps nomme **les changements que la modale a montrés** (`changeIds`),
 * jamais « tout ce qui est dû » : un changement publié entre l'affichage et le
 * clic n'est pas accepté par qui ne l'a pas lu, et réapparaîtra au chargement
 * suivant. Le refus, lui, n'a pas de route : c'est la suppression du compte
 * (`DELETE /api/profile`).
 */
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { acknowledgePrivacyChanges } from "@/lib/server/privacy-consent";
import { checkPrivacyAcknowledgement, INVALID_PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  let body: { changeIds?: unknown };
  try {
    body = (await req.json()) as { changeIds?: unknown };
  } catch {
    return fail(INVALID_PRIVACY_CHANGES, 400);
  }

  const check = checkPrivacyAcknowledgement(body?.changeIds);
  if (!check.ok) return fail(check.error, 400);

  await acknowledgePrivacyChanges(user.id, check.ids);
  return ok({ acknowledged: check.ids });
}
