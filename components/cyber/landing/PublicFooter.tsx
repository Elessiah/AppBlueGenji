import Link from "next/link";
import styles from "./PublicFooter.module.css";

function LogoMark() {
  return (
    <svg width="24" height="24" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M20 3 L36 12 V28 L20 37 L4 28 V12 Z" stroke="#5ac8ff" strokeWidth="1.3" fill="rgba(90,200,255,0.06)" />
      <path d="M14 15 L20 12 L26 15 L26 25 L20 28 L14 25 Z" stroke="#5ac8ff" strokeWidth="1.3" fill="none" />
    </svg>
  );
}

export function PublicFooter() {
  return (
    <footer className={styles.root}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <div className={styles.brandTop}>
            <LogoMark />
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
              <li><Link href="/tournois">Règlement</Link></li>
            </ul>
          </div>
          <div>
            <div className={styles.heading}>COMMUNAUTÉ</div>
            <ul>
              <li><a href="https://discord.gg/bluegenji" target="_blank" rel="noreferrer">Discord</a></li>
              <li><a href="#sponsors">Partenaires</a></li>
              <li><a href="#assoc">Bénévoles</a></li>
              <li><a href="/bot">Bot</a></li>
            </ul>
          </div>
          <div>
            <div className={styles.heading}>ASSOCIATION</div>
            <ul>
              <li><Link href="/association">Manifeste</Link></li>
              <li><Link href="/association">Équipe bénévole</Link></li>
              <li><Link href="/association">Partenariats</Link></li>
              <li><Link href="/association">Contact presse</Link></li>
            </ul>
          </div>
          <div>
            <div className={styles.heading}>LÉGAL</div>
            <ul>
              <li><a href="#top">Mentions légales</a></li>
              <li><a href="#top">RGPD</a></li>
              <li><a href="#top">Statuts</a></li>
              <li><a href="#top">Cookies</a></li>
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

