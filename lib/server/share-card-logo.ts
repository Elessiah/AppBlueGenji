/**
 * Le logo BlueGenji de l'image d'aperçu, lu sur le disque du site.
 *
 * Satori (`next/og`) ne sait dessiner une image qu'à partir d'une URL qu'il va
 * chercher lui-même, ou d'une URL `data:`. La première ferait une requête HTTP
 * du site vers lui-même à chaque rendu. On lit plutôt le PNG du manifeste
 * (`public/icons/icon-192.png`, déjà servi au navigateur) une fois par
 * processus, et on le passe en `data:`.
 *
 * Le WebP du logo de la vitrine (`public/logo_bg.webp`) n'est pas utilisable :
 * Satori ne décode que PNG, JPEG, GIF et SVG.
 *
 * Un fichier absent ou illisible rend `null` : la carte retombe alors sur le
 * seul nom « BLUEGENJI », plutôt que de faire échouer l'image entière — un
 * encart sans image vaut moins qu'un encart sans logo.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Chemin du logo, relatif à la racine du projet. */
export const SHARE_CARD_LOGO_PATH = join("public", "icons", "icon-192.png");

let cached: Promise<string | null> | null = null;

/**
 * Le logo en URL `data:`, ou `null` s'il ne se lit pas. Mémorisé par processus :
 * le fichier fait partie de la livraison et ne change pas sans redémarrage.
 */
export function shareCardLogo(): Promise<string | null> {
  cached ??= readFile(join(process.cwd(), SHARE_CARD_LOGO_PATH))
    .then((bytes) => `data:image/png;base64,${bytes.toString("base64")}`)
    .catch(() => null);
  return cached;
}

/** Oublie le logo mémorisé — pour les tests seulement. */
export function resetShareCardLogoForTests(): void {
  cached = null;
}
