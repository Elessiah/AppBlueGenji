import Link from "next/link";
import Image from "next/image";
import { CyberButton } from "@/components/cyber";
import { getCurrentUser } from "@/lib/server/auth";
import { PublicNavMenu } from "./PublicNavMenu";
import styles from "./PublicHeader.module.css";

/**
 * En-tête public des pages vitrine (landing, asso, bot…).
 *
 * À gauche : le menu burger (`PublicNavMenu`) puis la marque — le menu est placé
 * avant le logo pour rester repérable au lieu d'être noyé parmi les CTA.
 *
 * Actions à droite selon l'état de session :
 * - **Connecté** : bouton « Accéder à la partie compétitive » (→ `/tournois`,
 *   l'espace sécurisé) suivi de l'avatar cliquable menant au profil.
 * - **Déconnecté** : un seul bouton « Rejoindre » (primary) vers `/connexion`,
 *   qui sert aussi de page de connexion.
 *
 * Server component : lit la session via `getCurrentUser()` (retombe sur `null`
 * si la session est absente ou invalide).
 */
export async function PublicHeader() {
  const user = await getCurrentUser().catch(() => null);

  return (
    <header className={styles.root}>
      <div className={styles.inner}>
        <div className={styles.left}>
          <PublicNavMenu />
          <Link href="/" className={styles.brand} aria-label="BlueGenji Esport">
            <span className={styles.logo}>
              <Image src="/logo_bg.webp" alt="BlueGenji" width={28} height={28} />
            </span>
            <span className={styles.brandText}>
              <span className="logotype">BlueGenji</span>
              <span className="mono">ESPORT</span>
            </span>
          </Link>
        </div>

        <div className={styles.actions}>
          {user ? (
            <>
              <CyberButton variant="primary" asChild>
                <Link href="/tournois">
                  <span className={styles.ctaFull}>Accéder à la partie compétitive →</span>
                  <span className={styles.ctaShort}>Compétition →</span>
                </Link>
              </CyberButton>
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
            </>
          ) : (
            <CyberButton variant="primary" asChild>
              <Link href="/connexion">Rejoindre →</Link>
            </CyberButton>
          )}
        </div>
      </div>
    </header>
  );
}

