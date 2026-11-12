/**
 * Les comptes supprimés **sans fiche** (décision D13).
 *
 * Un compte anonymisé garde sa fiche `/joueurs/<id>` sous son pseudo d'emprunt
 * **seulement s'il a joué** : ses statistiques appartiennent aussi aux équipes
 * qu'il a affrontées, et brackets et feuilles de match y mènent. Celui que la
 * ligne ne retient que pour une autre raison — une entrée solo engagée sans
 * match compté, une équipe possédée, un tournoi organisé — n'a rien à montrer :
 * sa fiche répond comme un compte inconnu (404), et les liens qui y menaient
 * rendent le nom en texte (`components/profileless-players.tsx`).
 *
 * « A joué » est la question même de la suppression (`accountTraceSql().played`,
 * match compté de son entrée solo ou d'une équipe dont il était membre pendant
 * le tournoi) : la fiche et la décision d'anonymiser ne peuvent pas se
 * contredire. Voir `docs/features/ACCOUNT_DELETION.md`.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { failureReason } from "@/lib/server/failure-reason";
import { cachedRanking, RANKING_LIST_KEY_PREFIX } from "@/lib/server/ranking-cache";
import { accountTraceSql } from "./account-deletion";

/**
 * Un compte **supprimé** a-t-il joué ? Ne se pose que pour une ligne déjà lue
 * comme supprimée (`getFullProfile`, `getPlayerPageIdentity`).
 */
export async function deletedAccountHasStats(userId: number): Promise<boolean> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { played: number })[]>(
    `SELECT ${accountTraceSql().played} AS played FROM (SELECT ? AS id) u`,
    [userId],
  );
  return Boolean(Number(rows[0]?.played ?? 0));
}

async function computeProfilelessPlayerIds(): Promise<number[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT u.id
       FROM bg_users u
      WHERE u.is_deleted = 1
        AND (u.deletion_requested_at IS NOT NULL OR NOT ${accountTraceSql().played})
      ORDER BY u.id`,
  );
  return rows.map((row) => Number(row.id));
}

/**
 * Les comptes supprimés sans fiche, par id croissant.
 *
 * Mutualisé dans le cache du classement, sous le préfixe des entrées tirées de
 * la liste : **tout** score qui tombe l'oublie (`invalidateTeamRanking`), comme
 * toute suppression de compte (`invalidateTeamIdentityViews`). Ne lève jamais :
 * une panne de lecture rend des liens (au pire vers une fiche 404) plutôt
 * qu'une page tombée — il est lu par la mise en page racine.
 */
export async function loadProfilelessPlayerIds(): Promise<number[]> {
  try {
    return await cachedRanking(`${RANKING_LIST_KEY_PREFIX}profileless-players`, computeProfilelessPlayerIds);
  } catch (error) {
    console.error(`[profileless-players] lecture impossible : ${failureReason(error)}`);
    return [];
  }
}
