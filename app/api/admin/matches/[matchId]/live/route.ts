import { getCurrentUser, type AuthUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { setMatchLiveConfig, setMatchOnAir, StreamLinkError } from "@/lib/server/tournaments/live-streams";
import { mayConfigureMatchLive, parseStreamLinks } from "@/lib/server/tournaments/live-access";
import { isMatchLiveTrigger, parseOrganisationLink, type MatchLiveTrigger } from "@/lib/shared/live-streams";
import type { MatchStreamLinkEdit } from "@/lib/server/tournaments/live-streams";
import { can } from "@/lib/shared/permissions";
import { castOverseer } from "@/lib/shared/live-trigger-owner";
import { readOptionalJsonObject } from "@/lib/server/request-body";
import { announceStaffMatchAction, staffActionAuthor } from "@/lib/server/tournaments/staff-action-logs";

function parseMatchId(raw: string): number | null {
  const matchId = Number(raw);
  return Number.isInteger(matchId) && matchId > 0 ? matchId : null;
}

/**
 * La porte de la route : `live`, ou l'arbitre désigné du match. Elle lit la
 * base pour l'arbitre : une panne y rend un code (500), jamais une erreur nue.
 */
async function liveGate(user: AuthUser, matchId: number): Promise<Response | null> {
  try {
    return (await mayConfigureMatchLive(user, matchId)) ? null : fail("FORBIDDEN", 403);
  } catch {
    return fail("MATCH_LIVE_UPDATE_FAILED", 500);
  }
}

/** Statut de chaque refus connu du réglage ; tout autre motif est une panne (500). */
const LIVE_ERROR_STATUSES = new Map<string, number>(Object.entries({
  MATCH_NOT_FOUND: 404,
  LIVE_TRIGGER_NOT_OWNED: 403,
  NOT_MATCH_REFEREE: 403,
  NOT_MATCH_CASTER: 403,
  STAFF_STREAM_FORBIDDEN: 403,
  ORGANISATION_LINK_NOT_PROVIDER: 409,
  STREAM_NOT_FOUND: 404,
  INVALID_STREAM_URL: 400,
  INVALID_LIVE_TRIGGER: 400,
  LIVE_TRIGGER_NOT_MANUAL: 409,
  MATCH_NOT_LIVE_READY: 409,
  MATCH_START_AT_REQUIRED: 409,
  MATCH_NOT_CASTABLE: 409,
  MATCH_NOT_STREAMED: 409,
}));

function mapLiveError(error: unknown) {
  const message = (error as Error).message;
  // Un lien de caster refusé dit lequel : la fenêtre rattache le refus à son champ.
  if (error instanceof StreamLinkError) {
    return fail(message, message === "STREAM_NOT_FOUND" ? 404 : 400, { streamId: error.streamId });
  }
  const status = LIVE_ERROR_STATUSES.get(message);
  if (status !== undefined) return fail(message, status);
  return fail(message || "MATCH_LIVE_UPDATE_FAILED", 500);
}

type MatchLiveBody = {
  /** `undefined` (clé absente) : mode inchangé ; `null` explicite : retrait. */
  trigger: MatchLiveTrigger | null | undefined;
  /** `undefined` (clé absente) : lien du staff inchangé. */
  liveUrl: string | null | undefined;
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
  const trigger = body.trigger;
  if (trigger !== null && trigger !== undefined && !isMatchLiveTrigger(trigger)) return "INVALID_LIVE_TRIGGER";
  if (body.liveUrl !== null && body.liveUrl !== undefined && typeof body.liveUrl !== "string") {
    return "INVALID_STREAM_URL";
  }
  const organisationLink = parseOrganisationLink(body.organisationLink);
  if (organisationLink === null) return "INVALID_ORGANISATION_LINK";
  const streamLinks = parseStreamLinks(body.streamLinks);
  if (streamLinks === null) return "INVALID_STREAM_LINKS";
  return {
    trigger,
    liveUrl: body.liveUrl as string | null | undefined,
    organisationLink,
    streamLinks,
  };
}

/**
 * Le corps d'une requête de cette route, en objet : un corps illisible (JSON
 * cassé, trop lourd, mauvais type) est refusé (`INVALID_LIVE_BODY`, ou le code
 * de la lecture bornée), jamais pris pour un corps vide.
 */
async function readLiveRecord(req: Request): Promise<Record<string, unknown> | Response> {
  // Un JSON qui n'est pas un objet (`null`, nombre, chaîne, tableau) n'est pas
  // un réglage : refusé, jamais pris pour un corps vide.
  const read = await readOptionalJsonObject(req, "INVALID_LIVE_BODY");
  return "refusal" in read ? fail(read.refusal, 400) : read.body;
}

/** Le réglage lu et vérifié, ou la réponse de refus (400). */
async function readMatchLiveBody(req: Request): Promise<MatchLiveBody | Response> {
  const body = await readLiveRecord(req);
  if (body instanceof Response) return body;
  const parsed = parseMatchLiveBody(body);
  return typeof parsed === "string" ? fail(parsed, 400) : parsed;
}

/**
 * Configure la diffusion d'un match.
 * Corps : `{ trigger?: "AUTO" | "START_TIME" | "MANUAL" | null, liveUrl?: string | null,
 * organisationLink?: boolean }`.
 * `trigger: null` démarque le match (et efface lien et antenne) ; une clé
 * `trigger` (ou `liveUrl`) absente laisse le mode (ou le lien du staff) tel
 * quel — un envoi des seuls `streamLinks` ne retire rien ; `START_TIME`
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
 * l'arbitre désigné ou le staff `tournaments` + `live` (`LIVE_TRIGGER_NOT_OWNED`, 403) ; sans
 * maître, pour ce staff, l'arbitre et les casters du match (sauf quand le match
 * porte le lien de l'organisation), dont celui qui le change devient le maître. Un porteur de la seule `live` ne règle que son
 * cast : sans caster le match, `NOT_MATCH_CASTER` (403) ; le lien du staff
 * ne lui est pas ouvert (`STAFF_STREAM_FORBIDDEN`, 403). L'arbitre
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
  const gate = await liveGate(user, matchId);
  if (gate !== null) return gate;

  const parsed = await readMatchLiveBody(req);
  if (parsed instanceof Response) return parsed;
  const { trigger, streamLinks } = parsed;
  const organisation = can(user, "tournaments");
  // Même refus que la route du caster (`castOrganisationLinkRefusal`, D7).
  if (parsed.organisationLink && !organisation) return fail("STAFF_STREAM_FORBIDDEN", 403);

  try {
    // Le lien posé reste rattaché à qui le pose, sauf quand un membre de
    // l'organisation le dit « de l'organisation » (case de la fenêtre, décochée
    // par défaut) : la suppression de son compte retire sa chaîne à lui, jamais
    // celle de l'organisation (`withdrawUserCasts`).
    const { previousTrigger, changed } = await setMatchLiveConfig(matchId, {
      trigger,
      liveUrl: parsed.liveUrl,
      setter: { userId: user.id, asOrganisation: organisation && parsed.organisationLink },
      access: { oversees: castOverseer(organisation, can(user, "live")), manages: organisation, live: can(user, "live") },
      ...(streamLinks === undefined ? {} : { streamLinks }),
    });
    const removed = trigger === null && previousTrigger !== null;
    // Rien d'écrit (réglage réenregistré tel quel) : rien à annoncer.
    if (changed) {
      announceStaffMatchAction(matchId, removed ? "LIVE_REMOVED" : "LIVE_CONFIGURED", staffActionAuthor(user));
    }
    // Mode absent du corps : inchangé, la réponse dit celui qui reste.
    return ok({ trigger: trigger === undefined ? previousTrigger : trigger });
  } catch (error) {
    return mapLiveError(error);
  }
}

/**
 * Ouvre ou ferme l'antenne d'un match en mode `MANUAL`.
 * Corps : `{ onAir: boolean }`. Même règle que le changement du mode : son
 * caster, l'arbitre désigné ou le staff `tournaments` + `live` (les casters du
 * match aussi pour un mode sans propriétaire) — `LIVE_TRIGGER_NOT_OWNED` (403) pour un co-caster.
 */
export async function POST(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { matchId: rawMatchId } = await context.params;
  const matchId = parseMatchId(rawMatchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);
  const gate = await liveGate(user, matchId);
  if (gate !== null) return gate;

  const body = await readLiveRecord(req);
  if (body instanceof Response) return body;
  if (typeof body.onAir !== "boolean") return fail("INVALID_ON_AIR", 400);

  try {
    // Un double clic (déjà à l'antenne, ou déjà hors antenne) ne se journalise pas.
    const manages = can(user, "tournaments");
    const access = { oversees: castOverseer(manages, can(user, "live")), manages, live: can(user, "live") };
    if (await setMatchOnAir(matchId, body.onAir, user.id, access)) {
      announceStaffMatchAction(matchId, body.onAir ? "ON_AIR" : "OFF_AIR", staffActionAuthor(user));
    }
    return ok({ onAir: body.onAir });
  } catch (error) {
    return mapLiveError(error);
  }
}
