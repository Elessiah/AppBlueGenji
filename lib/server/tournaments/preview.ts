/**
 * Aperçu du plateau avant le lancement — orchestration.
 *
 * Assemble l'entrée du module pur `lib/shared/tournament-preview.ts` : ordre de
 * seeding effectif, réglages du format, phases. **Aucune écriture** : l'aperçu
 * ne crée ni match ni classement, il se contente de lire les inscriptions au
 * moment où on le demande. Il se recalcule donc naturellement à chaque
 * inscription, l'interface étant déjà rafraîchie par l'événement `updated`
 * publié par `registerCurrentUserTeam`.
 *
 * L'ordre reproduit exactement celui qu'appliquerait le moteur au démarrage :
 * même chargeur de classement du site (`loadEntrantsBySiteRanking`) que
 * `initializeSwissTournament`, `initializeSurvivalTournament` et
 * `initializeMultiTournament`, et même lecture de `manual_seeding`. Un aperçu
 * qui divergerait du tirage réel serait pire que pas d'aperçu du tout.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { loadEntrantsBySiteRanking } from "@/lib/server/ranking-service";
import {
  buildTournamentPreview,
  type PreviewEntrant,
  type PreviewSeedingSource,
  type TournamentPreview,
} from "@/lib/shared/tournament-preview";
import { seedingSource } from "@/lib/shared/seeding";
import type { PhaseConfig } from "@/lib/shared/tournament-phases";
import type { TournamentRow } from "./_internal";
import { loadPhases } from "./phases-repository";

/** Réglages de format que `TournamentRow` ne porte pas. */
type PreviewSettingsRow = RowDataPacket & {
  swiss_total_rounds: number | null;
  endurance_playoff_size: number | null;
};

/** L'aperçu n'a de sens qu'avant le lancement : ensuite, le vrai plateau existe. */
export function isPreviewableState(state: TournamentRow["state"]): boolean {
  return state === "UPCOMING" || state === "REGISTRATION";
}

/**
 * Engagés dans l'ordre de seeding effectif.
 *
 * `MANUAL` / `REGISTRATION` lisent la colonne `seed` (l'ordre d'inscription tant
 * que personne n'a réordonné) ; `RANKING` rejoue la requête de classement du
 * site utilisée par les moteurs à classement.
 */
async function loadOrderedEntrants(
  connection: PoolConnection,
  tournamentId: number,
  source: PreviewSeedingSource,
): Promise<PreviewEntrant[]> {
  // Classement du site : **le même chargeur** que le seeding réel
  // (`loadEntrantsBySiteRanking`), sur la connexion de l'appelant. Un aperçu qui
  // divergerait du tirage serait pire que pas d'aperçu du tout.
  const ordered =
    source === "RANKING"
      ? await loadEntrantsBySiteRanking(connection, tournamentId)
      : (
          await connection.execute<(RowDataPacket & { team_id: number; team_name: string })[]>(
            `SELECT r.team_id, t.name AS team_name
             FROM bg_tournament_registrations r
             JOIN bg_teams t ON t.id = r.team_id
             WHERE r.tournament_id = ?
             ORDER BY COALESCE(r.seed, 1000000), r.registered_at ASC`,
            [tournamentId],
          )
        )[0].map((row) => ({ teamId: Number(row.team_id), teamName: row.team_name }));

  // Le rang affiché est recalculé de 1 à N : `seed` peut être NULL ou à trous
  // sur d'anciennes inscriptions, et le classement du site n'en produit aucun.
  return ordered.map((entrant, index) => ({
    teamId: entrant.teamId,
    teamName: entrant.teamName,
    seed: index + 1,
  }));
}

/** Configuration des phases, telle que la lit le module pur. */
async function loadPhaseConfigs(
  connection: PoolConnection,
  tournamentId: number,
): Promise<PhaseConfig[]> {
  const rows = await loadPhases(connection, tournamentId);
  return rows.map((row, index) => ({
    position: Number(row.position ?? index + 1),
    format: row.format,
    name: row.name,
    qualifierMode: row.qualifier_mode,
    qualifierValue: Number(row.qualifier_value),
    hasThirdPlaceMatch: Boolean(row.has_third_place_match),
    swissTotalRounds: row.swiss_total_rounds === null ? null : Number(row.swiss_total_rounds),
    survivalRoundsBeforeFirstCut:
      row.survival_rounds_before_first_cut === null
        ? null
        : Number(row.survival_rounds_before_first_cut),
    survivalRoundsPerCut:
      row.survival_rounds_per_cut === null ? null : Number(row.survival_rounds_per_cut),
  }));
}

/**
 * Aperçu du plateau d'un tournoi pas encore lancé.
 *
 * Renvoie `null` dès que le tournoi est lancé ou terminé : le plateau réel est
 * alors la seule vérité, et l'afficher deux fois n'apporterait que de la
 * confusion. L'appelant est responsable du contrôle de permission
 * (`tournaments` ou `casting`).
 */
export async function loadTournamentPreview(
  connection: PoolConnection,
  tournament: TournamentRow,
): Promise<TournamentPreview | null> {
  if (!isPreviewableState(tournament.state)) return null;

  const source = seedingSource(tournament.format, Number(tournament.manual_seeding ?? 0) === 1);
  const entrants = await loadOrderedEntrants(connection, tournament.id, source);

  const [settings] = await connection.execute<PreviewSettingsRow[]>(
    `SELECT swiss_total_rounds, endurance_playoff_size FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournament.id],
  );

  const phases = tournament.format === "MULTI" ? await loadPhaseConfigs(connection, tournament.id) : null;

  return buildTournamentPreview({
    format: tournament.format,
    entrants,
    seedingSource: source,
    swissTotalRounds:
      settings[0]?.swiss_total_rounds === null || settings[0]?.swiss_total_rounds === undefined
        ? null
        : Number(settings[0].swiss_total_rounds),
    survivalRoundsBeforeFirstCut:
      tournament.survival_rounds_before_first_cut === null
        ? null
        : Number(tournament.survival_rounds_before_first_cut),
    survivalRoundsPerCut:
      tournament.survival_rounds_per_cut === null
        ? null
        : Number(tournament.survival_rounds_per_cut),
    endurancePlayoffSize:
      settings[0]?.endurance_playoff_size === null || settings[0]?.endurance_playoff_size === undefined
        ? null
        : Number(settings[0].endurance_playoff_size),
    phases,
  });
}
