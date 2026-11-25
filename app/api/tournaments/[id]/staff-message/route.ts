import { enforceRateLimit } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { readJsonObject, SMALL_JSON_BODY_MAX_BYTES } from "@/lib/server/request-body";
import { siteBaseUrl } from "@/lib/server/site-url";
import {
  countTournamentStaffMessageRecipients,
  previewTournamentStaffMessage,
  sendTournamentStaffMessage,
  STAFF_MESSAGE_SITE_CALL_RULE,
  StaffMessageError,
} from "@/lib/server/tournament-staff-message";
import { can } from "@/lib/shared/permissions";
import {
  parseStaffMessageCategories,
  parseStaffMessageDraft,
  parseTournamentId,
  STAFF_MESSAGE_ERRORS,
  type StaffMessageCategory,
  type StaffMessageDraft,
} from "@/lib/shared/tournament-staff-message";

type SiteRequest = { mode: "count"; categories: StaffMessageCategory[] } | StaffMessageDraft;

/** Le décompte (`count`) ne porte que les catégories ; aperçu et envoi, le texte aussi. */
function parseSiteRequest(body: Record<string, unknown>): SiteRequest | string {
  if (body.mode !== "count") return parseStaffMessageDraft(body);
  const categories = parseStaffMessageCategories(body.categories);
  return categories ? { mode: "count", categories } : STAFF_MESSAGE_ERRORS.invalidCategories;
}

/**
 * `POST /api/tournaments/[id]/staff-message` — bouton « Message aux
 * participants » de la fiche d'un tournoi : la porte du site de
 * `/message-tournoi`. Session exigée, provenance vérifiée par le middleware
 * (écriture sous `/api/`), permission `tournaments`. Corps :
 * `{ mode: "count", categories }` (décompte en direct de la fenêtre, avec la
 * racine des liens du message privé, `linkBase`) ou
 * `{ mode: "preview" | "send", categories, message }`. Même service que la
 * route interne du bot (`lib/server/tournament-staff-message.ts`) : mêmes
 * destinataires, même plafond, même journal. Rend des **nombres** — jamais un
 * nom ni un identifiant de destinataire.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const tournamentId = parseTournamentId(id);
  if (!tournamentId) return fail(STAFF_MESSAGE_ERRORS.invalidTournament, 400);

  if (!can(user, "tournaments")) return fail(STAFF_MESSAGE_ERRORS.forbidden, 403);

  const read = await readJsonObject(req, STAFF_MESSAGE_ERRORS.invalidRequest, SMALL_JSON_BODY_MAX_BYTES);
  if ("refusal" in read) return fail(read.refusal, 400);
  const parsed = parseSiteRequest(read.body);
  if (typeof parsed === "string") return fail(parsed, 400);

  const throttled = enforceRateLimit(STAFF_MESSAGE_SITE_CALL_RULE, user.id);
  if (throttled) return throttled;

  const author = { userId: user.id };
  try {
    if (parsed.mode === "count") {
      // `linkBase` : la racine des liens du message privé (`APP_URL`, `null` sans
      // elle) — la fenêtre mesure le message rendu sur la même base que le serveur.
      const counted = await countTournamentStaffMessageRecipients({ author, tournamentId, categories: parsed.categories });
      return ok({ mode: "count", ...counted, linkBase: siteBaseUrl() });
    }
    const request = { author, tournamentId, categories: parsed.categories, message: parsed.message };
    if (parsed.mode === "preview") {
      return ok({ mode: "preview", ...(await previewTournamentStaffMessage(request)) });
    }
    return ok({ mode: "send", ...(await sendTournamentStaffMessage(request)) });
  } catch (error) {
    if (error instanceof StaffMessageError) return fail(error.message, error.status);
    console.error("[staff-message] échec de la route du site", error instanceof Error ? error.name : typeof error);
    return fail("INTERNAL_ERROR", 500);
  }
}
