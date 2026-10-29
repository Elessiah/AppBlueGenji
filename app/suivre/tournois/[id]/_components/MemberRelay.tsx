"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useLocaleRouter } from "@/components/i18n/locale-navigation";
import { splitLocalePrefix } from "@/lib/shared/locales";
import { memberPathForSpectatorPath } from "@/lib/shared/spectator-member-path";

/**
 * Relais client du renvoi d'un membre connecté vers son espace.
 *
 * La mise en page serveur renvoie d'elle-même (`redirect`) quand elle lit le
 * chemin demandé dans `x-pathname`. Une mise en page **préchargée**, réutilisée
 * à la navigation, est servie sans cet en-tête : elle ne sait plus quelle page
 * on visait et ne peut mener qu'à la fiche du tournoi. Ce relais lit alors le
 * chemin réel (`usePathname`) et mène à la page du match quand c'en est une,
 * comme `AuthGate` le fait dans l'espace sécurisé. Requête et ancre suivent.
 */
export function MemberRelay({ tournamentId }: Readonly<{ tournamentId: number }>) {
  const pathname = usePathname();
  const router = useLocaleRouter();
  const target = memberPathForSpectatorPath(splitLocalePrefix(pathname).path, tournamentId);
  useEffect(() => {
    // Lus à l'instant du relais : le rendu serveur ne connaît ni l'un ni l'autre.
    const { search, hash } = globalThis.location;
    router.replace(`${target}${search}${hash}`);
  }, [target, router]);
  return null;
}
