"use client";

import type { TournamentPhaseStanding } from "@/lib/shared/types";
import { PhaseStandingsTable } from "./PhaseStandingsTable";
import styles from "./PhaseStandingsBlock.module.css";

interface PhaseStandingsBlockProps {
  standings: TournamentPhaseStanding[];
}

/**
 * Classement d'une phase terminée d'un tournoi multi-phases, sous son plateau.
 *
 * Un seul composant pour les trois vues qui l'affichent (survie, ronde suisse,
 * élimination) : recopié trois fois, le bloc portait un `<div>` pour titre et
 * s'intitulait « Classement » dans une branche, « Qualifiées » dans les deux
 * autres, pour le même contenu. Le tableau liste **toutes** les engagées de la
 * phase avec leur rang, les qualifiées marquées d'une colonne : c'est un
 * classement, d'où le titre.
 */
export function PhaseStandingsBlock({ standings }: PhaseStandingsBlockProps) {
  return (
    <section className={styles.block} aria-labelledby="phase-standings-title">
      <h3 id="phase-standings-title" className={styles.title}>
        Classement de la phase
      </h3>
      <PhaseStandingsTable standings={standings} />
    </section>
  );
}
