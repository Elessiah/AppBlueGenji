import Link from "next/link";
import { CyberButton, CyberCard } from "@/components/cyber";
import type { SiteCopy } from "@/lib/shared/site-copy";
import { EditableCopy } from "./EditableCopy";
import styles from "./JoinCTA.module.css";

type JoinCTAProps = {
  /**
   * Session en cours. Un visiteur connecté n'a plus de compte à créer : le CTA
   * bascule alors vers l'inscription d'équipe (`/tournois`) au lieu de renvoyer
   * une nouvelle fois vers `/connexion`.
   */
  isAuthenticated?: boolean;
  copy: SiteCopy;
  /** Le viewer peut-il éditer les textes (permission `showcase`) ? */
  canEditCopy?: boolean;
};

export function JoinCTA({ isAuthenticated = false, copy, canEditCopy = false }: JoinCTAProps) {
  return (
    <section className={styles.root}>
      <CyberCard ticks className={styles.card}>
        <div className="fabric" style={{ opacity: 0.8 }} />
        <div className={styles.inner}>
          <div className={styles.copy}>
            <EditableCopy copyKey="home.join.eyebrow" value={copy["home.join.eyebrow"]} canEdit={canEditCopy}>
              <span className="eyebrow">{copy["home.join.eyebrow"]}</span>
            </EditableCopy>
            <EditableCopy copyKey="home.join.title" value={copy["home.join.title"]} canEdit={canEditCopy}>
              <h3 className="display" style={{ fontSize: "clamp(32px, 4vw, 40px)" }}>
                {copy["home.join.title"].split("\n").map((line, index, lines) => (
                  <span key={line + index} className={index === lines.length - 1 ? styles.accent : undefined}>
                    {line}
                    {index < lines.length - 1 ? <br /> : null}
                  </span>
                ))}
              </h3>
            </EditableCopy>
            {/* Connecté, le compte existe déjà : la phrase d'appel change. Les
                deux versions sont éditables — un éditeur étant par définition
                connecté, il ne verrait jamais la version visiteur autrement. */}
            {isAuthenticated ? (
              <EditableCopy
                copyKey="home.join.lede.member"
                value={copy["home.join.lede.member"]}
                canEdit={canEditCopy}
              >
                <p>{copy["home.join.lede.member"]}</p>
              </EditableCopy>
            ) : (
              <EditableCopy copyKey="home.join.lede" value={copy["home.join.lede"]} canEdit={canEditCopy}>
                <p>{copy["home.join.lede"]}</p>
              </EditableCopy>
            )}
          </div>

          <div className={styles.actions}>
            <CyberButton variant="primary" asChild>
              {isAuthenticated ? (
                <Link href="/tournois">Inscrire mon équipe</Link>
              ) : (
                <Link href="/connexion">Créer un compte</Link>
              )}
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
