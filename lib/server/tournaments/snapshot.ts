/**
 * Instantané partagé d'un tournoi : ce que tout le monde voit de la même façon.
 *
 * # Pourquoi ce module existe
 *
 * Le détail d'un tournoi coûte cher : une dizaine de requêtes, plus une
 * transaction d'entretien (création du plateau, résolution des byes, arbitrage
 * des reports expirés, bascule d'état). Tant que chaque spectateur le
 * reconstruisait pour lui-même, un score rapporté dans un tournoi suivi par cent
 * personnes déclenchait cent fois ce travail **en même temps** — le pool MySQL
 * n'en compte que 25, et la machine est un Raspberry Pi.
 *
 * Or ce détail est presque entièrement le même pour tous. On l'isole donc ici
 * ({@link TournamentSnapshot}), on le calcule **une fois** et on le sert à tout
 * le monde : par le cache à vol unique pour les lectures HTTP, et poussé tel
 * quel dans le flux SSE pour les abonnés. Ce qui dépend du lecteur
 * (`TournamentViewerContext`) est calculé à part, et ne bouge qu'à
 * l'inscription.
 *
 * # Fraîcheur
 *
 * La durée de vie est courte ({@link SNAPSHOT_TTL_MS}) et sert uniquement à
 * absorber les pointes : toute écriture publie un événement, qui invalide
 * l'entrée ({@link invalidateTournamentSnapshot}). Personne ne lit donc un
 * score périmé.
 */
import { createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { TournamentSnapshot } from "@/lib/shared/types";
import { getDatabase } from "@/lib/server/database";
import { cached, invalidateCached } from "@/lib/server/cache";
import { loadSoloUserIds } from "@/lib/server/solo-entries-service";
import { toIso } from "@/lib/server/serialization";
import { isSoloTournament } from "@/lib/shared/participants";
import { mapCard, mapMatch, type TournamentRow } from "./_internal";
import {
  getMatchRows,
  getRegistrationRows,
  getTournamentListRow,
  loadTournamentRow,
} from "./repository";
import { hasPendingStateTransition, syncTournamentState } from "./state";

/**
 * Durée de vie d'un instantané. Volontairement courte : elle ne sert qu'à
 * regrouper les lectures d'une même rafale, l'invalidation explicite se
 * chargeant de la justesse.
 */
export const SNAPSHOT_TTL_MS = 3_000;

/** Trame SSE prête à l'emploi, encodée une seule fois pour tous les abonnés. */
export type TournamentSnapshotFrame = {
  snapshot: TournamentSnapshot;
  version: string;
  /** Message SSE complet, déjà sérialisé et encodé en UTF-8. */
  frame: Uint8Array;
};

const encoder = new TextEncoder();

function cacheKey(tournamentId: number): string {
  return `tournament-snapshot:${tournamentId}`;
}

/** Oublie l'instantané d'un tournoi. Appelé à chaque publication d'événement. */
export function invalidateTournamentSnapshot(tournamentId: number): void {
  invalidateCached(cacheKey(tournamentId));
}

async function hasExpiredScoreReports(
  db: Awaited<ReturnType<typeof getDatabase>>,
  tournamentId: number,
): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_matches WHERE tournament_id = ? AND status = 'AWAITING_CONFIRMATION' AND score_deadline_at <= NOW() LIMIT 1`,
    [tournamentId],
  );
  return rows.length > 0;
}

/**
 * Entretien passif du tournoi avant lecture : plateau manquant, reports
 * expirés, bascule d'état. Renvoie la ligne à jour, ou `null` si le tournoi
 * n'existe pas.
 *
 * La transaction n'est ouverte que si l'un de ces cas se présente — une lecture
 * ordinaire ne coûte donc rien de plus qu'un `SELECT`.
 */
async function loadMaintainedRow(tournamentId: number): Promise<TournamentRow | null> {
  const db = await getDatabase();

  let tournamentRow: TournamentRow | null;
  const readConnection = await db.getConnection();
  try {
    tournamentRow = await loadTournamentRow(readConnection, tournamentId);
  } finally {
    readConnection.release();
  }
  if (!tournamentRow) return null;

  // Une bascule d'état en retard est traitée quel que soit l'état courant.
  // Auparavant l'entretien était réservé aux tournois déjà `RUNNING` : un
  // tournoi dont l'heure de début était passée n'entrait en lice qu'au prochain
  // chargement de la *liste*, si bien que la page du tournoi lui-même restait
  // aux inscriptions jusqu'à ce que quelqu'un aille voir ailleurs. La bascule
  // est désormais déclenchée d'ici, et le vol unique du cache garantit qu'une
  // seule transaction part, même avec cent spectateurs sur la page.
  const needsSync =
    (await hasPendingStateTransition(tournamentRow)) ||
    (tournamentRow.state === "RUNNING" &&
      (tournamentRow.bracket_size === null ||
        (await hasExpiredScoreReports(db, tournamentId))));

  if (!needsSync) return tournamentRow;

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const syncResult = await syncTournamentState(connection, tournamentId);
    await connection.commit();
    return syncResult.row;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Empreinte stable du contenu, pour n'envoyer que ce qui a réellement changé. */
function snapshotVersion(payloadJson: string): string {
  return createHash("sha1").update(payloadJson).digest("base64url").slice(0, 16);
}

/**
 * Assemble la trame SSE **sans re-sérialiser l'instantané**.
 *
 * L'empreinte se calcule déjà sur le JSON du contenu ; le repasser dans un
 * `JSON.stringify` d'enveloppe referait le même travail sur les mêmes 150 ko
 * (mesure faite sur un tournoi à 128 équipes, 254 matchs) à chaque
 * construction, sur une machine qui n'en a pas les moyens. On referme donc
 * l'objet déjà sérialisé après y avoir glissé sa version.
 *
 * Assembler du JSON à la main mérite ses garde-fous, et il y en a trois :
 * chaque valeur insérée passe par `JSON.stringify` (rien n'est concaténé sans
 * échappement), le cas de l'objet vide est traité à part, et
 * `tests/lib/server/tournament-snapshot-frame.test.ts` vérifie que la trame se
 * relit bien en l'instantané de départ. Exportée pour ce test.
 */
export function buildFrame(
  tournamentId: number,
  payloadJson: string,
  version: string,
): Uint8Array {
  const encodedVersion = JSON.stringify(version);
  const body = payloadJson.slice(1, -1);
  const snapshotJson = body ? `{${body},"version":${encodedVersion}}` : `{"version":${encodedVersion}}`;
  return encoder.encode(
    `data: {"type":"snapshot","tournamentId":${JSON.stringify(tournamentId)},` +
      `"version":${encodedVersion},"snapshot":${snapshotJson}}\n\n`,
  );
}

async function buildSnapshot(tournamentId: number): Promise<TournamentSnapshotFrame | null> {
  const tournament = await loadMaintainedRow(tournamentId);
  if (!tournament) return null;

  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    const cardRow = await getTournamentListRow(connection, tournamentId);
    if (!cardRow) return null;

    const card = mapCard(cardRow);
    const registrations = await getRegistrationRows(connection, tournamentId);
    const matches = await getMatchRows(connection, tournamentId);

    // Engagés qui sont des joueurs : l'interface lie alors vers leur profil.
    const soloUserIds = isSoloTournament(tournament.participant_type)
      ? await loadSoloUserIds(
          connection,
          registrations.map((row) => Number(row.team_id)),
        )
      : {};

    const phasesDetail =
      card.format === "MULTI"
        ? await (await import("./phases")).loadPhasesForDetail(connection, tournamentId)
        : null;

    // La vue Survie sert aussi à l'intérieur d'un tournoi multi-phases : sans
    // ces métadonnées, une phase en survie retomberait sur l'affichage générique
    // en arbre, privant les équipes du classement et du report de score.
    const survivalPhaseId =
      phasesDetail?.phases.find(
        (phase) => phase.id === phasesDetail.currentPhaseId && phase.format === "SURVIVAL",
      )?.id ?? null;

    const survival =
      card.format === "SURVIVAL"
        ? await (await import("./survival")).loadSurvivalMeta(connection, tournamentId)
        : survivalPhaseId !== null
          ? await (await import("./survival")).loadSurvivalMeta(
              connection,
              tournamentId,
              survivalPhaseId,
            )
          : null;

    // Même raison que pour la survie ci-dessus : la vue Suisse sert aussi à
    // l'intérieur d'une phase, sinon une ronde suisse en `MULTI` n'afficherait
    // ni classement ni départages.
    const swissPhaseId =
      phasesDetail?.phases.find(
        (phase) => phase.id === phasesDetail.currentPhaseId && phase.format === "SWISS",
      )?.id ?? null;

    const endurance =
      card.format === "BG_SURVIE"
        ? await (await import("./bg-survie")).loadEnduranceMeta(connection, tournamentId)
        : null;

    const swiss =
      card.format === "SWISS"
        ? await (await import("./swiss")).loadSwissMeta(connection, tournamentId)
        : swissPhaseId !== null
          ? await (await import("./swiss")).loadSwissMeta(connection, tournamentId, swissPhaseId)
          : null;

    const payload: Omit<TournamentSnapshot, "version"> = {
      card,
      matches: matches.map(mapMatch),
      registrations: registrations.map((row) => ({
        teamId: Number(row.team_id),
        teamName: row.team_name,
        logoUrl: row.logo_url,
        seed: row.seed === null ? null : Number(row.seed),
        registeredAt: toIso(row.registered_at)!,
        finalRank: row.final_rank === null ? null : Number(row.final_rank),
      })),
      survival,
      swiss,
      endurance,
      phases: phasesDetail?.phases ?? null,
      currentPhaseId: phasesDetail?.currentPhaseId ?? null,
      phaseStandings: phasesDetail?.phaseStandings ?? {},
      soloUserIds,
    };

    const payloadJson = JSON.stringify(payload);
    const version = snapshotVersion(payloadJson);
    const snapshot: TournamentSnapshot = { ...payload, version };

    return { snapshot, version, frame: buildFrame(tournamentId, payloadJson, version) };
  } finally {
    connection.release();
  }
}

/**
 * Instantané du tournoi, mutualisé.
 *
 * Les appels concurrents partagent le même calcul : cent lecteurs réveillés par
 * le même événement ne produisent qu'une passe en base.
 */
export async function getTournamentSnapshotFrame(
  tournamentId: number,
): Promise<TournamentSnapshotFrame | null> {
  return cached(cacheKey(tournamentId), SNAPSHOT_TTL_MS, () => buildSnapshot(tournamentId));
}

/** Instantané seul, sans la trame SSE. */
export async function getTournamentSnapshot(
  tournamentId: number,
): Promise<TournamentSnapshot | null> {
  const frame = await getTournamentSnapshotFrame(tournamentId);
  return frame?.snapshot ?? null;
}
