import Link from "next/link";
import Image from "next/image";
import { getCurrentUser } from "@/lib/server/auth";
import { getContactInfo } from "@/lib/server/contact-service";
import { AccessibilityFooterLink } from "@/components/accessibility/AccessibilityFooterLink";
import { FooterContact } from "./FooterContact";
import styles from "./PublicFooter.module.css";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";

const REGLEMENT_URL =
  "https://docs.google.com/document/d/1f3X3tbgs0U7Gwz0qSfotgW-HqMLKIb6DUKqlbz-ZCq8/preview";

export async function PublicFooter() {
  const [contact, user] = await Promise.all([
    getContactInfo(),
    getCurrentUser().catch(() => null),
  ]);
  const isAdmin = Boolean(user?.isAdmin);

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
              <li><Link href="/tournois">Tournois actifs</Link></li>
              <li><Link href="/tournois">Archives</Link></li>
              <li><Link href="/joueurs">Classement</Link></li>
              <li><a href={REGLEMENT_URL} target="_blank" rel="noreferrer">Règlement</a></li>
            </ul>
          </div>
          <div>
            <div className={styles.heading}>COMMUNAUTÉ</div>
            <ul>
              <li><a href={DISCORD_INVITE_URL} target="_blank" rel="noreferrer">Discord</a></li>
              <li><Link href="/#sponsors">Partenaires</Link></li>
              <li><Link href="/benevoles">Bénévoles</Link></li>
              <li><Link href="/bot">Bot</Link></li>
            </ul>
          </div>
          <div>
            <div className={styles.heading}>ASSOCIATION</div>
            <ul>
              <li><Link href="/association#manifeste">Manifeste</Link></li>
              <li><Link href="/benevoles">Équipe bénévole</Link></li>
              <li><Link href="/#sponsors">Partenariats</Link></li>
            </ul>
          </div>
          <div>
            <div className={styles.heading}>CONTACT</div>
            <FooterContact initialContact={contact} isAdmin={isAdmin} />
          </div>
          <div>
            <div className={styles.heading}>LÉGAL</div>
            <ul>
              <li><Link href="/mentions-legales">Mentions légales</Link></li>
              <li><Link href="/rgpd">RGPD</Link></li>
              <li><a href="/statuts.pdf" target="_blank" rel="noreferrer">Statuts</a></li>
              <li><Link href="/rgpd#cookies">Cookies</Link></li>
              <li><AccessibilityFooterLink className={styles.linkButton} /></li>
            </ul>
          </div>
        </div>
      </div>

      <div className={styles.bottom}>
        <span>© 2026 BLUEGENJI · TOUS DROITS RÉSERVÉS</span>
      </div>
    </footer>
  );
}
