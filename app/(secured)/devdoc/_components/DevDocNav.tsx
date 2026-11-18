"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { ScrollArea } from "@/components/cyber/ScrollArea";
import { AnnuaireSearchField } from "@/app/(secured)/_shared/AnnuaireSearchField";
import {
  devDocHref,
  filterDevDocs,
  type DevDocRepoGroup,
  type DevDocSummary,
} from "@/lib/shared/dev-docs";
import type { Locale } from "@/lib/shared/locales";
import type { Messages } from "@/lib/shared/i18n-messages";
import { scopedText } from "@/lib/shared/scoped-text";
import styles from "../devdoc.module.css";

type DevDocNavProps = {
  groups: DevDocRepoGroup[];
  current: { repo: string; slug: string };
  locale: Locale;
  messages: Messages["devdoc"];
};

/**
 * Navigation de `/devdoc` : recherche par titre ou fichier, puis arborescence
 * par dépôt et par dossier (le dossier du document ouvert déplié). La liste
 * est servie par la page, filtrée ici sans requête.
 */
export function DevDocNav({ groups, current, locale, messages }: Readonly<DevDocNavProps>) {
  const { t } = useMemo(() => scopedText(locale, messages), [locale, messages]);
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const listRef = useRef<HTMLDivElement>(null);
  // Sous 960 px la navigation se replie (l'article passe en premier) ; au-dessus, CSS l'affiche toujours.
  const [expanded, setExpanded] = useState(false);

  const all = useMemo(() => groups.flatMap((group) => group.folders.flatMap((folder) => folder.docs)), [groups]);
  const results = useMemo(() => (deferred.trim() ? filterDevDocs(all, deferred) : null), [all, deferred]);
  const bodyId = useId();
  const currentTitle = all.find((doc) => doc.repo === current.repo && doc.slug === current.slug)?.title ?? "";
  const isCurrent = (doc: DevDocSummary) => doc.repo === current.repo && doc.slug === current.slug;

  // Le document ouvert est amené dans la zone défilante, sans faire défiler la page.
  useEffect(() => {
    // Un document choisi referme la navigation repliée : l'article est ce qu'on venait lire.
    setExpanded(false);
  }, [current.repo, current.slug]);

  const showingTree = results === null;
  useEffect(() => {
    const list = listRef.current;
    const area = list?.parentElement;
    const active = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!area || !active) return;
    // Écart mesuré à l'écran : `offsetTop` se compte depuis le parent positionné, pas depuis la zone.
    const gap = active.getBoundingClientRect().top - area.getBoundingClientRect().top;
    area.scrollTop = Math.max(0, area.scrollTop + gap - area.clientHeight / 3);
    // Dépliée ou revenue de la recherche, la zone retrouve le document ouvert.
  }, [current.repo, current.slug, showingTree, expanded]);

  const link = (doc: DevDocSummary, withPath: boolean) => (
    <LocaleLink
      href={devDocHref(doc.repo, doc.slug)}
      className={styles.navLink}
      aria-current={isCurrent(doc) ? "page" : undefined}
      onClick={() => setQuery("")}
    >
      <span className={styles.navTitle}>{doc.title}</span>
      {withPath ? <span className={styles.navPath}>{doc.path}</span> : null}
    </LocaleLink>
  );

  const resultList =
    results && results.length === 0 ? (
      <p className={styles.navEmpty}>{t("search.empty")}</p>
    ) : (
      <ul className={styles.navItems}>
        {(results ?? []).map((doc) => (
          <li key={`${doc.repo}:${doc.slug}`}>
            <span className={styles.navRepoTag}>{t(`repos.${doc.repo}`)}</span>
            {link(doc, true)}
          </li>
        ))}
      </ul>
    );

  const tree = groups.map((group) => (
    <section key={group.repo} className={styles.navRepo} aria-labelledby={`devdoc-repo-${group.repo}`}>
      <h2 id={`devdoc-repo-${group.repo}`} className={styles.navRepoTitle}>
        {t(`repos.${group.repo}`)}
      </h2>
      {group.folders.length === 0 ? <p className={styles.navEmpty}>{t("doc.repoEmpty")}</p> : null}
      {group.folders.map((folder) => {
        const open = group.repo === current.repo && folder.docs.some(isCurrent);
        return (
          <details key={folder.folder} className={styles.navFolder} open={open || undefined}>
            <summary className={styles.navFolderName}>
              <span>{folder.folder || t("rootFolder")}</span>
              <span className={styles.navFolderCount}>{folder.docs.length}</span>
            </summary>
            <ul className={styles.navItems}>
              {folder.docs.map((doc) => (
                <li key={doc.slug}>{link(doc, false)}</li>
              ))}
            </ul>
          </details>
        );
      })}
    </section>
  ));

  return (
    <nav className={styles.nav} aria-label={t("nav.label")} data-expanded={expanded ? "true" : "false"}>
      <button
        type="button"
        className={styles.navToggle}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={styles.navToggleText}>
          <span className={styles.navHeadTitle}>{t("nav.toggle")}</span>
          <span className={styles.navToggleDoc}>{currentTitle}</span>
        </span>
        <ChevronDown className={styles.navToggleIcon} size={16} aria-hidden="true" />
      </button>
      <div id={bodyId} className={styles.navBody}>
        <div className={styles.navHead}>
          <span className={styles.navHeadTitle}>{t("nav.label")}</span>
          <span className={styles.navHeadMeta}>{t("nav.count", { count: all.length })}</span>
        </div>
        {/* Échap vide la recherche (le champ garde le focus). */}
        <div
          className={styles.navSearch}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.stopPropagation();
              setQuery("");
            }
          }}
        >
          <AnnuaireSearchField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search.placeholder")}
            label={t("search.label")}
          />
          <p className="sr-only" aria-live="polite">
            {results ? t("search.results", { count: results.length }) : ""}
          </p>
        </div>
        <ScrollArea orientation="y" ariaLabel={t("nav.tree")} className={styles.navScroll}>
          <div ref={listRef} className={styles.navList}>
            {results ? resultList : tree}
          </div>
        </ScrollArea>
      </div>
    </nav>
  );
}
