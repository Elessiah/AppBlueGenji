import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { isDuplicateEntryError } from "@/lib/server/mysql-errors";
import { syncSoloEntryIdentityOn } from "@/lib/server/solo-entries-service";
import { ANONYMOUS_PSEUDOS, pickAnonymousPseudo } from "@/lib/shared/anonymous-pseudos";
import { reactivationPseudoCandidate } from "@/lib/shared/pseudo";

/*
 * Masque d'un compte en attente de suppression (décision du 2026-11-04,
 * `docs/features/ACCOUNT_DELETION.md` § « Anonyme dès la demande »).
 *
 * Dès la demande, le compte est montré **anonyme partout** : son pseudo est
 * remplacé sur `bg_users` par un pseudo d'emprunt et son avatar retiré, si
 * bien que toute lecture qui joint `bg_users` (résultats passés, classements,
 * effectifs, pages de tournoi, entrée solo) le montre déjà sous ce faux nom.
 * Le vrai pseudo et le chemin de l'avatar attendent dans
 * `bg_account_deletion_holds`, que seule la réactivation relit — et que la
 * suppression définitive efface. Le pseudo y reste réservé à son titulaire
 * (`isPseudoHeldByOther`) : la réactivation peut le lui rendre.
 */

/** Une ligne de masque, telle que la réactivation la relit. */
export type DeletionHold = { pseudo: string; avatarUrl: string | null };

type Runner = Pick<PoolConnection, "execute">;

/** Tentatives de pose d'un pseudo d'emprunt avant d'abandonner (même borne que l'anonymisation). */
const HOLD_PSEUDO_ATTEMPTS = 5;

/** Pseudos suffixés « OG » essayés à la réactivation (« PseudoOG » à « PseudoOG10 »). */
const REACTIVATION_PSEUDO_ATTEMPTS = 10;

/** Le pseudo est-il réservé par un **autre** compte en attente de suppression ? */
export async function isPseudoHeldByOther(runner: Runner, pseudo: string, userId: number | null): Promise<boolean> {
  const [rows] = await runner.execute<(RowDataPacket & { user_id: number })[]>(
    `SELECT user_id FROM bg_account_deletion_holds WHERE pseudo = ? LIMIT 1`,
    [pseudo],
  );
  return rows.length > 0 && Number(rows[0].user_id) !== userId;
}

/** Les pseudos d'emprunt déjà portés (comptes) ou réservés (masques) : à ne pas tirer. */
export async function loadTakenAnonymousPseudos(runner: Runner, userId: number): Promise<Set<string>> {
  const placeholders = ANONYMOUS_PSEUDOS.map(() => "?").join(", ");
  const [rows] = await runner.execute<(RowDataPacket & { pseudo: string })[]>(
    `SELECT pseudo FROM bg_users WHERE id <> ? AND pseudo IN (${placeholders})
     UNION
     SELECT pseudo FROM bg_account_deletion_holds WHERE user_id <> ? AND pseudo IN (${placeholders})`,
    [userId, ...ANONYMOUS_PSEUDOS, userId, ...ANONYMOUS_PSEUDOS],
  );
  return new Set(rows.map((row) => row.pseudo));
}

/**
 * Pose le masque sur la transaction de la demande, qui tient déjà la ligne du
 * compte : vrai pseudo et avatar mis de côté, pseudo d'emprunt et avatar retiré
 * posés **dans la même instruction** que `is_deleted = 1` (le balayage des
 * gardes d'écriture exige que seule l'écriture qui pose le drapeau en soit
 * dispensée), puis l'entrée solo renommée. Rend `false` si le compte n'était
 * plus vivant.
 */
