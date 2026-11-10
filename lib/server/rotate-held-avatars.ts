import "./script-env";
import type { RowDataPacket } from "mysql2/promise";
import { rotateHeldAvatarFile } from "./avatar-rotation";
import { getDatabase } from "./database";

/**
 * Rattrapage : renomme le fichier des avatars **déjà** mis de côté par une
 * demande de suppression.
 *
 * La demande renomme désormais le fichier de l'avatar qu'elle met de côté
 * (`rotateHeldAvatarFile`, `lib/server/avatar-rotation.ts`). Les comptes en
 * attente de suppression au moment du déploiement gardent, eux, un avatar
 * servi à son adresse d'origine jusqu'à la fin de leurs trente jours. Ce script
 * fait pour eux ce que la demande fait désormais, d'un coup.
 *
 *     NODE_ENV=production npm run rotate:held-avatars
 *
 * **À lancer une fois**, après le déploiement. Le relancer n'abîme rien, mais
 * change encore l'adresse de chaque avatar mis de côté. Séquentiel, à dessein.
 * `./script-env` : la configuration du serveur vit dans `.env.production`.
 */
async function main(): Promise<void> {
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<(RowDataPacket & { user_id: number })[]>(
      `SELECT user_id FROM bg_account_deletion_holds WHERE avatar_url IS NOT NULL ORDER BY user_id`,
    );
    console.log(`${rows.length} avatar(s) mis de côté.\n`);

    let rotated = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        if (await rotateHeldAvatarFile(Number(row.user_id))) rotated += 1;
      } catch (error) {
        failed += 1;
        // Sans identifiant de compte : le journal du script ne nomme personne.
        console.error("  échec d'un renommage", error instanceof Error ? error.message : error);
      }
    }

    console.log(`\n${rotated} fichier(s) renommé(s), ${failed} échec(s).`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

await main();
