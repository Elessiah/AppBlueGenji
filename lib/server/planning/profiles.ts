/**
 * Réglage d'un membre du planning (`bg_planning_profiles`) : caster autonome,
 * qui diffuse seul, sans prod. Une ligne absente vaut « non ».
 */
import type { Executor } from "./load";

export async function writeSoloCaster(executor: Executor, userId: number, solo: boolean): Promise<void> {
  await executor.execute(
    `INSERT INTO bg_planning_profiles (user_id, solo_caster) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE solo_caster = VALUES(solo_caster)`,
    [userId, solo ? 1 : 0],
  );
}
