"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  // L'horloge s'arrête d'elle-même une fois le dernier match daté entré en
  // lancement : `now` l'y fait voir, et seule une nouvelle donnée la relance.
  const [clockNeeded, setClockNeeded] = useState(() => needsSectionClock(matches, refereeScheduling));
  const now = useClock(SECTION_CLOCK_MS, clockNeeded);
  useEffect(() => {
    setClockNeeded(needsSectionClock(matches, refereeScheduling, now));
  }, [matches, refereeScheduling, now]);
  const sections = useMemo(
    () => sectionRoundMatches(matches, { refereeScheduling, now, seeds }),
    [matches, refereeScheduling, now, seeds],
  );

  return (
    <div className={styles.sections}>
      {sections.map((section) => {
        const count = sectionCountLabel(section.matches.length);
        return (
          <div key={section.key}>
            {/* Filet lu comme une ligne de texte (« Lancement, 2 matchs ») :
                ni volet, ni repère, ni élément focalisable. */}
            <p className={styles.divider} data-section={section.key}>
              <span className={styles.label}>
                {section.label}
                <span className="sr-only">, {count}</span>
              </span>
              <span className={styles.count} aria-hidden="true">
                {section.matches.length}
              </span>
              <span className={styles.rule} aria-hidden="true" />
            </p>
            {children(section.matches)}
          </div>
        );
      })}
    </div>
  );
}
