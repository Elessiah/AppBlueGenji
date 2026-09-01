"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { EntityLink, type EntityLinkProps } from "@/components/entity-link";
import { entrantHref, participantWording, type ParticipantType } from "@/lib/shared/participants";

/**
 * Contexte « type de participant » de la page de tournoi.
 *
 * Les vues de plateau, de classement et de manche affichent toutes des engagés,
 * sans savoir s'il s'agit d'équipes ou de joueurs. Plutôt que de faire descendre
 * l'information par les props à travers cinq niveaux de composants, on la pose
 * une fois en haut de la page :
 * - `entrantLink(teamId)` renvoie vers `/joueurs/[id]` pour une entrée solo,
 *   vers `/equipes/[id]` sinon ;
 * - `wording` fournit le vocabulaire (« équipe » / « joueur ») des libellés.
 */
type EntrantContextValue = {
  participantType: ParticipantType;
  soloUserIds: Record<number, number>;
};

const EntrantContext = createContext<EntrantContextValue>({
  participantType: "TEAM",
  soloUserIds: {},
});

export function EntrantProvider({
  participantType,
  soloUserIds,
  children,
}: EntrantContextValue & { children: ReactNode }) {
  const value = useMemo(
    () => ({ participantType, soloUserIds }),
    [participantType, soloUserIds],
  );
  return <EntrantContext.Provider value={value}>{children}</EntrantContext.Provider>;
}

/** Lien vers la fiche de l'engagé (profil du joueur, ou page d'équipe). */
export function useEntrantLink(): (teamId: number) => string {
  const { soloUserIds } = useContext(EntrantContext);
  return useMemo(() => (teamId: number) => entrantHref(teamId, soloUserIds), [soloUserIds]);
}

/** Vocabulaire du type de participant du tournoi affiché. */
export function useParticipantWording() {
  const { participantType } = useContext(EntrantContext);
  return participantWording(participantType);
}

/**
 * Nom d'un engagé, cliquable vers sa fiche.
 *
 * Les vues de plateau, de classement et de manche répétaient toutes le même
 * `<Link href={entrantLink(id)} style={{ color: "inherit", … }}>` : le composant
 * porte la résolution du lien *et* l'affordance, pour qu'un nom d'engagé se
 * comporte de la même façon d'une vue à l'autre.
 */
export function EntrantLink({
  teamId,
  ...rest
}: EntityLinkProps & { teamId: number }) {
  const entrantLink = useEntrantLink();
  return <EntityLink href={entrantLink(teamId)} {...rest} />;
}
