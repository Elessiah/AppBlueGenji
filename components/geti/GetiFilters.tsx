"use client";

import { SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useAppLocale } from "@/components/i18n/locale-context";
import { useLocaleRouter } from "@/components/i18n/locale-navigation";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import {
  GETI_DAYS,
  GETI_LANGUAGES,
  GETI_LEVELS,
  GETI_PLATFORMS,
  GETI_REGIONS,
  GETI_ROLES,
  GETI_STAFF_ROLES,
  GETI_SUB_ROLES,
  GETI_TIERS,
  type GetiCategory,
  type GetiRank,
} from "@/lib/shared/geti";
import {
  emptyGetiPageQuery,
  getiActiveFilterCount,
  getiAllRanks,
  getiClockLabel,
  getiFilterSync,
  getiLinkNavigatesTab,
  getiNormalizedSearch,
  getiPageHref,
  getiPageSearch,
  getiRankSlug,
  parseGetiRankSlug,
  type GetiFilterField,
  type GetiPageQuery,
} from "@/lib/shared/geti/page";
import { getiRankLabel, getiText, type GetiFilterDataText, type GetiMessages } from "@/lib/shared/geti/page-text";
import { useGetiPending } from "./GetiLayout";
import styles from "./geti.module.css";

type FiltersText = GetiMessages["filters"];

const ALL_RANKS = getiAllRanks();
/** Début du créneau : 0h à 23h ; fin : 1h à 24h (fin de journée). Un début après la fin passe minuit. */
const HOURS_FROM = Array.from({ length: 24 }, (_, hour) => hour);
const HOURS_TO = Array.from({ length: 24 }, (_, hour) => hour + 1);

/** Clés de l'état qui portent une liste de choix. */
type ListKey = "roles" | "subRoles" | "staffRoles" | "levels" | "regions" | "platforms" | "languages" | "days";

function toggled<T>(values: readonly T[], domain: readonly T[], value: T, on: boolean): T[] {
  const next = new Set(values);
  if (on) next.add(value);
  else next.delete(value);
  return domain.filter((entry) => next.has(entry));
}

/** Groupe de contrôles nommé par son titre ; l'explication (« i ») se pose à côté du titre. */
function Group({
  label,
  hint,
  separated = false,
  children,
}: Readonly<{ label: string; hint?: ReactNode; separated?: boolean; children: ReactNode }>) {
  return (
    <fieldset className={styles.group}>
      {/* La légende nomme le groupe ; le titre visible, lui, partage sa rangée avec le « i ». */}
      <legend className="sr-only">{label}</legend>
      <InfoHintRow separated={separated}>
        <span className={styles.legend} aria-hidden="true">
          {label}
        </span>
        {hint}
      </InfoHintRow>
      {children}
    </fieldset>
  );
}

/** Focus d'une cible qui survit à « Réinitialiser » : le bouton Filtres s'il est affiché (mobile), sinon le titre. */
function focusStableTarget(toggle: HTMLElement | null, title: HTMLElement | null): void {
  const visible = toggle !== null && toggle.getClientRects().length > 0;
  (visible ? toggle : title)?.focus({ preventScroll: true });
}

/** Bouton « Réinitialiser » : présent seulement tant qu'un filtre est actif. */
function ResetButton({ active, text, onReset }: Readonly<{ active: number; text: FiltersText; onReset: () => void }>) {
  if (active === 0) return null;
  return (
    <button type="button" className={styles.reset} onClick={onReset} aria-label={text.resetLabel}>
      {text.reset}
    </button>
  );
}

/** Calme à attendre après le dernier geste avant de demander la liste au serveur. */
const GETI_FILTER_DEBOUNCE_MS = 300;

/**
 * Filtres d'une catégorie d'annonces (`docs/features/GETI_INFO.md` § Page).
 *
 * L'adresse est la seule mémoire : chaque changement la réécrit
 * (`router.replace`, sans défilement), le serveur rend la liste filtrée et le
 * compteur l'annonce (`aria-live`). Sous 900 px, le panneau se replie derrière
 * un bouton ; au-dessus, il reste ouvert à côté de la liste.
 */
