import type { Pool, RowDataPacket } from "mysql2/promise";
import { withNamedLock } from "@/lib/server/named-lock";

/**
 * Un seul `npm run seed` à la fois sur une même base.
 *
 * Le jeu de test commence par **effacer** tout ce qui porte ses préfixes, puis
 * recrée comptes, équipes et tournois. Deux exécutions lancées ensemble sur la
 * même base — cas ordinaire : plusieurs worktrees partagent le `.env` du dépôt
 * parent, donc la même base locale — se détruisent mutuellement : le nettoyage
 * de la seconde efface les tournois que la première est en train de jouer. Les
 * symptômes changeaient d'une exécution à l'autre et ne désignaient jamais la
 * cause : `ER_NO_REFERENCED_ROW_2` sur `bg_endurance_standings` (le tournoi
 * venait d'être créé… et d'être effacé par l'autre), `Duplicate entry
 * 'Test_Admin'`, `Cannot read properties of undefined (reading 'team1_id')`.
 * Reproduit en lançant deux seeds à vingt secondes d'écart ; aucun n'échoue
 * seul, base déjà seedée ou non.
 *
 * D'où un verrou **nommé** (`GET_LOCK`), qui vaut entre processus : le second
 * seed attend la fin du premier, puis efface et régénère à son tour.
 */

/** Nom du verrou consultatif MySQL qui sérialise les exécutions du seed. */
export const SEED_LOCK_NAME = "bg_seed";

/**
 * Attente maximale du verrou, en secondes.
 *
 * Un seed complet dure une trentaine de secondes ; dix minutes laissent passer
 * plusieurs exécutions en file sans suspendre indéfiniment un seed bloqué
 * derrière une session morte.
 */
export const SEED_LOCK_TIMEOUT_SECONDS = 600;

/**
 * Joue `run` sous le verrou du seed.
 *
 * `onWait` est appelé une fois, avant l'attente, quand un autre seed tient déjà
 * le verrou : sans lui, le second seed resterait muet pendant tout le premier,
 * et passerait pour figé. Le constat est indicatif (le verrou peut se libérer
 * entre la question et la prise), la prise elle-même reste celle de
 * `withNamedLock`.
 *
 * @throws NamedLockUnavailableError si le verrou n'est pas obtenu dans le délai.
 */
export async function withSeedLock<T>(
  pool: Pool,
  run: () => Promise<T>,
  onWait?: () => void,
): Promise<T> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT IS_FREE_LOCK(?) AS free", [SEED_LOCK_NAME]);
  // `IS_FREE_LOCK` rend 1 (libre), 0 (tenu) ou NULL (erreur) : seul le 0 annonce une attente.
  if (Number(rows?.[0]?.free ?? 1) === 0) {
    onWait?.();
  }
  // La connexion du verrou n'est **pas** celle qui travaille : le seed passe par le pool.
  return withNamedLock(pool, SEED_LOCK_NAME, SEED_LOCK_TIMEOUT_SECONDS, () => run());
}
