import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { parseRoles, toIso } from "@/lib/server/serialization";
import { visibleAvatarUrl } from "@/lib/shared/avatar";
import { loadAllPlayerRecords } from "@/lib/server/stats-service";
import { cachedStats } from "@/lib/server/stats-cache";
import type { PublicUserProfile } from "@/lib/shared/types";

/*
 * Profil public d'un joueur et annuaire des joueurs, sous les réglages de
 * visibilité du compte.
 */

export type UserRow = RowDataPacket & {
  id: number;
  pseudo: string;
  avatar_url: string | null;
  overwatch_battletag: string | null;
  marvel_rivals_tag: string | null;
  discord_pseudo: string | null;
  discord_verified_at?: Date | null;
  is_adult: 0 | 1 | null;
  visible_avatar: 0 | 1;
  visible_pseudo: 0 | 1;
  visible_overwatch: 0 | 1;
  visible_marvel: 0 | 1;
  visible_major: 0 | 1;
  visible_discord: 0 | 1;
  open_to_recruitment: 0 | 1;
  is_admin?: 0 | 1;
  is_deleted?: 0 | 1;
  platform_roles_json?: string | null;
  created_at: Date;
};

export function mapPublicUser(row: UserRow): PublicUserProfile {
  return {
    id: Number(row.id),
    pseudo: row.pseudo,
    avatarUrl: row.avatar_url,
    overwatchBattletag: row.overwatch_battletag,
    marvelRivalsTag: row.marvel_rivals_tag,
    isAdult: row.is_adult === null ? null : Boolean(row.is_adult),
    visibility: {
      avatar: Boolean(row.visible_avatar),
      overwatch: Boolean(row.visible_overwatch),
      marvel: Boolean(row.visible_marvel),
      major: Boolean(row.visible_major),
      discord: Boolean(row.visible_discord),
    },
    openToRecruitment: Boolean(row.open_to_recruitment),
    createdAt: toIso(row.created_at)!,
  };
}

/**
 * Applique les réglages de visibilité d'un profil pour un spectateur tiers :
 * chaque champ non public est masqué (l'avatar masqué devient `null`). Aucun
 * effet lorsque le spectateur consulte son propre profil (`isSelf`). Centralise
 * la logique de masquage pour que l'annuaire `/joueurs` et la fiche profil
 * `/joueurs/[id]` restent cohérents.
 *
 * Le **pseudo n'est jamais masqué** : il identifie le joueur dans les brackets,
 * les rosters et les feuilles de match, où l'anonymat n'a pas de sens.
 *
 * Le BattleTag masqué ne l'est ici que pour le lecteur **quelconque** : la
 * fonction ne connaît que `isSelf`. Son public restreint (joueurs d'un même
 * match, arbitrage d'un tournoi vivant) est reposé par `getFullProfile` —
 * voir `lib/shared/battletag-visibility.ts`.
 */
export function applyVisibility<T extends PublicUserProfile>(profile: T, isSelf: boolean): T {
  // L'avatar passe par la règle partagée (`lib/shared/avatar.ts`) : le roster
  // d'une équipe et le logo d'une entrée solo la posent aussi, et trois copies
  // divergeraient — la première l'avait déjà fait en ne la posant pas du tout.
  profile.avatarUrl = visibleAvatarUrl(profile.avatarUrl, profile.visibility.avatar, isSelf);
  if (isSelf) return profile;
  if (!profile.visibility.overwatch) profile.overwatchBattletag = null;
  if (!profile.visibility.marvel) profile.marvelRivalsTag = null;
  if (!profile.visibility.major) profile.isAdult = null;
  return profile;
}

export async function getUserById(userId: number): Promise<PublicUserProfile | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<UserRow[]>(
    `SELECT
      id,
      pseudo,
      avatar_url,
      overwatch_battletag,
      marvel_rivals_tag,
      is_adult,
      visible_avatar,
      visible_overwatch,
      visible_marvel,
      visible_major,
      visible_discord,
      open_to_recruitment,
      created_at
     FROM bg_users
     WHERE id = ?
     LIMIT 1`,
    [userId],
  );

  if (rows.length === 0) return null;
  return mapPublicUser(rows[0]);
}

