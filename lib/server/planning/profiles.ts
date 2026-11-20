/**
 * Réglage d'un membre du planning (`bg_planning_profiles`) : caster autonome,
 * qui diffuse seul, sans prod. Une ligne absente vaut « non ».
 */
import type { Executor } from "./load";

/** Lignes touchées par une écriture (`affectedRows`), 0 si la réponse n'en dit rien. */
function affected(result: unknown): number {
  return Number((result as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}

/**
 * Lignes réellement modifiées par un `UPDATE` (`changedRows`), 0 si la réponse
 * n'en dit rien. Jamais `affectedRows` : sous `CLIENT_FOUND_ROWS` (le défaut
 * de mysql2), il compte aussi une ligne trouvée mais inchangée.
 */
function changed(result: unknown): number {
  return Number((result as { changedRows?: number } | undefined)?.changedRows ?? 0);
}

/**
 * Écrit le réglage et dit s'il a **changé** : chaque instruction ne touche que
 * ce qui diffère (la réponse de la base, jamais une lecture d'avant), si bien
 * que deux gestes simultanés n'en comptent qu'un et que reposer la même valeur
 * ne change rien. Une ligne absente vaut « non » : l'éteindre ne crée rien.
 */
export async function writeSoloCaster(executor: Executor, userId: number, solo: boolean): Promise<boolean> {
  const value = solo ? 1 : 0;
  const [updated] = await executor.execute(
    `UPDATE bg_planning_profiles SET solo_caster = ? WHERE user_id = ? AND solo_caster <> ?`,
    [value, userId, value],
  );
  if (changed(updated) > 0) return true;
  if (!solo) return false;
  // Pas de ligne qui diffère : soit elle vaut déjà « oui », soit elle manque.
  // `INSERT IGNORE` ne crée que la ligne manquante (1 ligne touchée) et laisse
  // une ligne déjà présente (0) — sans l'ambiguïté d'un `ON DUPLICATE KEY
  // UPDATE`, qui compte 1 aussi pour une ligne inchangée sous `FOUND_ROWS`.
  const [inserted] = await executor.execute(
    `INSERT IGNORE INTO bg_planning_profiles (user_id, solo_caster) VALUES (?, 1)`,
    [userId],
  );
  return affected(inserted) > 0;
}
