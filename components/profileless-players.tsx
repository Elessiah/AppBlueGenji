"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Les comptes supprimés **sans fiche** (décision D13, `lib/server/users/profileless-players.ts`),
 * posés par la mise en page racine (`app/layout.tsx`) et lus par les liens de
 * joueur (`PlayerLink`, `EntrantLink` d'une entrée solo) : leur nom reste un
 * nom, aucun lien ne mène à une fiche qui répond 404.
 *
 * La mise en page racine n'est pas re-rendue d'un lien à l'autre : pour un
 * visiteur connecté (`refresh`), la liste est relue (`/api/players/profileless`)
 * à la navigation client, au plus une fois par {@link PROFILELESS_REFRESH_MS} —
 * un compte supprimé entre-temps ne garde pas son lien jusqu'au rechargement.
 *
 * Hors fournisseur (tests, aperçus), toute fiche existe : un nom reste un lien.
 */
const ProfilelessPlayersContext = createContext<ReadonlySet<number>>(new Set());

/** Intervalle minimal entre deux relectures de la liste à la navigation. */
export const PROFILELESS_REFRESH_MS = 60_000;

/** Les ids d'une réponse de `/api/players/profileless`, ou `null` si elle n'en porte pas. */
export function parseProfilelessIds(body: unknown): number[] | null {
  if (typeof body !== "object" || body === null) return null;
  const ids = (body as { ids?: unknown }).ids;
  if (!Array.isArray(ids)) return null;
  return ids.filter((id): id is number => Number.isSafeInteger(id) && id > 0);
}

export function ProfilelessPlayersProvider({
  ids,
  refresh = false,
  children,
}: Readonly<{ ids: readonly number[]; refresh?: boolean; children: ReactNode }>) {
  // Relecture tenue avec la liste du serveur qu'elle remplace : une nouvelle
  // liste du serveur (rechargement, `router.refresh()`) prime aussitôt.
  const [fresh, setFresh] = useState<{ from: readonly number[]; ids: readonly number[] } | null>(null);
  const current = fresh?.from === ids ? fresh.ids : ids;
  const set = useMemo(() => new Set(current), [current]);
  return (
    <ProfilelessPlayersContext.Provider value={set}>
      {refresh ? <ProfilelessRefresh onIds={(next) => setFresh({ from: ids, ids: next })} /> : null}
      {children}
    </ProfilelessPlayersContext.Provider>
  );
}

/**
 * Relit la liste à chaque navigation client, au plus une fois par fenêtre. Monté
 * pour le seul visiteur connecté (`usePathname` n'existe que sous le routeur).
 */
function ProfilelessRefresh({ onIds }: Readonly<{ onIds: (ids: number[]) => void }>) {
  const pathname = usePathname();
  const firstPath = useRef(pathname);
  const loadedAt = useRef(Date.now());
  const latest = useRef(onIds);
  const mounted = useRef(true);

  useEffect(() => {
    latest.current = onIds;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (pathname === firstPath.current) return;
    firstPath.current = pathname;
    const now = Date.now();
    if (now - loadedAt.current < PROFILELESS_REFRESH_MS) return;
    loadedAt.current = now;
    // Jamais annulée par la navigation suivante : la fenêtre est déjà prise,
    // la réponse doit servir.
    fetch("/api/players/profileless", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        const next = parseProfilelessIds(body);
        if (mounted.current && next) latest.current(next);
      })
      // Hors ligne ou refus : la liste connue reste, au pire un lien vers une 404.
      .catch(() => undefined);
  }, [pathname]);

  return null;
}

/** La fiche `/joueurs/<id>` de ce compte existe-t-elle ? `undefined` (pas un joueur) : oui. */
export function useHasPlayerPage(userId: number | undefined): boolean {
  const profileless = useContext(ProfilelessPlayersContext);
  return userId === undefined || !profileless.has(userId);
}
