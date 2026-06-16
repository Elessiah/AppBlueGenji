import Link from "next/link";
import Image from "next/image";
import { CyberButton } from "@/components/cyber";
import { getCurrentUser } from "@/lib/server/auth";
import styles from "./PublicHeader.module.css";

export async function PublicHeader() {
  const user = await getCurrentUser().catch(() => null);

  return (
    <header className={styles.root}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand} aria-label="BlueGenji Arena">
          <span className={styles.logo}>
            <Image src="/logo_bg.webp" alt="BlueGenji" width={28} height={28} />
          </span>
          <span className={styles.brandText}>
            <span className="logotype">BlueGenji</span>
            <span className="mono">ARENA</span>
          </span>
        </Link>

        <nav className={styles.nav} aria-label="Navigation principale">
          <Link href="/#tournois">Tournois</Link>
          <Link href="/#equipes">Équipes</Link>
          <Link href="/joueurs">Joueurs</Link>
          <Link href="/bot">Bot</Link>
          <Link href="/association">L&apos;asso</Link>
        </nav>

        <div className={styles.actions}>
          {user ? (
            <Link
              href="/profil"
              aria-label="Mon profil"
              style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
            >
              <Image
                src={user.avatarUrl || "/vercel.svg"}
                alt="Avatar"
                width={30}
                height={30}
                unoptimized
                referrerPolicy="no-referrer"
                style={{ borderRadius: "50%", border: "1.5px solid rgba(89,212,255,0.35)" }}
              />
              <span>{user.pseudo}</span>
            </Link>
          ) : (
            <>
              <CyberButton variant="ghost" asChild>
                <Link href="/connexion">Connexion</Link>
              </CyberButton>
              <CyberButton variant="primary" asChild>
                <Link href="/connexion">Rejoindre →</Link>
              </CyberButton>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

