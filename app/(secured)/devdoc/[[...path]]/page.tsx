import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "@/app/bot/docs/docs.css";
import { getCurrentUser } from "@/lib/server/auth";
import { findDevDoc, loadDevDocIndex, renderDevDoc } from "@/lib/server/dev-docs";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { DEV_DOC_SOURCE_URLS, docOutline, groupDevDocs, parseDevDocParams } from "@/lib/shared/dev-docs";
import { INTL_LOCALE, localeHref } from "@/lib/shared/locales";
import { can } from "@/lib/shared/permissions";
import { scopedText } from "@/lib/shared/scoped-text";
import { DevDocNav } from "../_components/DevDocNav";
import styles from "../devdoc.module.css";

/**
 * Documentation développeur (`docs/features/DEVDOC.md`) : les Markdown du site
 * et du bot, relus à chaud depuis les dépôts, derrière la permission `dev`.
 */

interface PageProps {
  params: Promise<{ path?: string[] }>;
}

/** Le document demandé, pour un lecteur autorisé seulement ; sinon `null`. */
async function requestedDoc(params: PageProps["params"]) {
  const user = await getCurrentUser();
  if (!can(user, "dev")) return null;
  const wanted = parseDevDocParams((await params).path);
  if (!wanted) return null;
  const index = await loadDevDocIndex();
  const summary = findDevDoc(index, wanted.repo, wanted.slug);
  return summary ? { index, summary } : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const found = await requestedDoc(params);
  return found ? { title: found.summary.title } : {};
}

export default async function DevDocPage({ params }: Readonly<PageProps>) {
  const [user, locale] = await Promise.all([getCurrentUser(), requestLocale()]);
  // Sans session, l'espace sécurisé rend « Connexion requise » : rien à lire ici.
  if (!user) return null;
  if (!can(user, "dev")) notFound();
  const found = await requestedDoc(params);
  if (!found) notFound();
  const { index, summary } = found;

  const messages = messagesFor(locale).devdoc;
  const { t } = scopedText(locale, messages);
  const doc = await renderDevDoc(index, summary, (href) => localeHref(href, locale), t("doc.table"));
  const outline = doc.html === null ? [] : docOutline(doc.html);
  const foreign = doc.language !== locale;
  const sourceUrl = `${DEV_DOC_SOURCE_URLS[summary.repo]}/blob/main/${summary.path.split("/").map(encodeURIComponent).join("/")}`;

  return (
    <section className={`container ${styles.page}`}>
      <header className={styles.head}>
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1 className={`display text-gradient ${styles.title}`}>{t("title")}</h1>
        <p className={styles.lead}>{t("lead")}</p>
      </header>

      <div className={styles.layout}>
        <DevDocNav
          groups={groupDevDocs(index.docs)}
          current={{ repo: summary.repo, slug: summary.slug }}
          locale={locale}
          messages={messages}
        />

        <article className={styles.article}>
          <div className={styles.docHead}>
            <span className={`pill pill-info ${styles.docRepo}`}>{t(`repos.${summary.repo}`)}</span>
            <span className={styles.docSource}>{t("doc.source", { file: summary.path })}</span>
            <a className={styles.docGithub} href={sourceUrl} target="_blank" rel="noreferrer">
              {t("doc.github")}
              <span className="sr-only"> {t("doc.newTab")}</span>
            </a>
          </div>
          <div className={styles.docBody} lang={foreign ? doc.language : undefined}>
            {foreign && doc.language === "fr" ? (
              <p className={styles.docNotice} lang={locale}>
                {t("doc.frenchOnly")}
              </p>
            ) : null}
            {outline.length > 0 ? (
              <details className={styles.outline}>
                <summary className={styles.outlineTitle} lang={foreign ? locale : undefined}>{t("doc.outline")}</summary>
                <ul className={styles.outlineList}>
                  {outline.map((item) => (
                    <li key={item.id} className={item.level === 3 ? styles.outlineSub : undefined}>
                      <a href={`#${encodeURIComponent(item.id)}`}>{item.text}</a>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {doc.html === null ? (
              <p className={styles.docNotice} lang={foreign ? locale : undefined}>
                {t("doc.missing")}
              </p>
            ) : (
              <div className="docs-content" dangerouslySetInnerHTML={{ __html: doc.html }} />
            )}
          </div>
          {doc.updatedAt ? (
            <p className={styles.docFoot}>
              {t("doc.updated", {
                date: new Date(doc.updatedAt).toLocaleDateString(INTL_LOCALE[locale], {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                }),
              })}
            </p>
          ) : null}
        </article>
      </div>
    </section>
  );
}
