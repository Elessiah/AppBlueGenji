import { getCurrentUser } from "@/lib/server/auth";
import { sendBotLog } from "@/lib/server/bot-integration";
import { fail, ok } from "@/lib/server/http";
import { rollbackCurrentRound } from "@/lib/server/tournaments/rollback";
import { formatRoundRolledBackLog } from "@/lib/shared/bot-logs";
import { can } from "@/lib/shared/permissions";

/**
 * Efface le dernier stade joué du tournoi et le ramène à l'instant qui le
 * précède.
 *
 * Le geste est **répétable** : chaque appel recule d'un stade, du dernier joué
 * jusqu'au premier. C'est ce qui en fait un outil de rattrapage plutôt qu'un
 * bouton de dernier recours — une erreur se répare d'un cran ou deux, on ne
 * recommence pas un tournoi.
 *
 * Réservé au staff `tournaments` (administrateur ou arbitre), comme l'arbitrage
 * des scores dont ce geste n'est que la version en gros : c'est l'arbitre qui
 * tient le plateau un soir de tournoi, et qui découvre qu'une manche a été
 * saisie sur de mauvais appariements. La suppression définitive reste le seul
 * geste du domaine à exiger `isAdmin`, parce qu'elle, rien ne la rejoue.
 *
 * Le stade défait n'est pas **choisi**, il est *déduit* du plateau
 * (`lib/shared/tournament-rollback.ts`) : laisser le client le désigner ouvrirait
 * la porte à défaire une manche du milieu du tournoi, que rien ne rejouerait
 * ensuite. Le corps ne porte donc qu'un `expectedStage` facultatif — le stade
 * que l'écran a **montré**, à confronter à celui que le verrou trouve. C'est un
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
  // s'en remet au stade que la base désignera.
  const expectedStage = await readExpectedStage(request);

  try {
    const rolledBack = await rollbackCurrentRound(tournamentId, { expectedStage });

    // Après le commit, et au meilleur effort : le bot est optionnel, le stade
    // est déjà effacé, il n'y a rien à annuler si le message ne part pas.
    void sendBotLog(
      formatRoundRolledBackLog({
        tournament: { id: rolledBack.tournamentId, name: rolledBack.tournamentName },
        roundLabel: rolledBack.label,
        clearedMatches: rolledBack.clearedMatches,
        reopenedTournament: rolledBack.reopenedTournament,
        actorPseudo: user.pseudo,
        actorId: user.id,
      }),
    ).catch(() => undefined);

    return ok({ rolledBack });
  } catch (error) {
    const message = (error as Error).message;

    if (message === "TOURNAMENT_NOT_FOUND") return fail(message, 404);

    // 409 : la demande est bien formée, c'est l'état du tournoi qui la contredit.
    if (
      message === "ROLLBACK_TOURNAMENT_NOT_STARTED" ||
      message === "ROLLBACK_ROUND_CHANGED" ||
      message === "ROLLBACK_NOTHING_TO_UNDO"
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
 * Longueur maximale d'une clé de stade.
 *
 * Une clé s'écrit `"<rang de phase>:<index>"` — huit caractères en pratique. La
 * borne n'est pas une validation de forme (le serveur se contente de comparer
 * deux chaînes) mais une limite de ce qu'on accepte de lire d'un corps de
 * requête ; une clé plus longue ne peut de toute façon correspondre à rien.
 */
const MAX_STAGE_KEY_LENGTH = 32;

/**
 * Stade annoncé par le client, ou `undefined`.
 *
 * Tolérant par construction : ni corps, ni JSON valide, ni chaîne plausible ne
 * sont des erreurs — le geste retombe alors sur ce que la base désigne, ce qui
 * est exactement le comportement d'avant le garde-fou.
 */
async function readExpectedStage(request: Request): Promise<string | undefined> {
  try {
    const body = (await request.json()) as { expectedStage?: unknown };
    const stage = body?.expectedStage;
    if (typeof stage !== "string") return undefined;
    return stage.length > 0 && stage.length <= MAX_STAGE_KEY_LENGTH ? stage : undefined;
  } catch {
    return undefined;
  }
}
