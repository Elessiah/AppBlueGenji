import { LocaleLink } from "@/components/i18n/locale-navigation";
import Image from "next/image";
import { getCurrentUser } from "@/lib/server/auth";
import { getContactInfo } from "@/lib/server/contact-service";
import { AccessibilityFooterLink } from "@/components/accessibility/AccessibilityFooterLink";
import { FooterContact } from "./FooterContact";
import styles from "./PublicFooter.module.css";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";
import { ReportProblemButton } from "@/components/reports/ReportProblemButton";
import { accessibilityFooterLabel } from "@/lib/shared/accessibility-statement";
import { can } from "@/lib/shared/permissions";
import { toPublicContact } from "@/lib/shared/contact";
import { SOURCE_CODE_LINK_LABEL, SOURCE_CODE_URL } from "@/lib/shared/source-code";
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
            <span className="logotype">BlueGenji</span>
          </div>
          <p>
            Association loi 1901. Tournois Overwatch et Marvel Rivals pour la
            scène amateur francophone.
          </p>
        </div>

        <div className={styles.columns}>
          <div>
            <div className={styles.heading}>COMPÉTITIONS</div>
            <ul>
              <li><LocaleLink className="tap-target" href="/tournois">Tournois</LocaleLink></li>
              <li><LocaleLink className="tap-target" href="/classement">Classement</LocaleLink></li>
              <li><LocaleLink className="tap-target" href="/bot">Bot</LocaleLink></li>
            </ul>
          </div>
          <div>
            <div className={styles.heading}>ASSOCIATION</div>
            <ul>
              <li><LocaleLink className="tap-target" href="/association#manifeste">Manifeste</LocaleLink></li>
              <li><LocaleLink className="tap-target" href="/benevoles">Bénévoles</LocaleLink></li>
              <li><LocaleLink className="tap-target" href="/#sponsors">Partenaires</LocaleLink></li>
            </ul>
          </div>
          <div>
            <div className={styles.heading}>CONTACT</div>
            <FooterContact initialContact={toPublicContact(contact)} isAdmin={canEditContact} />
          </div>
          <div>
            <div className={styles.heading}>LÉGAL</div>
            <ul>
              <li><LocaleLink className="tap-target" href="/mentions-legales">Mentions légales</LocaleLink></li>
              <li><LocaleLink className="tap-target" href={TERMS_PATH}>Conditions d&apos;utilisation</LocaleLink></li>
              <li><LocaleLink className="tap-target" href="/rgpd">RGPD</LocaleLink></li>
              <li><a className="tap-target" href="/statuts.pdf" target="_blank" rel="noreferrer">Statuts</a></li>
              <li><a className="tap-target" href={REGLEMENT_URL} target="_blank" rel="noreferrer">Règlement intérieur</a></li>
              <li><LocaleLink className="tap-target" href="/rgpd#cookies">Cookies</LocaleLink></li>
              {/* AGPL, art. 13 : le code source s'offre à chaque utilisateur du service. */}
              <li><a className="tap-target" href={SOURCE_CODE_URL} target="_blank" rel="noreferrer">{SOURCE_CODE_LINK_LABEL}</a></li>
              <li><AccessibilityFooterLink className={`${styles.linkButton} tap-target`} /></li>
              {/* Mention imposée par le RGAA sur chaque page, dans ses termes
                  exacts : l'état de conformité se lit sans ouvrir la page. */}
              <li><LocaleLink className="tap-target" href="/accessibilite">{accessibilityFooterLabel()}</LocaleLink></li>
            </ul>
          </div>
        </div>
      </div>

      <div className={styles.bottom}>
        <span>© 2026 {ASSOCIATION_NAME}</span>
        {/* Sur la ligne du bas, à part des colonnes : c'est le seul geste du
            pied de page, et il doit se trouver sans parcourir les listes. */}
        <ReportProblemButton authenticated={Boolean(user)} className={styles.report} icon />
      </div>
    </footer>
  );
}
