import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, PROFILELESS_LOOKUP_RULE } from "@/lib/server/api-guard";
import { failureReason } from "@/lib/server/failure-reason";
import { fail, ok } from "@/lib/server/http";
import { rejectCrossSiteRequest } from "@/lib/server/request-origin";
import { bodyReadRefusal, PAYLOAD_TOO_LARGE, readJsonBody, SMALL_JSON_BODY_MAX_BYTES } from "@/lib/server/request-body";
import { profilelessAmong } from "@/lib/server/users/profileless-players";
import { parseProfilelessLookup } from "@/lib/shared/profileless-lookup";

/**
 * Parmi les comptes **affichés** par la page (`{ players: [{ id, name }] }`, au
 * plus `PROFILELESS_LOOKUP_MAX`), ceux qui sont supprimés sans fiche (D13), pour
 * que `ProfilelessPlayersProvider` rende leur nom en texte. Jamais la liste
 * entière (D86), et seulement pour un compte nommé comme la page le montre
 * (`profilelessAmong`) : des identifiants pris au hasard ne la reconstituent
 * pas, et les noms faux essayés par compte demandé sont bornés, tous visiteurs
 * confondus (`admitProfilelessName` : un nom hors borne est tu, jamais refusé).
 * Au seul visiteur connecté, le seul à qui un nom mène quelque part,
 * sous son propre seau (`PROFILELESS_LOOKUP_RULE`, distinct de l'annuaire).
 * Liste illisible : 503 (`PROFILELESS_UNAVAILABLE`), jamais une réponse vide
 * que les liens prendraient pour « tous ont une fiche ». Un `POST` sans
 * écriture : les noms ne passent pas par l'adresse (journaux d'accès).
 */
export async function POST(request: Request) {
  const crossSite = rejectCrossSiteRequest(request, { requireJson: true });
  if (crossSite) return crossSite;

  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const throttled = enforceRateLimit(PROFILELESS_LOOKUP_RULE, user.id);
  if (throttled) return throttled;

  let body: unknown;
  try {
    body = await readJsonBody(request, SMALL_JSON_BODY_MAX_BYTES);
  } catch (error) {
    const refusal = bodyReadRefusal(error);
    if (refusal === PAYLOAD_TOO_LARGE) return fail(refusal, 413);
    if (refusal !== null) return fail(refusal, 415);
    return fail("INVALID_PLAYER_IDS", 400);
  }
  const players = parseProfilelessLookup(body);
  if (players === null) return fail("INVALID_PLAYER_IDS", 400);

  try {
    return ok({ ids: await profilelessAmong(players) });
  } catch (error) {
    console.error("[profileless-players] liste illisible", failureReason(error));
    return fail("PROFILELESS_UNAVAILABLE", 503);
  }
}
