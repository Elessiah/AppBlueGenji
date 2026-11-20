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
 * Lignes réellement modifiées par un `UPDATE` (`changedRows`). Si le pilote ne
 * la rend pas, `affectedRows` : l'`UPDATE` d'ici ne trouve que des lignes qui
 * diffèrent (`solo_caster <> ?`), donc trouvées = modifiées — un champ absent
 * ne fait jamais lire « rien changé ».
 */
function changed(result: unknown): number {
  const rows = result as { changedRows?: number; affectedRows?: number } | undefined;
  return Number(rows?.changedRows ?? rows?.affectedRows ?? 0);
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
  // Un `INSERT` simple ne crée que la ligne manquante ; la clé en double (la
  // ligne existe déjà, « oui ») se lit comme « rien changé », et toute autre
  // erreur (compte disparu, valeur refusée) remonte — `INSERT IGNORE` les
  // aurait toutes avalées en avertissements.
  try {
    const [inserted] = await executor.execute(
      `INSERT INTO bg_planning_profiles (user_id, solo_caster) VALUES (?, 1)`,
      [userId],
    );
    return affected(inserted) > 0;
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "ER_DUP_ENTRY") return false;
    throw error;
  }
}
