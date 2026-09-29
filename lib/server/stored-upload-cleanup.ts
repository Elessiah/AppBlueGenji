import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { deleteStoredImage } from "@/lib/server/image-upload";
import { isStoredUploadIn, toDiskUploadPath, toServedUploadUrl, type UploadFolder } from "@/lib/shared/uploads";

/**
 * Effacer du disque un fichier téléversé **qui n'appartient plus à personne**.
 *
 * Remplacer ou supprimer une image (logo de partenaire, photo de bénévole, logo
 * d'une équipe dissoute) laissait le fichier derrière soi, ou l'effaçait sans
 * regarder qui d'autre le désignait. Le second cas était le pire : le logo d'un
 * partenaire accepte une adresse collée, donc aussi `/api/uploads/avatars/…` —
 * adresse lisible dans n'importe quelle réponse d'API —, et supprimer ce
 * partenaire effaçait l'avatar d'un joueur. D'où deux gardes, qui ne font pas
 * double emploi :
 *
 * - le **dossier** : un geste n'efface que dans le dossier qu'il remplit
 *   lui-même (`sponsors/` pour un partenaire, `benevoles/` pour un bénévole,
 *   `teams/` pour une équipe) ;
 * - la **référence** : le fichier n'est effacé que si plus aucune colonne
 *   d'image ne le désigne — un logo partagé par deux équipes, ou recopié d'un
 *   avatar sur une entrée solo, reste servi.
 *
 * Le contrôle de référence précède l'effacement d'un `await` : une ligne qui
 * adopterait le fichier dans l'intervalle le perdrait. La fenêtre est celle
 * d'un geste du staff, et l'adresse d'un fichier fraîchement libéré n'est
 * connue que de qui vient de la retirer.
 */

/**
 * Toutes les colonnes qui désignent un fichier téléversé. Un fichier masqué
 * par la modération (`HIDDEN`) compte aussi : quand d'autres équipes le
 * partagent, le masquage le laisse en place, et le rétablir le redésignera.
 */
const REFERENCE_QUERIES = [
  "SELECT 1 FROM bg_users WHERE avatar_url IN (?, ?) LIMIT 1",
  "SELECT 1 FROM bg_teams WHERE logo_url IN (?, ?) LIMIT 1",
  "SELECT 1 FROM bg_tournaments WHERE image_url IN (?, ?) LIMIT 1",
  "SELECT 1 FROM bg_sponsors WHERE logo_url IN (?, ?) OR banner_url IN (?, ?) LIMIT 1",
  "SELECT 1 FROM bg_benevoles WHERE photo_url IN (?, ?) LIMIT 1",
  "SELECT 1 FROM bg_logo_quarantines WHERE status = 'HIDDEN' AND logo_url IN (?, ?) LIMIT 1",
] as const;

/**
 * Vrai si une ligne désigne encore ce fichier, sous sa forme servie ou disque.
 *
 * @param options.exceptUserAvatar Ignore l'avatar de ce compte — « un autre que
 *   son titulaire désigne-t-il ce fichier ? » (`lib/server/avatar-rotation.ts`).
 */
export async function isUploadReferenced(
  url: string,
  options: { exceptUserAvatar?: number } = {},
): Promise<boolean> {
  const disk = toDiskUploadPath(url);
  if (!disk) return false;
  const served = toServedUploadUrl(disk);
  const db = await getDatabase();
  const exceptUser = options.exceptUserAvatar;
  for (const base of REFERENCE_QUERIES) {
    let sql: string = base;
    const params: (string | number)[] = sql.includes("banner_url") ? [served, disk, served, disk] : [served, disk];
    if (exceptUser !== undefined && sql.startsWith("SELECT 1 FROM bg_users ")) {
      sql = sql.replace(" LIMIT 1", " AND id <> ? LIMIT 1");
      params.push(exceptUser);
    }
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    if (rows.length > 0) return true;
  }
  return false;
}

/**
 * Efface le fichier désigné par `url` s'il vit dans `folder` et que plus rien
 * ne le désigne. **Au mieux** : l'appelant a déjà écrit en base, un échec
 * d'effacement ne doit pas lui faire rendre une erreur.
 *
 * @returns `true` si le fichier a été effacé (ou n'existait déjà plus).
 */
export async function deleteUnreferencedUpload(
  url: string | null | undefined,
  folder: UploadFolder,
): Promise<boolean> {
  if (!url || !isStoredUploadIn(url, folder)) return false;
  try {
    if (await isUploadReferenced(url)) return false;
    await deleteStoredImage(toDiskUploadPath(url));
    return true;
  } catch (error) {
    console.error(`[uploads] fichier ${folder}/ non effacé`, error);
    return false;
  }
}
