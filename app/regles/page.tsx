import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { CyberCard, Pill } from "@/components/cyber";
import {
  COMMON_RULES,
  availableRuleModes,
  upcomingRuleModes,
  type TournamentRuleMode,
} from "@/lib/shared/tournament-rules";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "BlueGenji - Règles des tournois",
  description:
    "Comment se joue un tournoi BlueGenji : élimination simple, double élimination, mode Survie et ronde suisse — règles, schémas et cas particuliers.",
  openGraph: {
    title: "BlueGenji - Règles des tournois",
    description:
      "Les règles de chaque mode de tournoi, expliquées avec des schémas : élimination simple, double élimination, Survie, ronde suisse.",
    type: "website",
    locale: "fr_FR",
  },
};

function ModeCard({ mode }: { mode: TournamentRuleMode }) {
  const soon = mode.status === "SOON";
  return (
    <CyberCard lift ticks style={{ height: "100%" }}>
      <Link href={`/regles/${mode.slug}`} className={styles.card}>
        <div className={styles.cardHead}>
          <h3 className={styles.cardTitle}>{mode.label}</h3>
          <Pill variant={soon ? "default" : "blue"}>{soon ? "Bientôt" : "Disponible"}</Pill>
        </div>
        <p className={styles.cardTagline}>{mode.tagline}</p>
        <dl className={styles.facts}>
          {mode.facts.slice(0, 4).map((fact) => (
            <div key={fact.label} className={styles.fact}>
              <dt className={styles.factLabel}>{fact.label}</dt>
              <dd className={styles.factValue} style={{ margin: 0 }}>
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
        <span className={styles.cardCta}>Lire les règles →</span>
      </Link>
    </CyberCard>
  );
}

export default function ReglesPage() {
  const available = availableRuleModes();
  const upcoming = upcomingRuleModes();

  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      <PublicHeader />

      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <span className="eyebrow">RÈGLES · MODES DE TOURNOI</span>
        <h1 className={`display ${styles.heroTitle}`}>
          Comment se joue
          <br />
          un tournoi BlueGenji.
        </h1>
        <p className={styles.heroLead}>
          Chaque tournoi annonce son mode dès la page d&apos;inscription. Le mode détermine le
          nombre de défaites que l&apos;on peut encaisser, la façon dont les adversaires sont
          désignés et la manière dont le classement final est établi. Choisis un mode pour en lire
          les règles détaillées, schémas à l&apos;appui.
        </p>
      </section>

      <section className={styles.section} style={{ paddingTop: 0 }}>
        <div className={styles.head}>
          <div>
            <span className="eyebrow">MODES DISPONIBLES</span>
            <h2 className={styles.sectionTitle}>Jouables dès maintenant</h2>
          </div>
          <p className={styles.headNote}>
            Ces formats peuvent être choisis à la création d&apos;un tournoi.
          </p>
        </div>
        <div className={styles.grid}>
          {available.map((mode) => (
            <ModeCard key={mode.slug} mode={mode} />
          ))}
        </div>
      </section>

      {upcoming.length > 0 && (
        <section className={styles.section} style={{ paddingTop: 0 }}>
          <div className={styles.head}>
            <div>
              <span className="eyebrow">À VENIR</span>
              <h2 className={styles.sectionTitle}>Bientôt sur la plateforme</h2>
            </div>
            <p className={styles.headNote}>
              Les règles sont déjà consultables : le format ouvrira à la création prochainement.
            </p>
          </div>
          <div className={styles.grid}>
            {upcoming.map((mode) => (
              <ModeCard key={mode.slug} mode={mode} />
            ))}
          </div>
        </section>
      )}

      <section className={styles.section} style={{ paddingTop: 0, paddingBottom: 72 }}>
        <div className={styles.head}>
          <div>
            <span className="eyebrow">TOUS MODES CONFONDUS</span>
            <h2 className={styles.sectionTitle}>Règles communes</h2>
          </div>
          <p className={styles.headNote}>
            Report des scores et forfaits fonctionnent de la même façon partout.
          </p>
        </div>
        <div className={styles.commonGrid}>
          {COMMON_RULES.map((rule) => (
            <CyberCard key={rule.title} className={styles.commonCard}>
              <h3 className={styles.commonTitle}>{rule.title}</h3>
              {rule.body.map((paragraph) => (
                <p key={paragraph} className={styles.commonBody}>
                  {paragraph}
                </p>
              ))}
              {rule.bullets && (
                <ul className={styles.bullets}>
                  {rule.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              )}
            </CyberCard>
          ))}
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
