import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import {
  loadEditableTournament,
  updateTournament,
  type EditableTournamentValues,
} from "@/lib/server/tournaments-service";
import { ALL_TOURNAMENT_FIELDS } from "@/lib/shared/tournament-edit";
import { can } from "@/lib/shared/permissions";
import { NextResponse } from "next/server";
import { readJsonBodyOrFallback } from "@/lib/server/request-body";
import { announceStaffTournamentAction } from "@/lib/server/tournaments/staff-action-logs";

/**
 * Édition d'un tournoi. `GET` rend la fenêtre d'édition et les valeurs à
 * préremplir, `PATCH` applique une modification partielle.
 *
 * Les deux sont réservés au staff `tournaments`, organisateur ou non : c'est la
 * règle déjà appliquée à l'arbitrage des scores.
 */

/** Identifiant de tournoi valide, ou `null`. */
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function guard(
  idRaw: string,
): Promise<{ error: NextResponse; id?: never } | { error?: never; id: number }> {
  const user = await getCurrentUser();
  if (!user) return { error: fail("UNAUTHORIZED", 401) };
  if (!can(user, "tournaments")) return { error: fail("FORBIDDEN", 403) };

  const id = parseId(idRaw);
  if (id === null) return { error: fail("INVALID_TOURNAMENT_ID", 400) };

  return { id };
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const checked = await guard(id);
  if (checked.error) return checked.error;

  const loaded = await loadEditableTournament(checked.id);
  if (!loaded) return fail("TOURNAMENT_NOT_FOUND", 404);

  return ok(loaded);
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const checked = await guard(id);
  if (checked.error) return checked.error;

  const read = await readJsonBodyOrFallback(req, {});
  if ("refusal" in read) return read.refusal;
  const body = read.body as Record<string, unknown>;

  // Liste blanche : le corps ne peut porter que des champs éditables connus.
  // Recopier le corps tel quel laisserait un client écrire n'importe quelle
  // colonne que le service viendrait à accepter plus tard.
  const patch: Partial<EditableTournamentValues> = {};
  for (const field of ALL_TOURNAMENT_FIELDS) {
    if (body[field] !== undefined) {
      (patch as Record<string, unknown>)[field] = body[field];
    }
  }

  if (Object.keys(patch).length === 0) return fail("EMPTY_PATCH", 400);

  try {
    const { previousName, name } = await updateTournament(checked.id, patch);
    // La ligne nomme le tournoi sous le nom que ce geste a écrit (pas celui d'un
    // renommage qui le suivrait) ; un renommage cite aussi l'ancien.
    announceStaffTournamentAction(checked.id, "EDITED", patch.name === undefined ? { name } : { previousName, name });
    return ok({ success: true });
  } catch (error) {
    return updateFailureResponse(error);
  }
}

/** Rend le refus d'une modification sous son code (409, 404, 400), le reste en 500. */
function updateFailureResponse(error: unknown): Response {
  const message = (error as Error).message;

  if (message.startsWith("FIELD_NOT_EDITABLE:")) {
    return NextResponse.json(
      { error: "FIELD_NOT_EDITABLE", field: message.slice("FIELD_NOT_EDITABLE:".length) },
      { status: 409 },
    );
  }
  if (message === "TOURNAMENT_LOCKED" || message === "MAP_POINTS_LOCKED") return fail(message, 409);
  if (message === "TOURNAMENT_NOT_FOUND") return fail(message, 404);
  if (message.startsWith("INVALID_") || message.startsWith("MISSING_") ||
      message === "MAX_TEAMS_CANNOT_DECREASE" ||
      message === "REGISTRATION_CLOSE_IN_PAST" ||
      message === "DOUBLE_MUST_BE_LAST_PHASE") {
    return fail(message, 400);
  }

  return fail("TOURNAMENT_UPDATE_FAILED", 500);
}
