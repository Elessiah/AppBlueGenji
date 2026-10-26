/**
 * Annulation d'un abandon de tournoi par un administrateur
 * (`docs/features/FORFEIT_CANCELLATION.md`).
 *
 * L'abandon (`forfeitTournamentTeamPublic`) fait deux choses : il clôt le match
 * en cours de l'équipe au score plein du format, et il la marque `FORFEIT` au
 * classement. L'annulation ne défait **que la seconde** : l'équipe redevient
 * `ACTIVE` et le moteur rejoue le classement. Le match perdu par forfait reste
 * perdu — c'est un résultat comme un autre, que l'arbitrage corrige par le
 * dialogue de score s'il le faut. Le défaire ici aurait obligé à rouvrir une
 * manche que le tournoi a peut-être déjà dépassée.
 *
 * Rien n'est recalculé à la main : les trois moteurs relisent les abandons
 * depuis le statut stocké, si bien qu'effacer le statut suffit à rendre
 * victoires, capital et rang à ce que les matchs disent.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { toParticipantType, type ParticipantType } from "@/lib/shared/participants";
import { HAS_SCORE_INPUT_SQL } from "./bg-survie/round-progress";
import { discardBotLogs, flushBotLogs } from "./bot-logs";
import { retryOnDeadlock } from "./deadlock-retry";
import { publishUpdatedEvent } from "./notifications";
import { lockTournamentRow } from "./registration";
import { sqlPlaceholders } from "@/lib/server/sql-placeholders";

/** Ce que l'annulation a produit, pour la ligne de journal et le message rendu. */
export type CancelledForfeit = {
  tournamentId: number;
  tournamentName: string;
  teamId: number;
  entrantName: string;
  participantType: ParticipantType;
};

type TournamentHead = RowDataPacket & {
  name: string;
  format: string;
  state: string;
  participant_type: string | null;
  endurance_playoffs_started: number | null;
};

/** Table du classement et colonne de la manche de sortie, par moteur. */
const STANDINGS = {
  SURVIVAL: { table: "bg_survival_standings", roundColumn: "eliminated_round", phased: true },
  SWISS: { table: "bg_swiss_standings", roundColumn: "forfeit_round", phased: true },
  BG_SURVIE: { table: "bg_endurance_standings", roundColumn: "eliminated_round", phased: false },
} as const;

type EngineFormat = keyof typeof STANDINGS;

function isEngineFormat(format: string | null): format is EngineFormat {
  return format !== null && Object.hasOwn(STANDINGS, format);
}

/**
 * Moteur qui porte l'abandon. En multi-phases, l'abandon vit dans le classement
 * de la phase en cours — le seul que `forfeitTournamentTeamPublic` sache écrire.
 */
async function resolveEngine(
  connection: PoolConnection,
  tournamentId: number,
  format: string,
): Promise<{ engineFormat: string | null; phaseId: number }> {
  if (format !== "MULTI") return { engineFormat: format, phaseId: 0 };
  const [phaseRows] = await connection.execute<(RowDataPacket & { id: number; format: string })[]>(
    `SELECT p.id, p.format
     FROM bg_tournament_phases p
     JOIN bg_tournaments t ON t.current_phase_id = p.id
     WHERE t.id = ? LIMIT 1`,
    [tournamentId],
  );
  return { engineFormat: phaseRows[0]?.format ?? null, phaseId: Number(phaseRows[0]?.id ?? 0) };
}

/**
 * Rejoue le classement : il rend à l'équipe ce que ses matchs lui donnent — y
 * compris une élimination par coupe ou par capital épuisé, que l'abandon
 * masquait. En multi-phases, `reconcilePhases` rejoue lui-même le moteur de la
 * phase, avec la cible de qualifiées que lui seul connaît : un appel direct
 * couperait jusqu'à une seule équipe.
 */
