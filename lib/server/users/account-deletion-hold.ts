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
  requestedAt: Date,
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

/**
 * Retire, pour la modération, l'avatar mis de côté d'un compte en attente de
 * suppression (décision D6) : sous le verrou du masque, la ligne n'en garde
 * plus le chemin — une réactivation ne le rendra pas, l'effacement n'a plus de
 * fichier à emporter. Rend l'adresse retirée, `null` s'il n'y en avait pas
 * (ou pas de masque). Le fichier est effacé par l'appelant, après le commit.
 */
export async function takeHeldAvatar(connection: Runner, userId: number): Promise<string | null> {
  const hold = await readDeletionHold(connection, userId, true);
  if (!hold?.avatarUrl) return null;
  await connection.execute(`UPDATE bg_account_deletion_holds SET avatar_url = NULL WHERE user_id = ?`, [userId]);
  return hold.avatarUrl;
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
