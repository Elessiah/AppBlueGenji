"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
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
  /** Conteneur unique des filets et des cartes (grille, colonne) : la mise en page reste à la vue. */
  className?: string;
  style?: CSSProperties;
  /** Rend une carte de match ; la clé est posée ici (l'id du match). */
  children: (match: BracketMatch) => ReactNode;
}

/**
 * Matchs d'une manche découpés par état (`lib/shared/match-sections.ts`) : un
 * filet discret titré par section, jamais un volet.
 */
export function RoundMatchSections({
  matches,
  className,
  style,
  children,
}: Readonly<RoundMatchSectionsProps>) {
  const { refereeScheduling } = useLiveControls();
  const seeds = useEntrantSeeds();
  // Bascule « En attente » → « Lancement » à la seconde où la carte de match
  // bascule elle-même (`useMatchLaunchPhase`) : un seul minuteur, armé sur la
  // prochaine heure de début, jamais d'intervalle. L'instant est lu dès le
  // premier rendu : les matchs n'arrivent qu'au client (détail chargé par
  // `fetch`), et un premier rendu sans heure ferait sauter les cartes d'une
  // section à l'autre à chaque ouverture de volet.
  //
  // Les effets ne suivent que des primitives (même choix que
  // `useMatchLaunchPhase`) : un tableau de matchs refait par la vue ne relance
  // pas l'horloge.
  const [now, setNow] = useState(() => Date.now());
  const signature = matches
    .map((m) => `${m.id}:${m.status}:${m.team1Id}:${m.team2Id}:${m.startAt}:${m.launchedAt}`)
    .join("|");
  useEffect(() => {
    setNow(Date.now());
  }, [signature, refereeScheduling]);
  const nextAt = nextSectionChangeAt(matches, refereeScheduling, now);
  useEffect(() => {
    if (nextAt === null) return;
    // Un délai au-delà de ~24,8 jours est plafonné : le réveil tombe alors
    // avant l'heure, relit l'instant réel (`now` change, l'effet se réarme) au
    // lieu d'avancer l'horloge. À l'approche de l'heure, `Math.max` franchit la
    // frontière même sur un réveil précoce de quelques millisecondes.
    const delay = Math.min(Math.max(0, nextAt - Date.now()), 2_147_483_647);
    const timer = setTimeout(() => {
      const current = Date.now();
      setNow(nextAt - current <= 1_000 ? Math.max(nextAt, current) : current);
    }, delay);
    return () => clearTimeout(timer);
  }, [nextAt, now]);
  const sections = useMemo(
    () => sectionRoundMatches(matches, { refereeScheduling, now, seeds }),
    [matches, refereeScheduling, now, seeds],
  );

  // Filets et cartes sont **frères** dans un seul conteneur, chaque carte
  // gardant pour clé l'id de son match : un match qui change de section est
  // déplacé, pas reconstruit — le bouton qui a ouvert une modale (score
  // arbitre, report) existe encore à sa fermeture, et le focus y revient.
  return (
    <div className={className} style={style}>
      {sections.flatMap((section) => [
        // Filet lu comme une ligne de texte (« Lancement, 2 matchs ») : ni
        // volet, ni repère, ni élément focalisable.
        <p key={`section-${section.key}`} className={styles.divider} data-section={section.key}>
          <span className={styles.label}>
            {section.label}
            <span className="sr-only">, {sectionCountLabel(section.matches.length)}</span>
          </span>
          <span className={styles.count} aria-hidden="true">
            {section.matches.length}
          </span>
          <span className={styles.rule} aria-hidden="true" />
        </p>,
        ...section.matches.map((match) => <Fragment key={match.id}>{children(match)}</Fragment>),
      ])}
    </div>
  );
}
