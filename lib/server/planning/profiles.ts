/**
 * Réglage d'un membre du planning (`bg_planning_profiles`) : caster autonome,
 * qui diffuse seul, sans prod. Une ligne absente vaut « non ».
 */
import { affectedRows, type Executor } from "./load";

/**
 * Écrit le réglage et dit s'il a **changé**, d'après les lignes que la base dit
 * avoir écrites et jamais une lecture d'avant — ni `changedRows`, que le pilote
 * tire d'un texte d'information que toute réponse ne porte pas.
 *
 * L'`UPDATE` ne vise que la ligne qui porte l'**autre** valeur : ses lignes
 * touchées sont alors des lignes changées, `CLIENT_FOUND_ROWS` ou non, et deux
 * gestes simultanés n'en comptent qu'un. Une ligne absente vaut « non » :
 * l'éteindre ne crée rien. L'allumer sans ligne changée crée la ligne si elle
 * manque, par un `INSERT … WHERE NOT EXISTS` qui ne fait rien (sans erreur) sur
 * une ligne déjà « oui ». Une ligne née entre-temps (clé en double) se relit
 * par le même `UPDATE` conditionnel ; toute autre erreur (compte disparu,
 * valeur refusée) remonte — `INSERT IGNORE` les aurait toutes avalées.
 */
export async function writeSoloCaster(executor: Executor, userId: number, solo: boolean): Promise<boolean> {
  const value = solo ? 1 : 0;
  const update = async () =>
    affectedRows(
      (await executor.execute(
        `UPDATE bg_planning_profiles SET solo_caster = ? WHERE user_id = ? AND solo_caster <> ?`,
        [value, userId, value],
      ))[0],
    ) > 0;
  if (await update()) return true;
  if (!solo) return false;
  try {
    const [inserted] = await executor.execute(
      `INSERT INTO bg_planning_profiles (user_id, solo_caster)
       SELECT ?, 1 FROM DUAL
        WHERE NOT EXISTS (SELECT 1 FROM bg_planning_profiles WHERE user_id = ?)`,
      [userId, userId],
    );
    return affectedRows(inserted) > 0;
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== "ER_DUP_ENTRY") throw error;
    // La ligne est née entre les deux écritures : elle porte peut-être « non ».
    return update();
  }
}
