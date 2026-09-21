/**
 * Les contacts Discord d'un plateau, pour qui doit le tenir.
 *
 * C'est l'usage qui a motivé toute la certification : un arbitre doit pouvoir
 * joindre les engagés de **son** tournoi sans ouvrir quinze fiches de profil ni
 * demander leur tag une par une. La liste rassemble donc, par engagé, les
 * joueurs joignables — et ceux qui ne le sont pas, ce qui est justement
 * l'information dont on a besoin avant de reprogrammer une manche.
 *
 * **Une lecture délibérée, jamais l'instantané.** Rien de ceci ne voyage dans
 * `TournamentSnapshot`, qui est calculé une fois et **diffusé tel quel à tous
 * les abonnés du flux** : y glisser des tags reviendrait à les envoyer à tout
 * spectateur connecté. C'est une route à part, gardée par la permission, appelée
 * quand l'arbitre en a besoin.
 *
 * **Pourquoi la règle de visibilité n'est pas rejouée ici.** `canViewDiscordTag`
 * demande trois choses de l'arbitre : la permission `tournaments`, que le joueur
 * soit engagé dans un tournoi **vivant**, et que son tag soit **certifié**. Les
 * deux premières sont tenues par la route — la permission, et l'état du tournoi
 * (`tournamentGrantsContactAccess`, sans quoi ce panneau rendrait après la
 * clôture ce que la fiche d'un joueur refuse) ; la troisième l'est ici, en SQL,
 * sur la colonne qui la porte. Un tag non certifié ne sort pas, administrateur
 * compris.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import type { TournamentState } from "@/lib/shared/types";

/**
 * État du tournoi, pour la seule question que la route ait à lui poser : ce
 * plateau ouvre-t-il encore ses contacts ?
 *
 * `null` = le tournoi n'existe pas. Lecture minuscule et à part plutôt qu'une
 * jointure dans la requête des contacts : il faut pouvoir **refuser sans rien
 * lire**, et un `WHERE t.state <> 'FINISHED'` aurait rendu une liste vide —
 * impossible à distinguer d'un plateau sans engagé.
 */
export async function loadContactTournamentState(
  tournamentId: number,
): Promise<TournamentState | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { state: TournamentState })[]>(
    `SELECT state FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournamentId],
  );
  return rows[0]?.state ?? null;
}

/** Un joueur d'un engagé, tel que l'arbitrage a besoin de le voir. */
export type EntrantContact = {
  userId: number;
  pseudo: string;
  /** Tag certifié, `null` quand le joueur n'en a pas certifié. */
  discordTag: string | null;
};

/** Un engagé et ses joueurs joignables. */
export type EntrantContactGroup = {
  teamId: number;
  teamName: string;
  /**
   * L'engagé est-il joignable ? Faux quand **aucun** de ses joueurs n'a certifié
   * son tag — le cas qui appelle un geste (relancer le capitaine, envisager un
   * forfait), d'où un champ plutôt qu'un calcul refait par chaque écran.
   */
  reachable: boolean;
  members: EntrantContact[];
};

type ContactRow = RowDataPacket & {
  team_id: number;
  team_name: string;
  user_id: number | null;
  pseudo: string | null;
  discord_tag: string | null;
};

/**
 * Contacts des engagés d'un tournoi, dans l'ordre du tirage (`seed`).
 *
 * Une seule requête pour tout le plateau : la liste s'ouvre en entier, et
 * trente-deux allers-retours par engagé sur une page d'arbitrage n'auraient
 * servi à rien.
 *
 * Les deux formes d'engagé sont couvertes. Une équipe rend ses membres actifs
 * (`left_at IS NULL` — un joueur parti n'est plus un interlocuteur) ; une
 * **entrée solo** n'a aucun membre, son joueur se lit sur `solo_user_id`. Une
 * **équipe fantôme** n'a ni l'un ni l'autre : elle ressort avec zéro joueur,
 * ce qui est exact — le staff sait qui il a invité, le site ne le sait pas.
 */
export async function loadTournamentContacts(
  tournamentId: number,
): Promise<EntrantContactGroup[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<ContactRow[]>(
    `SELECT
       t.id AS team_id,
       t.name AS team_name,
       u.id AS user_id,
       u.pseudo AS pseudo,
       CASE WHEN u.discord_verified_at IS NULL THEN NULL ELSE u.discord_pseudo END AS discord_tag
     FROM bg_tournament_registrations r
     JOIN bg_teams t ON t.id = r.team_id
     LEFT JOIN bg_team_members tm ON tm.team_id = t.id AND tm.left_at IS NULL
     LEFT JOIN bg_users u ON u.id = COALESCE(tm.user_id, t.solo_user_id)
     WHERE r.tournament_id = ?
     ORDER BY r.seed ASC, t.id ASC, u.pseudo ASC`,
    [tournamentId],
  );

  const groups = new Map<number, EntrantContactGroup>();
  for (const row of rows) {
    const teamId = Number(row.team_id);
    let group = groups.get(teamId);
    if (!group) {
      group = { teamId, teamName: row.team_name, reachable: false, members: [] };
      groups.set(teamId, group);
    }
    // La jointure gauche rend une ligne sans joueur pour une fantôme : l'engagé
    // existe, son roster est vide.
    if (row.user_id === null) continue;
    group.members.push({
      userId: Number(row.user_id),
      pseudo: row.pseudo ?? "",
      discordTag: row.discord_tag,
    });
    if (row.discord_tag) group.reachable = true;
  }

  return [...groups.values()];
}
