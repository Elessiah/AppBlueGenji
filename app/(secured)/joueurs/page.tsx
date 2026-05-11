"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PublicUserProfile, PlayerRole } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { Ticker } from "@/components/cyber/Ticker";
import { BgCanvas } from "../_shared/BgCanvas";
import { PlayerCard } from "./cards/PlayerCard";
import s from "../_shared/annuaire.module.css";

const ACCENT_RGB = "90, 200, 255";

type RoleFilter = "all" | "DPS" | "TANK" | "HEAL" | "COACH";
type StatusFilter = "all" | "free";
type SortKey = "pseudo" | "tournaments";

const TICKER_ITEMS = [
  "ANNUAIRE · Profils mis à jour quotidiennement",
  "ROSTER · Inscris-toi dans une équipe pour participer",
  "TOURNOIS · Candidatures ouvertes pour les prochaines saisons",
];

export default function PlayersPage() {
  const { showError } = useToast();
  const [players, setPlayers] = useState<PublicUserProfile[]>([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("pseudo");

  useEffect(() => {
    fetch("/api/players", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { error?: string; players?: PublicUserProfile[] };
        if (!response.ok || !payload.players) {
          throw new Error(payload.error || "PLAYERS_LOAD_FAILED");
        }
        setPlayers(payload.players);
      })
      .catch((e) => showError((e as Error).message));
  }, [showError]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let r = players.filter((p) => {
      if (q && !`${p.pseudo} ${p.team?.name || ""}`.toLowerCase().includes(q)) return false;
      if (roleFilter !== "all" && !(p.roles || []).includes(roleFilter as PlayerRole)) return false;
      if (statusFilter === "free" && p.team) return false;
      return true;
    });
    r = [...r];
    if (sort === "pseudo") r.sort((a, b) => a.pseudo.localeCompare(b.pseudo, "fr"));
    if (sort === "tournaments") r.sort((a, b) => (b.tournamentsCount || 0) - (a.tournamentsCount || 0));
    return r;
  }, [players, query, roleFilter, statusFilter, sort]);

  const freeAgents = players.filter((p) => !p.team).length;
  const ow2Count = players.filter((p) => (p.games || []).includes("OW2")).length;
  const mrCount = players.filter((p) => (p.games || []).includes("MR")).length;

  const accentStyle = {
    "--g-rgb": ACCENT_RGB,
    "--g-300": "#8fd5ff",
    "--g-500": "#5ac8ff",
  } as React.CSSProperties;

  return (
    <div style={accentStyle}>
      <BgCanvas rgb={ACCENT_RGB} />

      <header className={s.page}>
        <div className={s.fabric} />
        <div className={`container ${s.pageInner}`}>
          <div className={s.pageHead}>
            <div>
              <span className="eyebrow">COMMUNAUTÉ · ANNUAIRE</span>
              <h1 className={s.title}>
                Joueurs <em>BlueGenji</em>
              </h1>
              <div className={s.subtitle}>PROFILS · STATISTIQUES · DISPONIBILITÉ</div>
            </div>
            <Link href="/profil" className={s.cta}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 14a6 6 0 0 1 12 0"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              Mon profil
            </Link>
          </div>

          <div className={s.metrics}>
            <div className={s.metric}>
              <div className={s.metricNum}>
                <em>{players.length}</em>
              </div>
              <div className={s.metricLbl}>Profils référencés</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{freeAgents}</div>
              <div className={s.metricLbl}>Free agents · sans roster</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{ow2Count}</div>
              <div className={s.metricLbl}>Joueurs Overwatch 2</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{mrCount}</div>
              <div className={s.metricLbl}>Joueurs Marvel Rivals</div>
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
                placeholder="Rechercher un pseudo, une équipe…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className={s.searchKbd}>⌘K</span>
            </div>
            <div className={s.filters}>
              {([
                ["all", "Tous"],
                ["DPS", "DPS"],
                ["TANK", "Tank"],
                ["HEAL", "Heal"],
                ["COACH", "Coach"],
              ] as const).map(([k, l]) => (
                <button
                  key={k}
                  className={`${s.chip} ${roleFilter === k ? s.on : ""}`}
                  onClick={() => setRoleFilter(k)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className={s.sortRow}>
            <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
              <span>{filtered.length} joueur{filtered.length > 1 ? "s" : ""}</span>
              <span style={{ color: "var(--ink-dim)" }}>·</span>
              <div style={{ display: "flex", gap: 12 }}>
                {([
                  ["all", "Tous"],
                  ["free", "Free agents"],
                ] as const).map(([k, l]) => (
                  <button
                    key={k}
                    onClick={() => setStatusFilter(k)}
                    className={`${s.sortBtn} ${statusFilter === k ? s.sortBtnOn : ""}`}
                  >
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className={s.sortOpts}>
              <span style={{ color: "var(--ink-dim)" }}>Trier :</span>
              {([
                ["pseudo", "Pseudo"],
                ["tournaments", "Tournois"],
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
        <div className={s.section}>
          <div className={s.sectionHead}>
            <span className={s.sectionIx}>01</span>
            <span className={s.sectionTtl}>
              PROFILS <span className={s.sectionAccent}>· COMMUNAUTÉ ACTIVE</span>
            </span>
            <span className={s.sectionCount}>{filtered.length} JOUEURS</span>
          </div>

          <div style={{ paddingTop: 24 }}>
            <div className={s.plGrid}>
              {filtered.map((p) => (
                <PlayerCard key={p.id} player={p} />
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
