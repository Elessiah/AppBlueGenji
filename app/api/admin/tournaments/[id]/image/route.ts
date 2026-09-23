import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import {
  removeTournamentImage,
  setTournamentImage,
  updateTournamentImageSettings,
} from "@/lib/server/tournaments/image";
import { can } from "@/lib/shared/permissions";
import { checkTournamentImageSettings } from "@/lib/shared/tournament-image";

/**
 * Illustration ou logo d'un tournoi (`lib/shared/tournament-image.ts`).
 *
 * - `POST` (multipart) : `file`, et facultativement `fit`, `focusX`, `focusY` —
 *   pose ou remplace l'image ;
 * - `PATCH` (JSON) : `{ fit, focusX, focusY }` — change le cadrage seul ;
 * - `DELETE` : retire l'image.
 *
 * Permission `tournaments`, comme la chaîne officielle : l'image habille
 * l'annonce du tournoi, elle engage l'organisation. Aucune garde d'état — elle
 * est décorative et ne touche à aucune règle du moteur.
 */

type RouteContext = { params: Promise<{ id: string }> };

/** Refus d'image connus, tous des erreurs de saisie (400). */
const IMAGE_INPUT_ERRORS = new Set([
  "FILE_MISSING",
  "IMAGE_TOO_LARGE",
  "IMAGE_FORMAT_INVALID",
  "IMAGE_DIMENSIONS_INVALID",
  "IMAGE_ANIMATED_NOT_SUPPORTED",
]);

async function authorize(context: RouteContext): Promise<{ tournamentId: number } | Response> {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }
  return { tournamentId };
}

function mapFailure(error: unknown, fallback: string): Response {
  const message = (error as Error).message;
  if (message === "TOURNAMENT_NOT_FOUND") return fail(message, 404);
  if (message === "TOURNAMENT_IMAGE_MISSING") return fail(message, 409);
  if (IMAGE_INPUT_ERRORS.has(message)) return fail(message, 400);
  // Une erreur inattendue (sharp, disque, base) ne part pas telle quelle : son
  // message peut nommer un chemin ou une table.
  console.error("[tournament-image]", error);
  return fail(fallback, 500);
}

export async function POST(req: Request, context: RouteContext) {
  const auth = await authorize(context);
  if (auth instanceof Response) return auth;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("FILE_MISSING", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail("FILE_MISSING", 400);

  const settings = checkTournamentImageSettings({
    fit: form.get("fit") ?? undefined,
    focusX: form.get("focusX") ?? undefined,
    focusY: form.get("focusY") ?? undefined,
  });
  if (!settings.ok) return fail(settings.error, 400);

  try {
    const image = await setTournamentImage(auth.tournamentId, file, settings.value);
    return ok({ image });
  } catch (error) {
    return mapFailure(error, "TOURNAMENT_IMAGE_UPLOAD_FAILED");
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  const auth = await authorize(context);
  if (auth instanceof Response) return auth;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (body === null || typeof body !== "object") return fail("INVALID_IMAGE_FIT", 400);

  // Au PATCH, les trois champs sont **exigés**, et typés : `checkTournamentImageSettings`
  // tient un champ absent, `null` ou vide pour le défaut (un fichier seul doit
  // suffire au POST), ce qui recentrerait ici l'image en silence. Un corps JSON
  // n'a aucune raison de porter autre chose qu'une chaîne et deux nombres.
  if (typeof body.fit !== "string") return fail("INVALID_IMAGE_FIT", 400);
  if (typeof body.focusX !== "number" || typeof body.focusY !== "number") {
    return fail("INVALID_IMAGE_FOCUS", 400);
  }

  const settings = checkTournamentImageSettings(body);
  if (!settings.ok) return fail(settings.error, 400);

  try {
    const image = await updateTournamentImageSettings(auth.tournamentId, settings.value);
    return ok({ image });
  } catch (error) {
    return mapFailure(error, "TOURNAMENT_IMAGE_UPDATE_FAILED");
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  const auth = await authorize(context);
  if (auth instanceof Response) return auth;

  try {
    await removeTournamentImage(auth.tournamentId);
    return ok({ image: null });
  } catch (error) {
    return mapFailure(error, "TOURNAMENT_IMAGE_DELETE_FAILED");
  }
}
