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

/** Une ligne de `bg_users` réduite aux deux drapeaux que les conditions lisent. */
type EligibilityRow = RowDataPacket & { verified: number; blizzard: number };

/**
 * Les deux colonnes qui **prouvent** quelque chose, et leur lecture.
 *
 * Écrites une fois : le roster d'équipe et l'engagé solo les lisent sur la même
 * table, et deux copies auraient divergé au premier réglage ajouté — la seconde
 * restant muette, puisqu'un tournoi individuel ne fait pas les mêmes essais
 * qu'un tournoi par équipes.
 *
 * Chacune est la forme **prouvée** d'une donnée dont il existe aussi une forme
 * saisie : `discord_verified_at` et non `discord_pseudo`, `blizzard_sub` et non
 * `overwatch_battletag`. C'est exactement le trou que les conditions ferment —
 * les deux chaînes libres se remplissent avec l'identité de n'importe qui.
 */
const ELIGIBILITY_COLUMNS_SQL = `(u.discord_verified_at IS NOT NULL) AS verified,
            (u.blizzard_sub IS NOT NULL) AS blizzard`;

function toEligibility(row: EligibilityRow): RosterMemberEligibility {
  return {
    discordVerified: Number(row.verified) === 1,
    blizzardLinked: Number(row.blizzard) === 1,
  };
}

/**
 * Roster **actif** d'une équipe, réduit à ce que les conditions regardent.
 *
 * `left_at IS NULL` : un joueur parti ne compte ni dans l'effectif ni comme
 * interlocuteur.
 */
export async function loadTeamRosterEligibility(
  connection: PoolConnection,
  teamId: number,
): Promise<RosterMemberEligibility[]> {
  const [rows] = await connection.execute<EligibilityRow[]>(
    `SELECT ${ELIGIBILITY_COLUMNS_SQL}
     FROM bg_team_members tm
     JOIN bg_users u ON u.id = tm.user_id
     WHERE tm.team_id = ?
       AND tm.left_at IS NULL`,
    [teamId],
  );
  return rows.map(toEligibility);
}

/** Le joueur lui-même, pour un engagé solo : un roster d'une ligne. */
export async function loadSoloEligibility(
  connection: PoolConnection,
  userId: number,
): Promise<RosterMemberEligibility[]> {
  const [rows] = await connection.execute<EligibilityRow[]>(
    `SELECT ${ELIGIBILITY_COLUMNS_SQL}
     FROM bg_users u
     WHERE u.id = ?
     LIMIT 1`,
    [userId],
  );
  if (rows.length === 0) return [];
  return [toEligibility(rows[0])];
}

/** Les conditions du tournoi, lues sur la ligne déjà chargée. */
export function tournamentRegistrationFilters(
  tournament: Pick<
    TournamentRow,
    | "registration_discord_requirement"
    | "registration_blizzard_requirement"
    | "registration_min_players"
  >,
): RegistrationFilters {
  // `parseRegistrationFilters` ferait le même travail ; on l'évite ici parce que
  // `mapCard` l'a déjà appliqué en amont sur la même ligne, et que ce module
  // reçoit des valeurs venues de colonnes `NOT NULL`. Une ligne d'avant la
  // migration ne peut pas arriver jusqu'ici : `ADD COLUMN … NOT NULL DEFAULT`
  // remplit les lignes existantes.
  return {
    discordRequirement: tournament.registration_discord_requirement,
    blizzardRequirement: tournament.registration_blizzard_requirement,
    minPlayers: Number(tournament.registration_min_players),
  };
}

/**
 * L'engagé désigné, réduit à ce qu'il faut pour lire son roster.
 *
 * `soloUserId` non nul **est** la marque du tournoi individuel : l'engagé y est
 * une personne, son roster tient en une ligne, et l'effectif minimal ne
 * s'applique pas (`checkRegistrationFilters`). `teamId` peut alors être `null` —
 * l'entrée solo n'existe pas forcément encore, et c'est précisément le cas où la
 * condition doit quand même se juger, sur le joueur.
 */
export type EligibilityTarget = { teamId: number | null; soloUserId: number | null };

/**
 * Les conditions sont-elles remplies ? Rend le refus, ou `null`.
 *
 * **La forme qui ne lève pas** : elle sert à *fermer le bouton* d'inscription
 * (`getTournamentViewerContext`), où une exception n'aurait aucun sens. L'autre
 * forme ({@link assertRegistrationEligibility}) lève, parce qu'elle protège une
 * transaction qu'un refus doit défaire. Les deux passent par ici : deux lectures
 * de roster divergeraient, et la divergence se verrait en 409 sur un bouton qui
 * s'annonçait ouvert.
 */
export async function checkEntrantEligibility(
  connection: PoolConnection,
  filters: RegistrationFilters,
  entrant: EligibilityTarget,
): Promise<RegistrationFilterError | null> {
  const solo = entrant.soloUserId !== null;
  const roster = solo
    ? await loadSoloEligibility(connection, entrant.soloUserId!)
    : entrant.teamId === null
      ? []
      : await loadTeamRosterEligibility(connection, entrant.teamId);

  return checkRegistrationFilters(filters, roster, solo);
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
    | "registration_discord_requirement"
    | "registration_blizzard_requirement"
    | "registration_min_players"
  >,
  entrant: EligibilityTarget,
): Promise<void> {
  const error = await checkEntrantEligibility(
    connection,
    tournamentRegistrationFilters(tournament),
    entrant,
  );
  if (error) throw new Error(error);
}
