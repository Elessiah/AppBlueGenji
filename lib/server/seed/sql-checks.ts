/**
 * Contrôles SQL joués par le seed sur la **vraie** base (MySQL en local,
 * MariaDB en production) : le seed est le seul passage où ces requêtes
 * tournent ailleurs que sur une base simulée (`docs/seed/SEED_RULES.md`).
 *
 * Défis Discord (`lib/server/users/discord-challenges.ts`) : la règle « seul le
 * dernier code émis vaut » se garde **par usage** — le `NOT EXISTS` de
 * `consumeDiscordLoginChallenge` (`newer.purpose = c.purpose`). Les tests
 * unitaires n'en lisent que le texte ; ici, elle s'exécute.
 *
 * Un identifiant Discord fictif, propre au seed, porte les défis ; ses lignes
 * sont effacées avant et après. Un écart fait échouer le seed.
 */
import type { Pool } from "mysql2/promise";
import {
  consumeDiscordLoginChallenge,
  createDiscordLoginChallenge,
} from "@/lib/server/users/discord-challenges";

/** Identifiant Discord fictif (aucun compte réel n'a 20 chiffres commençant par 0). */
export const SEED_CHECK_DISCORD_ID = "00000000000000000001";

/** Lien d'un défi de tag, comme `challengeBinding` (`discord-verification.ts`). */
const HANDLE_BINDING = "0:certify";

/** Effacer les défis du contrôle (avant et après). */
async function clearCheckChallenges(db: Pool): Promise<void> {
  await db.execute(`DELETE FROM bg_discord_login_challenges WHERE discord_id = ?`, [SEED_CHECK_DISCORD_ID]);
}

function expectProof(label: string, proof: unknown, expected: boolean): void {
  if ((proof !== null) !== expected) {
    throw new Error(`Contrôle SQL des défis Discord : ${label} — attendu ${expected ? "accepté" : "refusé"}`);
  }
}

/**
 * Joue la règle de remplacement par usage sur la vraie base :
 * - un code de tag (HANDLE) émis après un code de connexion n'annule pas ce dernier ;
 * - un second code de connexion annule le premier, et vaut lui-même.
 */
export async function checkDiscordChallengeRules(db: Pool): Promise<void> {
  await clearCheckChallenges(db);
  try {
    const login = await createDiscordLoginChallenge(SEED_CHECK_DISCORD_ID, null, "login");
    await createDiscordLoginChallenge(SEED_CHECK_DISCORD_ID, "seed_check", "handle", HANDLE_BINDING);
    expectProof(
      "code de connexion suivi d'un code de tag",
      await consumeDiscordLoginChallenge(login.challengeToken, login.code, "login"),
      true,
    );

    const older = await createDiscordLoginChallenge(SEED_CHECK_DISCORD_ID, null, "login");
    const newer = await createDiscordLoginChallenge(SEED_CHECK_DISCORD_ID, null, "login");
    expectProof(
      "code de connexion remplacé par un plus récent",
      await consumeDiscordLoginChallenge(older.challengeToken, older.code, "login"),
      false,
    );
    expectProof(
      "dernier code de connexion",
      await consumeDiscordLoginChallenge(newer.challengeToken, newer.code, "login"),
      true,
    );
    console.log("🔎 Contrôle SQL des défis Discord : remplacement par usage vérifié");
  } finally {
    await clearCheckChallenges(db);
  }
}
