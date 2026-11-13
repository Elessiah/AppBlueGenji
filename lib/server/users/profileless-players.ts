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
import { cached, cachedStale } from "@/lib/server/cache";
import { PROFILELESS_PLAYERS_CACHE_KEY } from "@/lib/server/ranking-cache";
import { sortedIdsInclude } from "@/lib/shared/sorted-ids";
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
  // Trié ici aussi, sans se fier au seul `ORDER BY` : la recherche
  // dichotomique (`sortedIdsInclude`) en dépend.
  const ids = rows.map((row) => Number(row.id)).sort((a, b) => a - b);
  if (ids.length <= PROFILELESS_PLAYERS_MAX) return ids;
  console.warn(
    `[profileless-players] ${ids.length} comptes sans fiche : liste tronquée à ${PROFILELESS_PLAYERS_MAX}.`,
  );
  return ids.slice(0, PROFILELESS_PLAYERS_MAX);
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
 * Au-delà, la liste est tronquée (les plus récents d'abord retranchés) : elle
 * voyage dans la charge de **chaque** page d'un visiteur connecté, et nul ne
 * l'élague. Un lien au-delà mène au pire à une fiche 404, comme sur une panne
 * de lecture ; un avertissement le dit, pour qu'on revoie la forme de la liste
 * avant d'y arriver.
 */
export const PROFILELESS_PLAYERS_MAX = 20_000;

/** Après une lecture en échec, aucune relance avant ce délai : la base en peine n'est pas martelée. */
export const PROFILELESS_FAILURE_BACKOFF_MS = 15_000;

/** Instant de la dernière lecture en échec. Remis à zéro par la première réussite. */
let lastFailureAt: number | null = null;

/** Conservation de la dernière liste au-delà de sa durée de vie, pour servir pendant une panne. */
const PROFILELESS_PLAYERS_RETAIN_MS = 60 * 60_000;

/** Tests : oublie la dernière panne. */
export function resetProfilelessFailureForTests(): void {
  lastFailureAt = null;
}

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
    // Le délai de grâce rejoue l'erreur déjà dite : une ligne par panne, pas par page.
    if (!(error instanceof ProfilelessBackoffError)) {
      console.error(`[profileless-players] lecture impossible : ${failureReason(error)}`);
    }
    return [];
  }
}

/** Levée pendant le délai de grâce qui suit une panne de lecture (rien n'est relancé). */
class ProfilelessBackoffError extends Error {
  constructor() {
    super("PROFILELESS_READ_BACKOFF");
    this.name = "ProfilelessBackoffError";
  }
}

/**
 * La liste, mutualisée. Une lecture en échec n'est pas gardée par le cache :
 * sans ce garde-fou, chaque page d'un visiteur connecté (mise en page racine) et
 * chaque rafraîchissement client relançaient le balayage complet sur une base
 * déjà en peine. Pendant {@link PROFILELESS_FAILURE_BACKOFF_MS} on sert donc la
 * dernière liste connue (périmée, conservée une heure), ou on refuse sans
 * requête.
 */
async function readProfilelessPlayerIds(): Promise<number[]> {
  const now = Date.now();
  if (lastFailureAt !== null && now - lastFailureAt >= 0 && now - lastFailureAt < PROFILELESS_FAILURE_BACKOFF_MS) {
    const stale = cachedStale<number[]>(PROFILELESS_PLAYERS_CACHE_KEY, now);
    if (stale !== undefined) return stale;
    throw new ProfilelessBackoffError();
  }
  try {
    const ids = await cached(PROFILELESS_PLAYERS_CACHE_KEY, PROFILELESS_PLAYERS_TTL_MS, computeProfilelessPlayerIds, {
      retainMs: PROFILELESS_PLAYERS_RETAIN_MS,
    });
    lastFailureAt = null;
    return ids;
  } catch (error) {
    lastFailureAt = now;
    const stale = cachedStale<number[]>(PROFILELESS_PLAYERS_CACHE_KEY, now);
    if (stale !== undefined) return stale;
    throw error;
  }
}

/**
 * Un compte **anonymisé** (déjà lu comme supprimé, suppression non plus en
 * attente) est-il sans fiche ? La même liste que celle qui décide des liens :
 * la fiche et ses liens ne se contredisent pas. Si la liste ne se lit pas, la
 * question se pose au seul compte en base — une panne ne rouvre pas la fiche
 * d'un compte qui n'a jamais joué (D13). Si la seconde lecture échoue aussi,
 * le compte est dit sans fiche : la panne rend une 404, jamais une erreur ni
 * une fiche qu'il n'aurait peut-être pas.
 */
export async function anonymizedAccountHasNoPage(userId: number): Promise<boolean> {
  try {
    return sortedIdsInclude(await readProfilelessPlayerIds(), userId);
  } catch (error) {
    if (!(error instanceof ProfilelessBackoffError)) {
      console.error(`[profileless-players] liste illisible, lecture du compte : ${failureReason(error)}`);
    }
  }
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<(RowDataPacket & { played: number })[]>(
      `SELECT ${accountTraceSql().played} AS played FROM (SELECT ? AS id) u`,
      [userId],
    );
    return !Number(rows[0]?.played ?? 0);
  } catch (error) {
    console.error(`[profileless-players] compte illisible, fiche fermée : ${failureReason(error)}`);
    return true;
  }
}
