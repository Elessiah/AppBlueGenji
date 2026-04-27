import Link from "next/link";
import Image from "next/image";
import { CyberButton } from "@/components/cyber";
import styles from "./PublicHeader.module.css";

export function PublicHeader() {
  return (
    <header className={styles.root}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand} aria-label="BlueGenji Arena">
          <span className={styles.logo}>
            <Image src="/logo_bg.webp" alt="BlueGenji" width={28} height={28} />
          </span>
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

