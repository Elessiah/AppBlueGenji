"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { TeamListItem } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { Ticker } from "@/components/cyber/Ticker";
import { BgCanvas } from "../_shared/BgCanvas";
import { AnnuaireSearchField } from "../_shared/AnnuaireSearchField";
import { DirectoryShowMore } from "../_shared/DirectoryShowMore";
import { useProgressiveList } from "@/lib/shared/hooks/useProgressiveList";
import { TeamCard } from "./cards/TeamCard";
import { HighlightStrip } from "./cards/HighlightStrip";
import { GhostTeamDialog } from "./GhostTeamDialog";
import { useTeamErrorMessage } from "@/components/i18n/team-errors-text";
import { useTeamsText } from "@/components/i18n/teams-text";
import { richNodes } from "@/components/i18n/shell-text";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { compareLocalText } from "@/lib/shared/dates";
import { compareDirectoryRank } from "@/lib/shared/ranking";
import s from "../_shared/annuaire.module.css";

// Violet néon (`--violet-400-rgb`, littéral : le canevas de fond ne lit pas les variables CSS).
const ACCENT_RGB = "167, 139, 250";
const ACCENT_300 = "var(--violet-300)";
const ACCENT_500 = "var(--violet-400)";

type GameFilter = "all" | "ow" | "mr";
type SortKey = "rank" | "name" | "wins" | "members";

