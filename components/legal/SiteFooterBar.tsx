"use client";

import { LocaleLink } from "@/components/i18n/locale-navigation";
import { useShellText } from "@/components/i18n/shell-text";
import { ReportProblemButton } from "@/components/reports/ReportProblemButton";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";
import { SOURCE_CODE_URL } from "@/lib/shared/source-code";
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
 *
 * Composant client sans état : ses textes viennent de la coquille
 * (`useShellText`), dans la langue de la page.
 */
export function SiteFooterBar({ authenticated }: Readonly<{ authenticated: boolean }>) {
  const { t } = useShellText();
  return (
    <footer className={styles.root}>
      <nav className={styles.inner} aria-label={t("footer.legalNavLabel")}>
        <ReportProblemButton authenticated={authenticated} className={styles.report} icon label={t("footer.reportProblem")} />
        <ul className={styles.links}>
          <li>
            <LocaleLink className="tap-target" href={TERMS_PATH}>{t("footer.links.terms")}</LocaleLink>
          </li>
          <li>
            <LocaleLink className="tap-target" href="/mentions-legales">{t("footer.links.legalNotice")}</LocaleLink>
          </li>
          <li>
            <LocaleLink className="tap-target" href="/rgpd">{t("footer.links.privacy")}</LocaleLink>
          </li>
          <li>
            {/* AGPL, art. 13 : le code source s'offre à chaque utilisateur du service. */}
            <a className="tap-target" href={SOURCE_CODE_URL} target="_blank" rel="noreferrer">
              {t("footer.links.sourceCode")}
            </a>
          </li>
        </ul>
        <span className={styles.copy}>{t("footer.copyright", { association: ASSOCIATION_NAME })}</span>
      </nav>
    </footer>
  );
}
