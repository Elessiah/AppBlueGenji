import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import type { PlayerPageIdentity } from "@/lib/shared/entity-page-titles";
import { resolveRoles } from "@/lib/server/auth";
import { parseRoles, toIso } from "@/lib/server/serialization";
import { visibleDiscordTag } from "@/lib/shared/discord-identity";
import { battletagNeedsTournamentContext, visibleBattletag } from "@/lib/shared/battletag-visibility";
import { can, type PlatformRole } from "@/lib/shared/permissions";
import { getPlayerEntityStats } from "@/lib/server/stats-service";
import { getActiveSuspension } from "@/lib/server/account-suspensions";
import type { FullProfileResponse, PublicUserProfile, UserTeamTimeline } from "@/lib/shared/types";
import { applyVisibility, mapPublicUser, type UserRow } from "./players";

/*
 * Fiche complète d'un joueur telle que la voit son lecteur — lui-même, le
 * staff ou un autre joueur (tag Discord, BattleTag, historique d'équipes) —, et
 * le titre de sa page.
 */

type TeamTimelineRow = RowDataPacket & {
  team_id: number;
  team_name: string;
  joined_at: Date;
  left_at: Date | null;
  roles_json: string;
};

/**
 * Un joueur est-il engagé dans un tournoi **encore vivant** ?
 *
 * C'est la condition qui ouvre son tag Discord à l'arbitrage
 * (`lib/shared/discord-identity.ts`) : le besoin de le joindre naît du tournoi
 * et s'éteint avec lui. La borne est celle de `tournamentGrantsContactAccess` —
 * tout état sauf `FINISHED` —, rejouée ici en SQL faute de pouvoir appeler du
 * TypeScript depuis une requête : les deux doivent bouger ensemble.
 *
 * Les deux formes d'engagement sont couvertes par la même requête — appartenance
 * à une équipe inscrite (fenêtre d'appartenance **ouverte** : un joueur parti ne
 * représente plus l'équipe) et entrée solo, qui porte l'identifiant du joueur.
 */
async function isInActiveTournament(userId: number): Promise<boolean> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { c: number })[]>(
    `SELECT 1 AS c
     FROM bg_tournament_registrations r
     JOIN bg_tournaments t ON t.id = r.tournament_id
     LEFT JOIN bg_team_members tm
       ON tm.team_id = r.team_id
      AND tm.user_id = ?
      AND tm.left_at IS NULL
     LEFT JOIN bg_teams te ON te.id = r.team_id
     WHERE t.state <> 'FINISHED'
       AND (tm.id IS NOT NULL OR te.solo_user_id = ?)
     LIMIT 1`,
    [userId, userId],
  );
  return rows.length > 0;
}

/**
 * Deux joueurs sont-ils engagés dans un **même match** d'un tournoi vivant ?
 *
 * C'est la condition qui ouvre un BattleTag masqué aux autres joueurs du match
 * (`lib/shared/battletag-visibility.ts`) : ils en ont besoin pour s'ajouter en
 * jeu. Même borne que {@link isInActiveTournament} (tout état sauf `FINISHED`)
 * et mêmes formes d'engagement — appartenance **en cours** à une équipe, ou
 * entrée solo. Coéquipiers compris : ils disputent le même match.
 *
 * La requête part des engagés du titulaire — quelques lignes — plutôt que de
 * balayer les matchs de tous les tournois vivants, et en **deux branches**, une
 * par côté du match : une jointure `team1_id = … OR team2_id = …` n'utilise
 * aucun des deux index et balayait `bg_matches` en entier (vu à l'`EXPLAIN`).
 */
async function sharesLiveMatch(userId: number, otherUserId: number): Promise<boolean> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { c: number })[]>(
    `WITH mine AS (
       SELECT tm.team_id FROM bg_team_members tm WHERE tm.user_id = ? AND tm.left_at IS NULL
       UNION
       SELECT te.id FROM bg_teams te WHERE te.solo_user_id = ?
     ), theirs AS (
       SELECT tm.team_id FROM bg_team_members tm WHERE tm.user_id = ? AND tm.left_at IS NULL
       UNION
       SELECT te.id FROM bg_teams te WHERE te.solo_user_id = ?
     )
     SELECT 1 AS c
     FROM mine
     JOIN bg_matches m ON m.team1_id = mine.team_id
     JOIN bg_tournaments t ON t.id = m.tournament_id
     JOIN theirs ON theirs.team_id IN (m.team1_id, m.team2_id)
     WHERE t.state <> 'FINISHED'
     UNION ALL
     SELECT 1 AS c
     FROM mine
     JOIN bg_matches m ON m.team2_id = mine.team_id
     JOIN bg_tournaments t ON t.id = m.tournament_id
     JOIN theirs ON theirs.team_id IN (m.team1_id, m.team2_id)
     WHERE t.state <> 'FINISHED'
     LIMIT 1`,
    [userId, userId, otherUserId, otherUserId],
  );
  return rows.length > 0;
}

