/**
 * Les données du podium de la carte d'aperçu de `/classement`
 * (`docs/features/SHARE_METADATA.md` § « Le podium »).
 *
 * **Le même podium que la page** : classement général, équipes non jouées
 * comprises (`loadTeamRanking({ includeUnplayed: true })`, l'onglet
 * « Général » de `/classement`), les trois premières lignes. Rien de plus que
 * ce qu'un visiteur anonyme lit déjà sur la page publique : nom, logo, cote.
 *
 * **Mutualisé** dans le cache du classement (`cachedRanking`, 60 s, vidé à
 * chaque score) : un lien collé dans un gros salon fait venir plusieurs robots
 * d'aperçu, et aucun ne doit rejouer le classement pour lui seul.
 *
 * Les logos sont lus **sur le disque**, jamais par une requête HTTP : seul un
 * fichier stocké par le site sous `public/uploads/teams/` est accepté
 * (`isStoredUploadIn`), comme `localUploadUrl` le fait à la sortie. Satori ne
 * décode pas le WebP des imports : chaque logo est converti en PNG 152 px par
 * `sharp`. Un logo absent ou illisible rend `null` — la marche garde l'initiale.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { cachedRanking } from "./ranking-cache";
import { loadTeamRanking } from "./ranking-service";
import { PODIUM_TIER_COUNT } from "@/lib/shared/podium-tiers";
import type { PodiumShareInput } from "@/lib/shared/page-share-cards";
import { isStoredUploadIn, toDiskUploadPath } from "@/lib/shared/uploads";

/** Côté du logo converti : deux fois sa taille d'affichage (76 px). */
const LOGO_SIZE = 152;

/** Un logo d'équipe stocké par le site, en URL `data:` PNG — ou `null`. */
export async function teamLogoDataUrl(logoUrl: string | null): Promise<string | null> {
  if (!isStoredUploadIn(logoUrl, "teams")) return null;
  const diskPath = toDiskUploadPath(logoUrl);
  if (!diskPath) return null;
  try {
    const bytes = await readFile(path.join(process.cwd(), "public", diskPath));
    const png = await sharp(bytes)
      .resize(LOGO_SIZE, LOGO_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code ?? "illisible";
    console.warn(`[share-podium] logo d'équipe ignoré (${code}) : initiale à la place`);
    return null;
  }
}

async function computeSharePodium(): Promise<PodiumShareInput[]> {
  const ranking = await loadTeamRanking({ includeUnplayed: true });
  if (ranking.length < PODIUM_TIER_COUNT) return [];
  const top = ranking.slice(0, PODIUM_TIER_COUNT);
  return Promise.all(
    top.map(async (row) => ({
      teamName: row.teamName,
      points: row.points,
      logoSrc: await teamLogoDataUrl(row.logoUrl),
    })),
  );
}

/**
 * Les trois premières équipes du classement général, logos compris ; une liste
 * vide sous trois équipes classées ou si la base ne répond pas (la carte
 * retombe alors sur celle de la page, jamais sur une erreur).
 */
export async function loadSharePodium(): Promise<PodiumShareInput[]> {
  try {
    return await cachedRanking("share-podium", computeSharePodium);
  } catch (error) {
    console.error("[share-podium] lecture impossible", error);
    return [];
  }
}
