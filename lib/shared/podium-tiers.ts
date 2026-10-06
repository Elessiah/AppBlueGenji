/**
 * Marches du podium du site, suivies partout où un nom s'affiche.
 *
 * Les trois premières équipes de l'onglet « Général » de `/classement` (tous
 * jeux, `loadTeamRanking({ includeUnplayed: true })`, ordre de
 * `compareRankedTeams`) portent leur marche sur chaque nom d'équipe rendu par
 * les liens d'entité (`TeamLink`, `EntrantLink`, `EntrantName`), et leurs
 * membres en portent une version adoucie sur `PlayerLink`. Voir
 * `docs/features/PODIUM_TIERS.md`.
 *
 * Logique pure : construite côté serveur (`lib/server/podium-tiers.ts`), lue
 * côté client par le contexte (`components/podium-tiers.tsx`).
 */

/** Marche du podium : 1 (tête), 2, 3. */
export type PodiumTier = 1 | 2 | 3;

/** Nombre d'équipes sur le podium — le même que celui de `/classement`. */
export const PODIUM_TIER_COUNT = 3;

/**
 * Marches connues, par identifiant. Des objets simples (et non des `Map`) :
 * ils traversent la frontière serveur → client telles quelles.
 */
export type PodiumTiers = {
  /** `bg_teams.id` → marche de l'équipe. */
  teams: Readonly<Record<number, PodiumTier>>;
  /** `bg_users.id` → marche du membre (la plus haute de ses équipes). */
  members: Readonly<Record<number, PodiumTier>>;
};

export const EMPTY_PODIUM_TIERS: PodiumTiers = Object.freeze({
  teams: Object.freeze({}),
  members: Object.freeze({}),
});

/** Une appartenance active à une équipe (`bg_team_members`, `left_at IS NULL`). */
export type PodiumMembership = { userId: number; teamId: number };

/**
 * Construit les marches depuis le classement **déjà trié** (identifiants
 * d'équipe, de la tête vers le bas) et les appartenances de ses premières.
 *
 * Sous trois équipes classées, aucune marche : `/classement` n'affiche alors pas
 * de podium (`splitRankingPodium`), et le site ne doit pas en annoncer un.
 * Un joueur membre de plusieurs équipes du podium prend **la plus haute**.
 */
export function buildPodiumTiers(
  rankedTeamIds: readonly number[],
  memberships: readonly PodiumMembership[],
): PodiumTiers {
  if (rankedTeamIds.length < PODIUM_TIER_COUNT) return EMPTY_PODIUM_TIERS;
  const teams: Record<number, PodiumTier> = {};
  rankedTeamIds.slice(0, PODIUM_TIER_COUNT).forEach((teamId, index) => {
    teams[teamId] = (index + 1) as PodiumTier;
  });
  const members: Record<number, PodiumTier> = {};
  for (const { userId, teamId } of memberships) {
    const tier = teams[teamId];
    if (tier === undefined) continue;
    const current = members[userId];
    if (current === undefined || tier < current) members[userId] = tier;
  }
  return { teams, members };
}

/** Les trois premières équipes d'un classement trié, ou rien sous trois. */
export function podiumTeamIds(rankedTeamIds: readonly number[]): number[] {
  return rankedTeamIds.length < PODIUM_TIER_COUNT ? [] : rankedTeamIds.slice(0, PODIUM_TIER_COUNT);
}

/**
 * Ce qui part dans la page : les membres ne sont remis qu'à un visiteur
 * connecté — les effectifs ne se lisent que sur les fiches d'équipe, réservées
 * aux comptes (`/(secured)`). Les équipes du podium, elles, sont publiques
 * (`/classement`).
 */
export function visiblePodiumTiers(tiers: PodiumTiers, signedIn: boolean): PodiumTiers {
  if (signedIn || Object.keys(tiers.members).length === 0) return tiers;
  return { teams: tiers.teams, members: EMPTY_PODIUM_TIERS.members };
}

export function teamPodiumTier(tiers: PodiumTiers, teamId: number | null | undefined): PodiumTier | null {
  if (teamId === null || teamId === undefined) return null;
  return tiers.teams[teamId] ?? null;
}

export function memberPodiumTier(tiers: PodiumTiers, userId: number | null | undefined): PodiumTier | null {
  if (userId === null || userId === undefined) return null;
  return tiers.members[userId] ?? null;
}

/** Version pleine (équipe) ou adoucie (membre) de la marche. */
export type PodiumTierKind = "team" | "member";

/**
 * Classes globales de la marche (`app/globals.css`, famille `.podium-tier` /
 * `.podium-member`, `DESIGN_SYSTEM.md`) ; `undefined` hors podium.
 */
export function podiumTierClass(tier: PodiumTier | null, kind: PodiumTierKind = "team"): string | undefined {
  if (tier === null) return undefined;
  const base = kind === "team" ? "podium-tier" : "podium-member";
  return `${base} ${base}-${tier}`;
}

/**
 * Graisse en ligne d'un nom de classement de phase : 700 pour l'engagé du
 * lecteur, 500 ailleurs — sauf sur une marche du podium, qui porte la sienne
 * (et la rend sur une ligne en retrait) : un style en ligne l'écraserait.
 */
export function standingNameWeight(isMine: boolean, onPodium: boolean): number | undefined {
  if (isMine) return 700;
  return onPodium ? undefined : 500;
}
