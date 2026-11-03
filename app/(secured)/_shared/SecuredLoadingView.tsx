import styles from "./SecuredLoading.module.css";

/**
 * Le squelette, son libellé donné (rendu pur, sans requête).
 *
 * `cardsOnly` : l'état interne d'une page qui a déjà son titre à l'écran
 * (`/tournois` attend sa liste sous son vrai en-tête) — les cartes seules, sans
 * la barre de titre que la frontière de chargement dessine à la navigation.
 */
export function SecuredLoadingView({ label, cardsOnly = false }: Readonly<{ label: string; cardsOnly?: boolean }>) {
  return (
    <div /* NOSONAR S6819 — région live d'état, pas le résultat d'un formulaire */ className={styles.shell} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {cardsOnly ? null : (
        <>
          <div className={`${styles.bar} ${styles.title}`} aria-hidden="true" />
          <div className={`${styles.bar} ${styles.line}`} aria-hidden="true" />
        </>
      )}
      <div className={styles.grid} aria-hidden="true">
        <div className={styles.card} />
        <div className={styles.card} />
        <div className={styles.card} />
      </div>
    </div>
  );
}
