import Link from "next/link";
import { CyberButton } from "@/components/cyber";
import styles from "./PublicHeader.module.css";

function LogoMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M20 3 L36 12 V28 L20 37 L4 28 V12 Z" stroke="#5ac8ff" strokeWidth="1.3" fill="rgba(90,200,255,0.06)" />
      <path d="M14 15 L20 12 L26 15 L26 25 L20 28 L14 25 Z" stroke="#5ac8ff" strokeWidth="1.3" fill="none" />
      <circle cx="20" cy="20" r="2" fill="#5ac8ff" />
    </svg>
  );
}

export function PublicHeader() {
  return (
    <header className={styles.root}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand} aria-label="BlueGenji Arena">
          <span className={styles.logo}><LogoMark /></span>
          <span className={styles.brandText}>
            <span className="logotype">BlueGenji</span>
            <span className="mono">ARENA · EST. 2023</span>
          </span>
        </Link>

        <nav className={styles.nav} aria-label="Navigation principale">
          <a href="#tournois">Tournois</a>
          <a href="#equipes">Équipes</a>
          <a href="#calendrier">Calendrier</a>
          <Link href="/association">L&apos;asso</Link>
          <Link href="/partenaires">Partenaires</Link>
        </nav>

        <div className={styles.actions}>
          <CyberButton variant="ghost" asChild>
            <Link href="/connexion">Connexion</Link>
          </CyberButton>
          <CyberButton variant="primary" asChild>
            <Link href="/tournois">Rejoindre →</Link>
          </CyberButton>
        </div>
      </div>
    </header>
  );
}

