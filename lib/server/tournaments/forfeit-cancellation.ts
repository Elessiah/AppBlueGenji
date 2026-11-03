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
import { laterRoundsHaveScoreInput } from "./bg-survie/round-progress";
import { discardBotLogs, flushBotLogs } from "./bot-logs";
import { retryOnDeadlock } from "./deadlock-retry";
import { invalidateLandingMiniBrackets } from "@/lib/server/landing-cache";
import { invalidateTournamentLists } from "./list-cache";
import { publishMatchUpdatedEvent } from "./notifications";
import { invalidateTournamentPreview } from "./preview-cache";
import { releaseWithServerLockWait } from "./lock-wait";

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
  current_phase_id: number | null;
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
 * La phase est lue **verrouillée**, table seule : aucune lecture d'instantané
 * avant celle des manches (voir {@link cancelTournamentForfeitOnce}). Verrou
 * exclusif d'emblée : le rejeu des phases (`reconcilePhases`) peut réécrire
 * cette ligne, et un verrou partagé à promouvoir attendrait tout autre lecteur
 * partagé. Le verrou du tournoi, déjà tenu, sérialise les gestes qui l'écrivent.
 */
async function resolveEngine(
  connection: PoolConnection,
  tournament: TournamentHead,
): Promise<{ engineFormat: string | null; phaseId: number }> {
  if (tournament.format !== "MULTI") return { engineFormat: tournament.format, phaseId: 0 };
  const phaseId = Number(tournament.current_phase_id ?? 0);
  if (phaseId === 0) return { engineFormat: null, phaseId: 0 };
  const [phaseRows] = await connection.execute<(RowDataPacket & { format: string })[]>(
    `SELECT format FROM bg_tournament_phases WHERE id = ? LIMIT 1 FOR UPDATE`,
    [phaseId],
  );
  return { engineFormat: phaseRows[0]?.format ?? null, phaseId };
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
  // quand un report prend son match puis le tournoi (« Enregistrer » prend,
  // lui, le tournoi d'abord, comme l'annulation) : même inversion que l'abandon (`forfeitTournamentTeamPublic`), qu'un interblocage
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
    // Nom de l'engagé, pour le journal : lu **avant** la transaction, en
    // lecture autonome — ni image ouverte (`ER_CHECKREAD`, voir plus bas), ni
    // verrou partagé tenu jusqu'au commit, qui ferait attendre tout le rejeu à
    // un renommage de l'équipe. Son classement verrouillé plus bas la garde :
    // effacer l'équipe le supprime en cascade, et attendrait donc ce verrou.
    const [teamRows] = await connection.execute<(RowDataPacket & { name: string })[]>(
      `SELECT name FROM bg_teams WHERE id = ? LIMIT 1`,
      [teamId],
    );

    await connection.beginTransaction();

    // **Aucune lecture d'instantané avant celle des manches** : sous MariaDB
    // (`innodb_snapshot_isolation`), une lecture verrouillante d'une ligne
    // changée depuis l'image de la transaction est refusée (`ER_CHECKREAD`).
    // Une première lecture ordinaire figeait cette image avant l'attente du
    // verrou des manches, si bien qu'un « Prêt » commité pendant cette attente
    // faisait échouer puis rejouer l'annulation — une rafale de « Prêt » à
    // l'ouverture du salon épuisait les trois tentatives. Tête du tournoi,
    // phase, classement et manches se lisent donc sous verrou ; l'image ne naît
    // qu'après (nom de l'équipe, rejeu du classement).
    //
    // En toute première instruction, le verrou du tournoi — attendu sans borne,
    // comme tout geste qui le prend : son détenteur (une réconciliation, un
    // lancement) le rend sans rien attendre de nous. Seule la lecture des
    // manches, que des gestes sans verrou du tournoi peuvent tenir longtemps,
    // a une attente bornée (`lock`, `./lock-wait`). Ce verrou est la lecture
    // verrouillée de la tête elle-même : une seule instruction pour les deux.
    const [rows] = await connection.execute<TournamentHead[]>(
      `SELECT name, format, state, participant_type, endurance_playoffs_started, current_phase_id
       FROM bg_tournaments WHERE id = ? LIMIT 1 FOR UPDATE`,
      [tournamentId],
    );
    const tournament = rows[0];
    if (!tournament) throw new Error("TOURNAMENT_NOT_FOUND");
    if (tournament.state !== "RUNNING") throw new Error("TOURNAMENT_NOT_RUNNING");

    const { engineFormat, phaseId } = await resolveEngine(connection, tournament);
    if (!isEngineFormat(engineFormat)) throw new Error("FORMAT_WITHOUT_FORFEIT");
    if (engineFormat === "BG_SURVIE" && Number(tournament.endurance_playoffs_started) === 1) {
      throw new Error("ENDURANCE_PLAYOFFS_STARTED");
    }

    const { table, roundColumn, phased } = STANDINGS[engineFormat];
    const scope = phased ? "tournament_id = ? AND phase_id = ? AND team_id = ?" : "tournament_id = ? AND team_id = ?";
    const scopeParams = phased ? [tournamentId, phaseId, teamId] : [tournamentId, teamId];

    // Par la clé primaire du classement : le verrou de la seule ligne réécrite.
    const [standingRows] = await connection.execute<
      (RowDataPacket & { status: string; forfeit_round: number | null })[]
    >(
      `SELECT status, ${roundColumn} AS forfeit_round FROM ${table} WHERE ${scope} LIMIT 1 FOR UPDATE`,
      scopeParams,
    );
    const standing = standingRows[0];
    if (!standing) throw new Error("TEAM_NOT_IN_TOURNAMENT");
    if (standing.status !== "FORFEIT") throw new Error("TEAM_NOT_FORFEITED");

    // Classement sans engagé (équipe effacée) : rien à remettre en lice — refusé
    // avant de verrouiller les manches.
    const team = teamRows[0];
    if (!team) throw new Error("TEAM_NOT_IN_TOURNAMENT");

    // Même borne que le retrait d'une pénalité (`laterRoundsHaveScoreInput`) :
    // une manche **postérieure** à l'abandon déjà entamée, et l'équipe
    // rentrerait sans que les manches manquées comptent contre elle — capital
    // intact en BG Survie, défaites en moins en Survie. Une manche posée mais
    // vierge ne bloque pas : l'équipe rejoint l'appariement suivant.
    //
    // Lecture verrouillante : un report écrit son score sous le verrou du match
    // **avant** d'attendre celui du tournoi, que l'annulation tient déjà. Les
    // deux forment un interblocage que le moteur rompt aussitôt
    // (`docs/features/FORFEIT_CANCELLATION.md` § Concurrence).
    if (
      await laterRoundsHaveScoreInput(connection, {
        tournamentId,
        phaseId,
        afterRound: Number(standing.forfeit_round ?? 1),
        lock: true,
      })
    ) {
      throw new Error("FORFEIT_ROUND_PASSED");
    }

    await connection.execute(
      `UPDATE ${table} SET status = 'ACTIVE', ${roundColumn} = NULL WHERE ${scope}`,
      scopeParams,
    );

    await replayStandings(connection, tournamentId, tournament.format === "MULTI", engineFormat, phaseId);

    await connection.commit();
    // Le rejeu a pu réserver des lignes de journal (manche suivante posée).
    flushBotLogs(connection);

    // Aucun résultat de match ne change : le classement du site et les
    // statistiques, qui ne rejouent que des matchs `COMPLETED`, restent justes —
    // `publishUpdatedEvent` les vidait aussi. Le rejeu peut en revanche réécrire
    // des colonnes de `bg_tournaments` (manche d'endurance courante, phase) et
    // reposer les matchs d'une manche périmée : instantané, aperçu, listes, et
    // à l'accueil le direct et les mini-arbres sont oubliés. Leaderboards,
    // ticker (derniers résultats) et compteurs ne lisent que des matchs clos ou
    // des comptes : ils restent en cache.
    publishMatchUpdatedEvent(tournamentId, { landingLive: true });
    invalidateTournamentPreview(tournamentId);
    invalidateTournamentLists();
    invalidateLandingMiniBrackets();

    return {
      tournamentId,
      tournamentName: tournament.name,
      teamId,
      entrantName: team.name,
      participantType: toParticipantType(tournament.participant_type),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    discardBotLogs(connection);
    await releaseWithServerLockWait(connection);
  }
}
