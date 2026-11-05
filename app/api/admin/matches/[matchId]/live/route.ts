import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { setMatchLiveConfig, setMatchOnAir, StreamLinkError } from "@/lib/server/tournaments/live-streams";
import { mayConfigureMatchLive, parseStreamLinks } from "@/lib/server/tournaments/live-access";
import { isMatchLiveTrigger, type MatchLiveTrigger } from "@/lib/shared/live-streams";
import type { MatchStreamLinkEdit } from "@/lib/server/tournaments/live-streams";
import { can } from "@/lib/shared/permissions";
import { readJsonBody } from "@/lib/server/request-body";
import { announceStaffMatchAction, staffActionAuthor } from "@/lib/server/tournaments/staff-action-logs";

function parseMatchId(raw: string): number | null {
  const matchId = Number(raw);
  return Number.isInteger(matchId) && matchId > 0 ? matchId : null;
}

function mapLiveError(error: unknown) {
  const message = (error as Error).message;
  // Un lien de caster refusé dit lequel : la fenêtre rattache le refus à son champ.
  if (error instanceof StreamLinkError) {
    return fail(message, message === "STREAM_NOT_FOUND" ? 404 : 400, { streamId: error.streamId });
  }
  if (message === "MATCH_NOT_FOUND") return fail(message, 404);
  if (message === "LIVE_TRIGGER_NOT_OWNED") return fail(message, 403);
  if (message === "NOT_MATCH_REFEREE") return fail(message, 403);
  if (message === "STREAM_NOT_FOUND") return fail(message, 404);
  if (message === "INVALID_STREAM_URL") return fail(message, 400);
  if (message === "INVALID_LIVE_TRIGGER") return fail(message, 400);
  if (message === "LIVE_TRIGGER_NOT_MANUAL") return fail(message, 409);
  if (message === "MATCH_NOT_LIVE_READY") return fail(message, 409);
  if (message === "MATCH_START_AT_REQUIRED") return fail(message, 409);
  if (message === "MATCH_NOT_CASTABLE") return fail(message, 409);
  return fail(message || "MATCH_LIVE_UPDATE_FAILED", 500);
}

type MatchLiveBody = {
  trigger: MatchLiveTrigger | null;
  liveUrl: string | null;
  organisationLink: boolean;
  streamLinks: MatchStreamLinkEdit[] | undefined;
};

/** Lit le corps du réglage ; un code de refus (400) s'il est illisible. */
function parseMatchLiveBody(body: {
  trigger?: unknown;
  liveUrl?: unknown;
  organisationLink?: unknown;
  streamLinks?: unknown;
}): MatchLiveBody | string {
  const trigger = body.trigger ?? null;
  if (trigger !== null && !isMatchLiveTrigger(trigger)) return "INVALID_LIVE_TRIGGER";
  if (body.liveUrl !== null && body.liveUrl !== undefined && typeof body.liveUrl !== "string") {
    return "INVALID_STREAM_URL";
  }
  if (body.organisationLink !== undefined && typeof body.organisationLink !== "boolean") {
    return "INVALID_ORGANISATION_LINK";
  }
  const streamLinks = parseStreamLinks(body.streamLinks);
  if (streamLinks === null) return "INVALID_STREAM_LINKS";
  return {
    trigger,
    liveUrl: (body.liveUrl as string | undefined) ?? null,
    organisationLink: body.organisationLink === true,
    streamLinks,
  };
}

