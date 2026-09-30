import Link from "next/link";
import { ReportProblemButton } from "@/components/reports/ReportProblemButton";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";
import { SOURCE_CODE_LINK_LABEL, SOURCE_CODE_URL } from "@/lib/shared/source-code";
import { ASSOCIATION_NAME } from "@/lib/shared/legal-contact";
import styles from "./SiteFooterBar.module.css";

/**
 * Pied de page léger des écrans qui n'ont pas celui de la vitrine : l'espace
 * connecté et la page de connexion.
 *
 * Il porte ce qui doit se trouver **sur toutes les pages** du site et ne s'y
 * trouvait pas : le moyen de signaler un problème (dont un contenu illicite),
 * et les textes qui engagent l'association — conditions d'utilisation,
 * mentions légales, confidentialité.
 */
export function SiteFooterBar({ authenticated }: { authenticated: boolean }) {
  return (
    <footer className={styles.root}>
      <nav className={styles.inner} aria-label="Informations légales">
        <ReportProblemButton authenticated={authenticated} className={styles.report} icon />
        <ul className={styles.links}>
          <li>
            <Link className="tap-target" href={TERMS_PATH}>Conditions d&apos;utilisation</Link>
          </li>
          <li>
            <Link className="tap-target" href="/mentions-legales">Mentions légales</Link>
          </li>
          <li>
            <Link className="tap-target" href="/rgpd">Confidentialité</Link>
          </li>
          <li>
            {/* AGPL, art. 13 : le code source s'offre à chaque utilisateur du service. */}
            <a className="tap-target" href={SOURCE_CODE_URL} target="_blank" rel="noreferrer">
              {SOURCE_CODE_LINK_LABEL}
            </a>
          </li>
        </ul>
        <span className={styles.copy}>© 2026 {ASSOCIATION_NAME}</span>
      </nav>
    </footer>
  );
}
