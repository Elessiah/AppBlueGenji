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
 * Lignes réellement modifiées par un `UPDATE` (`changedRows`). Sans ce champ, 0 :
 * jamais « changé » sur une réponse muette (au pire un avis de moins).
 */
function changed(result: unknown): number {
  return Number((result as { changedRows?: number } | undefined)?.changedRows ?? 0);
}

/**
 * Écrit le réglage et dit s'il a **changé**, d'après la réponse de la base et
 * jamais une lecture d'avant : `changedRows` d'un seul `UPDATE` par la clé, si
 * bien que deux gestes simultanés n'en comptent qu'un et que reposer la même
 * valeur ne change rien. Une ligne absente vaut « non » : l'éteindre ne crée
 * rien, et l'allumer ne passe par l'`INSERT` que si l'`UPDATE` n'a trouvé
 * aucune ligne (`affectedRows` = lignes trouvées, le pilote demandant
 * `CLIENT_FOUND_ROWS`) — une ligne déjà « oui » ne coûte donc pas d'`INSERT`
 * voué à la clé en double.
 */
export async function writeSoloCaster(executor: Executor, userId: number, solo: boolean): Promise<boolean> {
  const [updated] = await executor.execute(`UPDATE bg_planning_profiles SET solo_caster = ? WHERE user_id = ?`, [solo ? 1 : 0, userId]);
  if (changed(updated) > 0) return true;
  if (!solo || affected(updated) > 0) return false;
  // Aucune ligne trouvée : un `INSERT` simple ne crée que la ligne manquante ;
  // la clé en double (une ligne née entre-temps, « oui ») se lit comme « rien
  // changé », et toute autre erreur (compte disparu, valeur refusée) remonte —
  // `INSERT IGNORE` les aurait toutes avalées en avertissements.
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
