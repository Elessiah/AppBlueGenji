"use client";

import { useId, useMemo, type ReactNode } from "react";
import type { BracketMatch } from "@/lib/shared/types";
import { useClock } from "@/lib/shared/hooks/useClock";
import {
  needsSectionClock,
  sectionCountLabel,
  sectionRoundMatches,
} from "@/lib/shared/match-sections";
import { useLiveControls } from "../_lib/live-context";
import { useEntrantSeeds } from "../_lib/entrant-link";
import styles from "./RoundMatchSections.module.css";

/** Pas de l'horloge : seule l'heure d'un match fait passer « En attente » → « Lancement ». */
const SECTION_CLOCK_MS = 15_000;

interface RoundMatchSectionsProps {
  matches: readonly BracketMatch[];
  /** Rend la liste d'une section (grille, colonne) — la mise en page reste à la vue. */
  children: (matches: BracketMatch[]) => ReactNode;
}

/**
 * Matchs d'une manche découpés par état (`lib/shared/match-sections.ts`) : un
 * filet discret titré par section, jamais un volet. L'horloge (`useClock`) ne
 * tourne que si un match attend son heure.
 */
export function RoundMatchSections({ matches, children }: Readonly<RoundMatchSectionsProps>) {
  const { refereeScheduling } = useLiveControls();
  const seeds = useEntrantSeeds();
  const clockNeeded = useMemo(
    () => needsSectionClock(matches, refereeScheduling),
    [matches, refereeScheduling],
  );
  const now = useClock(SECTION_CLOCK_MS, clockNeeded);
  const sections = useMemo(
    () => sectionRoundMatches(matches, { refereeScheduling, now, seeds }),
    [matches, refereeScheduling, now, seeds],
  );
  const baseId = useId();

  return (
    <div className={styles.sections}>
      {sections.map((section) => {
        const labelId = `${baseId}-${section.key}`;
        const count = sectionCountLabel(section.matches.length);
        return (
          <div key={section.key} role="group" aria-labelledby={labelId}>
            <div className={styles.divider} data-section={section.key}>
              <span id={labelId} className={styles.label}>
                {section.label}
                <span className="sr-only">, {count}</span>
              </span>
              <span className={styles.count} aria-hidden="true">
                {section.matches.length}
              </span>
              <span className={styles.rule} aria-hidden="true" />
            </div>
            {children(section.matches)}
          </div>
        );
      })}
    </div>
  );
}
