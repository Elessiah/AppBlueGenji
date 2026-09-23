import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { statusFromTeams } from "./_internal";

/**
 * **Effets en cascade** d'une correction de résultat dans un tableau à
 * élimination (liens `next_winner_match_id` / `next_loser_match_id`).
 *
 * Tant qu'un résultat ne pouvait que *poser* une équipe dans le créneau d'aval,
 * le corriger revenait à l'y remplacer par une autre (`pushTeamToTarget`), et le
 * verrou de `match-lock` garantissait que rien n'avait été joué derrière. Le
 * **double forfait** pose un **vide** : le match suivant, privé d'un camp, est
 * clos d'office en exemption (`tryAutoResolveByes`), l'adversaire qui
 * l'attendait monte d'un tour, et l'exemption peut en entraîner d'autres — deux
 * doubles forfaits voisins font un match fantôme, dont la cible devient à son
 * tour une exemption. Toute une chaîne de rencontres **résolues par le moteur**
 * descend donc d'un seul résultat, et la corriger dans un sens comme dans
 * l'autre doit la défaire :
 *
 * - double forfait → vainqueur : l'exemption d'aval n'a plus lieu d'être, son
 *   bénéficiaire doit redescendre d'un tour, et tout ce qu'il avait atteint en
 *   passant se vide avec lui ;
 * - vainqueur → double forfait : le créneau garni doit être **vidé** —
 *   `pushTeamToTarget` ne sait pas écrire un vide, il ignore un `null` —, pour
 *   que l'exemption naisse à son tour.
 *
 * On défait, on ne recalcule pas : une fois la chaîne vidée, le résultat
 * corrigé est propagé par le chemin ordinaire (`finalizeMatch`), et les
 * exemptions qui restent justes sont reposées par `tryAutoResolveByes` — la même
 * fonction qui les avait posées. Le module ne connaît aucune règle d'exemption.
 *
 * **Ce qui a été joué n'est jamais touché.** Le verrou
 * (`checkDownstreamMatchesHaveNoScores`, qui traverse lui aussi les rencontres
 * résolues par le moteur) a refusé la correction avant d'arriver ici si une
 * rencontre réellement disputée se trouvait au bout de la chaîne ; la garde
 * ci-dessous n'est que le dernier rempart, au cas où un appelant l'oublierait.
 */

type CascadeRow = RowDataPacket & {
  id: number;
  status: string;
  is_bye: number | null;
  team1_id: number | null;
  team2_id: number | null;
  team1_score: number | null;
  team2_score: number | null;
  winner_team_id: number | null;
  forfeit_team_id: number | null;
  double_forfeit: number | null;
  team1_reported_at: Date | null;
  team2_reported_at: Date | null;
  next_winner_match_id: number | null;
  next_winner_slot: number | null;
  next_loser_match_id: number | null;
  next_loser_slot: number | null;
};

/** Les liens d'aval d'un match, tels que `finalizeMatch` les suit. */
export type CascadeLinks = {
  next_winner_match_id: number | null;
  next_winner_slot: number | null;
  next_loser_match_id: number | null;
  next_loser_slot: number | null;
};

/** Plafond de profondeur : un tableau à 256 engagées en compte moins de vingt. */
const MAX_DEPTH = 64;

async function loadRow(connection: PoolConnection, matchId: number): Promise<CascadeRow | null> {
  const [rows] = await connection.execute<CascadeRow[]>(
    `SELECT id, status, is_bye, team1_id, team2_id, team1_score, team2_score,
            winner_team_id, forfeit_team_id, double_forfeit,
            team1_reported_at, team2_reported_at,
            next_winner_match_id, next_winner_slot, next_loser_match_id, next_loser_slot
     FROM bg_matches WHERE id = ? LIMIT 1`,
    [matchId],
  );
  return rows[0] ?? null;
}

/**
 * La rencontre a-t-elle été **résolue par le moteur** — exemption ou match
 * fantôme — plutôt que disputée ? Même lecture que `hasScoreInput`
 * (`lib/shared/match-lock.ts`) : un camp manquant suffit, le score (1-0, 0-0)
 * ayant été posé par le moteur et non saisi.
 */
function isEngineResolved(row: CascadeRow): boolean {
  return row.team1_id === null || row.team2_id === null || Number(row.is_bye ?? 0) === 1;
}

