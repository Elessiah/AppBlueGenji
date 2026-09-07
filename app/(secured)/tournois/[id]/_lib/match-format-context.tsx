"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { MatchFormat } from "@/lib/shared/match-format";
import { tournamentMatchFormat } from "@/lib/shared/bg-survie";
import type { TournamentFormat } from "@/lib/shared/types";

/**
 * Format de match du tournoi (BO5, FT3…), mis à disposition des composants de
 * saisie de score.
 *
 * Il passe par un contexte plutôt que par des props : les cartes de match sont
 * rendues au fond de quatre arborescences différentes (arbre d'élimination,
 * survie, ronde suisse, endurance) qui n'ont, elles, rien à faire du format.
 *
 * Le contexte porte **les deux** formats et celui du tournoi, plutôt qu'un
 * format déjà résolu : « BlueGenji Survie » en joue deux — sa qualification
 * tolère l'égalité, son arbre final non — et c'est la manche du match qui
 * tranche. La règle elle-même n'est pas réécrite ici : `tournamentMatchFormat`
 * est celle qu'applique aussi le serveur à chaque saisie.
 */
type MatchFormatContextValue = {
  /** Format de la phase qualificative — ou du tournoi entier, hors BG Survie. */
  format: MatchFormat | null;
  /** BG Survie : format de l'arbre final. `null` = celui du tournoi. */
  playoffFormat: MatchFormat | null;
  tournamentFormat: TournamentFormat;
};

const MatchFormatContext = createContext<MatchFormatContextValue>({
  format: null,
  playoffFormat: null,
  tournamentFormat: "SINGLE",
});

export function MatchFormatProvider({
  format,
  playoffFormat,
  tournamentFormat,
  children,
}: {
  format: MatchFormat | null;
  playoffFormat: MatchFormat | null;
  tournamentFormat: TournamentFormat;
  children: ReactNode;
}) {
  return (
    <MatchFormatContext.Provider value={{ format, playoffFormat, tournamentFormat }}>
      {children}
    </MatchFormatContext.Provider>
  );
}

/**
 * Format applicable à **un match**.
 *
 * Sans match — un affichage qui parle du tournoi et non d'une rencontre — c'est
 * le format de la qualification qui est rendu, comme le fait le serveur quand
 * il n'a pas de manche à opposer.
 */
export function useMatchFormat(match?: { roundNumber: number } | null): MatchFormat | null {
  const { format, playoffFormat, tournamentFormat } = useContext(MatchFormatContext);

  return tournamentMatchFormat(
    tournamentFormat,
    format,
    playoffFormat,
    match ? match.roundNumber : null,
  );
}
