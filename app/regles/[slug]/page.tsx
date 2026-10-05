import type { Metadata } from "next";
import { pageMetadata } from "@/lib/shared/page-metadata";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { RuleDiagramFigure } from "@/components/rules/RuleDiagram";
import { EmphasisText } from "@/components/rules/EmphasisText";
import { RulesToc } from "@/components/rules/RulesToc";
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
import {
  RULES_PAGE_ANCHORS,
  ruleSectionAnchors,
  rulesPageOutline,
} from "@/lib/shared/rules-page-outline";
import { RULE_MODE_TONE } from "@/lib/shared/rules-display";
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

function RuleBody({ rule }: Readonly<{ rule: RuleSection }>) {
  return (
    <>
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
    </>
  );
}

function SectionHead({ id, eyebrow, title }: Readonly<{ id: string; eyebrow: string; title: string }>) {
  return (
    <div className={styles.sectionHead}>
      <span className="eyebrow">{eyebrow}</span>
      <h2 id={id} className={styles.sectionTitle}>
        {title}
      </h2>
    </div>
  );
}

/**
 * Une page de règles se lit dans un ordre : ce qui vaut pour **ce** tournoi
 * (s'il est désigné), l'essentiel du mode, son détail, puis ce qui est commun à
 * tous. Le sommaire (`RulesToc`) dit où l'on est ; les règles communes, les
 * mêmes sur chaque page, sont repliées pour ne pas noyer celles du mode.
 */
export default async function RuleModePage({ params, searchParams }: Readonly<PageProps>) {
  const { slug } = await params;
  const mode = ruleModeBySlug(slug);
  if (!mode) notFound();

  const tournamentSettings = await loadTournamentSettings(
    parseRulesTournamentParam((await searchParams).tournoi),
  );

  const others = TOURNAMENT_RULE_MODES.filter((m) => m.slug !== mode.slug);
  const outline = rulesPageOutline(mode, { hasTournamentSettings: tournamentSettings !== null });
  const ruleAnchors = ruleSectionAnchors(mode.sections);

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

      <section className={`${styles.shell} ${styles.hero}`} data-tone={RULE_MODE_TONE[mode.diagram]}>
        <div className="fabric" />
        <Link href="/regles" className={styles.back}>
          ← Règles des tournois
        </Link>
        <h1 className={`display ${styles.title}`}>
          <span className="text-gradient">{mode.label}</span>
        </h1>
        <p className={styles.tagline}>{mode.tagline}</p>
        {mode.status === "SOON" && (
          <p className={styles.soonBanner}>
            <span aria-hidden="true">⏳</span>
            <span>
              <strong>Bientôt disponible.</strong> Ce mode n&apos;est pas encore proposé à la
              création d&apos;un tournoi. Ses règles sont publiées à l&apos;avance pour que les
              équipes puissent s&apos;y préparer.
            </span>
          </p>
        )}
        <dl className={styles.facts}>
          {mode.facts.map((fact) => (
            <div key={fact.label} className={styles.fact}>
              <dt className={styles.factLabel}>{fact.label}</dt>
              <dd className={styles.factValue}>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className={`${styles.shell} ${styles.layout}`} data-tone={RULE_MODE_TONE[mode.diagram]}>
        <RulesToc entries={outline} />

        <div className={styles.content}>
          {tournamentSettings && (
            <section className={styles.section} aria-labelledby={RULES_PAGE_ANCHORS.tournament}>
              <div className={styles.tournamentPanel}>
                <div className={styles.tournamentHead}>
                  <span className="eyebrow">CE TOURNOI</span>
                  <h2 id={RULES_PAGE_ANCHORS.tournament} className={styles.tournamentTitle}>
                    Réglages de « {tournamentSettings.name} »
                  </h2>
                  <p className={styles.settingsIntro}>
                    Les valeurs retenues à la création de ce tournoi. Elles priment sur les
                    valeurs par défaut citées plus bas.
                  </p>
                  <Link
                    href={`/tournois/${tournamentSettings.id}`}
                    className={`entity-link ${styles.backToTournament}`}
                  >
                    ← Retour au tournoi
                  </Link>
                </div>
                {tournamentSettings.groups.map((group) => (
                  <div key={group.title} className={styles.settingsGroup}>
                    <h3 className={styles.settingsGroupTitle}>{group.title}</h3>
                    <dl className={styles.settings}>
                      {group.settings.map((setting) => (
                        <div key={setting.label} className={styles.setting}>
                          <dt className={styles.factLabel}>{setting.label}</dt>
                          <dd className={styles.settingValue}>{setting.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className={styles.section} aria-labelledby={RULES_PAGE_ANCHORS.essentials}>
            <SectionHead id={RULES_PAGE_ANCHORS.essentials} eyebrow="EN BREF" title="L'essentiel" />
            <ol className={styles.principles}>
              {mode.principles.map((principle, i) => (
                <li key={principle} className={styles.principle}>
                  <span className={styles.principleNum} aria-hidden="true">
                    {i + 1}
                  </span>
                  <span>
                    <EmphasisText text={principle} />
                  </span>
                </li>
              ))}
            </ol>
            <RuleDiagramFigure diagram={mode.diagram} caption={mode.diagramCaption} />
          </section>

          <section className={styles.section} aria-labelledby={RULES_PAGE_ANCHORS.details}>
            <SectionHead id={RULES_PAGE_ANCHORS.details} eyebrow="EN DÉTAIL" title="Règles du mode" />
            {mode.sections.map((rule, i) => (
              <article key={rule.title} className={styles.rule} aria-labelledby={ruleAnchors[i]}>
                <h3 id={ruleAnchors[i]} className={styles.ruleTitle}>
                  {rule.title}
                </h3>
                <RuleBody rule={rule} />
              </article>
            ))}
          </section>

          <section className={styles.section} aria-labelledby={RULES_PAGE_ANCHORS.common}>
            <SectionHead id={RULES_PAGE_ANCHORS.common} eyebrow="TOUS MODES" title="Règles communes" />
            <p className={styles.sectionIntro}>
              Identiques dans tous les modes : lancement et format des matchs, report des scores,
              forfaits. Ouvre une règle pour la lire.
            </p>
            <div className={styles.accordion}>
              {COMMON_RULES.map((rule) => (
                <details key={rule.title} className={styles.commonRule}>
                  <summary className={styles.commonSummary}>{rule.title}</summary>
                  <div className={styles.commonBody}>
                    <RuleBody rule={rule} />
                  </div>
                </details>
              ))}
            </div>
          </section>

          <section className={styles.section} aria-labelledby={RULES_PAGE_ANCHORS.others}>
            <SectionHead id={RULES_PAGE_ANCHORS.others} eyebrow="COMPARER" title="Autres modes" />
            <div className={styles.otherModes}>
              {others.map((other) => (
                <Link
                  key={other.slug}
                  href={`/regles/${other.slug}`}
                  className={styles.otherMode}
                  data-tone={RULE_MODE_TONE[other.diagram]}
                >
                  {other.label}
                  {other.status === "SOON" && <span className={styles.soonTag}>bientôt</span>}
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </PublicPageShell>
  );
}
