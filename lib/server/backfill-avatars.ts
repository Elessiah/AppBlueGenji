import "dotenv/config";
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";
import { importRemoteAvatar } from "./user-avatar-import";

/**
 * Rapatrie les photos de profil restées chez leur hébergeur d'origine.
 *
 * `bg_users.avatar_url` a longtemps porté l'URL Google d'un compte, telle
 * qu'elle venait de `picture`. Depuis `user-avatar-import.ts`, la photo est
 * copiée chez nous à la connexion — mais un membre qui ne se reconnecte pas
 * garde son URL étrangère, et `visibleAvatarUrl` l'écarte désormais : sa
 * pastille à initiale s'affiche à la place de sa photo.
 *
 * C'est le seul but de ce script : éviter que la correction se paie d'avatars
 * disparus jusqu'à la prochaine connexion de chacun. Il ne fait rien qu'une
 * connexion ne ferait, il le fait simplement pour tout le monde d'un coup.
 *
 * Sans danger à relancer : il ne regarde que les lignes dont l'avatar n'est pas
 * déjà un fichier à nous, et une ligne qu'il n'a pas su rapatrier reste
 * exactement dans l'état où il l'a trouvée.
 *
 *     npm run backfill:avatars
 */

type UserRow = RowDataPacket & { id: number; pseudo: string; avatar_url: string | null };

async function main(): Promise<void> {
  try {
    const db = await getDatabase();

    // `LIKE 'http%'` plutôt que la négation de nos deux préfixes : c'est la
    // seule autre forme qu'ait jamais prise la colonne, et elle se lit.
    const [rows] = await db.execute<UserRow[]>(
      `SELECT id, pseudo, avatar_url
         FROM bg_users
        WHERE avatar_url LIKE 'http%'
        ORDER BY id`,
    );

    if (rows.length === 0) {
      console.log("Aucun avatar distant : rien à rapatrier.");
      process.exit(0);
    }

    console.log(`${rows.length} compte(s) avec un avatar distant.\n`);

    let done = 0;
    let failed = 0;

    // Séquentiel, à dessein : ce script n'est pas pressé, et il n'y a aucune
    // raison d'ouvrir des dizaines de connexions simultanées chez un tiers —
    // la façon la plus sûre de se faire plafonner au milieu du lot.
    for (const row of rows) {
      const stored = await importRemoteAvatar(row.avatar_url, row.id);
      if (!stored) {
        failed += 1;
        console.warn(`  ✗ ${row.pseudo} (#${row.id}) — non rapatrié, avatar inchangé`);
        continue;
      }
      await db.execute(`UPDATE bg_users SET avatar_url = ? WHERE id = ?`, [stored, row.id]);
      done += 1;
      console.log(`  · ${row.pseudo} (#${row.id}) → ${stored}`);
    }

    console.log(`\n${done} rapatrié(s), ${failed} en échec.`);
    if (failed > 0) {
      console.log("Les comptes en échec retrouveront leur photo à leur prochaine connexion.");
    }
    process.exit(0);
  } catch (error) {
    console.error("❌ Rapatriement échoué:", error);
    process.exit(1);
  }
}

main();
