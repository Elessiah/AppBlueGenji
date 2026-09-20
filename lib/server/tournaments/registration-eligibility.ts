/**
 * Conditions d'inscription : la lecture du roster, et rien d'autre.
 *
 * La **règle** vit dans `lib/shared/registration-filters.ts` (pure, partagée avec
 * l'interface) ; ce module ne fait que lui donner à manger. La séparation n'est
 * pas décorative : c'est elle qui permet au bouton d'inscription et au refus du
 * serveur de dire la même chose, alors qu'ils ne lisent pas la base au même
 * moment.
 *
 * **Toujours sur la connexion de l'appelant.** L'inscription tient un verrou sur
 * la ligne du tournoi quand ces lectures ont lieu : emprunter une seconde place
 * du pool sous ce verrou arme un convoi, exactement comme
 * `getUserActiveTeam(userId, connection)` l'évite déjà.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  checkRegistrationFilters,
  type RegistrationFilterError,
  type RegistrationFilters,
  type RosterMemberEligibility,
} from "@/lib/shared/registration-filters";
import type { TournamentRow } from "./_internal";

/**
 * Roster **actif** d'une équipe, réduit à ce que les conditions regardent.
 *
 * `left_at IS NULL` : un joueur parti ne compte ni dans l'effectif ni comme
 * interlocuteur. La certification est lue sur `discord_verified_at` — jamais sur
 * `discord_pseudo`, qu'un joueur peut remplir sans rien prouver, ce qui est
 * précisément le trou que la condition est censée fermer.
 */
export async function loadTeamRosterEligibility(
  connection: PoolConnection,
  teamId: number,
): Promise<RosterMemberEligibility[]> {
  const [rows] = await connection.execute<(RowDataPacket & { verified: number })[]>(
    `SELECT (u.discord_verified_at IS NOT NULL) AS verified
     FROM bg_team_members tm
     JOIN bg_users u ON u.id = tm.user_id
     WHERE tm.team_id = ?
       AND tm.left_at IS NULL`,
    [teamId],
  );
  return rows.map((row) => ({ discordVerified: Number(row.verified) === 1 }));
}

/** Le joueur lui-même, pour un engagé solo : un roster d'une ligne. */
export async function loadSoloEligibility(
  connection: PoolConnection,
  userId: number,
): Promise<RosterMemberEligibility[]> {
  const [rows] = await connection.execute<(RowDataPacket & { verified: number })[]>(
    `SELECT (discord_verified_at IS NOT NULL) AS verified
     FROM bg_users
     WHERE id = ?
     LIMIT 1`,
    [userId],
  );
  if (rows.length === 0) return [];
  return [{ discordVerified: Number(rows[0].verified) === 1 }];
}

/** Les conditions du tournoi, lues sur la ligne déjà chargée. */
export function tournamentRegistrationFilters(
  tournament: Pick<
    TournamentRow,
    "registration_discord_requirement" | "registration_min_players"
  >,
): RegistrationFilters {
  // `parseRegistrationFilters` ferait le même travail ; on l'évite ici parce que
  // `mapCard` l'a déjà appliqué en amont sur la même ligne, et que ce module
  // reçoit des valeurs venues de colonnes `NOT NULL`. Une ligne d'avant la
  // migration ne peut pas arriver jusqu'ici : `ADD COLUMN … NOT NULL DEFAULT`
  // remplit les lignes existantes.
  return {
    discordRequirement: tournament.registration_discord_requirement,
    minPlayers: Number(tournament.registration_min_players),
  };
}

/**
 * Refuse une inscription qui ne remplit pas les conditions.
 *
 * Levée plutôt que rendue : l'inscription est une transaction, et le refus doit
 * la défaire. Le code d'erreur est celui du module pur, que la route traduit
 * en 409 — c'est un **conflit d'état** (l'équipe n'est pas dans l'état requis),
 * pas une saisie invalide.
 */
export async function assertRegistrationEligibility(
  connection: PoolConnection,
  tournament: Pick<
    TournamentRow,
    "registration_discord_requirement" | "registration_min_players"
  >,
  entrant: { teamId: number; soloUserId: number | null },
): Promise<void> {
  const filters = tournamentRegistrationFilters(tournament);
  const roster =
    entrant.soloUserId === null
      ? await loadTeamRosterEligibility(connection, entrant.teamId)
      : await loadSoloEligibility(connection, entrant.soloUserId);

  const error: RegistrationFilterError | null = checkRegistrationFilters(
    filters,
    roster,
    entrant.soloUserId !== null,
  );
  if (error) throw new Error(error);
}
