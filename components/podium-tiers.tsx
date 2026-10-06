"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  EMPTY_PODIUM_TIERS,
  memberPodiumTier,
  podiumTierClass,
  teamPodiumTier,
  type PodiumTier,
  type PodiumTiers,
} from "@/lib/shared/podium-tiers";

/**
 * Marches du podium du site, posées une fois par la mise en page racine
 * (`app/layout.tsx`) et lues par les liens d'entité (`components/entity-link.tsx`)
 * — aucune requête par lien. Voir `docs/features/PODIUM_TIERS.md`.
 *
 * Hors fournisseur (tests, aperçus), aucune marche : un nom reste un nom.
 */
const PodiumTiersContext = createContext<PodiumTiers>(EMPTY_PODIUM_TIERS);

export function PodiumTiersProvider({ tiers, children }: Readonly<{ tiers: PodiumTiers; children: ReactNode }>) {
  return <PodiumTiersContext.Provider value={tiers}>{children}</PodiumTiersContext.Provider>;
}

/**
 * Sous-arbre sobre : aucun nom n'y porte de marche. Les écrans d'administration
 * (signalements, contacts d'arbitrage) restent des outils, pas une vitrine.
 */
export function PodiumTiersOff({ children }: Readonly<{ children: ReactNode }>) {
  return <PodiumTiersContext.Provider value={EMPTY_PODIUM_TIERS}>{children}</PodiumTiersContext.Provider>;
}

/** `PodiumTiersOff` sous condition : un écran public qui passe en outil du staff. */
export function PodiumTiersOffWhen({ off, children }: Readonly<{ off: boolean; children: ReactNode }>) {
  return off ? <PodiumTiersOff>{children}</PodiumTiersOff> : <>{children}</>;
}

export function usePodiumTiers(): PodiumTiers {
  return useContext(PodiumTiersContext);
}

/** Marche d'une équipe, ou `null` hors podium. */
export function useTeamPodiumTier(teamId: number | null | undefined): PodiumTier | null {
  return teamPodiumTier(useContext(PodiumTiersContext), teamId);
}

/** Marche d'un joueur membre d'une équipe du podium (la plus haute), ou `null`. */
export function useMemberPodiumTier(userId: number | null | undefined): PodiumTier | null {
  return memberPodiumTier(useContext(PodiumTiersContext), userId);
}

/**
 * Nom d'équipe **non cliquable** (titre d'une fiche d'équipe) habillé de sa
 * marche. Le texte reste tel quel : l'effet n'est que de la peinture.
 */
export function TeamPodiumName({ teamId, children }: Readonly<{ teamId: number; children: ReactNode }>) {
  const className = podiumTierClass(useTeamPodiumTier(teamId));
  if (className === undefined) return <>{children}</>;
  return <span className={className}>{children}</span>;
}

/**
 * Pseudo **non cliquable** (titre d'une fiche joueur, carte de l'annuaire)
 * habillé de la marche adoucie de son équipe du podium.
 */
export function PlayerPodiumName({ userId, children }: Readonly<{ userId: number; children: ReactNode }>) {
  const className = podiumTierClass(useMemberPodiumTier(userId), "member");
  if (className === undefined) return <>{children}</>;
  return <span className={className}>{children}</span>;
}
