import "./script-env";
import type { RowDataPacket } from "mysql2/promise";
import { rotateHiddenAvatarFile } from "./avatar-rotation";
import { getDatabase } from "./database";

/**
 * Rattrapage : renomme le fichier des avatars **déjà** masqués.
 *
 * `updateOwnProfile` ne renomme le fichier qu'à la bascule visible → masqué
 * (`lib/server/avatar-rotation.ts`). Un avatar masqué avant cette règle garde
 * donc son adresse d'origine, toujours servie sans session — et resauvegarder
 * son profil n'y change rien, le réglage étant déjà « masqué ». Ce script fait
 * pour eux ce que la bascule fait désormais, d'un coup.
 *
 *     NODE_ENV=production npm run rotate:hidden-avatars
 *
 * **À lancer une fois**, après le déploiement. Le relancer n'abîme rien, mais
 * change encore l'adresse de chaque avatar masqué — donc celle que leur
 * titulaire a en cache. Séquentiel, à dessein : il n'est pas pressé.
 * `./script-env` pour la même raison que `backfill-avatars.ts` : la
 * configuration du serveur vit dans `.env.production`.
 */
async function main(): Promise<void> {
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM bg_users
        WHERE visible_avatar = 0 AND is_deleted = 0 AND avatar_url IS NOT NULL
        ORDER BY id`,
    );
    console.log(`${rows.length} compte(s) à l'avatar masqué.\n`);

    let rotated = 0;
    let failed = 0;
    for (const { id } of rows) {
      try {
        if (await rotateHiddenAvatarFile(id)) rotated += 1;
      } catch (error) {
        failed += 1;
        console.error(`  #${id} : échec`, error);
      }
    }

    console.log(`\n${rotated} fichier(s) renommé(s), ${failed} échec(s).`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

void main();
