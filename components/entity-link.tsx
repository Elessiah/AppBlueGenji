"use client";

import { LocaleLink } from "@/components/i18n/locale-navigation";
import { useMemberPodiumTier, useTeamPodiumTier } from "@/components/podium-tiers";
import { useSpectatorView } from "@/components/spectator-view";
import { podiumTierClass, type PodiumTier } from "@/lib/shared/podium-tiers";
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
}

/**
 * Marche imposée par l'appelant plutôt que lue dans le contexte : `/classement`
 * pose celle **de l'onglet affiché** (un onglet par jeu a son propre podium),
 * `null` n'en pose aucune.
 */
export type PodiumTierOverride = { podiumTier?: PodiumTier | null };

/** Classe de la marche à concaténer : l'imposée si elle est donnée, sinon celle du contexte. */
function tierClassName(override: PodiumTier | null | undefined, fromContext: PodiumTier | null, kind: "team" | "member") {
  return podiumTierClass(override === undefined ? fromContext : override, kind);
}

/** Concatène des classes optionnelles (`undefined` si aucune). */
export function joinEntityClasses(...names: (string | undefined)[]): string | undefined {
  const joined = names.filter(Boolean).join(" ");
  return joined === "" ? undefined : joined;
}

export function EntityLink({
  href,
  children,
  className,
  ...rest
}: Readonly<EntityLinkProps & { href: string }>) {
  const spectator = useSpectatorView();
  if (spectator) {
    // Pas d'`aria-label` sur un `<span>` sans rôle (`aria-prohibited-attr`) :
    // le nom affiché suffit, il n'annonce plus de destination.
    return (
      <span className={className ? `entity-name ${className}` : "entity-name"} style={rest.style} title={rest.title}>
        {children}
      </span>
    );
  }
  return (
    <LocaleLink href={href} className={className ? `entity-link ${className}` : "entity-link"} {...rest}>
      {children}
    </LocaleLink>
  );
}

/** Nom d'équipe cliquable → `/equipes/[id]`, habillé de sa marche du podium. */
export function TeamLink({
  teamId,
  podiumTier,
  className,
  ...rest
}: Readonly<EntityLinkProps & PodiumTierOverride & { teamId: number }>) {
  const tier = tierClassName(podiumTier, useTeamPodiumTier(teamId), "team");
  return <EntityLink href={`/equipes/${teamId}`} className={joinEntityClasses(tier, className)} {...rest} />;
}

/** Pseudo cliquable → `/joueurs/[id]`, habillé de la marche (adoucie) de son équipe. */
export function PlayerLink({
  userId,
  podiumTier,
  className,
  ...rest
}: Readonly<EntityLinkProps & PodiumTierOverride & { userId: number }>) {
  const tier = tierClassName(podiumTier, useMemberPodiumTier(userId), "member");
  return <EntityLink href={`/joueurs/${userId}`} className={joinEntityClasses(tier, className)} {...rest} />;
}

/**
 * Classe de marche d'un engagé de tournoi : celle de l'équipe, ou — pour une
 * entrée solo (`soloUserId`), jamais classée — celle du joueur, adoucie, comme
 * sur son `PlayerLink`.
 */
export function useEntrantPodiumClass(teamId: number, soloUserId: number | undefined): string | undefined {
  const teamTier = useTeamPodiumTier(soloUserId === undefined ? teamId : null);
  const memberTier = useMemberPodiumTier(soloUserId);
  return soloUserId === undefined ? podiumTierClass(teamTier, "team") : podiumTierClass(memberTier, "member");
}