async function replayStandings(
  connection: PoolConnection,
  tournamentId: number,
  multiPhase: boolean,
  engineFormat: EngineFormat,
  phaseId: number,
): Promise<void> {
  if (multiPhase) {
    const { reconcilePhases } = await import("./phases");
    await reconcilePhases(tournamentId, connection);
  } else if (engineFormat === "SURVIVAL") {
    const { reconcileSurvival } = await import("./survival");
    await reconcileSurvival(tournamentId, connection, { phaseId });
  } else if (engineFormat === "SWISS") {
    const { reconcileSwiss } = await import("./swiss");
    await reconcileSwiss(tournamentId, connection, { phaseId });
  } else {
    const { reconcileEndurance } = await import("./bg-survie/reconcile");
    await reconcileEndurance(tournamentId, connection);
  }
}

/**
 * Une manche postérieure à `round` porte-t-elle une saisie ?
 *
 * Un report écrit son score sous le verrou du match **avant** d'attendre celui
 * du tournoi, que l'annulation tient déjà : une lecture d'instantané manquait ce
 * score en cours, l'équipe rentrait et le rejeu suisse réappariait une manche
 * saisie. Les lignes encore vierges sont donc relues **verrouillées**, par clé
 * primaire seulement (les manches postérieures, pas toute la phase ni ses
 * intervalles). Un geste bref sur l'une d'elles (« Prêt », horaire) se laisse
 * attendre ; un report en cours, qui attend le tournoi, forme un interblocage
 * que le moteur rompt aussitôt — l'annulation, qui n'a rien écrit, en est la
 * victime ordinaire et se rejoue (`retryOnDeadlock`) en voyant alors le score.
 * Ces lignes restent verrouillées jusqu'au commit : un « Prêt » de la manche
 * suivante attend la fin du rejeu (geste d'administration rare et court).
 */
