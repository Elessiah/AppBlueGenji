/**
 * Prise de connaissance des changements du traitement des données
 * (`lib/shared/privacy-changes.ts`).
 *
 * Le corps nomme **les changements que la modale a montrés** (`changeIds`),
 * jamais « tout ce qui est dû » : un changement publié entre l'affichage et le
 * clic n'est pas acquitté par qui ne l'a pas lu, et réapparaîtra au chargement
 * suivant. Il n'y a pas de refus : la modale informe, elle ne demande aucun
 * accord.
 *
 * `GET` rend le **détail** des entrées que la modale présente (#587 : la mise en
 * page n'en envoie plus que titre et résumé). Des entrées publiées seulement —
 * le texte même de l'historique de `/rgpd` — si bien qu'aucune donnée de compte
 * n'est lue : la session ne sert qu'à réserver la route aux comptes connectés,
 * seuls à voir la modale.
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
import { privacyChangeDetailsFor } from "@/lib/shared/privacy-changes-en";

/** Le détail ne change qu'avec un déploiement : cinq minutes, privé au navigateur. */
const PRIVACY_DETAILS_CACHE_CONTROL = "private, max-age=300";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const params = new URL(req.url).searchParams;
  const ids = (params.get("ids") ?? "").split(",").filter((id) => id.length > 0);
  const check = checkPrivacyAcknowledgement(ids, privacyChangeDay(new Date()));
  if (!check.ok) return fail(check.error, 400);

  const response = ok({ details: privacyChangeDetailsFor(check.ids, params.get("locale") === "en" ? "en" : "fr") });
  // Texte publié, identique pour tous : le navigateur le garde (rechargements
  // de la page modale ouverte) sans le redemander ni relire la session.
  response.headers.set("Cache-Control", PRIVACY_DETAILS_CACHE_CONTROL);
  return response;
}

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
