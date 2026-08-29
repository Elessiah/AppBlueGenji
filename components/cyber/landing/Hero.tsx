"use client";

import Link from "next/link";
import { CountdownStrip, CyberButton } from "@/components/cyber";
import type { LandingLive, LandingStats } from "@/lib/shared/landing";
import type { TournamentCard } from "@/lib/shared/types";
import { PLATFORM_LABELS, streamPlatform } from "@/lib/shared/live-streams";
import { LiveCard } from "./LiveCard";
import { useLandingLive } from "./useLandingLive";
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

export function Hero({ stats, live: initialLive, nextUpcoming, copy, canEditCopy }: HeroProps) {
  // Une seule source pour la carte live et le bouton « Regarder le live » :
  // deux sondages séparés les feraient diverger le temps d'un tick.
  const live = useLandingLive(initialLive);
  const stream = live?.stream ?? null;
  const platform = streamPlatform(stream?.url);

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
            {/* Aucune diffusion en cours → aucun bouton : un « Regarder le
                live » qui ne mène nulle part crée plus de confusion qu'il n'en
                lève. */}
            {stream && (
              <CyberButton variant="ghost" asChild>
                <a
                  href={stream.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Regarder ${stream.tournamentName} en direct${
                    platform ? ` sur ${PLATFORM_LABELS[platform]}` : ""
                  } (nouvel onglet)`}
                >
                  <span aria-hidden="true">▶</span>
                  Regarder le live
                </a>
              </CyberButton>
            )}
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
          <LiveCard live={live} nextUpcomingISO={nextUpcoming?.startAt ?? null} />
          {nextUpcoming && (
            <CountdownStrip targetISO={nextUpcoming.startAt} label={`PROCHAIN TOURNOI · ${nextUpcoming.name}`} />
          )}
        </div>
      </div>
    </section>
  );
}
