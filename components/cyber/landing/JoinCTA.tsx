import Link from "next/link";
import { CyberButton, CyberCard } from "@/components/cyber";
import styles from "./JoinCTA.module.css";

export function JoinCTA() {
  return (
    <section className={styles.root}>
      <CyberCard ticks className={styles.card}>
        <div className="fabric" style={{ opacity: 0.8 }} />
        <div className={styles.inner}>
          <div className={styles.copy}>
            <span className="eyebrow">REJOINDRE LA SCÈNE</span>
            <h3 className="display" style={{ fontSize: "clamp(32px, 4vw, 40px)" }}>
              Ton équipe. Notre bracket.
              <br />
              <span className={styles.accent}>Le prochain tournoi commence maintenant.</span>
            </h3>
            <p>
              Crée ton compte, monte une équipe de cinq, inscris-la. On s&apos;occupe
              du reste avec des brackets, du streaming et de l&apos;arbitrage.
            </p>
          </div>

          <div className={styles.actions}>
            <CyberButton variant="primary" asChild>
              <Link href="/connexion">Créer un compte</Link>
            </CyberButton>
            <CyberButton variant="ghost" asChild>
              <a href="https://discord.gg/bluegenji" target="_blank" rel="noreferrer">
                Rejoindre le Discord
              </a>
            </CyberButton>
          </div>
        </div>
      </CyberCard>
    </section>
  );
}

