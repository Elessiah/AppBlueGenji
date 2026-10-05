"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { BracketMatch } from "@/lib/shared/types";
import {
  nextSectionChangeAt,
  sectionCountLabel,
  sectionRoundMatches,
} from "@/lib/shared/match-sections";
import { useLiveControls } from "../_lib/live-context";
import { useEntrantSeeds } from "../_lib/entrant-link";
import styles from "./RoundMatchSections.module.css";

interface RoundMatchSectionsProps {
  matches: readonly BracketMatch[];
  /** Rend la liste d'une section (grille, colonne) — la mise en page reste à la vue. */
  children: (matches: BracketMatch[]) => ReactNode;
}

/**
 * Matchs d'une manche découpés par état (`lib/shared/match-sections.ts`) : un
 * filet discret titré par section, jamais un volet.
 */
export function RoundMatchSections({ matches, children }: Readonly<RoundMatchSectionsProps>) {
  const { refereeScheduling } = useLiveControls();
  const seeds = useEntrantSeeds();
  // Bascule « En attente » → « Lancement » à la seconde où la carte de match
  // bascule elle-même (`useMatchLaunchPhase`) : un seul minuteur, armé sur la
  // prochaine heure de début, jamais d'intervalle. `null` avant le montage —
  // l'heure du lecteur n'est pas celle du serveur.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
  }, [matches, refereeScheduling]);
  useEffect(() => {
    if (now === null) return;
    const at = nextSectionChangeAt(matches, refereeScheduling, now);
    if (at === null) return;
    const delay = Math.min(Math.max(0, at - Date.now()), 2_147_483_647);
    const timer = setTimeout(() => setNow(Math.max(at, Date.now())), delay);
    return () => clearTimeout(timer);
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
