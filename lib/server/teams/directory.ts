import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { toIso } from "@/lib/server/serialization";
import type { TeamListItem } from "@/lib/shared/types";
import { cachedStats } from "@/lib/server/stats-cache";
import { loadTeamRanking } from "@/lib/server/ranking-service";
import { compareRankedTeams, rankingMatchJoinSql } from "@/lib/shared/ranking";
import { visibleAvatarUrl } from "@/lib/shared/avatar";
import { localUploadUrl } from "@/lib/shared/uploads";

/**
 * Longueur de la barre de forme des cartes d'annuaire. Les fiches en montrent
 * moins (`FORM_LENGTH` de `lib/shared/stats.ts`) : c'est le même historique,
 * lu sur une fenêtre plus courte, jamais un autre calcul.
 */
const LIST_FORM_LENGTH = 10;

type TeamListForm = ("w" | "l" | "d")[];

/**
 * Forme de chaque équipe pour l'annuaire : ses dix derniers résultats, le plus
 * récent en tête.
 *
 * La requête parcourt **tous** les matchs de toutes les équipes, par une
 * jointure en `OR` peu favorable aux index, et elle était rejouée à chaque
 * chargement de `/equipes` alors qu'elle ne dépend pas du lecteur. Elle passe
 * donc par `cachedStats`, comme le bilan des joueurs : vidé à chaque score
 * (`tournaments/notifications.ts`), le cache ne retarde jamais une forme — un
 * roster qui bouge ne la change pas, et une équipe créée n'en a aucune.
 */
async function loadTeamListForms(): Promise<Map<number, TeamListForm>> {
  // Forme : les dix derniers résultats de chaque équipe, le plus récent en
  // tête. Même assiette de matchs que le bilan (`playedMatchSql`) et même
  // chronologie que les fiches (`updated_at`, à défaut les dates du tournoi) :
  // la barre de forme de la carte est le début de celle de la fiche, pas une
  // autre lecture des mêmes matchs. Le découpage par équipe se fait en SQL, ce
  // qui évite aussi de ne servir que les 1000 derniers matchs du site — au-delà,
  // les équipes les moins actives n'avaient plus de forme du tout.
  //
  // Le **nul** a sa lettre, et c'est cette assiette partagée qui l'y oblige :
  // depuis qu'elle admet les matchs sans vainqueur, un `CASE … ELSE 'l'` les
  // rangeait en défaites, si bien que la carte affichait une case rouge là où la
  // fiche de la même équipe annonçait « N ».
  const db = await getDatabase();
  const [formRows] = await db.execute<
    (RowDataPacket & { team_id: number; result: "w" | "l" | "d" })[]
  >(
    `SELECT team_id, result
     FROM (
       SELECT
         t.id AS team_id,
         CASE
           WHEN m.winner_team_id IS NULL THEN 'd'
           WHEN m.winner_team_id = t.id THEN 'w'
           ELSE 'l'
         END AS result,
         ROW_NUMBER() OVER (
           PARTITION BY t.id
           ORDER BY COALESCE(m.updated_at, tr.finished_at, tr.start_at) DESC, m.id DESC
         ) AS rn
       FROM bg_teams t
       JOIN bg_matches m
         ON ${rankingMatchJoinSql("t.id")}
       JOIN bg_tournaments tr ON tr.id = m.tournament_id
       WHERE t.deleted_at IS NULL
         AND t.solo_user_id IS NULL
     ) ranked
     WHERE rn <= ${LIST_FORM_LENGTH}
     ORDER BY team_id ASC, rn ASC`,
  );

  const formByTeam = new Map<number, TeamListForm>();
  for (const row of formRows) {
    const teamId = Number(row.team_id);
    const form = formByTeam.get(teamId) ?? [];
    form.push(row.result);
    formByTeam.set(teamId, form);
  }
  return formByTeam;
}

/**
 * La forme de toutes les équipes (dix derniers résultats, le plus récent en
 * tête), par la même photo mutualisée que l'annuaire — la page `/classement`
 * lit donc exactement les barres de `/equipes`.
 */
export function loadCachedTeamForms(): Promise<Map<number, TeamListForm>> {
  return cachedStats("team-list-forms", loadTeamListForms);
}

/**
 * Annuaire des équipes.
 *
 * @param viewerId Lecteur de la liste. Sert au seul masquage d'avatar : sans
 *   lui, un joueur qui a masqué le sien ne le verrait pas non plus sur la carte
 *   de sa propre équipe.
 */