/**
 * Vide un créneau d'aval et défait tout ce qui en était descendu.
 *
 * `keepTeamId` : l'équipe que la correction va reposer dans ce créneau. S'il
 * l'occupe déjà, il n'y a rien à défaire — même close d'office, la cible est
 * exactement ce qu'elle sera après la correction : son exemption tient à
 * **l'autre** créneau, que la correction ne touche pas. La rouvrir ferait
 * rouvrir puis reclore un tournoi pour un score corrigé sans changer de
 * vainqueur (date de clôture redatée, clôture annoncée deux fois).
 *
 * `force` : la cible **amont** vient d'être rouverte. Son résultat n'est plus
 * acquis, donc tout ce qu'il avait fait descendre doit l'être aussi — y compris
 * quand le créneau semble déjà juste : un match fantôme rouvert (deux créneaux
 * vides, aucune équipe à reposer) a causé l'exemption de sa cible, qui n'a plus
 * lieu d'être.
 */
async function vacateSlot(
  connection: PoolConnection,
  targetId: number,
  slot: number,
  keepTeamId: number | null,
  depth: number,
  force: boolean,
): Promise<number> {
  if (depth > MAX_DEPTH) return 0;
  const target = await loadRow(connection, targetId);
  if (!target) return 0;

  const current = slot === 1 ? target.team1_id : target.team2_id;
  const currentId = current === null ? null : Number(current);
  const closed = target.status === "COMPLETED";

  if (currentId === keepTeamId && !(force && closed)) return 0;

  let reopened = 0;
  if (closed) {
    if (!isEngineResolved(target)) {
      // Une rencontre disputée derrière : le verrou aurait dû refuser. On
      // refuse ici plutôt que d'effacer un résultat que personne n'a montré.
      throw new Error("CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES");
    }
    // Ce que l'exemption avait fait monter redescend, en entier : la cible sera
    // tranchée de nouveau, et rien ne dit encore par qui.
    reopened += 1 + (await undoPropagation(connection, target, null, null, depth + 1, true));
    await connection.execute(
      `UPDATE bg_matches
       SET team1_score = NULL, team2_score = NULL,
           winner_team_id = NULL, loser_team_id = NULL,
           forfeit_team_id = NULL, double_forfeit = 0
       WHERE id = ?`,
      [targetId],
    );
  }

  const team1 = slot === 1 ? null : target.team1_id;
  const team2 = slot === 2 ? null : target.team2_id;
  const column = slot === 1 ? "team1_id" : "team2_id";
  // L'antenne se referme quand une engagée **quitte** l'affiche : c'est la
  // règle de `pushTeamToTarget`, qui ne la verrait plus — le créneau étant vide
  // quand la nouvelle équipe y arrive.
  const leaving = currentId !== null && currentId !== keepTeamId;
  await connection.execute(
    `UPDATE bg_matches
     SET ${column} = NULL,
         status = ?${leaving ? ", live_started_at = NULL" : ""}
     WHERE id = ?`,
    [statusFromTeams(team1 === null ? null : Number(team1), team2 === null ? null : Number(team2)), targetId],
  );
  return reopened;
}

/**
 * Défait, en aval de `match`, ce que son résultat **actuel** avait posé, avant
 * qu'un nouveau résultat (`nextWinnerTeamId`, `nextLoserTeamId`) ne soit
 * propagé par `finalizeMatch`.
 */
async function undoPropagation(
  connection: PoolConnection,
  match: CascadeLinks,
  nextWinnerTeamId: number | null,
  nextLoserTeamId: number | null,
  depth: number,
  force: boolean,
): Promise<number> {
  const links: [number | null, number | null, number | null][] = [
    [match.next_winner_match_id, match.next_winner_slot, nextWinnerTeamId],
    [match.next_loser_match_id, match.next_loser_slot, nextLoserTeamId],
  ];

  let reopened = 0;
  for (const [targetId, slot, keep] of links) {
    if (targetId === null || slot === null) continue;
    reopened += await vacateSlot(connection, Number(targetId), Number(slot), keep, depth, force);
  }
  return reopened;
}

/**
 * Prépare le plateau à recevoir le nouveau résultat de `match` : vide les
 * créneaux d'aval qui changent, et rouvre les rencontres que le moteur avait
 * closes d'office sur l'ancien résultat — en cascade.
 *
 * À appeler **avant** `finalizeMatch`, qui propagera ensuite le résultat, puis
 * `tryAutoResolveByes`, qui reposera les exemptions encore justes.
 *
 * @returns le nombre de rencontres closes d'office qui ont été **rouvertes**.
 *   Au-delà de zéro, le tableau a de nouveau quelque chose à jouer : un tournoi
 *   que ces exemptions avaient clos doit être rouvert par l'appelant, sans quoi
 *   il resterait « terminé » avec une rencontre que plus rien ne ferait jouer.
 */
export async function detachDownstreamOutcome(
  connection: PoolConnection,
  match: CascadeLinks,
  next: { winnerTeamId: number | null; loserTeamId: number | null },
): Promise<number> {
  return undoPropagation(connection, match, next.winnerTeamId, next.loserTeamId, 0, false);
}