export default function TeamsList() {
  const { showError } = useToast();
  const text = useTeamsText();
  const { t } = text;
  // Bandeau mémoïsé (`Ticker`) : ses libellés gardent leur référence d'une
  // frappe à l'autre — le texte ne change qu'avec la langue.
  const tickerItems = useMemo(() => [t("ticker.roster"), t("ticker.ranking"), t("ticker.community")], [t]);
  const tickerLabels = useMemo(
    () => ({
      label: t("ticker.label"),
      resume: t("ticker.resume"),
      pause: t("ticker.pause"),
      resumeShort: t("ticker.resumeShort"),
      pauseShort: t("ticker.pauseShort"),
    }),
    [t],
  );
  const teamErrorMessage = useTeamErrorMessage();
  const [teams, setTeams] = useState<TeamListItem[]>([]);
  const [activeTeam, setActiveTeam] = useState<{ teamId: number; teamName: string } | null>(null);
  const [query, setQuery] = useState("");
  const [gameFilter, setGameFilter] = useState<GameFilter>("all");
  const [sort, setSort] = useState<SortKey>("rank");
  // Staff `tournaments` : peut créer et administrer les équipes fantômes.
  const [canManageGhostTeams, setCanManageGhostTeams] = useState(false);
  const [ghostDialogOpen, setGhostDialogOpen] = useState(false);

  // La table des refus par une référence : la liste ne se relit jamais sur un
  // simple changement de texte (revue de performance du lot 9-2).
  const teamErrorMessageRef = useRef(teamErrorMessage);
  useEffect(() => {
    teamErrorMessageRef.current = teamErrorMessage;
  }, [teamErrorMessage]);

  const loadTeams = useCallback(() => {
    fetch("/api/teams", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          error?: string;
          teams?: TeamListItem[];
          activeTeam?: { teamId: number; teamName: string } | null;
          canManageGhostTeams?: boolean;
        };
        if (!response.ok || !payload.teams) {
          throw new Error(payload.error || "TEAMS_LOAD_FAILED");
        }
        setTeams(payload.teams);
        setActiveTeam(payload.activeTeam || null);
        setCanManageGhostTeams(payload.canManageGhostTeams === true);
      })
      .catch((e) => showError(teamErrorMessageRef.current((e as Error).message, "TEAMS_LOAD_FAILED")));
  }, [showError]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  // Recherche différée : le champ suit la frappe, la grille suit sans la bloquer.
  const deferredQuery = useDeferredValue(query);
  // Le sigle est un nom court : on cherche une équipe par « BG » comme par son
  // nom complet. Clé calculée à la première recherche qui la lit, puis gardée
  // (table faible pour la vie de l'écran : une liste rechargée apporte des
  // entrées neuves) — rien sans recherche (revue de performance du lot 9-2).
  const [searchKeys] = useState(() => new WeakMap<(typeof teams)[number], string>());
  const searchKeyOf = useCallback((team: (typeof teams)[number]): string => {
    let key = searchKeys.get(team);
    if (key === undefined) {
      key = `${team.name} ${team.tag || ""} ${team.region || ""}`.toLowerCase();
      searchKeys.set(team, key);
    }
    return key;
  }, [searchKeys]);
  // Trié une fois par liste et par ordre choisi ; la recherche ne fait ensuite
  // qu'un filtre, qui garde l'ordre (revue de performance du lot 9-2).
  const sorted = useMemo(() => {
    const r = [...teams];
    if (sort === "rank") r.sort(compareDirectoryRank);
    if (sort === "name") {
      const compare = compareLocalText(text.locale);
      r.sort((a, b) => compare(a.name, b.name));
    }
    if (sort === "wins") r.sort((a, b) => b.wins - a.wins);
    if (sort === "members") r.sort((a, b) => b.membersCount - a.membersCount);
    return r;
  }, [teams, sort, text.locale]);
  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return sorted.filter((team) => {
      if (q && !searchKeyOf(team).includes(q)) return false;
      if (gameFilter === "all") return true;
      if (gameFilter === "ow") return team.games.includes("OW");
      if (gameFilter === "mr") return team.games.includes("MR");
      return true;
    });
  }, [searchKeyOf, sorted, deferredQuery, gameFilter]);

  // Rendu borné à une page de cartes ; tout filtre modifié repart de la première.
  const gridRef = useRef<HTMLDivElement>(null);
  const page = useProgressiveList(
    filtered,
    JSON.stringify([deferredQuery.trim().toLowerCase(), gameFilter, sort]),
  );

  // Comptés une fois par liste, pas à chaque frappe dans la recherche (revue de performance du lot 9-2).
  const { totalMembers, countOw, countMr } = useMemo(
    () => ({
      totalMembers: teams.reduce((sum, team) => sum + team.membersCount, 0),
      countOw: teams.filter((team) => team.games.includes("OW")).length,
      countMr: teams.filter((team) => team.games.includes("MR")).length,
    }),
    [teams],
  );

  const accentStyle = {
    "--g-rgb": ACCENT_RGB,
    "--g-300": ACCENT_300,
    "--g-500": ACCENT_500,
  } as React.CSSProperties;

  return (
    <div className="page-wide" style={accentStyle}>
      <BgCanvas rgb={ACCENT_RGB} />

      <header className={s.page}>
        <div className="fabric" />
        <div className={`container ${s.pageInner}`}>
          <div className={s.pageHead}>
            <div>
              <span className="eyebrow">{t("list.eyebrow")}</span>
              <h1 className={s.title}>{richNodes(text.rich("list.title", {}, { em: (chunks) => <em>{chunks}</em> }))}</h1>
              <div className={s.subtitle}>{t("list.subtitle")}</div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {canManageGhostTeams && (
                <button
                  type="button"
                  className={s.ctaGhost}
                  onClick={() => setGhostDialogOpen(true)}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  {t("list.ghostTeam")}
                </button>
              )}
              {!activeTeam && (
                <LocaleLink href="/equipes/creer" className={s.cta}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  {t("list.createTeam")}
                </LocaleLink>
              )}
            </div>
          </div>

          <div className={s.metrics}>
            <div className={s.metric}>
              <div className={s.metricNum}>
                <em>{teams.length}</em>
              </div>
              <div className={s.metricLbl}>{t("list.metrics.teams")}</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{totalMembers}</div>
              <div className={s.metricLbl}>{t("list.metrics.members")}</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{countOw}</div>
              <div className={s.metricLbl}>{t("list.metrics.overwatch")}</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{countMr}</div>
              <div className={s.metricLbl}>{t("list.metrics.marvelRivals")}</div>
            </div>
          </div>

          {/* Recherche, jeux et tri : deux rangées, une seule sur grand écran. */}
          <div className={s.controls}>
            <div className={s.toolbar}>
              <AnnuaireSearchField
                label={t("list.searchLabel")}
                placeholder={t("list.searchPlaceholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className={s.filters}>
                {(
                  [
                    ["all", teams.length],
                    ["ow", countOw],
                    ["mr", countMr],
                  ] as const
                ).map(([k, n]) => (
                  <button
                    key={k}
                    type="button"
                    className={`${s.chip} ${gameFilter === k ? s.chipOn : ""}`}
                    aria-pressed={gameFilter === k}
                    onClick={() => setGameFilter(k)}
                  >
                    {t(`list.filters.${k}`)}
                    <span className={s.num}>{n}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={s.sortRow}>
              <span>{t("list.count", { count: filtered.length })}</span>
              <div className={s.sortOpts}>
                <span style={{ color: "var(--ink-dim)" }}>{t("list.sortBy")}</span>
                {(
                  [
                    "rank",
                    "name",
                    "wins",
                    "members",
                  ] as const
                ).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`${s.sortBtn} ${sort === k ? s.sortBtnOn : ""}`}
                    aria-pressed={sort === k}
                    onClick={() => setSort(k)}
                  >
                    {t(`list.sort.${k}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </header>

      <Ticker items={tickerItems} labels={tickerLabels} />

      <section className={`container ${s.sections}`}>
        {sort === "rank" && <HighlightStrip teams={filtered} />}

        <div className={s.section}>
          <div className={s.sectionHead}>
            <span className={s.sectionIx}>01</span>
            <span className={s.sectionTtl}>
              {t("list.sectionTitle")} <span className={s.sectionAccent}>{t("list.sectionAccent")}</span>
            </span>
            <span className={s.sectionCount}>{t("list.sectionCount", { count: filtered.length })}</span>
          </div>

          <div style={{ paddingTop: 24 }}>
            <div className={s.tmGrid} ref={gridRef}>
              {page.visible.map((team) => (
                <TeamCard key={team.id} team={team} />
              ))}
            </div>
            <DirectoryShowMore
              hidden={page.hidden}
              shown={page.visible.length}
              noun={t("list.showMoreNoun")}
              label={(step, hidden) => t("list.showMore", { step, hidden })}
              gridRef={gridRef}
              onShowMore={page.showMore}
            />
          </div>
        </div>
      </section>

      {ghostDialogOpen && (
        <GhostTeamDialog onClose={() => setGhostDialogOpen(false)} onCreated={loadTeams} />
      )}
    </div>
  );
}
