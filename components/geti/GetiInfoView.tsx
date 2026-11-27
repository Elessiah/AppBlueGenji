import { Suspense } from "react";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { JsonLd } from "@/components/seo/JsonLd";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { getCurrentUser } from "@/lib/server/auth";
import { listGetiAlerts } from "@/lib/server/geti/alerts";
import { listGetiPostsShared } from "@/lib/server/geti/posts";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";
import { GETI_CATEGORIES, type GetiCategory, type GetiFilter } from "@/lib/shared/geti";
import { getiAlertSearch, type GetiAlert } from "@/lib/shared/geti/alerts";
import { GETI_RETENTION_DAYS, type GetiPostPage } from "@/lib/shared/geti/ingest";
import {
  GETI_CATEGORY_FILTERS,
  GETI_PAGE_PATH,
  getiActiveFilterCount,
  getiAgeOptions,
  getiCategoryPath,
  getiChannelUrl,
  getiErrorCode,
  getiPageFilter,
  getiPageHref,
  getiPageSearch,
  parseGetiPageQuery,
  type GetiPageQuery,
  type GetiSearchParams,
} from "@/lib/shared/geti/page";
import { getiDataText, getiFilterDataText, getiText, type GetiDataText, type GetiMessages } from "@/lib/shared/geti/page-text";
import { localeHref, type Locale } from "@/lib/shared/locales";
import { breadcrumbJsonLd } from "@/lib/shared/structured-data";
import { GetiAlerts } from "./GetiAlerts";
import { GetiFilters } from "./GetiFilters";
import { GetiLayout } from "./GetiLayout";
import { GetiRetry } from "./GetiRetry";
import { GetiOfficialCard } from "./GetiOfficialCard";
import { GetiOfficialCount } from "./GetiOfficialCount";
import { GetiPostCard } from "./GetiPostCard";
import { GetiPublishButton } from "./GetiPublishButton";
import { GetiRefresher } from "./GetiRefresher";
import styles from "./geti.module.css";

/**
 * Page publique des annonces GETI pour une catégorie — `docs/features/GETI_INFO.md` § Page.
 *
 * Rendue côté serveur à chaque demande : l'état des filtres vit dans
 * l'adresse, la liste est lue par `listGetiPosts` (même filtre que les
 * alertes), et le navigateur ne reçoit que des annonces déjà analysées.
 */