export async function holdAccountIdentity(
  connection: PoolConnection,
  userId: number,
  requestedAt: Date | string,
): Promise<boolean> {
  const [rows] = await connection.execute<(RowDataPacket & { pseudo: string; avatar_url: string | null })[]>(
    `SELECT pseudo, avatar_url FROM bg_users WHERE id = ? AND is_deleted = 0 LIMIT 1`,
    [userId],
  );
  const current = rows[0];
  if (!current) return false;
  // Un masque resté d'une demande antérieure cède la place ; puis une insertion
  // simple : un pseudo déjà mis de côté par un autre compte fait échouer la
  // demande (doublon), au lieu de réécrire en silence le masque de cet autre
  // compte (`ON DUPLICATE KEY` jouerait sur les deux clés uniques).
  await connection.execute(`DELETE FROM bg_account_deletion_holds WHERE user_id = ?`, [userId]);
  await connection.execute(`INSERT INTO bg_account_deletion_holds (user_id, pseudo, avatar_url) VALUES (?, ?, ?)`, [
    userId,
    current.pseudo,
    current.avatar_url ?? null,
  ]);
  const taken = await loadTakenAnonymousPseudos(connection, userId);
  for (let attempt = 0; ; attempt += 1) {
    const pseudo = pickAnonymousPseudo(taken);
    try {
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE bg_users
            SET pseudo = ?, avatar_url = NULL, is_deleted = 1, deletion_requested_at = ?
          WHERE id = ? AND is_deleted = 0`,
        [pseudo, requestedAt, userId],
      );
      if (Number(result.affectedRows) !== 1) return false;
      break;
    } catch (error) {
      if (!isDuplicateEntryError(error) || attempt + 1 >= HOLD_PSEUDO_ATTEMPTS) throw error;
      taken.add(pseudo);
    }
  }
  await syncSoloEntryIdentityOn(connection, userId);
  return true;
}

/** Le masque du compte, s'il en a un (lecture sur la transaction appelante). */
export async function readDeletionHold(runner: Runner, userId: number, lock = false): Promise<DeletionHold | null> {
  const [rows] = await runner.execute<(RowDataPacket & { pseudo: string; avatar_url: string | null })[]>(
    `SELECT pseudo, avatar_url FROM bg_account_deletion_holds WHERE user_id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [userId],
  );
  return rows[0] ? { pseudo: rows[0].pseudo, avatarUrl: rows[0].avatar_url ?? null } : null;
}

/** L'avatar qu'une décision de modération peut atteindre (`readModeratableAvatar`). */
export interface ModeratableAvatar {
  pseudo: string;
  avatarUrl: string | null;
  /** En attente de suppression : l'avatar est dans le masque, pas sur la ligne. */
  pending: boolean;
}

/**
 * L'avatar qu'une décision de modération (masquage, suppression,
 * rétablissement) peut atteindre (décision D6) : celui de la ligne d'un compte
 * vivant — ou, compte **en attente de suppression**, celui que son masque garde
 * pour la réactivation, toujours servi : sans quoi demander la suppression
 * mettrait l'image hors d'atteinte de la modération pendant trente jours.
 * `null` : pas de ligne, ou compte anonymisé (sans masque) — il n'y a plus rien.
 * `lock` : sous les verrous de la ligne et du masque, dans cet ordre.
 */
export async function readModeratableAvatar(
  runner: Runner,
  userId: number,
  lock: boolean,
): Promise<ModeratableAvatar | null> {
  const [users] = await runner.execute<(RowDataPacket & { pseudo: string; avatar_url: string | null; is_deleted: 0 | 1 })[]>(
    lock
      ? `SELECT pseudo, avatar_url, is_deleted FROM bg_users WHERE id = ? FOR UPDATE`
      : `SELECT pseudo, avatar_url, is_deleted FROM bg_users WHERE id = ? LIMIT 1`,
    [userId],
  );
  const user = users[0];
  if (!user) return null;
  if (Number(user.is_deleted) !== 1) return { pseudo: user.pseudo, avatarUrl: user.avatar_url, pending: false };
  const hold = await readDeletionHold(runner, userId, lock);
  return hold ? { pseudo: user.pseudo, avatarUrl: hold.avatarUrl, pending: true } : null;
}

/**
 * Pose (`avatarUrl`) ou retire (`null`) l'avatar gardé dans le masque d'un
 * compte en attente — masquage, suppression ou rétablissement par la
 * modération ; la réactivation rend ce que le masque garde alors. Sous le
 * verrou pris par `readModeratableAvatar`.
 */
export async function setHeldAvatar(runner: Runner, userId: number, avatarUrl: string | null): Promise<void> {
  await runner.execute(`UPDATE bg_account_deletion_holds SET avatar_url = ? WHERE user_id = ?`, [avatarUrl, userId]);
}

/** Efface le masque (suppression définitive : le vrai pseudo ne doit plus survivre nulle part). */
export async function dropDeletionHold(runner: Runner, userId: number): Promise<void> {
  await runner.execute(`DELETE FROM bg_account_deletion_holds WHERE user_id = ?`, [userId]);
}

/**
 * Réactivation : relève la demande **et** rend le vrai pseudo et l'avatar, en
 * une instruction, puis efface le masque et renomme l'entrée solo. Le pseudo
 * étant réservé pendant la fenêtre, le conflit ne vient que d'une course (un
 * renommage concurrent passé entre sa vérification et son écriture) ou d'une
 * sauvegarde restaurée : le compte revit alors sous son pseudo suivi de « OG »
 * (« PseudoOG », puis « PseudoOG2 »… — décision R3 du 2026-11-04), que son
 * titulaire peut changer dans Mon profil ; à défaut, sous son pseudo d'emprunt.
 * Rend `true` si le compte est réactivé.
 */
export async function restoreAccountIdentity(connection: PoolConnection, userId: number): Promise<boolean> {
  const hold = await readDeletionHold(connection, userId, true);
  const reactivate = async (assignments: string, params: (string | null)[]): Promise<ResultSetHeader> => {
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE bg_users SET is_deleted = 0, deletion_requested_at = NULL${assignments}
        WHERE id = ? AND is_deleted = 1 AND deletion_requested_at IS NOT NULL`,
      [...params, userId],
    );
    return result;
  };
  let result: ResultSetHeader;
  if (!hold) {
    result = await reactivate("", []);
  } else {
    try {
      result = await reactivate(", pseudo = ?, avatar_url = ?", [hold.pseudo, hold.avatarUrl]);
    } catch (error) {
      if (!isDuplicateEntryError(error)) throw error;
      result = await reactivateUnderSuffixedPseudo(connection, userId, hold, reactivate);
    }
  }
  if (Number(result.affectedRows) !== 1) return false;
  await dropDeletionHold(connection, userId);
  await syncSoloEntryIdentityOn(connection, userId);
  return true;
}

/**
 * Vrai pseudo pris : essaie « PseudoOG », « PseudoOG2 »… (en sautant ceux
 * qu'un autre compte en attente réserve), et à défaut garde le pseudo d'emprunt.
 */
async function reactivateUnderSuffixedPseudo(
  connection: PoolConnection,
  userId: number,
  hold: DeletionHold,
  reactivate: (assignments: string, params: (string | null)[]) => Promise<ResultSetHeader>,
): Promise<ResultSetHeader> {
  for (let attempt = 0; attempt < REACTIVATION_PSEUDO_ATTEMPTS; attempt += 1) {
    const candidate = reactivationPseudoCandidate(hold.pseudo, attempt);
    if (await isPseudoHeldByOther(connection, candidate, userId)) continue;
    try {
      return await reactivate(", pseudo = ?, avatar_url = ?", [candidate, hold.avatarUrl]);
    } catch (error) {
      if (!isDuplicateEntryError(error)) throw error;
    }
  }
  return reactivate(", avatar_url = ?", [hold.avatarUrl]);
}
