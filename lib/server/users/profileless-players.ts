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
import { cached } from "@/lib/server/cache";
import { PROFILELESS_PLAYERS_CACHE_KEY } from "@/lib/server/ranking-cache";
import { accountTraceSql } from "./account-deletion";

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
 * Durée de vie de la liste. Une suppression, une réactivation ou un rattrapage
 * l'oublie aussitôt (`invalidateTeamIdentityViews`), comme une suppression de
 * tournoi (`invalidateTeamRanking`). Un score ne la vide pas : il donne au plus
 * une fiche à un compte anonymisé qui n'en avait pas (son nom reste du texte au
 * plus cette durée) ; une correction qui lui retire son seul match joué lui
 * laisse sa fiche, sous pseudo d'emprunt, au plus cette même durée.
 */
export const PROFILELESS_PLAYERS_TTL_MS = 10 * 60_000;

/**
 * Les comptes supprimés sans fiche, par id croissant.
 *
 * Mutualisé hors du préfixe du classement (que chaque score vide) :
 * le balayage des comptes supprimés n'est rejoué qu'à une écriture d'identité
 * ou à l'échéance. Ne lève jamais : une panne de lecture rend des liens (au
 * pire vers une fiche 404) plutôt qu'une page tombée — il est lu par la mise en
 * page racine.
 */
export async function loadProfilelessPlayerIds(): Promise<number[]> {
  try {
    return await readProfilelessPlayerIds();
  } catch (error) {
    console.error(`[profileless-players] lecture impossible : ${failureReason(error)}`);
    return [];
  }
}

function readProfilelessPlayerIds(): Promise<number[]> {
  return cached(PROFILELESS_PLAYERS_CACHE_KEY, PROFILELESS_PLAYERS_TTL_MS, computeProfilelessPlayerIds);
}

/** La liste vue en ensemble, rebâtie seulement quand le cache rend une autre liste. */
const profilelessSets = new WeakMap<readonly number[], ReadonlySet<number>>();

function asSet(ids: readonly number[]): ReadonlySet<number> {
  let set = profilelessSets.get(ids);
  if (set === undefined) {
    set = new Set(ids);
    profilelessSets.set(ids, set);
  }
  return set;
}

/**
 * Un compte **anonymisé** (déjà lu comme supprimé, suppression non plus en
 * attente) est-il sans fiche ? La même liste que celle qui décide des liens :
 * la fiche et ses liens ne se contredisent pas. Si la liste ne se lit pas, la
 * question se pose au seul compte en base — une panne ne rouvre pas la fiche
 * d'un compte qui n'a jamais joué (D13). Lève si les deux lectures échouent.
 */
export async function anonymizedAccountHasNoPage(userId: number): Promise<boolean> {
  try {
    return asSet(await readProfilelessPlayerIds()).has(userId);
  } catch (error) {
    console.error(`[profileless-players] liste illisible, lecture du compte : ${failureReason(error)}`);
  }
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { played: number })[]>(
    `SELECT ${accountTraceSql().played} AS played FROM (SELECT ? AS id) u`,
    [userId],
  );
  return !Number(rows[0]?.played ?? 0);
}
