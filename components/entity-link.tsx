"use client";

import { LocaleLink } from "@/components/i18n/locale-navigation";
import { PodiumPaint, useMemberPodiumTier, useTeamPodiumTier } from "@/components/podium-tiers";
import { useSpectatorView } from "@/components/spectator-view";
import { podiumTierClass, podiumTierFamily, type PodiumTier, type PodiumTierKind } from "@/lib/shared/podium-tiers";
import type { CSSProperties, ReactNode } from "react";

/**
 * Liens vers les fiches d'entités (équipe, joueur).
 *
 * Un nom d'équipe ou de joueur mène à sa fiche partout où il est affiché. Le
 * chemin se construisait jusqu'ici à la main sur chaque écran, avec à chaque
 * fois le même `color: inherit; text-decoration: none` en style en ligne — la
 * règle globale `a { color: inherit }` rendant un nom cliquable indiscernable
 * d'un nom mort. La classe `.entity-link` (dans `app/globals.css`) porte
 * désormais l'unique affordance de ces liens : c'est le survol et le focus qui
 * disent « ceci mène quelque part ».
 *
 * Ne pas confondre avec `entrantHref` (`lib/shared/participants.ts`) : un
 * *engagé* de tournoi est une équipe **ou** un joueur selon le tournoi, et se
 * résout par le contexte de la page de tournoi (`_lib/entrant-link.tsx`).
 *
 * Le chemin est écrit **sans** préfixe de langue : `LocaleLink` le résout dans
 * la langue de la page (`docs/features/I18N.md`) — un seul endroit pour les
 * trois liens d'entité, `EntrantLink` compris.
 *
 * **Marche du podium** : une équipe du podium du site porte sa marche
 * (`.podium-tier-N`) sur chaque `TeamLink`, ses membres une version adoucie
 * (`.podium-member-N`) sur chaque `PlayerLink` — lue dans le contexte posé par
 * la mise en page racine (`components/podium-tiers.tsx`, `PODIUM_TIERS.md`).
 * Elle se peint sur un `<span>` **dans** le lien, jamais sur le lien : la classe
 * de l'appelant (une pastille `.badge`, par exemple) pose souvent un
 * `background`, qui effacerait le dégradé peint dans le texte transparent.
 *
 * **Sans compte** (`useSpectatorView`, `/suivre/tournois/[id]`), le nom reste
 * un nom : les fiches d'équipe et de joueur sont dans l'espace connecté, un
 * lien n'y mènerait qu'à la carte « Connexion requise ». La marche du podium,
 * elle, reste.
 */
export interface EntityLinkProps {
  children: ReactNode;
  /** Classe additionnelle, concaténée à `.entity-link`. */
  className?: string;
  style?: CSSProperties;
  title?: string;
  "aria-label"?: string;
  /**
   * Éteint la marche du podium (`data-podium-muted`, repère conservé) : un lien
   * habillé d'une surface teintée (pastille `.badge`…) sur laquelle la marche,
   * sous sa lueur, tomberait sous 4,5:1 (`PODIUM_TIERS.md`).
   */
  podiumMuted?: boolean;
  /**
   * Tronque le nom d'une ellipse sur une ligne (`.entity-truncate`). Un nom
   * peint d'une marche rogne alors sur lui-même et non sur le lien : sa lueur
   * n'est pas coupée et l'ellipse garde le dégradé (`PODIUM_TIERS.md`).
   */
  truncate?: boolean;
}

/**
 * Marche imposée par l'appelant plutôt que lue dans le contexte : `/classement`
 * pose celle **de l'onglet affiché** (un onglet par jeu a son propre podium),
 * `null` n'en pose aucune.
 */
export type PodiumTierOverride = { podiumTier?: PodiumTier | null };

/** Marche peinte sur le nom d'un lien d'entité : sa place, et la famille (équipe ou membre). */
export type EntityPodium = { tier: PodiumTier; kind: PodiumTierKind };

/** Marche du lien : l'imposée si elle est donnée, sinon celle du contexte ; `undefined` hors podium. */
function linkPodium(override: PodiumTier | null | undefined, fromContext: PodiumTier | null, kind: PodiumTierKind) {
  const tier = override === undefined ? fromContext : override;
  return tier === null ? undefined : { tier, kind };
}

/** Concatène des classes optionnelles. */
function joinClasses(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

export function EntityLink({
  href,
  children,
  className,
  podium,
  podiumMuted = false,
  truncate = false,
  ...rest
}: Readonly<EntityLinkProps & { href: string; /** Marche peinte sur le nom. */ podium?: EntityPodium }>) {
  const spectator = useSpectatorView();
  const name = <PodiumPaint className={podium && podiumTierClass(podium.tier, podium.kind)}>{children}</PodiumPaint>;
  // Repères posés sur le lien, lus par la feuille sans `:has()` : la famille de
  // la marche peinte dedans (`podium-tier` / `podium-member`), et son extinction.
  const marks = {
    "data-podium": podium && podiumTierFamily(podium.kind),
    "data-podium-muted": podiumMuted ? "" : undefined,
  };
  const extra = joinClasses(truncate && "entity-truncate", className);
  if (spectator) {
    // Pas d'`aria-label` sur un `<span>` sans rôle (`aria-prohibited-attr`) :
    // le nom affiché suffit, il n'annonce plus de destination.
    return (
      <span className={joinClasses("entity-name", extra)} style={rest.style} title={rest.title} {...marks}>
        {name}
      </span>
    );
  }
  return (
    <LocaleLink href={href} className={joinClasses("entity-link", extra)} {...marks} {...rest}>
      {name}
    </LocaleLink>
  );
}

/** Nom d'équipe cliquable → `/equipes/[id]`, habillé de sa marche du podium. */
export function TeamLink({
  teamId,
  podiumTier,
  ...rest
}: Readonly<EntityLinkProps & PodiumTierOverride & { teamId: number }>) {
  const podium = linkPodium(podiumTier, useTeamPodiumTier(teamId), "team");
  return <EntityLink href={`/equipes/${teamId}`} podium={podium} {...rest} />;
}

/** Pseudo cliquable → `/joueurs/[id]`, habillé de la marche (adoucie) de son équipe. */
export function PlayerLink({
  userId,
  podiumTier,
  ...rest
}: Readonly<EntityLinkProps & PodiumTierOverride & { userId: number }>) {
  const podium = linkPodium(podiumTier, useMemberPodiumTier(userId), "member");
  return <EntityLink href={`/joueurs/${userId}`} podium={podium} {...rest} />;
}

/**
 * Classe de marche d'un engagé de tournoi : celle de l'équipe, ou — pour une
 * entrée solo (`soloUserId`), jamais classée — celle du joueur, adoucie, comme
 * sur son `PlayerLink`.
 */
export function useEntrantPodium(teamId: number, soloUserId: number | undefined): EntityPodium | undefined {
  const teamTier = useTeamPodiumTier(soloUserId === undefined ? teamId : null);
  const memberTier = useMemberPodiumTier(soloUserId);
  return soloUserId === undefined ? linkPodium(undefined, teamTier, "team") : linkPodium(undefined, memberTier, "member");
}

