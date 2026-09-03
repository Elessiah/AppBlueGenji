import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { CyberCard, Pill } from "@/components/cyber";
import { RuleDiagramFigure } from "@/components/rules/RuleDiagram";
import { EmphasisText } from "@/components/rules/EmphasisText";
import {
  COMMON_RULES,
  TOURNAMENT_RULE_MODES,
  ruleModeBySlug,
  type RuleSection,
} from "@/lib/shared/tournament-rules";
import styles from "./page.module.css";

type PageProps = { params: Promise<{ slug: string }> };

/** Les modes sont un registre statique : toutes les pages sont pré-générées. */
export function generateStaticParams(): { slug: string }[] {
  return TOURNAMENT_RULE_MODES.map((mode) => ({ slug: mode.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const mode = ruleModeBySlug(slug);
  if (!mode) return { title: "BlueGenji - Règles des tournois" };
  return {
    title: `BlueGenji - Règles : ${mode.label}`,
    description: mode.tagline,
    openGraph: {
      title: `Règles du mode ${mode.label}`,
      description: mode.tagline,
      type: "article",
      locale: "fr_FR",
    },
  };
}

function RuleCard({ rule }: { rule: RuleSection }) {
  return (
    <CyberCard className={styles.rule}>
      <h3 className={styles.ruleTitle}>{rule.title}</h3>
      {rule.body.map((paragraph) => (
        <p key={paragraph} className={styles.ruleBody}>
          <EmphasisText text={paragraph} />
        </p>
      ))}
      {rule.bullets && (
        <ul className={styles.bullets}>
          {rule.bullets.map((bullet) => (
            <li key={bullet}>
              <EmphasisText text={bullet} />
            </li>
          ))}
        </ul>
      )}
    </CyberCard>
  );
}

export default async function RuleModePage({ params }: PageProps) {
  const { slug } = await params;
  const mode = ruleModeBySlug(slug);
  if (!mode) notFound();

  const others = TOURNAMENT_RULE_MODES.filter((m) => m.slug !== mode.slug);

  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      <PublicHeader />

      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <Link href="/regles" className={styles.back}>
          ← Règles des tournois
        </Link>
        <h1 className={`display ${styles.title}`}>{mode.label}</h1>
        <p className={styles.tagline}>{mode.tagline}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 22 }}>
          <Pill variant={mode.status === "SOON" ? "default" : "blue"}>
            {mode.status === "SOON" ? "Bientôt disponible" : "Disponible à la création"}
          </Pill>
          <Pill variant="blue">{mode.shortLabel}</Pill>
        </div>
        <dl className={styles.facts}>
          {mode.facts.map((fact) => (
            <div key={fact.label} className={styles.fact}>
              <dt className={styles.factLabel}>{fact.label}</dt>
              <dd className={styles.factValue}>{fact.value}</dd>
            </div>
          ))}
        </dl>
        {mode.status === "SOON" && (
          <p className={styles.soonBanner}>
            <span aria-hidden="true">⏳</span>
            <span>
              Ce mode n&apos;est pas encore proposé à la création d&apos;un tournoi. Ses règles sont
              publiées à l&apos;avance pour que les équipes puissent s&apos;y préparer.
            </span>
          </p>
        )}
      </section>

      <section className={styles.section} style={{ paddingTop: 0 }}>
        <div className={styles.sectionHead}>
          <span className="eyebrow">EN BREF</span>
          <h2 className={styles.sectionTitle}>Le principe</h2>
        </div>
        <ul className={styles.principles}>
          {mode.principles.map((principle, i) => (
            <li key={principle} className={styles.principle}>
              <span className={styles.principleNum}>0{i + 1}</span>
              <span>
                <EmphasisText text={principle} />
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} style={{ paddingTop: 0 }}>
        <div className={styles.sectionHead}>
          <span className="eyebrow">SCHÉMA</span>
          <h2 className={styles.sectionTitle}>Le mode en un coup d&apos;œil</h2>
        </div>
        <RuleDiagramFigure diagram={mode.diagram} caption={mode.diagramCaption} />
      </section>

      <section className={styles.section} style={{ paddingTop: 0 }}>
        <div className={styles.sectionHead}>
          <span className="eyebrow">RÈGLES</span>
          <h2 className={styles.sectionTitle}>Dans le détail</h2>
        </div>
        {mode.sections.map((rule) => (
          <RuleCard key={rule.title} rule={rule} />
        ))}
      </section>

      <section className={styles.section} style={{ paddingTop: 0 }}>
        <div className={styles.sectionHead}>
          <span className="eyebrow">TOUS MODES</span>
          <h2 className={styles.sectionTitle}>Règles communes</h2>
        </div>
        {COMMON_RULES.map((rule) => (
          <RuleCard key={rule.title} rule={rule} />
        ))}
      </section>

      <section className={styles.section} style={{ paddingTop: 0, paddingBottom: 72 }}>
        <div className={styles.sectionHead}>
          <span className="eyebrow">AUTRES MODES</span>
          <h2 className={styles.sectionTitle}>Comparer</h2>
        </div>
        <div className={styles.otherModes}>
          {others.map((other) => (
            <Link key={other.slug} href={`/regles/${other.slug}`} className={styles.otherMode}>
              {other.label}
              {other.status === "SOON" && (
                <span style={{ color: "var(--amber)", fontSize: 11 }}>bientôt</span>
              )}
            </Link>
          ))}
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
