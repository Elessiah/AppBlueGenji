import type { ReactNode } from "react";
import styles from "./KeyFacts.module.css";

/** Un fait clé : un titre en toutes lettres, une valeur bien visible, une précision facultative. */
export type KeyFact = {
  /** Clé de rendu, stable. */
  id: string;
  label: ReactNode;
  value: ReactNode;
  /** Précision sous la valeur (format détaillé, règle…), en plus petit. */
  detail?: ReactNode;
  /** Occupe toute la largeur de la grille (liste de maps…). */
  wide?: boolean;
};

/**
 * Grille de faits clés — celle de l'en-tête des pages de règles (`/regles/[slug]`),
 * reprise par la page d'un match (`docs/features/MATCH_PAGE.md`) : cases séparées
 * d'un filet teinté, titre en capitales à chasse fixe, valeur en clair. La
 * teinte suit `--tone-rgb` / `--tone-ink` quand la page en pose une (modes de
 * règles), le bleu glacier sinon.
 */
export function KeyFacts({
  facts,
  className,
  label,
}: Readonly<{ facts: readonly KeyFact[]; className?: string; /** Nom accessible de la liste. */ label?: string }>) {
  if (facts.length === 0) return null;
  return (
    <dl className={className ? `${styles.facts} ${className}` : styles.facts} aria-label={label}>
      {facts.map((fact) => (
        <div key={fact.id} className={styles.fact} data-fact={fact.id} data-wide={fact.wide ? "" : undefined}>
          <dt className={styles.label}>{fact.label}</dt>
          <dd className={styles.value}>
            {fact.value}
            {fact.detail && <span className={styles.detail}>{fact.detail}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
