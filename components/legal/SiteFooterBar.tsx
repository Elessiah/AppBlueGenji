import Link from "next/link";
import { ReportProblemButton } from "@/components/reports/ReportProblemButton";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";
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
            <Link href={TERMS_PATH}>Conditions d&apos;utilisation</Link>
          </li>
          <li>
            <Link href="/mentions-legales">Mentions légales</Link>
          </li>
          <li>
            <Link href="/rgpd">Confidentialité</Link>
          </li>
        </ul>
        <span className={styles.copy}>© 2026 BlueGenji</span>
      </nav>
    </footer>
  );
}
