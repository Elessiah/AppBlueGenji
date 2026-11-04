/**
 * Les polices Inter des images d'aperçu, lues sur le disque du site.
 *
 * Sans `fonts`, `ImageResponse` (Satori) retombe sur la police par défaut en
 * graisse normale : les `fontWeight: 700` sont ignorés et la règle « Inter »
 * (TYPOGRAPHY.md) n'est pas tenue. Satori ne lit pas le WOFF2 variable du site :
 * on embarque donc, dans le dépôt (`app/og-fonts/`, licence OFL d'Inter à côté
 * dans `app/fonts/`), deux graisses statiques en TTF — Regular et Bold — pour
 * le latin et le latin étendu (le `Ł` d'un pseudo, un nom d'équipe turc). Aucun
 * téléchargement à l'exécution. Une fois par processus, comme le logo.
 *
 * Un fichier absent ou illisible rend une liste vide : la carte garde la police
 * par défaut plutôt que de faire échouer l'image entière.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Fichiers embarqués, relatifs à la racine du projet. */
export const SHARE_CARD_FONT_FILES: readonly { file: string; weight: 400 | 700 }[] = [
  { file: "inter-latin-400.ttf", weight: 400 },
  { file: "inter-latin-ext-400.ttf", weight: 400 },
  { file: "inter-latin-700.ttf", weight: 700 },
  { file: "inter-latin-ext-700.ttf", weight: 700 },
];

export const SHARE_CARD_FONT_DIR = join("app", "og-fonts");

export type ShareCardFont = { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" };

let cached: Promise<ShareCardFont[]> | null = null;

/** Découpe un `Buffer` en `ArrayBuffer` propre (Satori refuse un `Buffer` partagé). */
function toArrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Les polices en options `fonts` de `ImageResponse`, ou `[]` si elles ne se
 * lisent pas. Seule une lecture réussie est mémorisée : un échec passager est
 * journalisé et retenté au rendu suivant.
 */
export function shareCardFonts(): Promise<ShareCardFont[]> {
  cached ??= Promise.all(
    SHARE_CARD_FONT_FILES.map(async ({ file, weight }) => ({
      name: "Inter",
      data: toArrayBuffer(await readFile(join(process.cwd(), SHARE_CARD_FONT_DIR, file))),
      weight,
      style: "normal" as const,
    })),
  ).catch((error: unknown) => {
    cached = null;
    const code = (error as NodeJS.ErrnoException | null)?.code ?? "inconnu";
    console.warn(`[share-card] polices illisibles (${code}) : police par défaut`);
    return [];
  });
  return cached;
}

/** Options d'`ImageResponse` : `base` (taille, en-têtes) augmentée des polices. */
export async function shareImageOptions<T extends object>(base: T): Promise<T & { fonts: ShareCardFont[] }> {
  return { ...base, fonts: await shareCardFonts() };
}

/** Oublie les polices mémorisées — pour les tests seulement. */
export function resetShareCardFontsForTests(): void {
  cached = null;
}
