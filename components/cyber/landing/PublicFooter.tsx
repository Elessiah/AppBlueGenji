import { getTranslations } from "next-intl/server";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import Image from "next/image";
import { getCurrentUser } from "@/lib/server/auth";
import { getContactInfo } from "@/lib/server/contact-service";
import { AccessibilityFooterLink } from "@/components/accessibility/AccessibilityFooterLink";
import { FooterContact } from "./FooterContact";
import styles from "./PublicFooter.module.css";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";
import { ReportProblemButton } from "@/components/reports/ReportProblemButton";
import { CONFORMITY_STATUS } from "@/lib/shared/accessibility-statement";
import { can } from "@/lib/shared/permissions";
import { toPublicContact } from "@/lib/shared/contact";
import { SOURCE_CODE_URL } from "@/lib/shared/source-code";
import { ASSOCIATION_NAME } from "@/lib/shared/legal-contact";

// Règlement **intérieur** de l'association — un document de l'association,
// rangé sous LÉGAL. Les règles des tournois (`/regles`) ne sont pas listées :
// elles s'ouvrent depuis la page du tournoi et les conditions d'utilisation.
// Le serveur Discord n'a qu'une entrée, dans CONTACT (lien éditable).
const REGLEMENT_URL =
  "https://docs.google.com/document/d/1f3X3tbgs0U7Gwz0qSfotgW-HqMLKIb6DUKqlbz-ZCq8/preview";

export async function PublicFooter() {
  const [contact, user] = await Promise.all([
    getContactInfo(),
    getCurrentUser().catch(() => null),
  ]);
  // Même garde que `PUT /api/association/contact` (§1.4) : la permission, pas `isAdmin`.
  const canEditContact = can(user, "showcase");
  const t = await getTranslations("shell.footer");

  return (
    // `a11y-always-contrast` : le pied de page se lit toujours en contraste
    // renforcé (mêmes jetons que le réglage du menu). C'est là qu'on cherche
    // l'accessibilité et les mentions légales ; il doit se lire sans réglage.
    <footer className={`${styles.root} a11y-always-contrast`}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <div className={styles.brandTop}>
            {/* Décoratif : le mot-symbole qui suit dit déjà le nom, un `alt`
                le ferait lire deux fois. Même règle que dans l'en-tête. */}
            <Image src="/logo_bg.webp" alt="" width={24} height={24} />
            <span className="logotype">{t("brandName")}</span>
          </div>
          <p>{t("tagline")}</p>
        </div>

        <div className={styles.columns}>
          <div>
            <div className={styles.heading}>{t("headings.competitions")}</div>
            <ul>
              <li><LocaleLink className="tap-target" href="/tournois">{t("links.tournaments")}</LocaleLink></li>
              <li><LocaleLink className="tap-target" href="/classement">{t("links.ranking")}</LocaleLink></li>
              <li><LocaleLink className="tap-target" href="/bot">{t("links.bot")}</LocaleLink></li>
            </ul>
          </div>
          <div>
            <div className={styles.heading}>{t("headings.association")}</div>
            <ul>
              <li><LocaleLink className="tap-target" href="/association#manifeste">{t("links.manifesto")}</LocaleLink></li>
              <li><LocaleLink className="tap-target" href="/benevoles">{t("links.volunteers")}</LocaleLink></li>
              <li><LocaleLink className="tap-target" href="/#sponsors">{t("links.partners")}</LocaleLink></li>
            </ul>
          </div>
          <div>
            <div className={styles.heading}>{t("headings.contact")}</div>
            <FooterContact initialContact={toPublicContact(contact)} isAdmin={canEditContact} />
          </div>
          <div>
            <div className={styles.heading}>{t("headings.legal")}</div>
            <ul>
              <li><LocaleLink className="tap-target" href="/mentions-legales">{t("links.legalNotice")}</LocaleLink></li>
              <li><LocaleLink className="tap-target" href={TERMS_PATH}>{t("links.terms")}</LocaleLink></li>
              <li><LocaleLink className="tap-target" href="/rgpd">{t("links.rgpd")}</LocaleLink></li>
              <li><a className="tap-target" href="/statuts.pdf" target="_blank" rel="noreferrer">{t("links.statutes")}</a></li>
              <li><a className="tap-target" href={REGLEMENT_URL} target="_blank" rel="noreferrer">{t("links.internalRules")}</a></li>
              <li><LocaleLink className="tap-target" href="/rgpd#cookies">{t("links.cookies")}</LocaleLink></li>
              {/* AGPL, art. 13 : le code source s'offre à chaque utilisateur du service. */}
              <li><a className="tap-target" href={SOURCE_CODE_URL} target="_blank" rel="noreferrer">{t("links.sourceCode")}</a></li>
              <li><AccessibilityFooterLink className={`${styles.linkButton} tap-target`} /></li>
              {/* Mention imposée par le RGAA sur chaque page, dans ses termes
                  exacts : l'état de conformité se lit sans ouvrir la page. */}
              <li><LocaleLink className="tap-target" href="/accessibilite">
                {t("accessibilityStatus", { status: t(`conformity.${CONFORMITY_STATUS}`) })}
              </LocaleLink></li>
            </ul>
          </div>
        </div>
      </div>

      <div className={styles.bottom}>
        <span>{t("copyright", { association: ASSOCIATION_NAME })}</span>
        {/* Sur la ligne du bas, à part des colonnes : c'est le seul geste du
            pied de page, et il doit se trouver sans parcourir les listes. */}
        <ReportProblemButton
          authenticated={Boolean(user)}
          className={styles.report}
          icon
          label={t("reportProblem")}
        />
      </div>
    </footer>
  );
}
