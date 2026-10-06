"use client";

import { LocaleLink } from "@/components/i18n/locale-navigation";
import { CountdownStrip, CyberButton } from "@/components/cyber";
import type { LandingLive, LandingStats } from "@/lib/shared/landing";
import type { TournamentCard } from "@/lib/shared/types";
import { PLATFORM_LABELS, streamPlatform } from "@/lib/shared/live-streams";
import { DiscordCommunity } from "./DiscordCommunity";
import { LiveCard } from "./LiveCard";
import { CountUp } from "./CountUp";
import { useLandingLive } from "./useLandingLive";
import { EditableCopy } from "./EditableCopy";
import { useLandingText } from "@/components/i18n/landing-text";
import type { SiteCopy } from "@/lib/shared/site-copy";
import styles from "./Hero.module.css";

/**
 * Tournois organisés avant que le site ne les compte lui-même (LAN et
 * ligues jouées sur Discord/Challonge avant le lancement de la plateforme).
 * Valeur figée au lancement, à ne plus faire évoluer.
 */
const LEGACY_TOURNAMENT_COUNT = 19;

type HeroProps = {
  stats: LandingStats;
  live: LandingLive | null;
  nextUpcoming: TournamentCard | null;
  /** Textes éditables de la vitrine (défauts compris). */
  copy: SiteCopy;
  /** Le viewer peut-il éditer les textes (permission `showcase`) ? */
  canEditCopy: boolean;
};

export function Hero({ stats, live: initialLive, nextUpcoming, copy, canEditCopy }: Readonly<HeroProps>) {
  // Une seule source pour la carte live et le bouton « Regarder le live » :
  // deux sondages séparés les feraient diverger le temps d'un tick.
  const live = useLandingLive(initialLive);
  const { t } = useLandingText();
  const stream = live?.stream ?? null;
  const platform = streamPlatform(stream?.url);

  return (
    <section className={styles.root}>
      <div className="fabric" />
      {/* Éclats lumineux qui dérivent derrière le hero : purement décoratifs. */}
      <div className={styles.glints} aria-hidden="true">
        <span className={`${styles.glint} ${styles.glintBlue}`} />
        <span className={`${styles.glint} ${styles.glintViolet}`} />
      </div>
      <div className={styles.inner}>
        <div className={styles.left}>
          <EditableCopy copyKey="home.hero.eyebrow" value={copy["home.hero.eyebrow"]} canEdit={canEditCopy}>
            <span className="eyebrow">{copy["home.hero.eyebrow"]}</span>
          </EditableCopy>
          <EditableCopy copyKey="home.hero.title" value={copy["home.hero.title"]} canEdit={canEditCopy}>
            <h1 className={`display ${styles.title}`}>
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
              <LocaleLink href="/tournois">{t("common.registerTeam")}</LocaleLink>
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
                  /* Le libellé **commence par le texte affiché**, puis ajoute
                     ce que l'écran donne à voir autour du bouton (le tournoi,
                     la plateforme) : un lien dont le nom accessible ne contient
                     pas ce qu'on lit dessus ne répond pas à la commande vocale,
                     puisqu'on prononce ce qui est écrit (WCAG 2.5.3). */
                  aria-label={
                    platform
                      ? t("hero.watchLiveLabelOn", { tournament: stream.tournamentName, platform: PLATFORM_LABELS[platform] })
                      : t("hero.watchLiveLabel", { tournament: stream.tournamentName })
                  }
                >
                  <span aria-hidden="true">▶</span>
                  {/* NOSONAR S6772 — CyberButton en flex avec `gap` */}
                  {t("common.watchLive")}
                </a>
              </CyberButton>
            )}
          </div>

          <div className={styles.stats}>
            <div className={styles.stat}>
              <CountUp value={stats.players} className={`num text-gradient ${styles.statValue}`} />
              <div className="mono">{t("hero.stats.players")}</div>
            </div>
            <span className={styles.sep} />
            <div className={styles.stat}>
              <CountUp value={stats.teams} className={`num text-gradient ${styles.statValue}`} />
              <div className="mono">{t("hero.stats.teams")}</div>
            </div>
            <span className={styles.sep} />
            <div className={styles.stat}>
              <CountUp value={LEGACY_TOURNAMENT_COUNT + stats.tournaments} className={`num text-gradient ${styles.statValue}`} />
              <div className="mono">{t("hero.stats.tournaments")}</div>
            </div>
          </div>

          {/* Quatrième chiffre, mais d'une autre nature : les trois précédents
              se lisent en base, celui-ci vient de Discord et peut manquer. Il
              vit donc dans son propre bloc, qui porte aussi l'invitation. */}
          <DiscordCommunity stats={stats.discord} />
        </div>

        <div className={styles.right}>
          <LiveCard live={live} nextUpcomingISO={nextUpcoming?.startAt ?? null} />
          {nextUpcoming && (
            <CountdownStrip targetISO={nextUpcoming.startAt} label={t("hero.nextTournament", { name: nextUpcoming.name })} />
          )}
        </div>
      </div>
    </section>
  );
}
