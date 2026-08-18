"use client";

import Link from "next/link";
import { CountdownStrip, CyberButton } from "@/components/cyber";
import type { LandingLive, LandingStats } from "@/lib/shared/landing";
import type { TournamentCard } from "@/lib/shared/types";
import { LiveCard } from "./LiveCard";
import { EditableCopy } from "./EditableCopy";
import type { SiteCopy } from "@/lib/shared/site-copy";
import styles from "./Hero.module.css";

type HeroProps = {
  stats: LandingStats;
  live: LandingLive | null;
  nextUpcoming: TournamentCard | null;
  /** Textes éditables de la vitrine (défauts compris). */
  copy: SiteCopy;
  /** Le viewer peut-il éditer les textes (permission `showcase`) ? */
  canEditCopy: boolean;
};

export function Hero({ stats, live, nextUpcoming, copy, canEditCopy }: HeroProps) {
  return (
    <section className={styles.root}>
      <div className="fabric" />
      <div className={styles.inner}>
        <div className={styles.left}>
          <EditableCopy copyKey="home.hero.eyebrow" value={copy["home.hero.eyebrow"]} canEdit={canEditCopy}>
            <span className="eyebrow">{copy["home.hero.eyebrow"]}</span>
          </EditableCopy>
          <EditableCopy copyKey="home.hero.title" value={copy["home.hero.title"]} canEdit={canEditCopy}>
            <h1 className="display" style={{ fontSize: "clamp(38px, 7vw, 82px)" }}>
              {/* Dernière ligne du titre accentuée : c'est la chute du slogan. */}
              {copy["home.hero.title"].split("\n").map((line, index, lines) => (
                <span key={line + index} className={index === lines.length - 1 ? styles.accent : undefined}>
                  {line}
                  {index < lines.length - 1 ? <br /> : null}
                </span>
              ))}
            </h1>
          </EditableCopy>
          <EditableCopy copyKey="home.hero.lede" value={copy["home.hero.lede"]} canEdit={canEditCopy}>
            <p className={styles.lede}>{copy["home.hero.lede"]}</p>
          </EditableCopy>

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
          {nextUpcoming && (
            <CountdownStrip targetISO={nextUpcoming.startAt} label={`PROCHAIN TOURNOI · ${nextUpcoming.name}`} />
          )}
        </div>
      </div>
    </section>
  );
}
