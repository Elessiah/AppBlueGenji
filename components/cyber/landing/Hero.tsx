"use client";

import Link from "next/link";
import { CountdownStrip, CyberButton } from "@/components/cyber";
import type { LandingLive, LandingStats } from "@/lib/shared/landing";
import type { TournamentCard } from "@/lib/shared/types";
import { LiveCard } from "./LiveCard";
import styles from "./Hero.module.css";

type HeroProps = {
  stats: LandingStats;
  live: LandingLive | null;
  nextUpcoming: TournamentCard | null;
};

export function Hero({ stats, live, nextUpcoming }: HeroProps) {
  const countdownTarget = nextUpcoming?.startAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  return (
    <section className={styles.root}>
      <div className="fabric" />
      <div className={styles.inner}>
        <div className={styles.left}>
          <span className="eyebrow">ASSOCIATION ESPORT · LOI 1901</span>
          <h1 className="display" style={{ fontSize: "clamp(48px, 7vw, 82px)" }}>
            Organiser,
            <br />
            jouer,
            <br />
            <span className={styles.accent}>gagner ensemble.</span>
          </h1>
          <p className={styles.lede}>
            BlueGenji fédère une scène amateur francophone avec des tournois
            lisibles, des brackets en direct, des arbitres bénévoles et une
            communauté Discord active autour d&apos;Overwatch 2 et Marvel Rivals.
          </p>

          <div className={styles.actions}>
            <CyberButton variant="primary" asChild>
              <Link href="/tournois">Inscrire mon équipe</Link>
            </CyberButton>
            <CyberButton variant="ghost" asChild>
              <a href="#tournois" aria-label="Regarder le live">
                <span aria-hidden="true">▶</span>
                Regarder le live
              </a>
            </CyberButton>
          </div>

          <div className={styles.stats}>
            <div className={styles.stat}>
              <div className="num" style={{ fontSize: 28, color: "var(--blue-500)" }}>{stats.players}</div>
              <div className="mono">Joueurs inscrits</div>
            </div>
            <span className={styles.sep} />
            <div className={styles.stat}>
              <div className="num" style={{ fontSize: 28, color: "var(--blue-500)" }}>{stats.teams}</div>
              <div className="mono">Équipes actives</div>
            </div>
            <span className={styles.sep} />
            <div className={styles.stat}>
              <div className="num" style={{ fontSize: 28, color: "var(--blue-500)" }}>{stats.tournaments}</div>
              <div className="mono">Tournois organisés</div>
            </div>
          </div>
        </div>

        <div className={styles.right}>
          <LiveCard initialLive={live} nextUpcomingISO={nextUpcoming?.startAt ?? null} />
          <CountdownStrip targetISO={countdownTarget} label={nextUpcoming ? `PROCHAIN TOURNOI · ${nextUpcoming.name}` : "PROCHAIN TOURNOI"} />
        </div>
      </div>
    </section>
  );
}
