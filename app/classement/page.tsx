import type { Metadata } from "next";
import { EditableCopy, SiteCopyEditorProvider } from "@/components/cyber/landing/EditableCopy";
import { SessionPageShell } from "@/components/cyber/landing/SessionPageShell";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { RuleText } from "@/components/rules/RuleText";
import { JsonLd } from "@/components/seo/JsonLd";
import { getCurrentUser } from "@/lib/server/auth";
import { messagesFor } from "@/lib/server/i18n-messages";
import { loadLeaderboardRows } from "@/lib/server/landing-service";
import { requestLocale } from "@/lib/server/request-locale";
import { getSiteCopy, getSiteCopyEditor } from "@/lib/server/site-copy-service";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { loadCachedTeamForms } from "@/lib/server/teams/directory";
import { formatLocalNumber } from "@/lib/shared/dates";
import type { LandingLeaderboardRow } from "@/lib/shared/landing";
import { localeHref } from "@/lib/shared/locales";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { can } from "@/lib/shared/permissions";
import { RANKING_BASE_POINTS, RANKING_FLOOR_POINTS, RANKING_MARGIN_MAX_BONUS } from "@/lib/shared/ranking";
import { parseRankingFilter, parseRankingShown, rankingFilterGame } from "@/lib/shared/ranking-page";
import { breadcrumbJsonLd } from "@/lib/shared/structured-data";
import { RankingBoard } from "./RankingBoard";
import styles from "./page.module.css";

/**
 * Métadonnées figées dans chaque langue, comme à l'accueil et sur la page
 * association : le titre éditable de l'en-tête (`ranking.hero.title`) est une
 * accroche, pas le nom de la page — l'onglet et l'aperçu de partage gardent
 * « Classement des équipes » / « Team ranking ». Page traduite (`/en/classement`,
 * `docs/features/I18N.md` § Classement) : canonique et `hreflang` dans la langue.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const { meta } = messagesFor(locale).ranking;
  return pageMetadata({
    title: meta.title,
    description: meta.description,
    shareDescription: meta.shareDescription,
    path: "/classement",
    locale,
  });
}

// Le classement bouge à chaque score : la page se rend à la demande, la
// mutualisation se fait en amont (`ranking-cache`, `stats-cache`).
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClassementPage({ searchParams }: Readonly<PageProps>) {
  const params = await searchParams;
  const filter = parseRankingFilter(params.jeu);
  const game = rankingFilterGame(filter);
  // Affichage progressif : `?n=` lignes (validé et borné). Le classement
  // complet est rejoué et trié de toute façon (le rang en dépend) : on le garde
  // entier pour savoir s'il en reste et si une colonne « N » existe, puis on
  // coupe — le rang reste absolu d'une page à l'autre, le rendu borné.
  const shown = parseRankingShown(params.n);
  const locale = await requestLocale();
  const messages = messagesFor(locale).ranking;

  // Lectures indépendantes : en parallèle, chacune avec son repli. La forme
  // couvre tous les jeux : elle n'accompagne que le classement général. Les
  // textes de l'en-tête retombent d'eux-mêmes sur leurs défauts (`getSiteCopy`) —
  // sous `/en`, l'anglais enregistré ou l'anglais d'origine, jamais le français
  // (`resolveSiteCopy`). La session est déjà lue par le layout (mémoïsée par requête).
  const [loaded, forms, copy, user] = await Promise.all([
    loadLeaderboardRows(game).catch((): LandingLeaderboardRow[] | null => null),
    game === undefined ? loadCachedTeamForms().catch(() => null) : Promise.resolve(null),
    getSiteCopy(locale),
    getCurrentUser().catch(() => null),
  ]);
  // Mêmes éditeurs que les textes de la vitrine : administrateurs + Community Managers.
  const canEditCopy = can(user, "showcase");
  // Éditeur bilingue (FR + EN obligatoire) : ses textes ne voyagent que pour le staff.
  const copyEditor = canEditCopy ? await getSiteCopyEditor() : null;
  const unavailable = loaded === null;
  const rows = loaded?.slice(0, shown) ?? [];
  const hasMore = (loaded?.length ?? 0) > shown;
  const anyDraws = loaded?.some((row) => row.draws > 0) ?? false;
  // Nombres en chaînes : « 1,5 » / « 1.5 » selon la langue, les cotes telles quelles.
  const howValues = {
    base: String(RANKING_BASE_POINTS),
    floor: String(RANKING_FLOOR_POINTS),
    marginMax: formatLocalNumber(1 + RANKING_MARGIN_MAX_BONUS, locale),
  };

  return (
    <SessionPageShell>
      {/* Fil d'Ariane dans la langue de la page : noms traduits, adresses préfixées sous `/en`. */}
      <JsonLd
        data={breadcrumbJsonLd(siteCanonicalBase(), [
          { name: messages.breadcrumb.home, path: localeHref("/", locale) },
          { name: messages.breadcrumb.ranking, path: localeHref("/classement", locale) },
        ])}
      />
      <section className={`${styles.section} ${styles.hero}`} aria-labelledby="classement-title">
        <div className="fabric" />
        <div className={styles.heroAurora} aria-hidden="true" />
        <span className="eyebrow">{messages.hero.eyebrow}</span>
        <SiteCopyEditorProvider entries={copyEditor ?? null}>
        <EditableCopy copyKey="ranking.hero.title" value={copy["ranking.hero.title"]} canEdit={canEditCopy}>
          {/* Une ligne par retour à la ligne saisi, la dernière en dégradé. */}
          <h1 id="classement-title" className={`display ${styles.heroTitle}`}>
            {copy["ranking.hero.title"].split("\n").map((line, index, lines) => (
              <span key={line + index} className={index > 0 && index === lines.length - 1 ? "text-gradient" : undefined}>
                {line}
                {index < lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </h1>
        </EditableCopy>
        <EditableCopy copyKey="ranking.hero.lede" value={copy["ranking.hero.lede"]} canEdit={canEditCopy}>
          <p className={styles.heroSub}>{copy["ranking.hero.lede"]}</p>
        </EditableCopy>
        </SiteCopyEditorProvider>
      </section>

      <section className={styles.section} aria-labelledby="classement-board">
        {/* Titre de section pour la hiérarchie (h1 → h2 → noms du podium en h3). */}
        <h2 id="classement-board" className="sr-only">{messages.board.heading}</h2>
        <RankingBoard
          rows={rows}
          filter={filter}
          forms={forms}
          unavailable={unavailable}
          hasMore={hasMore}
          anyDraws={anyDraws}
          locale={locale}
        />
      </section>

      <section className={`${styles.section} ${styles.how}`} aria-labelledby="classement-how">
        <h2 id="classement-how" className={styles.howTitle}>{messages.how.title}</h2>
        <ul className={styles.howList}>
          {([messages.how.base, messages.how.match, messages.how.score, messages.how.placement] as const).map((item) => (
            <li key={item}>
              <RuleText text={item} locale={locale} values={howValues} />
            </li>
          ))}
        </ul>
        <div className={styles.cta}>
          {/* `/tournois` n'est pas encore traduit : depuis `/en`, le lien mène à la page
              française, et le dit (`hrefLang`) aux technologies d'assistance. */}
          <LocaleLink href="/tournois" className={styles.ctaPrimary} hrefLang={locale === "en" ? "fr" : undefined}>
            {messages.cta.register}
          </LocaleLink>
          <LocaleLink href="/regles" className={styles.ctaSecondary}>{messages.cta.rules}</LocaleLink>
        </div>
      </section>
    </SessionPageShell>
  );
}
