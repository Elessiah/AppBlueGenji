"use client";

import Link from "next/link";
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
 */
export interface EntityLinkProps {
  children: ReactNode;
  /** Classe additionnelle, concaténée à `.entity-link`. */
  className?: string;
  style?: CSSProperties;
  title?: string;
  "aria-label"?: string;
}

export function EntityLink({
  href,
  children,
  className,
  ...rest
}: EntityLinkProps & { href: string }) {
  return (
    <Link href={href} className={className ? `entity-link ${className}` : "entity-link"} {...rest}>
      {children}
    </Link>
  );
}

/** Nom d'équipe cliquable → `/equipes/[id]`. */
export function TeamLink({ teamId, ...rest }: EntityLinkProps & { teamId: number }) {
  return <EntityLink href={`/equipes/${teamId}`} {...rest} />;
}

/** Pseudo cliquable → `/joueurs/[id]`. */
export function PlayerLink({ userId, ...rest }: EntityLinkProps & { userId: number }) {
  return <EntityLink href={`/joueurs/${userId}`} {...rest} />;
}
