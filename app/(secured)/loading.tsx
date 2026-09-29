import styles from "./loading.module.css";

/**
 * Frontière de chargement de l'espace connecté.
 *
 * Sans elle, un clic dans la barre de navigation ne rendait rien tant que le
 * serveur n'avait pas répondu, et le préchargement des `<Link>` n'avait rien à
 * préparer pour ces routes dynamiques. Rendue **dans** la mise en page (la
 * barre reste en place), elle donne un retour immédiat au clic.
 *
 * Volontairement neutre : un squelette qui imiterait une page précise
 * mentirait sur toutes les autres.
 */
export default function SecuredLoading() {
  return (
    <div className={styles.shell} role="status" aria-live="polite">
      <span className="sr-only">Chargement…</span>
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