export async function GetiInfoView({
  category,
  searchParams,
}: Readonly<{ category: GetiCategory; searchParams: GetiSearchParams }>) {
  const locale = await requestLocale();
  const m = messagesFor(locale).geti;
  const query = parseGetiPageQuery(category, searchParams);
  const filter = getiPageFilter(category, query);
  const now = Date.now();
  // Base injoignable : la page reste lisible (carte, onglets, bouton « Publier »).
  const listed: GetiPostPage | null = await listGetiPostsShared(filter, { page: query.page }, now).catch(
    (error: unknown) => {
      // Un code seul (jamais le message, qui peut citer la requête) : la panne se voit dans pm2.
      console.warn("[geti] post list unavailable:", getiErrorCode(error));
      return null;
    },
  );
  const activeFilters = getiActiveFilterCount(query);
  // Les alertes du compte connecté, s'il y en a un : la page reste publique, et
  // se rend sans elles si la session ou la table ne se lisent pas.
  const viewer = await getCurrentUser().catch(() => null);
  const alerts: GetiAlert[] = viewer ? await listGetiAlerts(viewer.id).catch(() => []) : [];
  const categoryTitles = Object.fromEntries(
    GETI_CATEGORIES.map((entry) => [entry, m.categories[entry].title]),
  ) as Record<GetiCategory, string>;
  const data = getiFilterDataText(m);
  const cardData = getiDataText(m);
  const retentionDays = GETI_RETENTION_DAYS[category];

  return (
    <PublicPageShell>
      <JsonLd
        data={breadcrumbJsonLd(siteCanonicalBase(), [
          { name: m.breadcrumb.home, path: localeHref("/", locale) },
          { name: m.breadcrumb.page, path: localeHref(GETI_PAGE_PATH, locale) },
          { name: m.categories[category].title, path: localeHref(getiCategoryPath(category), locale) },
        ])}
      />
      <section className={`${styles.section} ${styles.hero}`} aria-labelledby="geti-title">
        <div className="fabric" />
        <span className="eyebrow">{m.hero.eyebrow}</span>
        <h1 id="geti-title" className={`display ${styles.heroTitle}`}>
          {m.hero.titleLead}
          <br />
          <span className="text-gradient">{m.hero.titleAccent}</span>
        </h1>
        <p className={styles.heroLede}>{m.hero.lede}</p>
      </section>

      <div className={styles.section}>
        <nav className={styles.tabs} aria-label={m.tabs.label}>
          <span className={styles.tabsLabel} aria-hidden="true">
            {m.tabs.label}
          </span>
          <ul className={styles.tabList} data-tap-zone="">
            {GETI_CATEGORIES.map((entry) => (
              <li key={entry}>
                <LocaleLink
                  href={getiCategoryPath(entry)}
                  className={entry === category ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                  aria-current={entry === category ? "page" : undefined}
                >
                  {m.tabs[entry]}
                </LocaleLink>
              </li>
            ))}
          </ul>
        </nav>

        <GetiOfficialCard
          text={m.official}
          locale={locale}
          count={
            <Suspense fallback={null}>
              <GetiOfficialCount text={m.official} locale={locale} />
            </Suspense>
          }
        />

        <header className={styles.categoryHead}>
          <div>
            <h2 id="geti-category-title" className={styles.categoryTitle}>
              {m.categories[category].title}
            </h2>
            <InfoHintRow inline>
              <p className={styles.categoryLede}>{m.categories[category].lede}</p>
              <InfoHint id="geti-retention-hint" subject={m.hero.retentionSubject}>
                {getiText(locale, m.hero.retention, { days: retentionDays })}
              </InfoHint>
            </InfoHintRow>
          </div>
          <div className={styles.headActions}>
            <InfoHintRow inline>
              <GetiAlerts
                text={m.alerts}
                category={category}
                search={getiAlertSearch(category, getiPageSearch(query)) ?? ""}
                categoryTitles={categoryTitles}
                signedIn={viewer !== null}
                initialAlerts={alerts}
              />
              <InfoHint id="geti-alerts-hint" subject={m.alerts.hintSubject}>
                {m.alerts.hint}
              </InfoHint>
            </InfoHintRow>
            <GetiPublishButton
              text={m.publish}
              categoryTitle={m.categories[category].title}
              channelUrl={getiChannelUrl(category)}
              ourInviteUrl={DISCORD_INVITE_URL}
              official={m.official}
            />
          </div>
        </header>

        <GetiLayout single={listed === null}>
          {listed === null ? null : (
            <GetiFilters
              category={category}
              query={query}
              fields={GETI_CATEGORY_FILTERS[category]}
              ageOptions={getiAgeOptions(category)}
              retentionDays={retentionDays}
              total={listed.total}
              text={m.filters}
              data={data}
            />
          )}

          <GetiResults
            listed={listed}
            category={category}
            query={query}
            filter={filter}
            filtered={activeFilters > 0}
            messages={m}
            data={cardData}
            locale={locale}
            now={now}
          />
        </GetiLayout>
      </div>
      <GetiRefresher />
    </PublicPageShell>
  );
}

type ResultsProps = Readonly<{
  listed: GetiPostPage | null;
  category: GetiCategory;
  query: GetiPageQuery;
  filter: GetiFilter;
  /** Au moins un filtre est actif. */
  filtered: boolean;
  messages: GetiMessages;
  data: GetiDataText;
  locale: Locale;
  now: number;
}>;

/** Compteur annoncé (`aria-live`), liste des annonces, pagination. */
function GetiResults({ listed, category, query, filter, filtered, messages: m, data, locale, now }: ResultsProps) {
  if (listed === null) {
    return (
      <section className={styles.results} aria-labelledby="geti-category-title">
        <p /* NOSONAR S6819 — compteur de résultats annoncé à chaque filtre, pas une sortie de formulaire */ className={styles.count} role="status" aria-live="polite" aria-atomic="true" data-testid="geti-count">
          {m.results.none}
        </p>
        <GetiRetry label={m.results.retry} error={m.results.unavailable} />
      </section>
    );
  }
  const pages = Math.max(1, Math.ceil(listed.total / listed.pageSize));
  // Page au-delà de la dernière (lien partagé, annonces retirées depuis) : la liste n'est pas vide.
  const beyond = listed.posts.length === 0 && listed.total > 0;
  return (
    <section className={styles.results} aria-labelledby="geti-category-title">
      <p /* NOSONAR S6819 — compteur de résultats annoncé à chaque filtre, pas une sortie de formulaire */ className={styles.count} role="status" aria-live="polite" aria-atomic="true" data-testid="geti-count">
        {getiText(locale, filtered ? m.results.countFiltered : m.results.count, { count: listed.total })}
      </p>
      {beyond ? (
        <div className={styles.empty} data-testid="geti-beyond">
          <p>{m.results.beyond}</p>
          <LocaleLink href={getiPageHref(category, { ...query, page: pages })} className={styles.resetLink}>
            {getiText(locale, m.results.beyondLink, { page: pages })}
          </LocaleLink>
        </div>
      ) : null}
      {!beyond && listed.posts.length === 0 ? (
        <div className={styles.empty}>
          <p>{filtered ? m.results.emptyFiltered : m.results.empty}</p>
          {filtered ? (
            <LocaleLink href={getiPageHref(category)} className={styles.resetLink} scroll={false}>
              {m.results.emptyReset}
            </LocaleLink>
          ) : null}
        </div>
      ) : null}
      {listed.posts.length > 0 ? (
        // Le texte des annonces n'est pas repris en extrait par les moteurs : `data-nosnippet`
        // n'est lu que sur `div`, `span` et `section`, d'où l'enveloppe.
        <div data-nosnippet="" data-testid="geti-nosnippet">
          <ul className={styles.list} aria-label={m.results.listLabel}>
            {listed.posts.map((post) => (
              <li key={post.messageId}>
                <GetiPostCard post={post} filter={filter} text={m.post} data={data} locale={locale} now={now} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {/* Au-delà de la dernière page (liste vide comprise), pas de « Page 5 sur 1 » : seul le lien de retour reste. */}
      {query.page > pages ? null : (
        <GetiPagination category={category} query={query} pages={pages} text={m.results} locale={locale} />
      )}
    </section>
  );
}

function GetiPagination({
  category,
  query,
  pages,
  text,
  locale,
}: Readonly<{
  category: GetiCategory;
  query: GetiPageQuery;
  pages: number;
  text: GetiMessages["results"];
  locale: Locale;
}>) {
  if (pages <= 1 && query.page <= 1) return null;
  const pageHref = (page: number) => getiPageHref(category, { ...query, page });
  return (
    <nav className={styles.pagination} aria-label={text.pagination}>
      {query.page > 1 ? (
        <LocaleLink href={pageHref(Math.min(query.page - 1, pages))} className={styles.pageLink} rel="prev">
          ← {text.previous}
        </LocaleLink>
      ) : (
        <span />
      )}
      <span className={styles.pageInfo}>{getiText(locale, text.page, { page: query.page, pages })}</span>
      {query.page < pages ? (
        <LocaleLink href={pageHref(query.page + 1)} className={styles.pageLink} rel="next">
          {text.next} →
        </LocaleLink>
      ) : (
        <span />
      )}
    </nav>
  );
}
