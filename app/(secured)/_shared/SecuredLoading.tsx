import styles from "./SecuredLoading.module.css";

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
 *
 * Posée **segment par segment** (`tournois`, `equipes`, `joueurs`, `profil`,
 * `signalements`) et jamais à la racine de `(secured)` : une frontière rend la
 * réponse en flux, donc fige son statut à `200` avant que les mises en page
 * qu'elle enveloppe aient parlé — `admin/signalements/layout.tsx`, qui refuse
 * en `notFound()` (404, jamais 403), ne pourrait plus poser son statut.
 *
 * Pas d'`aria-busy` : la frontière est remplacée d'un bloc par la page, la
 * zone ne cesserait donc jamais d'être « occupée » et le lecteur d'écran
 * attendrait indéfiniment pour l'annoncer.
 */
export function SecuredLoading() {
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
