import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { listGhostTeams } from "@/lib/server/ghost-teams-service";
import { registerGhostTeams } from "@/lib/server/tournaments-service";
import { parseGhostBatch, registrationErrorTeamId } from "@/lib/shared/ghost-registration";
import { can } from "@/lib/shared/permissions";

function readTournamentId(raw: string): number | null {
  const tournamentId = Number(raw);
  return Number.isInteger(tournamentId) && tournamentId > 0 ? tournamentId : null;
}

/**
 * Équipes fantômes encore disponibles pour ce tournoi.
 *
 * Les déjà engagées sont retirées **en base** : les reproposer ne pouvait mener
 * qu'à un `ALREADY_REGISTERED` après l'aller-retour, et sur un lot une seule
 * d'entre elles ferait échouer toute la sélection.
 */
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const tournamentId = readTournamentId(id);
  if (tournamentId === null) return fail("INVALID_TOURNAMENT_ID", 400);

  return ok({ teams: await listGhostTeams(tournamentId) });
}

/**
 * Inscrit un lot d'équipes fantômes au tournoi, sans passer par le flux joueur.
 *
 * Volontairement limité aux équipes fantômes : le staff n'inscrit jamais
 * l'équipe d'un joueur réel — ni une entrée solo — à sa place. Le contrôle est
 * fait dans la transaction (`registerTeamsByIds`), au plus près de l'écriture,
 * plutôt qu'ici : cocher trente lignes prend du temps, et une fantôme peut être
 * attribuée entre l'affichage de la liste et la validation.
 *
 * **Tout ou rien** : la transaction entière est défaite au premier refus, et le
 * corps de l'erreur nomme l'engagé en cause quand le refus le désigne.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const tournamentId = readTournamentId(id);
  if (tournamentId === null) return fail("INVALID_TOURNAMENT_ID", 400);

  const body = (await req.json().catch(() => ({}))) as { teamIds?: unknown };
  const selection = parseGhostBatch(body.teamIds);
  if (!selection.ok) return fail(selection.error, 400);

  try {
    await registerGhostTeams(tournamentId, selection.teamIds);
    return ok({ success: true, registered: selection.teamIds.length }, 201);
  } catch (error) {
    const message = (error as Error).message;
    // Le refus qui désigne un engagé le joint au corps : le dialogue retrouve
    // son nom dans sa propre liste et le nomme dans le toast.
    const teamId = registrationErrorTeamId(error);
    const details = teamId === undefined ? undefined : { teamId };

    if (message === "TOURNAMENT_NOT_FOUND" || message === "TEAM_NOT_FOUND") {
      return fail(message, 404, details);
    }
    if (
      message === "REGISTRATION_CLOSED"
      || message === "TOURNAMENT_FULL"
      || message === "ALREADY_REGISTERED"
      || message === "TEAM_ALREADY_DELETED"
      || message === "NOT_A_GHOST_TEAM"
    ) {
      return fail(message, 409, details);
    }
    return fail(message || "GHOST_REGISTRATION_FAILED", 500);
  }
}
