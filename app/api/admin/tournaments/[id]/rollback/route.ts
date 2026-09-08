import { getCurrentUser } from "@/lib/server/auth";
import { sendBotLog } from "@/lib/server/bot-integration";
import { fail, ok } from "@/lib/server/http";
import { rollbackCurrentRound } from "@/lib/server/tournaments/rollback";
import { formatRoundRolledBackLog } from "@/lib/shared/bot-logs";
import { can } from "@/lib/shared/permissions";
import { rollbackRoundLabelWithArticle } from "@/lib/shared/tournament-rollback";

/**
 * Efface la manche courante du tournoi et le ramène à l'instant qui la précède.
 *
 * Réservé au staff `tournaments` (administrateur ou arbitre), comme l'arbitrage
 * des scores dont ce geste n'est que la version en gros : c'est l'arbitre qui
 * tient le plateau un soir de tournoi, et qui découvre qu'une manche a été
 * saisie sur de mauvais appariements. La suppression définitive reste le seul
 * geste du domaine à exiger `isAdmin`, parce qu'elle, rien ne la rejoue.
 *
 * La manche défaite n'est pas **choisie**, elle est *déduite* du plateau
 * (`lib/shared/tournament-rollback.ts`) : laisser le client la désigner ouvrirait
 * la porte à défaire une manche du milieu du tournoi, que rien ne rejouerait
 * ensuite. Le corps ne porte donc qu'un `expectedRound` facultatif — la manche
 * que l'écran a **montrée**, à confronter à celle que le verrou trouve. C'est un
 * garde-fou de concurrence, pas un choix : il ne peut que faire refuser le
 * geste, jamais le déplacer.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  // Corps facultatif : un client qui n'en envoie pas (ou en envoie un illisible)
  // s'en remet à la manche que la base désignera.
  const expectedRound = await readExpectedRound(request);

  try {
    const rolledBack = await rollbackCurrentRound(tournamentId, { expectedRound });

    // Après le commit, et au meilleur effort : le bot est optionnel, la manche
    // est déjà effacée, il n'y a rien à annuler si le message ne part pas.
    void sendBotLog(
      formatRoundRolledBackLog({
        tournament: { id: rolledBack.tournamentId, name: rolledBack.tournamentName },
        roundLabel: rollbackRoundLabelWithArticle(rolledBack.roundNumber),
        clearedMatches: rolledBack.clearedMatches,
        actorPseudo: user.pseudo,
        actorId: user.id,
      }),
    ).catch(() => undefined);

    return ok({ rolledBack });
  } catch (error) {
    const message = (error as Error).message;

    if (message === "TOURNAMENT_NOT_FOUND") return fail(message, 404);

    // 409 : la demande est bien formée, c'est l'état du tournoi (ou son format)
    // qui la contredit.
    if (
      message === "TOURNAMENT_NOT_RUNNING" ||
      message === "ROLLBACK_ROUND_CHANGED" ||
      message === "ROLLBACK_UNSUPPORTED_FORMAT" ||
      message === "ROLLBACK_NOTHING_TO_UNDO" ||
      message === "ROLLBACK_PLAYOFFS_STARTED"
    ) {
      return fail(message, 409);
    }

    // Même précaution que la suppression et le lancement anticipé : le texte
    // d'une erreur mysql2 est anglais et parle du moteur. Il reste au journal du
    // serveur, où il sert à quelque chose.
    console.error(`[tournaments] retour en arrière du tournoi ${tournamentId} échoué :`, error);
    return fail("ROLLBACK_FAILED", 500);
  }
}

/**
 * Manche annoncée par le client, ou `undefined`.
 *
 * Tolérant par construction : ni corps, ni JSON valide, ni entier positif ne
 * sont des erreurs — le geste retombe alors sur ce que la base désigne, ce qui
 * est exactement le comportement d'avant le garde-fou.
 */
async function readExpectedRound(request: Request): Promise<number | undefined> {
  try {
    const body = (await request.json()) as { expectedRound?: unknown };
    const round = Number(body?.expectedRound);
    return Number.isInteger(round) && round > 0 ? round : undefined;
  } catch {
    return undefined;
  }
}
