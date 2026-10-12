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
      .catch((e) => showError(teamErrorMessage((e as Error).message, "TEAMS_LOAD_FAILED")));
  }, [showError, teamErrorMessage]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  // Recherche différée : le champ suit la frappe, la grille suit sans la bloquer.
  const deferredQuery = useDeferredValue(query);
  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    let r = teams.filter((team) => {
      // Le sigle est un nom court : on cherche une équipe par « BG » comme par
      // son nom complet.
      if (q && !`${team.name} ${team.tag || ""} ${team.region || ""}`.toLowerCase().includes(q)) return false;
      if (gameFilter === "all") return true;
      if (gameFilter === "ow") return team.games.includes("OW");
      if (gameFilter === "mr") return team.games.includes("MR");
      return true;
    });
    r = [...r];
    if (sort === "rank") r.sort((a, b) => a.rank - b.rank);
    if (sort === "name") {
      const compare = compareLocalText(text.locale);
      r.sort((a, b) => compare(a.name, b.name));
    }
    if (sort === "wins") r.sort((a, b) => b.wins - a.wins);
    if (sort === "members") r.sort((a, b) => b.membersCount - a.membersCount);
    return r;
  }, [teams, deferredQuery, gameFilter, sort, text.locale]);

  // Rendu borné à une page de cartes ; tout filtre modifié repart de la première.
  const gridRef = useRef<HTMLDivElement>(null);
  const page = useProgressiveList(
    filtered,
    JSON.stringify([deferredQuery.trim().toLowerCase(), gameFilter, sort]),
  );

  const totalMembers = teams.reduce((sum, team) => sum + team.membersCount, 0);
  const countOw = teams.filter((team) => team.games.includes("OW")).length;
  const countMr = teams.filter((team) => team.games.includes("MR")).length;

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
        {sort === "rank" && filtered.length >= 3 && <HighlightStrip teams={filtered} />}

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
