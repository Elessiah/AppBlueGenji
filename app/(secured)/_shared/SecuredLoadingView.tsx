import styles from "./SecuredLoading.module.css";

/** Le squelette, son libellé donné (rendu pur, sans requête). */
export function SecuredLoadingView({ label }: Readonly<{ label: string }>) {
  return (
    <div /* NOSONAR S6819 — région live d'état, pas le résultat d'un formulaire */ className={styles.shell} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className={`${styles.bar} ${styles.title}`} aria-hidden="true" />
      <div className={`${styles.bar} ${styles.line}`} aria-hidden="true" />
      <div className={styles.grid} aria-hidden="true">
        <div className={styles.card} />
        <div className={styles.card} />
        <div className={styles.card} />
      </div>
    </div>
  );
}
