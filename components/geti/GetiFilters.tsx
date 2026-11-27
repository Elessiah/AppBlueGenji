"use client";

import { SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
  getiPageHref,
  getiPageSearch,
  getiRankSlug,
  parseGetiRankSlug,
  type GetiFilterField,
  type GetiPageQuery,
} from "@/lib/shared/geti/page";
import { getiRankLabel, getiText, type GetiDataText, type GetiMessages } from "@/lib/shared/geti/page-text";
import styles from "./geti.module.css";

type FiltersText = GetiMessages["filters"];

const ALL_RANKS = getiAllRanks();
const HOURS = Array.from({ length: 25 }, (_, hour) => hour);

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
  text,
  data,
}: Readonly<{
  category: GetiCategory;
  query: GetiPageQuery;
  fields: readonly GetiFilterField[];
  ageOptions: readonly number[];
  retentionDays: number;
  text: FiltersText;
  data: GetiDataText;
}>) {
  const locale = useAppLocale();
  const router = useLocaleRouter();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(query);
  // L'adresse fait foi : un retour arrière ou un lien partagé remet les contrôles d'accord.
  const serverSearch = getiPageSearch(query);
  const lastServerSearch = useRef(serverSearch);
  useEffect(() => {
    if (lastServerSearch.current === serverSearch) return;
    lastServerSearch.current = serverSearch;
    setDraft(query);
  }, [serverSearch, query]);

  const apply = (next: GetiPageQuery) => {
    // Tout changement de filtre revient à la première page.
    const first = { ...next, page: 1 };
    setDraft(first);
    router.replace(getiPageHref(category, first), { scroll: false });
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

  const hourSelect = (key: "hourFrom" | "hourTo", label: string) => {
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
          {HOURS.map((hour) => (
            <option key={hour} value={hour}>
              {getiClockLabel(hour * 60)}
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
          className={styles.filtersToggle}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          {active > 0 ? getiText(locale, text.toggleActive, { count: active }) : text.toggle}
        </button>
        {active > 0 ? (
          <button
            type="button"
            className={styles.reset}
            onClick={() => apply({ ...emptyGetiPageQuery() })}
            aria-label={text.resetLabel}
          >
            {text.reset}
          </button>
        ) : null}
      </div>

      <form
        id={panelId}
        className={styles.panel}
        data-open={open ? "true" : "false"}
        aria-label={text.title}
        onSubmit={(event) => event.preventDefault()}
      >
        <div className={styles.panelHead}>
          <h3 className={styles.panelTitle}>{text.title}</h3>
          {active > 0 ? (
            <button
              type="button"
              className={styles.reset}
              onClick={() => apply({ ...emptyGetiPageQuery() })}
              aria-label={text.resetLabel}
            >
              {text.reset}
            </button>
          ) : null}
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
              {hourSelect("hourFrom", text.hourFrom)}
              {hourSelect("hourTo", text.hourTo)}
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
      </form>
    </div>
  );
}
