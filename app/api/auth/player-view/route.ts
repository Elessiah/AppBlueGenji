import { enforceRateLimit, PLAYER_VIEW_EXIT_RULE, PLAYER_VIEW_TOGGLE_RULE, reserveRateLimit } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { failureReason } from "@/lib/server/failure-reason";
import { fail, ok } from "@/lib/server/http";
import { PLAYER_VIEW_NO_SESSION, PLAYER_VIEW_NOT_ADMIN, setPlayerView } from "@/lib/server/player-view";
import { readJsonObject, SMALL_JSON_BODY_MAX_BYTES } from "@/lib/server/request-body";
import { rejectCrossSiteRequest } from "@/lib/server/request-origin";
import { parsePlayerViewBody } from "@/lib/shared/player-view";

/**
 * « Incarner un rôle » / « Revenir en vue admin »
 * (`docs/features/ADMIN_ROLE_IMPERSONATION.md`). Corps `{ active: boolean,
 * roles?: PlatformRole[] }` — `roles` à l'entrée seulement : les rôles à
 * incarner (sauf `ADMIN`), vides ou absents pour la vue joueur.
 *
 * Ouverte aux seuls administrateurs **réels** (`playerViewAvailable`, lu sur
 * le compte et non sur la session) : c'est ce qui laisse revenir une session
 * qui incarne un rôle, dont `can()` ne voit plus que ce rôle. Tout autre
 * compte reçoit `403 FORBIDDEN`. Débit borné par compte (`429`) : les
 * **entrées** par `PLAYER_VIEW_TOGGLE_RULE`, le retour, qui ne fait que rendre
 * des droits, par une règle à part et plus large (`PLAYER_VIEW_EXIT_RULE`),
 * qui borne aussi, avant la lecture du corps, toute requête du compte (corps
 * invalide compris). Une entrée refusée par sa propre règle y rend sa place :
 * les deux fenêtres, fixes, ne démarrent pas ensemble, si bien que vingt
 * entrées admises au plus pèsent sur une même fenêtre large (dix de part et
 * d'autre d'un renouvellement de la fenêtre étroite) — dix places au moins
 * restent au retour. Seule une boucle de corps refusés (`400`) peut l'épuiser,
 * le temps d'une fenêtre : elle se compte, c'est son but.
 *
 * Une entrée alors que la session incarne déjà **d'autres** rôles (un autre
 * onglet l'a posée) ne change rien et répond `409 IMPERSONATION_ALREADY_ACTIVE`
 * (la page se relit et montre la bannière) : jamais un `200` qui laisserait
 * croire au rôle choisi. Une entrée qui a bien écrit (`changed`) n'est jamais
 * refusée, même si un geste croisé a changé l'état relu depuis : elle rend
 * l'état relu, comme tout `200`.
 */
export async function POST(req: Request) {
  const crossSite = rejectCrossSiteRequest(req, { requireJson: true });
  if (crossSite) return crossSite;

  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!user.playerViewAvailable) return fail("FORBIDDEN", 403);

  // Garde large **avant** de lire le corps : un corps refusé (rôle inconnu,
  // trop de rôles, `roles` à la sortie) se compte aussi — une boucle de
  // requêtes invalides ne martèle pas la lecture et l'analyse du JSON. Les
  // entrées ont, en plus, leur règle plus étroite, après l'analyse.
  const broad = reserveRateLimit(PLAYER_VIEW_EXIT_RULE, user.id);
  if (broad.refused) return broad.refused;
  const read = await readJsonObject(req, "INVALID_PLAYER_VIEW", SMALL_JSON_BODY_MAX_BYTES);
  if ("refusal" in read) return fail(read.refusal, 400);
  const parsed = parsePlayerViewBody(read.body);
  if (parsed === null) return fail("INVALID_PLAYER_VIEW", 400);
  if (parsed.active) {
    const throttled = enforceRateLimit(PLAYER_VIEW_TOGGLE_RULE, user.id);
    if (throttled) {
      // Entrée refusée : sa place dans la règle large est rendue, le retour reste possible.
      broad.refund();
      return throttled;
    }
  }

  try {
    const { until, roles, changed } = await setPlayerView(user, parsed.active, parsed.roles);
    // Une entrée qui n'a rien écrit : une autre incarnation tenait la session
    // (rôles autres : conflit ; mêmes rôles : déjà posée, `200`) — ou une
    // sortie croisée l'a levée depuis (relue vide : `409` aussi, jamais un
    // `200` qui laisserait croire à une incarnation qui n'existe pas).
    if (parsed.active && !changed && (until === null || !sameRoles(roles, parsed.roles))) {
      return fail("IMPERSONATION_ALREADY_ACTIVE", 409);
    }
    // L'état relu en base, pas celui demandé : deux bascules croisées ne
    // peuvent rendre une incarnation sans échéance.
    return ok({ playerView: until !== null, until, roles });
  } catch (error) {
    return toggleFailure(error);
  }
}

/** Réponse d'une bascule en échec : refus du service, ou panne (`500`, code seul dans pm2). */
function toggleFailure(error: unknown): Response {
  const message = error instanceof Error ? error.message : null;
  if (message === PLAYER_VIEW_NO_SESSION) return fail("UNAUTHORIZED", 401);
  // Administration retirée pendant l'entrée : défaite, refusée comme telle.
  if (message === PLAYER_VIEW_NOT_ADMIN) return fail("FORBIDDEN", 403);
  console.error("[player-view] bascule impossible :", failureReason(error));
  return fail("PLAYER_VIEW_FAILED", 500);
}

/** Mêmes rôles (listes normalisées, dans l'ordre de `IMPERSONABLE_ROLES`). */
function sameRoles(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((role, index) => role === b[index]);
}