/**
 * Configure la diffusion d'un match.
 * Corps : `{ trigger: "AUTO" | "START_TIME" | "MANUAL" | null, liveUrl?: string | null,
 * organisationLink?: boolean }`.
 * `trigger: null` démarque le match (et efface lien et antenne) ; `START_TIME`
 * exige une date de début déjà posée sur le match (409 sinon) ; un match qui ne
 * peut plus passer à l'antenne et n'est pas déjà casté refuse tout réglage
 * (`MATCH_NOT_CASTABLE`, 409) ; déjà casté, il ne peut plus qu'être démarqué.
 *
 * `organisationLink` dit de qui est le lien posé : `true` pour un
 * membre de l'organisation (permission `tournaments`) = le lien de
 * l'organisation, qui reste au match ; `false` (ou absent) = sa propre chaîne,
 * qui part avec son compte. Sans la permission `tournaments`, le lien est toujours le sien, et
 * `true` est refusé (403) plutôt que silencieusement ignoré.
 *
 * Le mode d'antenne déjà posé ne change que pour le caster qui l'a posé,
 * l'arbitre désigné ou un admin (`LIVE_TRIGGER_NOT_OWNED`, 403). L'arbitre
 * désigné du match est admis même sans `live`, et lui seul peut envoyer
 * `streamLinks: [{ streamId, liveUrl }]` — les liens des streams des casters
 * (`NOT_MATCH_REFEREE`, 403, pour tout autre) ; un lien refusé rend le
 * `streamId` fautif avec son code.
 *
 * Le journal du staff ne dit « retiré » (`LIVE_REMOVED`) que d'un mode qui
 * était posé : un arbitre qui corrige les seuls liens des casters d'un match
 * sans mode règle la diffusion, il ne la retire pas.
 */
export async function PUT(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { matchId: rawMatchId } = await context.params;
  const matchId = parseMatchId(rawMatchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);
  if (!(await mayConfigureMatchLive(user, matchId))) return fail("FORBIDDEN", 403);

  const body = (await readJsonBody(req).catch(() => ({}))) as {
    trigger?: unknown;
    liveUrl?: unknown;
    organisationLink?: unknown;
    streamLinks?: unknown;
  };

  const parsed = parseMatchLiveBody(body);
  if (typeof parsed === "string") return fail(parsed, 400);
  const { trigger, streamLinks } = parsed;
  const organisation = can(user, "tournaments");
  if (parsed.organisationLink && !organisation) return fail("FORBIDDEN", 403);

  try {
    // Le lien posé reste rattaché à qui le pose, sauf quand un membre de
    // l'organisation le dit « de l'organisation » (case de la fenêtre, décochée
    // par défaut) : la suppression de son compte retire sa chaîne à lui, jamais
    // celle de l'organisation (`withdrawUserCasts`).
    const { previousTrigger, changed } = await setMatchLiveConfig(matchId, {
      trigger,
      liveUrl: parsed.liveUrl,
      setter: { userId: user.id, asOrganisation: organisation && parsed.organisationLink },
      access: { isAdmin: user.isAdmin, manages: organisation, live: can(user, "live") },
      ...(streamLinks === undefined ? {} : { streamLinks }),
    });
    const removed = trigger === null && previousTrigger !== null;
    // Rien d'écrit (réglage réenregistré tel quel) : rien à annoncer.
    if (changed) {
      announceStaffMatchAction(matchId, removed ? "LIVE_REMOVED" : "LIVE_CONFIGURED", staffActionAuthor(user));
    }
    return ok({ trigger });
  } catch (error) {
    return mapLiveError(error);
  }
}

/**
 * Ouvre ou ferme l'antenne d'un match en mode `MANUAL`.
 * Corps : `{ onAir: boolean }`. Même règle que le changement du mode : son
 * caster, l'arbitre désigné ou un admin (le staff `tournaments` pour un mode
 * sans propriétaire) — `LIVE_TRIGGER_NOT_OWNED` (403) pour un co-caster.
 */
export async function POST(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { matchId: rawMatchId } = await context.params;
  const matchId = parseMatchId(rawMatchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);
  if (!(await mayConfigureMatchLive(user, matchId))) return fail("FORBIDDEN", 403);

  const body = (await readJsonBody(req).catch(() => ({}))) as { onAir?: unknown };
  if (typeof body.onAir !== "boolean") return fail("INVALID_ON_AIR", 400);

  try {
    // Un double clic (déjà à l'antenne, ou déjà hors antenne) ne se journalise pas.
    const access = { isAdmin: user.isAdmin, manages: can(user, "tournaments"), live: can(user, "live") };
    if (await setMatchOnAir(matchId, body.onAir, user.id, access)) {
      announceStaffMatchAction(matchId, body.onAir ? "ON_AIR" : "OFF_AIR", staffActionAuthor(user));
    }
    return ok({ onAir: body.onAir });
  } catch (error) {
    return mapLiveError(error);
  }
}