async function laterRoundHasInput(
  connection: PoolConnection,
  tournamentId: number,
  phaseId: number,
  round: number,
): Promise<boolean> {
  // Les matchs ne naissent que sous le verrou du tournoi, déjà pris : la
  // lecture d'instantané les voit tous. Une saisie déjà commitée y suffit à
  // refuser, sans rien verrouiller.
  const [later] = await connection.execute<(RowDataPacket & { id: number; has_input: number })[]>(
    `SELECT id, ${HAS_SCORE_INPUT_SQL} AS has_input FROM bg_matches
     WHERE tournament_id = ? AND phase_id = ? AND round_number > ?`,
    [tournamentId, phaseId, round],
  );
  if (later.length === 0) return false;
  if (later.some((row) => Number(row.has_input) === 1)) return true;
  const [rows] = await connection.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_matches
     WHERE id IN (${sqlPlaceholders(later.length)}) AND ${HAS_SCORE_INPUT_SQL}
     FOR UPDATE`,
    later.map((row) => Number(row.id)),
  );
  return rows.length > 0;
}

/**
 * Remet en lice un engagé qui avait abandonné.
 *
 * Le contrôle de permission appartient à la route (administrateur strict).
 *
 * @throws `TOURNAMENT_NOT_FOUND` — identifiant inconnu.
 * @throws `TOURNAMENT_NOT_RUNNING` — un tournoi terminé ne se rouvre pas.
 * @throws `FORMAT_WITHOUT_FORFEIT` — format (ou phase en cours) sans abandon.
 * @throws `ENDURANCE_PLAYOFFS_STARTED` — l'arbre final est posé : l'équipe ne
 *         peut plus y entrer.
 * @throws `TEAM_NOT_IN_TOURNAMENT` — l'engagé n'est pas au classement.
 * @throws `TEAM_NOT_FORFEITED` — l'engagé n'a pas abandonné.
 * @throws `FORFEIT_ROUND_PASSED` — une manche postérieure à l'abandon porte une
 *         saisie : l'équipe rentrerait sans que les manches qu'elle a manquées
 *         comptent contre elle.
 */
export async function cancelTournamentForfeit(
  tournamentId: number,
  teamId: number,
): Promise<CancelledForfeit> {
  // Verrous tournoi puis manches (le rejeu peut poser la manche suivante),
  // quand un report ou « Enregistrer » prend la manche puis le tournoi : même
  // inversion que l'abandon (`forfeitTournamentTeamPublic`), qu'un interblocage
  // rejoue au lieu de renvoyer une erreur à l'administrateur.
  return retryOnDeadlock(() => cancelTournamentForfeitOnce(tournamentId, teamId));
}

/** Une tentative d'annulation, dans sa propre transaction. */
async function cancelTournamentForfeitOnce(
  tournamentId: number,
  teamId: number,
): Promise<CancelledForfeit> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // En toute première instruction : sous `REPEATABLE READ`, une lecture
    // ordinaire placée avant figerait un état d'avant l'attente du verrou.
    await lockTournamentRow(connection, tournamentId);

    const [rows] = await connection.execute<TournamentHead[]>(
      `SELECT name, format, state, participant_type, endurance_playoffs_started
       FROM bg_tournaments WHERE id = ? LIMIT 1`,
      [tournamentId],
    );
    const tournament = rows[0];
    if (!tournament) throw new Error("TOURNAMENT_NOT_FOUND");
    if (tournament.state !== "RUNNING") throw new Error("TOURNAMENT_NOT_RUNNING");

    const { engineFormat, phaseId } = await resolveEngine(connection, tournamentId, tournament.format);
    if (!isEngineFormat(engineFormat)) throw new Error("FORMAT_WITHOUT_FORFEIT");
    if (engineFormat === "BG_SURVIE" && Number(tournament.endurance_playoffs_started) === 1) {
      throw new Error("ENDURANCE_PLAYOFFS_STARTED");
    }

    const { table, roundColumn, phased } = STANDINGS[engineFormat];
    const scope = phased ? "s.tournament_id = ? AND s.phase_id = ? AND s.team_id = ?" : "s.tournament_id = ? AND s.team_id = ?";
    const scopeParams = phased ? [tournamentId, phaseId, teamId] : [tournamentId, teamId];

    const [standingRows] = await connection.execute<
      (RowDataPacket & { status: string; forfeit_round: number | null; team_name: string })[]
    >(
      `SELECT s.status, s.${roundColumn} AS forfeit_round, t.name AS team_name
       FROM ${table} s
       JOIN bg_teams t ON t.id = s.team_id
       WHERE ${scope}
       LIMIT 1`,
      scopeParams,
    );
    const standing = standingRows[0];
    if (!standing) throw new Error("TEAM_NOT_IN_TOURNAMENT");
    if (standing.status !== "FORFEIT") throw new Error("TEAM_NOT_FORFEITED");

    // Même borne que le retrait d'une pénalité (`laterRoundHasScoreInput`) :
    // une manche **postérieure** à l'abandon déjà entamée, et l'équipe
    // rentrerait sans que les manches manquées comptent contre elle — capital
    // intact en BG Survie, défaites en moins en Survie. Une manche posée mais
    // vierge ne bloque pas : l'équipe rejoint l'appariement suivant.
    if (await laterRoundHasInput(connection, tournamentId, phaseId, Number(standing.forfeit_round ?? 1))) {
      throw new Error("FORFEIT_ROUND_PASSED");
    }

    await connection.execute(
      `UPDATE ${table} s SET s.status = 'ACTIVE', s.${roundColumn} = NULL WHERE ${scope}`,
      scopeParams,
    );

    await replayStandings(connection, tournamentId, tournament.format === "MULTI", engineFormat, phaseId);

    await connection.commit();
    // Le rejeu a pu réserver des lignes de journal (manche suivante posée).
    flushBotLogs(connection);

    publishUpdatedEvent(tournamentId);

    return {
      tournamentId,
      tournamentName: tournament.name,
      teamId,
      entrantName: standing.team_name,
      participantType: toParticipantType(tournament.participant_type),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    discardBotLogs(connection);
    connection.release();
  }
}
