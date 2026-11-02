"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Les comptes supprimés **sans fiche** (décision D13, `lib/server/users/profileless-players.ts`),
 * posés une fois par la mise en page racine (`app/layout.tsx`) et lus par les
 * liens de joueur (`PlayerLink`, `EntrantLink` d'une entrée solo) : leur nom
 * reste un nom, aucun lien ne mène à une fiche qui répond 404.
 *
 * Hors fournisseur (tests, aperçus), toute fiche existe : un nom reste un lien.
 */
const ProfilelessPlayersContext = createContext<ReadonlySet<number>>(new Set());

export function ProfilelessPlayersProvider({
  ids,
  children,
}: Readonly<{ ids: readonly number[]; children: ReactNode }>) {
  const set = useMemo(() => new Set(ids), [ids]);
  return <ProfilelessPlayersContext.Provider value={set}>{children}</ProfilelessPlayersContext.Provider>;
}

/** La fiche `/joueurs/<id>` de ce compte existe-t-elle ? `undefined` (pas un joueur) : oui. */
export function useHasPlayerPage(userId: number | undefined): boolean {
  const profileless = useContext(ProfilelessPlayersContext);
  return userId === undefined || !profileless.has(userId);
}