export function GetiFilters({
  category,
  query,
  fields,
  ageOptions,
  retentionDays,
  total,
  text,
  data,
}: Readonly<{
  category: GetiCategory;
  query: GetiPageQuery;
  fields: readonly GetiFilterField[];
  ageOptions: readonly number[];
  retentionDays: number;
  /** Annonces de la liste affichée (bouton « Voir les annonces » sur mobile). */
  total: number;
  text: FiltersText;
  data: GetiFilterDataText;
}>) {
  const locale = useAppLocale();
  const router = useLocaleRouter();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const setPending = useGetiPending();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useState(query);
  // L'adresse fait foi : un retour arrière ou un lien partagé remet les contrôles d'accord.
  const serverSearch = getiPageSearch(query);
  // Dernière adresse demandée par un changement de filtre (normalisée comme le serveur la
  // rendra), tant que son rendu n'est pas arrivé : le rendu d'un changement plus ancien ne
  // doit pas défaire le dernier geste.
  const pendingSearch = useRef<string | null>(null);
  // Navigations de filtre en cours : une fois toutes rendues, plus rien n'est attendu
  // (un geste défait vers l'adresse déjà affichée ne produit parfois aucun rendu).
  const [navigating, startNavigation] = useTransition();
  // Navigation de filtre en attente de sa fenêtre de calme (`GETI_FILTER_DEBOUNCE_MS`).
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancelNavigation() {
    if (navTimer.current === null) return;
    clearTimeout(navTimer.current);
    navTimer.current = null;
  }
  useEffect(() => {
    // Chaque rendu du serveur (nouvel objet `query`) passe ici, même à adresse égale :
    // un geste défait avant son rendu lève aussi l'attente.
    const sync = getiFilterSync(pendingSearch.current, serverSearch);
    pendingSearch.current = sync.pending;
    if (sync.adopt) setDraft(query);
  }, [serverSearch, query]);
  useEffect(() => {
    if (!navigating) pendingSearch.current = null;
    setPending(navigating);
  }, [navigating, setPending]);
  useEffect(() => cancelNavigation, []);
  useEffect(() => {
    // Retour arrière ou avant, ou lien suivi (pagination, « Réinitialiser » de la liste) :
    // l'adresse affichée reprend la main sur les contrôles.
    const release = () => {
      pendingSearch.current = null;
      cancelNavigation();
    };
    const releaseOnLink = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      // Seul un lien qui remplace cette page compte : pas un nouvel onglet, un téléchargement, une ancre.
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (
        link instanceof HTMLAnchorElement &&
        getiLinkNavigatesTab(
          { href: link.href, target: link.target, download: link.hasAttribute("download") },
          globalThis.location.href,
        )
      ) {
        release();
      }
    };
    window.addEventListener("popstate", release);
    document.addEventListener("click", releaseOnLink, true);
    return () => {
      window.removeEventListener("popstate", release);
      document.removeEventListener("click", releaseOnLink, true);
    };
  }, []);

  const apply = (next: GetiPageQuery, immediate = false) => {
    // Tout changement de filtre revient à la première page.
    const first = { ...next, page: 1 };
    setDraft(first);
    pendingSearch.current = getiNormalizedSearch(category, first);
    // Une rafale de cases cochées ne coûte qu'un rendu serveur : seule la dernière adresse part.
    cancelNavigation();
    const go = () => {
      navTimer.current = null;
      startNavigation(() => router.replace(getiPageHref(category, first), { scroll: false }));
    };
    if (immediate) go();
    else navTimer.current = setTimeout(go, GETI_FILTER_DEBOUNCE_MS);
  };

  // Les boutons « Réinitialiser » disparaissent avec le dernier filtre : le focus passe à
  // une cible qui reste (le bouton Filtres sur mobile, le titre du panneau sinon).
  const resetAll = () => {
    focusStableTarget(toggleRef.current, titleRef.current);
    apply({ ...emptyGetiPageQuery() }, true);
  };

  const active = getiActiveFilterCount(draft);
  const has = (field: GetiFilterField) => fields.includes(field);

  const checks = <T extends string>(
    key: ListKey,
    legend: string,
    domain: readonly T[],
    labels: Readonly<Record<T, string>>,
    hint?: ReactNode,
  ) => {
    const selected = draft[key] as readonly string[];
    return (
      <Group label={legend} hint={hint}>
        <div className={styles.checks} data-tap-zone="">
          {domain.map((value) => (
            <label key={value} className={styles.check}>
              <input
                type="checkbox"
                name={key}
                value={value}
                checked={selected.includes(value)}
                onChange={(event) =>
                  apply({ ...draft, [key]: toggled(selected, domain, value, event.target.checked) })
                }
              />
              <span>{labels[value]}</span>
            </label>
          ))}
        </div>
      </Group>
    );
  };

  const rankSelect = (key: "rankMin" | "rankMax", label: string) => {
    const id = `${panelId}-${key}`;
    const value: GetiRank | null = draft[key];
    return (
      <div className={styles.selectField}>
        <label htmlFor={id}>{label}</label>
        <select
          id={id}
          value={value ? getiRankSlug(value) : ""}
          onChange={(event) => apply({ ...draft, [key]: parseGetiRankSlug(event.target.value) })}
        >
          <option value="">{text.any}</option>
          {GETI_TIERS.map((tier) => (
            <optgroup key={tier} label={data.tiers[tier]}>
              {ALL_RANKS.filter((rank) => rank.tier === tier).map((rank) => (
                <option key={getiRankSlug(rank)} value={getiRankSlug(rank)}>
                  {getiRankLabel(rank, data, locale)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
    );
  };

  const hourSelect = (key: "hourFrom" | "hourTo", label: string, hours: readonly number[]) => {
    const id = `${panelId}-${key}`;
    const value = draft[key];
    return (
      <div className={styles.selectField}>
        <label htmlFor={id}>{label}</label>
        <select
          id={id}
          value={value === null ? "" : String(value)}
          onChange={(event) =>
            apply({ ...draft, [key]: event.target.value === "" ? null : Number.parseInt(event.target.value, 10) })
          }
        >
          <option value="">{text.any}</option>
          {hours.map((hour) => (
            <option key={hour} value={hour}>
              {getiClockLabel(hour * 60, locale)}
            </option>
          ))}
        </select>
      </div>
    );
  };

  const ageId = `${panelId}-age`;

  return (
    <div className={styles.filters}>
      <div className={styles.filtersBar}>
        <button
          type="button"
          ref={toggleRef}
          className={styles.filtersToggle}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          {active > 0 ? getiText(locale, text.toggleActive, { count: active }) : text.toggle}
        </button>
        <ResetButton active={active} text={text} onReset={resetAll} />
      </div>

      <form
        id={panelId}
        className={styles.panel}
        data-open={open ? "true" : "false"}
        aria-label={text.title}
        onSubmit={(event) => event.preventDefault()}
      >
        <div className={styles.panelHead}>
          <h3 ref={titleRef} tabIndex={-1} className={styles.panelTitle}>
            {text.title}
          </h3>
          <output className={styles.pendingNote}>{navigating ? text.updating : ""}</output>
          <ResetButton active={active} text={text} onReset={resetAll} />
        </div>

        {has("staffRoles") ? checks("staffRoles", text.staffRoles, GETI_STAFF_ROLES, data.staffRoles) : null}

        {has("ranks") ? (
          <Group
            label={text.ranks}
            hint={
              <InfoHint id={`${panelId}-ranks-hint`} subject={text.ranksHintSubject}>
                {text.ranksHint}
              </InfoHint>
            }
          >
            <div className={styles.pair}>
              {rankSelect("rankMin", text.rankMin)}
              {rankSelect("rankMax", text.rankMax)}
            </div>
          </Group>
        ) : null}

        {has("roles")
          ? checks(
              "roles",
              text.roles,
              GETI_ROLES,
              data.roles,
              <InfoHint id={`${panelId}-roles-hint`} subject={text.rolesHintSubject}>
                {text.rolesHint}
              </InfoHint>,
            )
          : null}
        {has("subRoles") ? checks("subRoles", text.subRoles, GETI_SUB_ROLES, data.subRoles) : null}
        {has("levels")
          ? checks(
              "levels",
              text.levels,
              GETI_LEVELS,
              data.levels,
              <InfoHint id={`${panelId}-levels-hint`} subject={text.levelsHintSubject}>
                {text.levelsHint}
              </InfoHint>,
            )
          : null}
        {has("regions") ? checks("regions", text.regions, GETI_REGIONS, data.regions) : null}
        {has("platforms") ? checks("platforms", text.platforms, GETI_PLATFORMS, data.platforms) : null}
        {has("languages") ? checks("languages", text.languages, GETI_LANGUAGES, data.languages) : null}
        {has("days") ? checks("days", text.days, GETI_DAYS, data.days) : null}

        {has("time") ? (
          <Group
            label={text.time}
            hint={
              <InfoHint id={`${panelId}-time-hint`} subject={text.timeHintSubject}>
                {text.timeHint}
              </InfoHint>
            }
          >
            <div className={styles.pair}>
              {hourSelect("hourFrom", text.hourFrom, HOURS_FROM)}
              {hourSelect("hourTo", text.hourTo, HOURS_TO)}
            </div>
          </Group>
        ) : null}

        <div className={styles.group}>
          <div className={styles.selectField}>
            <label htmlFor={ageId} className={styles.legend}>
              {text.age}
            </label>
            <select
              id={ageId}
              value={draft.ageDays === null ? "" : String(draft.ageDays)}
              onChange={(event) =>
                apply({ ...draft, ageDays: event.target.value === "" ? null : Number.parseInt(event.target.value, 10) })
              }
            >
              <option value="">{getiText(locale, text.ageAll, { days: retentionDays })}</option>
              {ageOptions.map((days) => (
                <option key={days} value={days}>
                  {getiText(locale, text.ageDays, { days })}
                </option>
              ))}
            </select>
          </div>
        </div>

        <Group label={text.options}>
          <InfoHintRow separated>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={draft.showClosed}
                onChange={(event) => apply({ ...draft, showClosed: event.target.checked })}
              />
              <span>{text.showClosed}</span>
            </label>
            <InfoHint id={`${panelId}-closed-hint`} subject={text.showClosedHintSubject}>
              {text.showClosedHint}
            </InfoHint>
          </InfoHintRow>
          <InfoHintRow separated>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={!draft.strict}
                onChange={(event) => apply({ ...draft, strict: !event.target.checked })}
              />
              <span>{text.includeUnknown}</span>
            </label>
            <InfoHint id={`${panelId}-unknown-hint`} subject={text.includeUnknownHintSubject}>
              {text.includeUnknownHint}
            </InfoHint>
          </InfoHintRow>
        </Group>
        <div className={styles.applyRow}>
          <button
            type="button"
            className={styles.applyButton}
            onClick={() => {
              setOpen(false);
              toggleRef.current?.focus({ preventScroll: true });
            }}
          >
            {getiText(locale, text.apply, { count: total })}
          </button>
        </div>
      </form>
    </div>
  );
}
