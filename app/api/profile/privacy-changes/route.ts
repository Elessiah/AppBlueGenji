/**
 * Prise de connaissance des changements du traitement des données
 * (`lib/shared/privacy-changes.ts`).
 *
 * Le corps nomme **les changements que la modale a montrés** (`changeIds`),
 * jamais « tout ce qui est dû » : un changement publié entre l'affichage et le
 * clic n'est pas acquitté par qui ne l'a pas lu, et réapparaîtra au chargement
 * suivant. Il n'y a pas de refus : la modale informe, elle ne demande aucun
 * accord.
 */
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { acknowledgePrivacyChanges } from "@/lib/server/privacy-consent";
import {
  checkPrivacyAcknowledgement,
  INVALID_PRIVACY_CHANGES,
  privacyChangeDay,
} from "@/lib/shared/privacy-changes";
import { readJsonBody } from "@/lib/server/request-body";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  let body: { changeIds?: unknown };
  try {
    body = (await readJsonBody(req)) as { changeIds?: unknown };
  } catch {
    return fail(INVALID_PRIVACY_CHANGES, 400);
  }

  const check = checkPrivacyAcknowledgement(body?.changeIds, privacyChangeDay(new Date()));
  if (!check.ok) return fail(check.error, 400);

  await acknowledgePrivacyChanges(user.id, check.ids);
  return ok({ acknowledged: check.ids });
}
