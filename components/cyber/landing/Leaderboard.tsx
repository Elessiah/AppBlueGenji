"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TeamSigil } from "@/components/cyber";
import type { LandingLeaderboardRow } from "@/lib/shared/landing";
import styles from "./Leaderboard.module.css";

type LeaderboardProps = {
  initialRows: LandingLeaderboardRow[];
};

type LeaderboardResponse = {
  leaderboard: LandingLeaderboardRow[];
};

export function Leaderboard({ initialRows }: LeaderboardProps) {
  const [game, setGame] = useState<"all" | "ow2" | "mr">("all");
  const [rows, setRows] = useState(initialRows);

  useEffect(() => {
    let mounted = true;

    async function loadRows() {
      try {
        const response = await fetch(`/api/landing/leaderboard?game=${game}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as LeaderboardResponse;
        if (mounted) setRows(payload.leaderboard ?? []);
      } catch {
        if (!mounted) return;
      }
    }

    void loadRows();
    return () => {
      mounted = false;
    };
  }, [game]);

  const chips = [
    { id: "all" as const, label: "Général" },
    { id: "ow2" as const, label: "Overwatch 2" },
    { id: "mr" as const, label: "Marvel Rivals" },
  ];

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.2em", color: "var(--ink-mute)" }}>TOP ÉQUIPES</span>
        <div className={styles.chips}>
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={chip.id === game ? styles.chipOn : styles.chip}
              onClick={() => setGame(chip.id)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.table}>
        <div className={styles.tableHead}>
          <span>#</span>
          <span>ÉQUIPE</span>
          <span>V–D</span>
          <span>PTS</span>
          <span>TR</span>
        </div>

        {rows.map((row) => {
          const trend = row.trend === "flat" ? "—" : row.trend === "up" ? `+${row.trendValue}` : `-${row.trendValue}`;
          const trendClass =
            row.trend === "up" ? styles.trendUp : row.trend === "down" ? styles.trendDown : styles.trendFlat;

          return (
            <div key={row.teamId} className={`${styles.row} ${row.rank <= 3 ? styles.top : ""}`}>
              <span className={styles.rank}>{String(row.rank).padStart(2, "0")}</span>
              <span className={styles.team}>
                <TeamSigil letter={row.teamName.charAt(0)} size={24} />
                <span>{row.teamName}</span>
              </span>
              <span className={styles.wl}>
                <span className={styles.wins}>{row.wins}</span>
                <span className={styles.losses}>–{row.losses}</span>
              </span>
              <span className="num">{row.points}</span>
              <span className={`${styles.trend} ${trendClass}`}>{trend}</span>
            </div>
          );
        })}
      </div>

      <div className={styles.footer}>
        <Link href="/joueurs" className="mono">VOIR LE CLASSEMENT COMPLET →</Link>
      </div>
    </div>
  );
}
