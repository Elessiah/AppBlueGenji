import type { Metadata } from "next";
import { pageMetadata } from "@/lib/shared/page-metadata";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { CyberCard, Pill } from "@/components/cyber";
import { RuleDiagramFigure } from "@/components/rules/RuleDiagram";
import { EmphasisText } from "@/components/rules/EmphasisText";
import {
  COMMON_RULES,
  TOURNAMENT_RULE_MODES,
  ruleModeBySlug,
  type RuleSection,
} from "@/lib/shared/tournament-rules";
import { JsonLd } from "@/components/seo/JsonLd";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { breadcrumbJsonLd } from "@/lib/shared/structured-data";
import { getCurrentUser } from "@/lib/server/auth";
import { getVisibleTournamentSnapshot } from "@/lib/server/tournaments-service";
import { can } from "@/lib/shared/permissions";
import {
  parseRulesTournamentParam,
  tournamentSettingsGroups,
  type TournamentSettingsGroup,
} from "@/lib/shared/tournament-settings";
import styles from "./page.module.css";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type TournamentSettingsView = { id: number; name: string; groups: TournamentSettingsGroup[] };

/**
 * Réglages du tournoi désigné par `?tournoi=<id>` — le lien du bouton d'aide
 * d'une fiche de tournoi le porte. Même règle de lecture que la fiche : il faut
 * être connecté (l'espace des tournois l'est), et un tournoi non publié n'existe
 * que pour la permission `tournaments`. Tout refus, toute panne de lecture, rend
 * simplement la page générale du mode.
 */
async function loadTournamentSettings(tournamentId: number | null): Promise<TournamentSettingsView | null> {
  if (tournamentId === null) return null;
  try {
    const user = await getCurrentUser();
    if (!user) return null;
    const snapshot = await getVisibleTournamentSnapshot(tournamentId, {
      canManage: can(user, "tournaments"),
    });
    if (!snapshot) return null;
    return {
      id: snapshot.card.id,
      name: snapshot.card.name,
      groups: tournamentSettingsGroups({
        card: snapshot.card,
        phases: snapshot.phases,
        swiss: snapshot.swiss,
        endurance: snapshot.endurance,
        seedingSource: snapshot.seedingSource,
      }),
    };
  } catch {
    return null;
  }
}

/** Les modes sont un registre statique : toutes les pages sont pré-générées. */
export function generateStaticParams(): { slug: string }[] {
  return TOURNAMENT_RULE_MODES.map((mode) => ({ slug: mode.slug }));
}

export async function generateMetadata({ params }: Pick<PageProps, "params">): Promise<Metadata> {
  const { slug } = await params;
  const mode = ruleModeBySlug(slug);
  if (!mode) return pageMetadata({
    title: "Règles des tournois",
    description: "Les règles de chaque mode de tournoi BlueGenji.",
    path: "/regles",
  });
  return pageMetadata({
    title: `Règles : ${mode.label}`,
    description: mode.tagline,
    path: `/regles/${mode.slug}`,
  });
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

export default async function RuleModePage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const mode = ruleModeBySlug(slug);
  if (!mode) notFound();

  const tournamentSettings = await loadTournamentSettings(
    parseRulesTournamentParam((await searchParams).tournoi),
  );

  const others = TOURNAMENT_RULE_MODES.filter((m) => m.slug !== mode.slug);

  return (
    <PublicPageShell>
      {/*
        Le fil d'Ariane est ce qui remplace, dans un résultat de recherche,
        l'adresse brute par « bluegenji-esport.fr › Règles › Ronde suisse ».
        Une page de règles arrive rarement par l'accueil : elle doit dire seule
        d'où elle vient.

        La page étant prérendue, la racine du site est lue **à la compilation** —
        comme l'est déjà l'URL canonique que Next écrit ici : `APP_URL` doit donc
        être réglée au moment du `build`, pas seulement au démarrage. Voir
        `siteCanonicalBase()`.
      */}
      <JsonLd
        data={breadcrumbJsonLd(siteCanonicalBase(), [
          { name: "Accueil", path: "/" },
          { name: "Règles des tournois", path: "/regles" },
          { name: mode.label, path: `/regles/${mode.slug}` },
        ])}
      />

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

      {tournamentSettings && (
        <section
          className={styles.section}
          style={{ paddingTop: 0 }}
          aria-labelledby="reglages-du-tournoi"
        >
          <div className={styles.sectionHead}>
            <span className="eyebrow">CE TOURNOI</span>
            <h2 id="reglages-du-tournoi" className={styles.sectionTitle}>
              Réglages de « {tournamentSettings.name} »
            </h2>
          </div>
          <p className={styles.settingsIntro}>
            Les valeurs retenues à la création de ce tournoi. Elles priment sur les valeurs par
            défaut citées plus bas.{" "}
            <Link href={`/tournois/${tournamentSettings.id}`} className="entity-link">
              Retour au tournoi
            </Link>
          </p>
          {tournamentSettings.groups.map((group) => (
            <CyberCard key={group.title} className={styles.rule}>
              <h3 className={styles.ruleTitle}>{group.title}</h3>
              <dl className={styles.settings}>
                {group.settings.map((setting) => (
                  <div key={setting.label} className={styles.setting}>
                    <dt className={styles.factLabel}>{setting.label}</dt>
                    <dd className={styles.settingValue}>{setting.value}</dd>
                  </div>
                ))}
              </dl>
            </CyberCard>
          ))}
        </section>
      )}

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
    </PublicPageShell>
  );
}
