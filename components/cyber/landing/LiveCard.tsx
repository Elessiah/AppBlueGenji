"use client";

import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { CyberCard, Pill, TeamSigil } from "@/components/cyber";
import type { LandingLive } from "@/lib/shared/landing";
import { inferPhaseLabel, toBestOfLabel } from "@/lib/shared/landing";
import styles from "./LiveCard.module.css";

type LiveCardProps = {
  initialLive: LandingLive | null;
  nextUpcomingISO?: string | null;
};

type LiveResponse = {
  live: LandingLive | null;
};

function sigilFor(name: string | null): string {
  if (!name) return "?";
  return name.trim().charAt(0).toUpperCase() || "?";
}

function nextDaysLabel(iso: string | null | undefined): string {
  if (!iso) return "bientôt";
  const diff = Math.max(0, new Date(iso).getTime() - Date.now());
  const days = Math.max(0, Math.ceil(diff / 86400000));
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "1 jour";
  return `${days} jours`;
}

export function LiveCard({ initialLive, nextUpcomingISO }: LiveCardProps) {
  const [live, setLive] = useState<LandingLive | null>(initialLive);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    async function loadLive() {
      try {
        const response = await fetch("/api/landing/live", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as LiveResponse;
        if (mounted) {
          setLive(payload.live ?? null);
        }
      } catch {
        if (!mounted) return;
      }
    }

    void loadLive();
    const interval = window.setInterval(() => {
      void loadLive();
    }, 10_000);

    return () => {
      mounted = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  if (!live) {
    return (
      <CyberCard ticks className={styles.root}>
        <div className={styles.empty}>
          <span className="pill pill-blue">INFO LIVE</span>
          <p>Aucun tournoi en direct. Le prochain démarre dans {nextDaysLabel(nextUpcomingISO)}.</p>
        </div>
      </CyberCard>
    );
  }

  const currentMatch = live.currentMatch;
  const bestOf = toBestOfLabel(currentMatch);
  const title = live.tournament.name.toUpperCase();

  return (
    <CyberCard ticks className={styles.root}>
      <div className={styles.head}>
        <Pill variant="live">LIVE</Pill>
        <span className="mono">{live.game.toUpperCase()} · {inferPhaseLabel(currentMatch)}</span>
        <span className={styles.viewers}>
          <Eye size={12} />
          <span className="mono">{live.viewers}</span>
        </span>
      </div>

      <div className={styles.title}>{title}</div>

      {currentMatch ? (
        <div className={styles.match}>
          <div className={styles.team}>
            <TeamSigil letter={sigilFor(currentMatch.team1Name)} size={40} />
            <div className={styles.teamText}>
              <div className={styles.teamName}>{currentMatch.team1Name ?? "Équipe 1"}</div>
              <div className="mono">FR · SEED 1</div>
            </div>
            <div className="num" style={{ fontSize: 30 }}>{currentMatch.team1Score ?? "—"}</div>
          </div>

          <div className={`${styles.vs} mono`}>
            MATCH {String(currentMatch.id).padStart(2, "0")} · {bestOf}
          </div>

          <div className={styles.team}>
            <TeamSigil letter={sigilFor(currentMatch.team2Name)} color="var(--amber)" size={40} />
            <div className={styles.teamText}>
              <div className={styles.teamName}>{currentMatch.team2Name ?? "Équipe 2"}</div>
              <div className="mono">FR · SEED 4</div>
            </div>
            <div className="num" style={{ fontSize: 30 }}>{currentMatch.team2Score ?? "—"}</div>
          </div>
        </div>
      ) : (
        <div className={styles.match}>
          <div className={styles.emptyMatch}>Le prochain match en direct sera affiché ici dès son lancement.</div>
        </div>
      )}

      <div className={styles.map}>
        <span>CARTE EN COURS</span>
        <span>—</span>
      </div>
    </CyberCard>
  );
}
