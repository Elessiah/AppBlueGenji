import { enforceRateLimit } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { rejectWithoutSiteInternalToken } from "@/lib/server/internal-token";
import { readJsonObject, SMALL_JSON_BODY_MAX_BYTES } from "@/lib/server/request-body";
import {
  previewTournamentStaffMessage,
  sendTournamentStaffMessage,
  STAFF_MESSAGE_CALL_RULE,
  StaffMessageError,
  type StaffMessageRequest,
} from "@/lib/server/tournament-staff-message";
import {
  parseDiscordUserId,
  parseStaffMessageDraft,
  parseTournamentId,
  STAFF_MESSAGE_ERRORS,
  type StaffMessageMode,
} from "@/lib/shared/tournament-staff-message";

function parseRequest(
  body: Record<string, unknown>,
): { mode: StaffMessageMode; discordId: string; request: StaffMessageRequest } | string {
  const draft = parseStaffMessageDraft(body);
  if (typeof draft === "string") return draft;
  const discordId = parseDiscordUserId(body.discordId);
  if (!discordId) return STAFF_MESSAGE_ERRORS.invalidDiscordId;
  const tournamentId = parseTournamentId(body.tournamentId);
  if (!tournamentId) return STAFF_MESSAGE_ERRORS.invalidTournament;
  const { mode, categories, message } = draft;
  return { mode, discordId, request: { author: { discordId }, tournamentId, categories, message } };
}

/**
 * `POST /api/internal/tournament-message` — appelé par le bot seul
 * (`/message-tournoi`), jeton `SITE_INTERNAL_TOKEN` exigé. Sans session ni
 * cookie : la provenance du middleware ne s'y oppose pas (aucun `Origin` côté
 * serveur), et un navigateur n'a pas le jeton. Rend des **nombres** — jamais un
 * nom ni un identifiant de destinataire.
 */
export async function POST(req: Request) {
  const refused = rejectWithoutSiteInternalToken(req);
  if (refused) return refused;

  const read = await readJsonObject(req, STAFF_MESSAGE_ERRORS.invalidRequest, SMALL_JSON_BODY_MAX_BYTES);
  if ("refusal" in read) return fail(read.refusal, 400);
  const parsed = parseRequest(read.body);
  if (typeof parsed === "string") return fail(parsed, 400);

  const throttled = enforceRateLimit(STAFF_MESSAGE_CALL_RULE, parsed.discordId);
  if (throttled) return throttled;

  try {
    if (parsed.mode === "preview") {
      return ok({ mode: "preview", ...(await previewTournamentStaffMessage(parsed.request)) });
    }
    return ok({ mode: "send", ...(await sendTournamentStaffMessage(parsed.request)) });
  } catch (error) {
    if (error instanceof StaffMessageError) return fail(error.message, error.status);
    console.error("[staff-message] échec de la route", error instanceof Error ? error.name : typeof error);
    return fail("INTERNAL_ERROR", 500);
  }
}
