"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { TeamListItem } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { Ticker } from "@/components/cyber/Ticker";
import { BgCanvas } from "../_shared/BgCanvas";
import { TeamCard } from "./cards/TeamCard";
import { HighlightStrip } from "./cards/HighlightStrip";
import s from "../_shared/annuaire.module.css";

const ACCENT_RGB = "255, 157, 46";
const ACCENT_300 = "#ffc18a";
const ACCENT_500 = "#ff9d2e";

type GameFilter = "all" | "ow2" | "mr";
type SortKey = "rank" | "name" | "wins" | "members";

const TICKER_ITEMS = [
  "ROSTER · Annuaire mis à jour quotidiennement",
  "CLASSEMENT · Calculé sur l'ensemble des matchs validés",
  "COMMUNAUTÉ · Inscris ton équipe pour rejoindre la saison",
];

export default function TeamsPage() {
  const { showError } = useToast();
  const [teams, setTeams] = useState<TeamListItem[]>([]);
  const [activeTeam, setActiveTeam] = useState<{ teamId: number; teamName: string } | null>(null);
  const [query, setQuery] = useState("");
  const [gameFilter, setGameFilter] = useState<GameFilter>("all");
  const [sort, setSort] = useState<SortKey>("rank");

  useEffect(() => {
    fetch("/api/teams", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          error?: string;
          teams?: TeamListItem[];
          activeTeam?: { teamId: number; teamName: string } | null;
        };
        if (!response.ok || !payload.teams) {
          throw new Error(payload.error || "TEAMS_LOAD_FAILED");
        }
        setTeams(payload.teams);
        setActiveTeam(payload.activeTeam || null);
      })
      .catch((e) => showError((e as Error).message));
  }, [showError]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let r = teams.filter((t) => {
      if (q && !`${t.name} ${t.region || ""}`.toLowerCase().includes(q)) return false;
      if (gameFilter === "all") return true;
      if (gameFilter === "ow2") return t.games.includes("OW2");
      if (gameFilter === "mr") return t.games.includes("MR");
      return true;
    });
    r = [...r];
    if (sort === "rank") r.sort((a, b) => a.rank - b.rank);
    if (sort === "name") r.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    if (sort === "wins") r.sort((a, b) => b.wins - a.wins);
    if (sort === "members") r.sort((a, b) => b.membersCount - a.membersCount);
    return r;
  }, [teams, query, gameFilter, sort]);

  const totalMembers = teams.reduce((sum, t) => sum + t.membersCount, 0);
  const countOw2 = teams.filter((t) => t.games.includes("OW2")).length;
  const countMr = teams.filter((t) => t.games.includes("MR")).length;

  const accentStyle = {
    "--g-rgb": ACCENT_RGB,
    "--g-300": ACCENT_300,
    "--g-500": ACCENT_500,
  } as React.CSSProperties;

  return (
    <div style={accentStyle}>
      <BgCanvas rgb={ACCENT_RGB} />

      <header className={s.page}>
        <div className={s.fabric} />
        <div className={`container ${s.pageInner}`}>
          <div className={s.pageHead}>
            <div>
              <span className="eyebrow">COMMUNAUTÉ · ROSTERS</span>
              <h1 className={s.title}>
                Équipes <em>BlueGenji</em>
              </h1>
              <div className={s.subtitle}>ANNUAIRE · ROSTERS · CLASSEMENT GÉNÉRAL</div>
            </div>
            {!activeTeam && (
              <Link href="/equipes/creer" className={s.cta}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                Créer une équipe
              </Link>
            )}
          </div>

          <div className={s.metrics}>
            <div className={s.metric}>
              <div className={s.metricNum}>
                <em>{teams.length}</em>
              </div>
              <div className={s.metricLbl}>Équipes actives</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{totalMembers}</div>
              <div className={s.metricLbl}>Joueurs sous roster</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{countOw2}</div>
              <div className={s.metricLbl}>Équipes Overwatch 2</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{countMr}</div>
              <div className={s.metricLbl}>Équipes Marvel Rivals</div>
            </div>
          </div>

          <div className={s.toolbar}>
            <div className={s.search}>
              <span className={s.searchIcon}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </span>
              <input
                placeholder="Rechercher une équipe, un tag, une région…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className={s.searchKbd}>⌘K</span>
            </div>
            <div className={s.filters}>
              {([
                ["all", "Toutes", teams.length],
                ["ow2", "Overwatch 2", countOw2],
                ["mr", "Marvel Rivals", countMr],
              ] as const).map(([k, label, n]) => (
                <button
                  key={k}
                  className={`${s.chip} ${gameFilter === k ? s.chipOn : ""}`}
                  onClick={() => setGameFilter(k)}
                >
                  {label}
                  <span className="num">{n}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={s.sortRow}>
            <span>{filtered.length} équipe{filtered.length > 1 ? "s" : ""}</span>
            <div className={s.sortOpts}>
              <span style={{ color: "var(--ink-dim)" }}>Trier :</span>
              {([
                ["rank", "Classement"],
                ["name", "Nom"],
                ["wins", "Victoires"],
                ["members", "Effectif"],
              ] as const).map(([k, l]) => (
                <button
                  key={k}
                  className={`${s.sortBtn} ${sort === k ? s.sortBtnOn : ""}`}
                  onClick={() => setSort(k)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <Ticker items={TICKER_ITEMS} />

      <section className={`container ${s.sections}`}>
        {sort === "rank" && filtered.length >= 3 && <HighlightStrip teams={filtered} />}

        <div className={s.section}>
          <div className={s.sectionHead}>
            <span className={s.sectionIx}>01</span>
            <span className={s.sectionTtl}>
              ROSTERS <span className={s.sectionAccent}>· SAISON ACTUELLE</span>
            </span>
            <span className={s.sectionCount}>{filtered.length} ÉQUIPES</span>
          </div>

          <div style={{ paddingTop: 24 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 18,
              }}
            >
              {filtered.map((t) => (
                <TeamCard key={t.id} team={t} />
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