/**
 * Ce que l'onglet d'une fiche de joueur a le droit de nommer : le pseudo, et le
 * fait que le compte soit supprimé — `playerPageTitle` tait alors le pseudo
 * d'emprunt. Lecture d'une ligne, sans les statistiques ni les règles de
 * visibilité de {@link getFullProfile} : aucun des champs réglables n'y figure.
 */
export async function getPlayerPageIdentity(userId: number): Promise<PlayerPageIdentity | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { pseudo: string; is_deleted: 0 | 1 })[]>(
    `SELECT pseudo, is_deleted FROM bg_users WHERE id = ? LIMIT 1`,
    [userId],
  );
  if (rows.length === 0) return null;
  return { pseudo: rows[0].pseudo, isDeleted: Boolean(rows[0].is_deleted) };
}

/** Le lecteur d'une fiche, tel que les règles de visibilité le demandent. */
export type ProfileViewer = {
  id: number;
  isAdmin?: boolean;
  roles?: readonly PlatformRole[];
};

export async function getFullProfile(
  viewer: ProfileViewer,
  targetUserId: number,
): Promise<FullProfileResponse | null> {
  const viewerId = viewer.id;
  const viewerIsAdmin = Boolean(viewer.isAdmin);
  const canModerate = can(viewer, "moderation");
  const db = await getDatabase();

  const [userRows] = await db.execute<UserRow[]>(
    `SELECT
      id,
      pseudo,
      avatar_url,
      overwatch_battletag,
      marvel_rivals_tag,
      discord_pseudo,
      discord_verified_at,
      is_adult,
      visible_avatar,
      visible_overwatch,
      visible_marvel,
      visible_major,
      visible_discord,
      open_to_recruitment,
      is_admin,
      platform_roles_json,
      is_deleted,
      created_at
    FROM bg_users
    WHERE id = ?
    LIMIT 1`,
    [targetUserId],
  );

  if (userRows.length === 0) return null;

  const isSelf = viewerId === targetUserId;
  const isDeleted = Boolean(userRows[0].is_deleted);
  // Un compte supprimé n'a plus de titre de staff à afficher : l'anonymisation
  // les efface en base, et `reconcileDeletedAccounts` rattrape les comptes
  // supprimés avant la règle — la lecture n'a pas de cas particulier à tenir.
  const targetIsAdmin = Boolean(userRows[0].is_admin);
  const targetRoles = resolveRoles(targetIsAdmin, userRows[0].platform_roles_json);
  // `isDeleted` voyage jusqu'à la fiche, qui doit **annoncer** le compte
  // supprimé : son pseudo d'emprunt se lit comme un pseudo ordinaire.
  const profile: PublicUserProfile = { ...mapPublicUser(userRows[0]), isDeleted };
  const discordVerified = userRows[0].discord_verified_at != null;

  if (!isSelf) applyVisibility(profile, false);

  // **Le tag Discord passe par sa propre règle**, et pas par `applyVisibility` :
  // son réglage de visibilité ne vaut que pour un tag certifié, et il a en plus
  // un public que le réglage ne commande pas — l'organisation (voir
  // `lib/shared/discord-identity.ts`). La question du tournoi n'est posée que
  // lorsqu'elle peut changer la réponse — un administrateur voit de toute façon,
  // un tag rendu visible aussi, le lecteur ordinaire ne voit de toute façon
  // pas, et une requête de plus sur chaque fiche consultée n'aurait servi à
  // personne.
  // La question est partagée avec le BattleTag ci-dessous : posée une fois au plus.
  let activeTournament: Promise<boolean> | null = null;
  const targetInActiveTournament = () => (activeTournament ??= isInActiveTournament(targetUserId));

  const discordVisible = profile.visibility.discord;
  const needsTournamentCheck =
    !isSelf &&
    !viewerIsAdmin &&
    !discordVisible &&
    can(viewer, "tournaments") &&
    discordVerified;
  profile.discordPseudo = visibleDiscordTag(userRows[0].discord_pseudo, viewer, {
    userId: targetUserId,
    verified: discordVerified,
    visible: discordVisible,
    inActiveTournament: needsTournamentCheck ? await targetInActiveTournament() : false,
  });

  // **Le BattleTag masqué ne l'est pas pour tout le monde** : les autres joueurs
  // d'un match et l'arbitrage d'un tournoi vivant le lisent encore — ce que la
  // modale de `/profil` annonce au joueur quand il le masque. `applyVisibility`
  // l'a effacé plus haut sans connaître le lecteur ; la règle le repose ici, sur
  // la valeur brute.
  const rawBattletag = userRows[0].overwatch_battletag;
  const battletagSubject = { userId: targetUserId, visible: profile.visibility.overwatch };
  if (battletagNeedsTournamentContext(rawBattletag, viewer, battletagSubject)) {
    // Deux questions indépendantes : posées ensemble, un seul aller-retour d'attente.
    const [shares, inActive] = await Promise.all([
      sharesLiveMatch(targetUserId, viewerId),
      can(viewer, "tournaments") ? targetInActiveTournament() : Promise.resolve(false),
    ]);
    profile.overwatchBattletag = visibleBattletag(rawBattletag, viewer, {
      ...battletagSubject,
      sharesLiveMatch: shares,
      inActiveTournament: inActive,
    });
  }
  // **La pastille ne suit pas le tag** (`canSeeDiscordVerification`) : le tag dit
  // *comment* joindre le joueur, la certification dit seulement *qu'il est
  // joignable*. Le second fait ne nomme personne — et il manque à quelqu'un de
  // précis, le capitaine dont le tournoi exige « tous les Discord vérifiés », qui
  // lisait jusqu'ici un refus sans savoir qui de son roster devait certifier.
  profile.discordVerified = discordVerified;

  const [timelineRows] = await db.execute<TeamTimelineRow[]>(
    `SELECT
      tm.team_id,
      t.name AS team_name,
      tm.joined_at,
      tm.left_at,
      tm.roles_json
     FROM bg_team_members tm
     JOIN bg_teams t ON t.id = tm.team_id
     WHERE tm.user_id = ?
     ORDER BY tm.joined_at DESC`,
    [targetUserId],
  );

  const timeline: UserTeamTimeline[] = timelineRows.map((row) => ({
    teamId: Number(row.team_id),
    teamName: row.team_name,
    joinedAt: toIso(row.joined_at) ?? new Date().toISOString(),
    leftAt: toIso(row.left_at),
    roles: parseRoles(row.roles_json),
  }));

  // Statistiques et palmarès viennent de la même collecte (`stats-service`) :
  // mêmes définitions que côté équipe, et surtout mêmes bornes d'appartenance.
  // L'ancienne requête, jointe sans condition de date, listait aussi le même
  // tournoi une fois par équipe du joueur.
  const { stats, tournaments } = await getPlayerEntityStats(targetUserId);

  return {
    profile,
    stats,
    teamsTimeline: timeline,
    tournaments,
    // Ne pas divulguer qui est admin / quels rôles aux non-admins : réservé au viewer admin.
    isAdmin: viewerIsAdmin ? targetIsAdmin : false,
    roles: viewerIsAdmin ? targetRoles : [],
    // Les rôles staff sont des titres publics affichés à tous les visiteurs.
    displayRoles: targetRoles,
    isSelf,
    viewerIsAdmin,
    canModerate,
    // Calculé sur la valeur **brute**, avant que `applyVisibility` ne la
    // filtre selon `visible_avatar` — sans quoi un avatar masqué au lecteur
    // masquerait aussi le bouton qui permet de le retirer.
    moderationAvatarPresent: canModerate && Boolean(userRows[0].avatar_url),
    // Réservés à la modération, comme le bouton qu'ils commandent : qu'un
    // compte soit suspendu, et pourquoi, ne regarde que lui et elle.
    moderationSuspension: canModerate && !isDeleted ? await getActiveSuspension(targetUserId) : null,
    moderationSuspendable: canModerate && !isDeleted && !isSelf && !targetIsAdmin,
  };
}
