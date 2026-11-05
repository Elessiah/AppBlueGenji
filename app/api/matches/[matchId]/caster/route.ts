import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { bodyReadRefusal, readJsonBody } from "@/lib/server/request-body";
import { loadOwnCastSettings } from "@/lib/server/tournaments/cast-settings";
import { claimMatchCast, releaseMatchCast, setCastSettings } from "@/lib/server/tournaments/match-launch";
import {
  isPositiveId,
  launchFailure,
  parseCastSettings,
  parseCastTarget,
  parseMatchIdParam,
} from "@/lib/server/tournaments/match-launch-routes";
import { can } from "@/lib/shared/permissions";
import type { AuthUser } from "@/lib/server/auth";
import type { CastAccess } from "@/lib/server/tournaments/cast-settings";

/** Ses droits sur un mode d'antenne déjà posé (`lib/shared/live-trigger-owner.ts`). */
function castAccess(user: AuthUser): CastAccess {
  return { isAdmin: user.isAdmin, manages: can(user, "tournaments") };
}

const STATUSES: Readonly<Record<string, number>> = {
  NOT_CASTER: 403,
  CASTER_IDENTITY_REQUIRED: 409,
  CASTER_DISCORD_REQUIRED: 409,
  MATCH_NOT_FOUND: 404,
  MATCH_ALREADY_COMPLETED: 409,
  MATCH_NOT_LAUNCHABLE: 409,
  CASTER_IS_PLAYER: 409,
  STREAM_NOT_FOUND: 409,
  INVALID_STREAM_URL: 400,
  STREAM_URL_REQUIRED: 400,
  INVALID_CAST_BATTLETAG: 400,
  INVALID_LIVE_TRIGGER: 400,
  LIVE_TRIGGER_NOT_OWNED: 403,
  MATCH_NOT_CASTABLE: 409,
  MATCH_START_AT_REQUIRED: 409,
  CAST_STREAM_NOT_OWNED: 409,
  NOT_MATCH_CASTER: 403,
};

/** Corps de requête lu, ou le refus déjà formé (`bodyReadRefusal`). */
async function castBody(req: Request): Promise<{ body: unknown } | { refusal: string }> {
  if (req.body === null || req.headers.get("content-length") === "0") return { body: {} };
  try {
    return { body: await readJsonBody(req) };
  } catch (error) {
    return { refusal: bodyReadRefusal(error) ?? "INVALID_CAST_TARGET" };
  }
}

/**
 * S'inscrire pour caster un match. Permission `live`, **et** tag Discord
 * certifié **et**, pour un match Overwatch, compte Battle.net rattaché (jeu lu
 * sous le verrou du match) : le caster se présente aux deux
 * équipes dans la modale de lancement (`lib/shared/match-launch.ts`).
 * Corps : `{ streamId: number }` (co-caster un stream du match) ou
 * `{ liveUrl: string }` (ouvrir son propre stream — le lien est
 * **obligatoire**, un stream sans lien n'apparaissant sur aucune vue), plus les
 * réglages du même geste (`parseCastSettings` : `trigger`, `battletag`,
 * `organisationLink`), appliqués dans la même transaction
 * (`docs/features/CAST_SETTINGS.md`). Un corps **illisible** (JSON cassé, trop
 * lourd, mauvais type) est refusé, jamais pris pour un corps vide.
 */
export async function POST(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  const read = await castBody(req);
  if ("refusal" in read) return fail(read.refusal, 400);
  const target = parseCastTarget(read.body);
  if (target === null) return fail("INVALID_CAST_TARGET", 400);
  const settings = parseCastSettings(read.body);
  if (settings === null) return fail("INVALID_CAST_SETTINGS", 400);
  // Le lien est la **cible** de l'inscription (`target`), pas un réglage : le
  // repasser réécrirait le stream qui vient d'être ouvert avec.
  delete settings.liveUrl;
  // Le lien de l'organisation engage l'organisation : seule la permission
  // `tournaments` le dit, et le refus est explicite (jamais ignoré en silence).
  if (settings.asOrganisation === true && !can(user, "tournaments")) return fail("FORBIDDEN", 403);

  try {
    await claimMatchCast(matchId, user.id, can(user, "live"), target, settings, castAccess(user));
    return ok({ casterUserId: user.id });
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_CAST_CLAIM_FAILED");
  }
}

/**
 * Lire les réglages de **son** cast (fenêtre « Configurer ma diffusion ») : le
 * lien de son stream, et le BattleTag qu'il a donné pour ce cast — qui ne
 * voyage pas dans l'instantané du plateau, commun à tous les lecteurs.
 * Réservé aux casters inscrits sur le match (403 `NOT_MATCH_CASTER` sinon).
 */
export async function GET(_req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  try {
    return ok(await loadOwnCastSettings(matchId, user.id));
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_CAST_SETTINGS_FAILED");
  }
}

/**
 * Régler **son** cast (fenêtre « Configurer ma diffusion ») : mode de passage à
 * l'antenne du match, lien de son stream, BattleTag donné pour ce cast. Réservé
 * aux casters inscrits sur le match (403 `NOT_MATCH_CASTER` sinon) ; chaque
 * champ absent du corps n'est pas touché.
 */
export async function PUT(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  const read = await castBody(req);
  if ("refusal" in read) return fail(read.refusal, 400);
  const settings = parseCastSettings(read.body);
  if (settings === null) return fail("INVALID_CAST_SETTINGS", 400);
  if (settings.asOrganisation === true && !can(user, "tournaments")) return fail("FORBIDDEN", 403);

  try {
    await setCastSettings(matchId, user.id, can(user, "live"), settings, castAccess(user));
    return ok({ casterUserId: user.id });
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_CAST_SETTINGS_FAILED");
  }
}

/**
 * Se désinscrire — ou, pour l'arbitrage (`tournaments`), retirer un caster du
 * match : `?userId=` le désigne (absent : le lecteur lui-même).
 */
export async function DELETE(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  const rawCasterId = new URL(req.url).searchParams.get("userId");
  const casterId = rawCasterId === null ? user.id : Number(rawCasterId);
  if (!isPositiveId(casterId)) return fail("INVALID_USER_ID", 400);

  try {
    await releaseMatchCast(matchId, user.id, can(user, "tournaments"), casterId);
    return ok({ casterUserId: null });
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_CAST_RELEASE_FAILED");
  }
}
