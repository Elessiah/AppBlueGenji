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
 * page n'en envoie plus que titre et résumé). Une version de la politique — le
 * texte même de l'historique de `/rgpd` — se rend sans lire le compte ; un avis
 * réservé à un public et absent de `/rgpd` (`GOOGLE_LINKED`) n'est rendu par
 * cette route qu'au compte qui l'a à lire (`loadPendingPrivacyChanges`), sinon
 * il est omis. Ce n'est pas un secret — le registre, détail compris, est aussi
 * dans le code client (`lib/shared/privacy-changes.ts`) : la route ne le
 * présente simplement pas à qui il ne s'adresse pas. Sa réponse dépend alors
 * du compte : elle n'est pas gardée par le navigateur (`no-store`), qu'un autre
 * compte connecté ensuite ne reçoive pas la lecture du premier.
 */
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { acknowledgePrivacyChanges, loadPendingPrivacyChanges } from "@/lib/server/privacy-consent";
import {
  checkPrivacyAcknowledgement,
  INVALID_PRIVACY_CHANGES,
  isPrivacyPolicyVersion,
  PRIVACY_CHANGES,
  privacyChangeDay,
} from "@/lib/shared/privacy-changes";
import { readJsonBody } from "@/lib/server/request-body";
import { privacyChangeDetailsFor } from "@/lib/shared/privacy-changes-en";

/** Le détail ne change qu'avec un déploiement : cinq minutes, privé au navigateur. */
const PRIVACY_DETAILS_CACHE_CONTROL = "private, max-age=300";

/** Réponse qui dépend du compte (avis hors politique demandé) : jamais gardée. */
const ACCOUNT_DEPENDENT_CACHE_CONTROL = "private, no-store";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const params = new URL(req.url).searchParams;
  const ids = (params.get("ids") ?? "").split(",").filter((id) => id.length > 0);
  const check = checkPrivacyAcknowledgement(ids, privacyChangeDay(new Date()));
  if (!check.ok) return fail(check.error, 400);

  const { ids: servable, accountDependent } = await servableDetailIds(user.id, check.ids);
  const response = ok({ details: privacyChangeDetailsFor(servable, params.get("locale") === "en" ? "en" : "fr") });
  // Versions de la politique seules : texte publié, identique pour tous — le
  // navigateur le garde (rechargements de la page, modale ouverte) sans le
  // redemander. Un avis hors politique demandé : la réponse dépend du compte
  // (dû ou non), et une même URL relue après un changement de compte dans ce
  // navigateur rendrait la réponse du précédent — elle n'est pas gardée.
  response.headers.set("Cache-Control", accountDependent ? ACCOUNT_DEPENDENT_CACHE_CONTROL : PRIVACY_DETAILS_CACHE_CONTROL);
  return response;
}

/**
 * Les identifiants dont le détail peut se rendre à ce compte : toute version de
 * la politique (publique sur `/rgpd`), et un avis hors politique seulement s'il
 * est dû à ce compte — la base n'est lue que si l'un d'eux est demandé.
 */
async function servableDetailIds(
  userId: number,
  ids: readonly string[],
): Promise<{ ids: string[]; accountDependent: boolean }> {
  const byId = new Map(PRIVACY_CHANGES.map((change) => [change.id, change]));
  const restricted = ids.filter((id) => {
    const change = byId.get(id);
    return change !== undefined && !isPrivacyPolicyVersion(change);
  });
  if (restricted.length === 0) return { ids: [...ids], accountDependent: false };
  const pending = new Set((await loadPendingPrivacyChanges(userId)).map((change) => change.id));
  return { ids: ids.filter((id) => !restricted.includes(id) || pending.has(id)), accountDependent: true };
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
