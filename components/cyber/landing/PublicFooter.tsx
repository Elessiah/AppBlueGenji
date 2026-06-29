import Link from "next/link";
import Image from "next/image";
import styles from "./PublicFooter.module.css";

const REGLEMENT_URL =
  "https://docs.google.com/document/d/1f3X3tbgs0U7Gwz0qSfotgW-HqMLKIb6DUKqlbz-ZCq8/preview";

export function PublicFooter() {
  return (
    <footer className={styles.root}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <div className={styles.brandTop}>
            <Image src="/logo_bg.webp" alt="BlueGenji" width={24} height={24} />
            <span className="logotype">BlueGenji</span>
          </div>
          <p>
            Association loi 1901. Tournois Overwatch 2 et Marvel Rivals pour la
            scène amateur francophone.
          </p>
          <div className="mono">SIRET 912 345 678 00017 · RNA W691234567</div>
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
              <li><a href="https://discord.gg/bluegenji" target="_blank" rel="noreferrer">Discord</a></li>
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
              <li><Link href="/association#contact">Contact presse</Link></li>
            </ul>
          </div>
          <div>
            <div className={styles.heading}>LÉGAL</div>
            <ul>
              <li><Link href="/mentions-legales">Mentions légales</Link></li>
              <li><Link href="/rgpd">RGPD</Link></li>
              <li><a href="/statuts.pdf" target="_blank" rel="noreferrer">Statuts</a></li>
              <li><Link href="/rgpd#cookies">Cookies</Link></li>
            </ul>
          </div>
        </div>
      </div>

      <div className={styles.bottom}>
        <span>© 2026 BLUEGENJI · TOUS DROITS RÉSERVÉS</span>
        <span>BUILT WITH ♠ IN LYON</span>
      </div>
    </footer>
  );
}
