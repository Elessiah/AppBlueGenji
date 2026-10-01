import type { ReactNode } from "react";
import type { ErrorPageCopy } from "@/lib/shared/error-pages";
import styles from "./ErrorPanel.module.css";

/**
 * Carte centrale des pages d'erreur (404, erreur d'exécution). Sans état ni
 * accès serveur : elle sert aussi bien la page introuvable (composant serveur)
 * que les limites d'erreur, qui sont des composants client.
 */
export function ErrorPanel({
  copy,
  children,
  reference,
}: Readonly<{
  copy: ErrorPageCopy;
  /** Actions proposées (liens, bouton « Réessayer »). */
  children: ReactNode;
  reference?: string | null;
}>) {
  return (
    <section className={styles.wrap} aria-labelledby="error-page-title">
      <div className={styles.card}>
        <span className="eyebrow">{copy.eyebrow}</span>
        <h1 id="error-page-title" className={styles.title}>
          {copy.title}
        </h1>
        <p className={styles.message}>{copy.message}</p>
        <div className={styles.actions}>{children}</div>
        {reference && (
          <p className={styles.reference}>
            Référence : <span className="mono">{reference}</span>
          </p>
        )}
      </div>
    </section>
  );
}