export async function listTeams(viewerId: number | null = null): Promise<TeamListItem[]> {
  const db = await getDatabase();

  // Effectif et identité de chaque équipe. Le bilan (victoires, défaites,
  // points) ne se calcule **pas** ici : il vient de `loadTeamRanking`, source
  // unique du classement du site. L'agréger dans cette requête revenait à le
  // multiplier par l'effectif de l'équipe — la jointure des membres et celle
  // des matchs formaient un produit cartésien, et une équipe de six joueurs
  // affichait six fois ses victoires.
  const [teamRows] = await db.execute<
    (RowDataPacket & {
      id: number;
      name: string;
      tag: string | null;
      logo_url: string | null;
      created_at: Date;
      members_count: number;
      is_ghost: 0 | 1;
    })[]
  >(
    `SELECT
      t.id,
      t.name,
      t.tag,
      t.logo_url,
      t.created_at,
      t.is_ghost,
      COALESCE(COUNT(tm.id), 0) AS members_count
     FROM bg_teams t
     LEFT JOIN bg_team_members tm ON tm.team_id = t.id AND tm.left_at IS NULL
     WHERE t.deleted_at IS NULL
       AND t.solo_user_id IS NULL
     GROUP BY t.id, t.name, t.tag, t.logo_url, t.created_at, t.is_ghost`,
  );

  // Forme : mutualisée (voir `loadTeamListForms`), elle ne dépend pas du lecteur.
  const formByTeam = await loadCachedTeamForms();

  // Bilan et points : une seule source pour l'annuaire, la fiche et le
  // leaderboard de la landing.
  const rankingByTeam = new Map(
    (await loadTeamRanking({ includeUnplayed: true })).map((row) => [row.teamId, row]),
  );

  // Get roster preview
  const [rosterRows] = await db.execute<
    (RowDataPacket & {
      team_id: number;
      user_id: number;
      pseudo: string;
      avatar_url: string | null;
      visible_avatar: 0 | 1;
    })[]
  >(
    `SELECT
      tm.team_id,
      u.id AS user_id,
      u.pseudo,
      u.avatar_url,
      u.visible_avatar
     FROM (
       SELECT team_id, user_id, ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY joined_at ASC) as rn
       FROM bg_team_members
       WHERE left_at IS NULL
     ) limited_members
     JOIN bg_team_members tm ON tm.user_id = limited_members.user_id AND tm.team_id = limited_members.team_id
     JOIN bg_users u ON u.id = tm.user_id
     WHERE limited_members.rn <= 6
     ORDER BY tm.team_id, tm.joined_at ASC`,
  );

  // Get games practiced
  const [gameRows] = await db.execute<
    (RowDataPacket & {
      team_id: number;
      game: "OW" | "MR";
    })[]
  >(
    `SELECT DISTINCT
      tr.team_id,
      t.game
     FROM bg_tournament_registrations tr
     JOIN bg_tournaments t ON t.id = tr.tournament_id
     ORDER BY tr.team_id, t.game`,
  );

  // Organize roster by team
  const rosterByTeam = new Map<
    number,
    { userId: number; pseudo: string; avatarUrl: string | null }[]
  >();
  for (const row of rosterRows) {
    if (!rosterByTeam.has(row.team_id)) {
      rosterByTeam.set(row.team_id, []);
    }
    const memberId = Number(row.user_id);
    rosterByTeam.get(row.team_id)!.push({
      userId: memberId,
      pseudo: row.pseudo,
      // Le réglage `visible_avatar` vaut ici comme sur une fiche de profil : la
      // vignette du roster lisait `avatar_url` sans le consulter, et rendait
      // donc à tout le site l'image que son propriétaire avait masquée.
      avatarUrl: visibleAvatarUrl(row.avatar_url, row.visible_avatar === 1, memberId === viewerId),
    });
  }

  // Organize games by team
  const gamesByTeam = new Map<number, ("OW" | "MR")[]>();
  for (const row of gameRows) {
    if (!gamesByTeam.has(row.team_id)) {
      gamesByTeam.set(row.team_id, []);
    }
    gamesByTeam.get(row.team_id)!.push(row.game);
  }

  // Transform rows and calculate rank
  const unsorted: Omit<TeamListItem, "rank">[] = teamRows.map((row) => {
    const id = Number(row.id);
    const ranked = rankingByTeam.get(id);
    return {
      id,
      name: row.name,
      tag: row.tag,
      logoUrl: localUploadUrl(row.logo_url),
      membersCount: Number(row.members_count),
      createdAt: toIso(row.created_at)!,
      wins: ranked?.wins ?? 0,
      losses: ranked?.losses ?? 0,
      points: ranked?.points ?? 0,
      // Copie : la table vient du cache, partagée entre tous les lecteurs.
      form: [...(formByTeam.get(id) ?? [])],
      games: gamesByTeam.get(id) || [],
      rosterPreview: rosterByTeam.get(id) || [],
      region: null,
      isGhost: row.is_ghost === 1,
    };
  });

  // Même ordre que le leaderboard de la landing et `/classement` : la cote, puis
  // les victoires, les défaites, les nuls et le nom. `TeamListItem` ne porte
  // pas les nuls : ils sont relus sur la ligne du classement, sans quoi deux
  // équipes à égalité se départageraient autrement qu'à `/classement`.
  const drawsOf = (id: number) => rankingByTeam.get(id)?.draws ?? 0;
  unsorted.sort((a, b) =>
    compareRankedTeams({ ...a, draws: drawsOf(a.id) }, { ...b, draws: drawsOf(b.id) }),
  );

  const teams: TeamListItem[] = unsorted.map((team, index) => ({
    ...team,
    rank: index + 1,
  }));

  return teams;
}
