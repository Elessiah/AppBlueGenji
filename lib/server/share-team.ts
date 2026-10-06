/**
 * Les données de la carte d'aperçu nominative d'une équipe (`/equipes/[id]`,
 * `docs/features/SHARE_METADATA.md` § « La carte d'une équipe »).
 *
 * **Le sous-ensemble du classement public**, rien d'autre : nom, logo, cote et
 * bilan de la ligne que `/classement` montre déjà à un visiteur anonyme (onglet
 * « Général », équipes non jouées comprises, dans la limite des lignes que la
 * page peut afficher — `RANKING_MAX_SHOWN`). Le classement écarte déjà les
 * entrées solo (dont le « nom » est un pseudo) et les équipes dissoutes ; les
 * équipes fantômes sont retirées ici. Aucun joueur : ni pseudo ni avatar.
 *
 * **Aucune requête au rendu de la fiche** : seule la route d'image lit ces
 * données, mutualisées dans le cache du classement (`cachedRanking`, 60 s, vidé
 * à chaque score). Une seule entrée pour toutes les équipes — un robot qui
 * parcourt des identifiants au hasard ne remplit pas le cache, et le rejeu du
 * classement est celui de la page (`state:all:all`).
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";
import { cachedRanking } from "./ranking-cache";
import { loadTeamRanking } from "./ranking-service";
import { teamLogoDataUrl } from "./share-podium";
import type { TeamShareInput } from "@/lib/shared/page-share-cards";
import { RANKING_MAX_SHOWN } from "@/lib/shared/ranking-page";

/** Côté du logo converti : la taille du motif de la carte (208 px). */
export const TEAM_SHARE_LOGO_SIZE = 208;

export type ShareTeamRow = TeamShareInput & { logoUrl: string | null };

type GhostRow = RowDataPacket & { id: number };

async function computeShareTeams(): Promise<ReadonlyMap<number, ShareTeamRow>> {
  const [ranking, [ghosts]] = await Promise.all([
    loadTeamRanking({ includeUnplayed: true }),
    (await getDatabase()).execute<GhostRow[]>("SELECT id FROM bg_teams WHERE is_ghost = 1"),
  ]);
  const ghostIds = new Set(ghosts.map((row) => Number(row.id)));
  const teams = new Map<number, ShareTeamRow>();
  for (const row of ranking.slice(0, RANKING_MAX_SHOWN)) {
    if (ghostIds.has(row.teamId)) continue;
    teams.set(row.teamId, {
      teamName: row.teamName,
      logoUrl: row.logoUrl,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      points: row.points,
    });
  }
  return teams;
}

/**
 * La ligne publique de l'équipe `teamId` (sans logo converti) ; `null` si elle
 * n'est pas au classement public (inconnue, solo, fantôme, dissoute) ou si la
 * base ne répond pas. Une lecture du cache partagé : de quoi décider, avant
 * tout rendu, si la carte sera nominative.
 */
export async function findShareTeam(teamId: number): Promise<ShareTeamRow | null> {
  try {
    return (await cachedRanking("share-teams", computeShareTeams)).get(teamId) ?? null;
  } catch (error) {
    console.error("[share-team] lecture impossible", error);
    return null;
  }
}

/**
 * L'équipe `teamId` telle que sa carte la montre, logo compris (fichier du
 * site seulement, `teamLogoDataUrl`) ; `null` comme {@link findShareTeam} — la
 * carte retombe alors sur la carte générique de la fiche.
 */
export async function loadShareTeam(
  teamId: number,
): Promise<(TeamShareInput & { logoSrc: string | null }) | null> {
  const row = await findShareTeam(teamId);
  if (!row) return null;
  const { logoUrl, ...team } = row;
  return { ...team, logoSrc: await teamLogoDataUrl(logoUrl, TEAM_SHARE_LOGO_SIZE) };
}
