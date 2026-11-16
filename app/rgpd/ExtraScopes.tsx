import styles from "./page.module.css";

/**
 * Portées d'une même pastille de base (`groupedExtraBases`) : une seule se
 * lit en ligne ; plusieurs, en liste — chaque portée contient déjà des « ; »
 * et des « — », un séparateur en ligne les rendrait indiscernables.
 */
export function ExtraScopes({ scopes }: Readonly<{ scopes: readonly string[] }>) {
  if (scopes.length <= 1) return <>{scopes[0]}</>;
  return (
    <ul className={styles.extraScopes}>
      {scopes.map((scope) => (
        <li key={scope}>{scope}</li>
      ))}
    </ul>
  );
}