export async function listPlayers(viewerId: number): Promise<PublicUserProfile[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<UserRow[]>(
    `SELECT
      id,
      pseudo,
      avatar_url,
      overwatch_battletag,
      marvel_rivals_tag,
      is_adult,
      visible_avatar,
      visible_overwatch,
      visible_marvel,
      visible_major,
      visible_discord,
      open_to_recruitment,
      is_deleted,
      created_at
     FROM bg_users
     ORDER BY is_deleted ASC, pseudo ASC`,
  );

  // `isDeleted` voyage jusqu'à l'annuaire, qui masque ces comptes par défaut :
  // un compte anonymisé n'est plus personne, mais sa ligne reste nécessaire à
  // qui remonte un ancien match. Le filtre est côté client, comme les autres de
  // cet écran — la liste entière y est déjà, et ces lignes ne portent plus rien
  // de personnel.
  const baseUsers = rows.map((row) => ({
    ...applyVisibility(mapPublicUser(row), Number(row.id) === viewerId),
    isDeleted: Boolean(row.is_deleted),
  }));

  // Les badges de jeu se dérivent des tags bruts : jouer à OW/MR n'est pas
  // une donnée privée (seule la chaîne exacte du battletag l'est), donc ils
  // restent affichés même si `visible_overwatch`/`visible_marvel` masque le tag.
  const gamesByUserId = new Map<number, ("OW" | "MR")[]>(
    rows.map((row) => {
      const games: ("OW" | "MR")[] = [];
      if (row.overwatch_battletag) games.push("OW");
      if (row.marvel_rivals_tag) games.push("MR");
      return [Number(row.id), games];
    }),
  );

  if (baseUsers.length === 0) return baseUsers;

  // Appartenances en cours de **tout le site** : l'annuaire lit tous les
  // comptes, une liste `IN (?, …)` de tous leurs identifiants ne filtrait rien
  // et grossissait la requête d'un paramètre par compte.
  const [teamMemberships] = await db.execute<
    (RowDataPacket & {
      user_id: number;
      team_id: number;
      team_name: string;
      roles_json: string;
    })[]
  >(
    `SELECT tm.user_id, tm.team_id, t.name AS team_name, tm.roles_json
     FROM bg_team_members tm
     JOIN bg_teams t ON t.id = tm.team_id
     WHERE tm.left_at IS NULL`,
  );

  const membershipByUserId = new Map(teamMemberships.map((m) => [m.user_id, m]));

  // Tournois disputés et bilan de matchs : **le même chargeur que la fiche**
  // (`loadPlayerRecords`). Les deux requêtes d'agrégation qui vivaient ici
  // rendaient trois nombres que la fiche contredisait — byes et matchs fantômes
  // comptés, défaites lues sur `loser_team_id` (que le moteur ne renseigne pas
  // toujours), fenêtres d'appartenance ignorées. Un seul chargeur, donc un seul
  // bilan par joueur, quelle que soit la page qui l'affiche.
  //
  // Seul morceau lourd de la page — il recharge les matchs de toutes les
  // équipes du site —, il est mutualisé (`stats-cache.ts`) : le bilan ne dépend
  // pas du lecteur, contrairement aux lignes de compte ci-dessus, qui restent
  // lues à chaque appel pour qu'un réglage de visibilité s'applique aussitôt.
  // Le chargeur porte sur **tous** les comptes, sans liste d'identifiants : un
  // compte né pendant la fenêtre n'a encore aucun match, le repli à zéro
  // ci-dessous dit déjà son bilan.
  const recordsByUserId = await cachedStats("player-records", () => loadAllPlayerRecords());

  return baseUsers.map((user) => {
    const membership = membershipByUserId.get(user.id);
    const games = gamesByUserId.get(user.id) ?? [];

    const record = recordsByUserId.get(user.id) ?? {
      wins: 0,
      losses: 0,
      tournamentsPlayed: 0,
    };

    return {
      ...user,
      team: membership
        ? {
            id: membership.team_id,
            name: membership.team_name,
            colorIndex: membership.team_id % 7,
          }
        : null,
      roles: membership ? parseRoles(membership.roles_json) : [],
      games,
      tournamentsCount: record.tournamentsPlayed,
      wins: record.wins,
      losses: record.losses,
    };
  });
}
