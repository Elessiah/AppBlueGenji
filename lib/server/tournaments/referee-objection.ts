/**
 * Opposition d'un arbitre retenue par le staff (`docs/features/MATCH_REFEREE.md`,
 * décision 42b du 2026-10-28) : l'arbitre s'oppose (formulaire de signalement,
 * catégorie RGPD) à être présenté aux parties de ses matchs ; le staff la
 * retient ici.
 *
 * - Retenue (`bg_users.referee_objection_at`), elle le retire de **tous** ses
 *   matchs non terminés (le staff en désigne un autre) et lui ferme tout
 *   arbitrage : ni « Je prends ce match », ni désignation par le staff
 *   (`REFEREE_OBJECTION`, contrôlé sous verrou dans `writeReferee`). Les
 *   matchs terminés gardent leur arbitre.
 * - Levée (à sa demande), il peut de nouveau arbitrer ; rien ne lui est rendu.
 *
 * Ordre des verrous : l'écriture de l'opposition est une instruction seule
 * (verrou exclusif sur la ligne du compte, relâché à son commit), puis chaque
 * match est retiré dans **sa propre transaction**, sous le seul verrou du
 * match (`releaseObjectingReferee`) — comme tout geste d'arbitrage, jamais
 * deux matchs verrouillés ensemble ni le tournoi (les inscrites ne sont ni lues
 * ni écrites). Une transaction pour tous ses matchs, à travers plusieurs
 * tournois, tiendrait leurs verrous le temps du balayage face au maintien des
 * lancements, qui en prend un à la fois. Une désignation concurrente lit
 * l'opposition en partage (`refereeObjectionUpheld(…, true)`) : elle passe
 * avant l'écriture, et le balayage qui suit la voit, ou après, et elle est
 * refusée. Le balayage est rejouable : retenir de nouveau une opposition déjà
 * retenue le refait.
 */
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { loadRefereeEligibility } from "./cast-eligibility";
import { releaseObjectingReferee } from "./match-launch";

/**
 * Ce que le geste a fait : `changed` faux s'il était déjà dans cet état ;
 * `released` : matchs retirés ; `failed` : matchs que le balayage n'a pas pu
 * traiter (le geste se rejoue en retenant de nouveau l'opposition).
 */
export type RefereeObjectionResult = { changed: boolean; released: number; failed: number };

/**
 * Retient (`upheld`) ou lève l'opposition d'arbitre du compte `refereeId`.
 *
 * Seul un arbitre (permission `tournaments`, relue en base) peut voir son
 * opposition retenue : l'identifiant de la route ne suffit pas, sans quoi le
 * staff écrirait une opposition sur n'importe quel compte. La lever reste
 * possible sur tout compte qui en porte une (un arbitre privé depuis de la
 * permission compris).
 *
 * @throws `USER_NOT_FOUND` — compte supprimé (ou absent, à la levée) ;
 *   `NOT_REFEREE` — retenir sur un compte absent ou qui n'arbitre pas.
 */
export async function setRefereeObjection(refereeId: number, upheld: boolean): Promise<RefereeObjectionResult> {
  const db = await getDatabase();
  if (upheld && (await loadRefereeEligibility(db, refereeId)) === "NOT_REFEREE") throw new Error("NOT_REFEREE");
  const [result] = await db.execute<ResultSetHeader>(
    upheld
      ? `UPDATE bg_users SET referee_objection_at = NOW()
          WHERE id = ? AND is_deleted = 0 AND referee_objection_at IS NULL`
      : `UPDATE bg_users SET referee_objection_at = NULL
          WHERE id = ? AND is_deleted = 0 AND referee_objection_at IS NOT NULL`,
    [refereeId],
  );
  const changed = result.affectedRows > 0;
  if (!changed) {
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT id FROM bg_users WHERE id = ? AND is_deleted = 0 LIMIT 1`, [
      refereeId,
    ]);
    if (rows.length === 0) throw new Error("USER_NOT_FOUND");
  }
  if (!upheld) return { changed, released: 0, failed: 0 };
  return { changed, ...(await releaseFromUnfinishedMatches(refereeId)) };
}

/**
 * Retire l'arbitre de chacun de ses matchs non terminés, un par un. Un échec
 * n'arrête pas les autres ; il est compté (et journalisé), jamais levé : le
 * geste, déjà écrit, doit rester tracé par la route.
 */
async function releaseFromUnfinishedMatches(refereeId: number): Promise<{ released: number; failed: number }> {
  const db = await getDatabase();
  let matches: (RowDataPacket & { id: number })[];
  try {
    [matches] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM bg_matches WHERE referee_user_id = ? AND status <> 'COMPLETED' ORDER BY id`,
      [refereeId],
    );
  } catch (error) {
    // L'opposition est déjà écrite : compter l'échec, pour que la route trace
    // le geste (auteur dans pm2) avant de répondre 500, plutôt que lever.
    console.error("[referee-objection] matchs non terminés illisibles :", error);
    return { released: 0, failed: 1 };
  }
  let released = 0;
  let failed = 0;
  for (const match of matches) {
    try {
      if (await releaseObjectingReferee(Number(match.id), refereeId)) released += 1;
    } catch (error) {
      failed += 1;
      console.error(`[referee-objection] retrait du match #${match.id} impossible :`, error);
    }
  }
  return { released, failed };
}
