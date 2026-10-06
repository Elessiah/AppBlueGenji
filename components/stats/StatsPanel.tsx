"use client";

import { useMemo, type ReactNode } from "react";
import { TeamLink } from "@/components/entity-link";
import { formatLocalDate, shortMonthLabel } from "@/lib/shared/dates";
import type { Locale } from "@/lib/shared/locales";
import {
  formatDiff,
  type DeepStats,
  type StatsOpponent,
  type StatsSplit,
  type TeamRankingPosition,
} from "@/lib/shared/stats";
import {
  FR_STATS_PANEL_MESSAGES,
  statsPointsHint,
  statsRate,
  statsRecord,
  statsSplitLabel,
  statsStreak,
  statsText,
  type StatsKey,
  type StatsPanelI18n,
  type StatsPanelMessages,
  type StatsText,
} from "@/lib/shared/stats-text";
import s from "./StatsPanel.module.css";

interface StatsPanelProps {
  stats: DeepStats;
  /** Teinte d'accent : bleu côté joueur, violet côté équipe. */
  accent?: "blue" | "violet";
  /** Place au classement du site — réservé aux équipes. */
  ranking?: TeamRankingPosition | null;
  /**
   * Langue et messages d'une page **traduite** (`statsPanelMessages`) ; absent,
   * le bloc est en français, messages inclus dans le paquet.
   */
  i18n?: StatsPanelI18n;
}

/** Lecture d'une langue : phrases du bloc, libellés courts, langue des dates. */
type PanelText = { locale: Locale; text: StatsText; labels: StatsPanelMessages["labels"] };

/** Pastille de forme de chaque issue ; le nul porte « N », « D » étant la défaite. */
const FORM_BADGES: Record<DeepStats["form"][number], { label: StatsKey; letter: StatsKey; tone: string | undefined }> = {
  W: { label: "form.win", letter: "form.winLetter", tone: s.formWin },
  L: { label: "form.loss", letter: "form.lossLetter", tone: s.formLoss },
  D: { label: "form.draw", letter: "form.drawLetter", tone: s.formDraw },
};

/** Groupe titré : le sous-titre visible sert d'étiquette accessible au bloc. */
function Group({ id, title, children }: Readonly<{ id: string; title: string; children: ReactNode }>) {
  return (
    <section aria-labelledby={id}>
      <h3 className={s.subhead} id={id}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Tile({
  label,
  value,
  hint,
  loss = false,
}: Readonly<{ label: string; value: string | number; hint?: string; loss?: boolean }>) {
  return (
    <div className={s.tile}>
      <div className={s.tileLabel}>{label}</div>
      <div className={loss ? `${s.tileValue} result-loss` : s.tileValue}>{value}</div>
      {hint ? <div className={s.tileHint}>{hint}</div> : null}
    </div>
  );
}

function SplitBars({
  splits,
  table,
  panel,
}: Readonly<{ splits: StatsSplit[]; table: "formatShort" | "game"; panel: PanelText }>) {
  const { text } = panel;
  if (splits.length === 0) return <p className={s.empty}>{text.t("noFinishedMatch")}</p>;

  return (
    <div className={s.splits}>
      {splits.map((split) => {
        const total = Math.max(1, split.played);
        const label = statsSplitLabel(panel.labels, table, split);
        return (
          <div className={s.splitRow} key={split.key}>
            <span className={s.splitLabel}>{label}</span>
            <span
              className={s.splitTrack}
              role="img"
              aria-label={text.t("splitLabel", { label, won: String(split.won), played: String(split.played) })}
            >
              <span className={s.splitWin} style={{ width: `${(split.won / total) * 100}%` }} />
              <span className={s.splitLoss} style={{ width: `${(split.lost / total) * 100}%` }} />
            </span>
            <span className={s.splitValue}>
              {statsRecord(text, split)} · {statsRate(text, split.winRate)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function OpponentCard({
  title,
  opponent,
  emptyLabel,
  text,
}: Readonly<{
  title: string;
  opponent: StatsOpponent | null;
  emptyLabel: string;
  text: StatsText;
}>) {
  return (
    <div className={s.opponentCard}>
      <div className={s.tileLabel}>{title}</div>
      {opponent ? (
        <>
          <div className={s.opponentName}>
            <TeamLink teamId={opponent.teamId}>{opponent.teamName}</TeamLink>
          </div>
          <div className={s.opponentMeta}>
            {text.t("opponent.meetings", { count: opponent.played, record: statsRecord(text, opponent) })}
          </div>
        </>
      ) : (
        <div className={s.opponentMeta} style={{ marginTop: 10 }}>
          {emptyLabel}
        </div>
      )}
    </div>
  );
}

function ActivityChart({ stats, panel }: Readonly<{ stats: DeepStats; panel: PanelText }>) {
  const { text, locale } = panel;
  const points = stats.activity;
  const max = Math.max(1, ...points.map((point) => point.played));
  const width = 640;
  const height = 130;
  const paddingBottom = 22;
  const slot = width / points.length;
  const barWidth = Math.max(6, slot * 0.52);

  return (
    <>
      <svg
        className={s.chart}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={text.t("activity.chartLabel", {
          months: String(points.length),
          played: stats.matchesPlayed,
        })}
      >
        {points.map((point, index) => {
          const usable = height - paddingBottom;
          const playedHeight = (point.played / max) * usable;
          const wonHeight = (point.won / max) * usable;
          const x = index * slot + (slot - barWidth) / 2;
          const month = shortMonthLabel(point.month, locale);
          return (
            <g key={point.month}>
              <title>
                {text.t("activity.barTitle", {
                  month,
                  year: point.month.slice(0, 4),
                  played: point.played,
                  won: point.won,
                })}
              </title>
              <rect
                x={x}
                y={usable - playedHeight}
                width={barWidth}
                height={Math.max(point.played > 0 ? 2 : 0, playedHeight)}
                rx={3}
                style={{ fill: "rgba(255,255,255,0.12)" }}
              />
              <rect
                x={x}
                y={usable - wonHeight}
                width={barWidth}
                height={Math.max(point.won > 0 ? 2 : 0, wonHeight)}
                rx={3}
                style={{ fill: "rgba(var(--green-rgb), 0.75)" }}
              />
              <text
                x={x + barWidth / 2}
                y={height - 6}
                textAnchor="middle"
                fontSize={11}
                style={{ fill: "var(--ink-quiet)" }}
              >
                {month}
              </text>
            </g>
          );
        })}
      </svg>
      <div className={s.legend}>
        <span className={s.legendItem}>
          <span className={s.legendSwatch} style={{ background: "rgba(255,255,255,0.12)" }} />
          {/* NOSONAR S6772 — légende en flex avec `gap` */}
          {text.t("activity.legendPlayed")}
        </span>
        <span className={s.legendItem}>
          <span className={s.legendSwatch} style={{ background: "rgba(var(--green-rgb), 0.75)" }} />
          {/* NOSONAR S6772 — légende en flex avec `gap` */}
          {text.t("activity.legendWon")}
        </span>
      </div>
    </>
  );
}

/**
 * Bloc de statistiques approfondies, partagé par la fiche équipe et la fiche
 * joueur : les deux exposent le même `DeepStats`, donc la même lecture. Textes
 * par `messages/<langue>/stats.json` (`lib/shared/stats-text.ts`).
 */
export function StatsPanel({ stats, accent = "blue", ranking = null, i18n }: Readonly<StatsPanelProps>) {
  const hasPlayed = stats.matchesPlayed > 0;
  const panel = useMemo<PanelText>(() => {
    const locale = i18n?.locale ?? "fr";
    const messages = i18n?.messages ?? FR_STATS_PANEL_MESSAGES;
    return { locale, text: statsText(locale, messages.stats), labels: messages.labels };
  }, [i18n]);
  const { text, locale } = panel;
  const noFinishedMatch = text.t("noFinishedMatch");

  return (
    <div className={`${s.panel} ${accent === "violet" ? s.violet : ""}`}>
      <Group id="stats-palmares" title={text.t("group.record")}>
        <div className={s.grid}>
          <Tile
            label={text.t("tile.tournamentsPlayed")}
            value={stats.tournamentsPlayed}
            hint={
              stats.tournamentsUpcoming > 0
                ? text.t("tile.upcomingEntries", { count: stats.tournamentsUpcoming })
                : undefined
            }
          />
          <Tile label={text.t("tile.tournamentsWon")} value={stats.tournamentsWon} />
          <Tile label={text.t("tile.podiums")} value={stats.podiums} hint={text.t("tile.podiumsHint")} />
          <Tile label={text.t("tile.bestRank")} value={stats.bestRank ?? "—"} />
          <Tile label={text.t("tile.averageRank")} value={stats.averageRank ?? "—"} />
          {/* La place et la cote qui la produit sortent du **même** objet :
              deux nombres d'une seule lecture, jamais deux calculs. Une fiche
              joueur ne les reçoit pas — le classement note des équipes, pas des
              personnes. */}
          {ranking ? (
            <>
              <Tile
                label={text.t("tile.sitePosition")}
                value={ranking.position ? text.t("tile.sitePositionValue", { position: String(ranking.position) }) : "—"}
                hint={
                  ranking.position
                    ? text.t("tile.sitePositionHint", { total: String(ranking.total) })
                    : text.t("tile.noMatchPlayed")
                }
              />
              <Tile
                label={text.t("ranking.pointsLabel")}
                value={ranking.points}
                /* Le bilan des matchs, et non `position` : celui-ci est nul
                   pour trois situations distinctes — aucun match, entrée solo,
                   équipe dissoute — et la dernière a joué. La tuile
                   « Matchs joués » juste à côté sort de la même assiette
                   (`PLAYED_MATCH_SQL`) que le classement : les deux ne peuvent
                   pas se contredire. */
                hint={statsPointsHint(text, stats.matchesPlayed > 0, ranking.points)}
              />
              {/* La part de parcours ne s'affiche que si un tournoi clos l'a
                  fait bouger : une tuile à zéro sur la fiche d'une équipe qui
                  n'a encore fini aucun tournoi poserait une question que rien
                  n'y répond — même règle que les nuls plus bas. Elle est
                  **déjà** dans la cote au-dessus, d'où le signe explicite. */}
              {ranking.placementPoints !== 0 && (
                <Tile
                  label={text.t("ranking.placementLabel")}
                  value={formatDiff(ranking.placementPoints)}
                  hint={text.t("ranking.placementHint")}
                />
              )}
            </>
          ) : null}
        </div>
      </Group>

      <Group id="stats-bilan" title={text.t("group.matches")}>
        <div className={s.grid}>
          <Tile label={text.t("tile.matchesPlayed")} value={stats.matchesPlayed} />
          <Tile label={text.t("tile.wins")} value={stats.matchesWon} />
          <Tile label={text.t("tile.losses")} value={stats.matchesLost} loss />
          {/* Les nuls ne s'affichent que s'il y en a : ils n'existent que dans un
              mode et un seul, et une tuile à zéro sur toutes les autres fiches
              poserait une question que rien n'y répond. */}
          {stats.matchesDrawn > 0 && (
            <Tile label={text.t("tile.draws")} value={stats.matchesDrawn} hint={text.t("tile.drawsHint")} />
          )}
          <Tile label={text.t("tile.winRate")} value={statsRate(text, stats.winRate)} />
          <Tile
            label={text.t("tile.maps")}
            value={`${stats.mapsWon} / ${stats.mapsLost}`}
            hint={text.t("tile.mapsHint", { diff: formatDiff(stats.mapDiff), rate: statsRate(text, stats.mapWinRate) })}
          />
        </div>
      </Group>

      <div className={s.columns}>
        <Group id="stats-forme" title={text.t("group.form")}>
          {stats.form.length > 0 ? (
            <div className={s.formRow}>
              {/* `role="list"` n'est pas redondant : Safari retire le rôle d'une
                  liste dont on a ôté les puces (`list-style: none`). */}
              <ul // NOSONAR S6822 — Safari retire le rôle d'une liste sans puces
                className={`native-list ${s.form}`}
                role="list"
                aria-label={text.t("form.listLabel", { count: stats.form.length })}
              >
                {stats.form.map((result, index) => {
                  // « D » désigne déjà la **défaite** sur ces pastilles en
                  // français : un nul porte donc « N », faute de quoi les deux
                  // issues se liraient sous la même lettre (en anglais : W / L / D).
                  const badge = FORM_BADGES[result];
                  const label = text.t(badge.label);

                  return (
                    <li
                      key={`${result}-${index}`}
                      className={`${s.formBadge} ${badge.tone}`}
                      aria-label={label}
                      title={label}
                    >
                      <span aria-hidden="true">{text.t(badge.letter)}</span>
                    </li>
                  );
                })}
              </ul>
              <span className={s.splitValue}>{statsStreak(text, stats.currentStreak)}</span>
            </div>
          ) : (
            <p className={s.empty}>{noFinishedMatch}</p>
          )}
          <div className={s.grid} style={{ marginTop: 14 }}>
            <Tile label={text.t("tile.bestStreak")} value={stats.bestWinStreak} hint={text.t("tile.bestStreakHint")} />
            <Tile label={text.t("tile.worstStreak")} value={stats.worstLossStreak} hint={text.t("tile.worstStreakHint")} />
            <Tile
              label={text.t("tile.forfeits")}
              value={`${stats.forfeitsGiven} / ${stats.forfeitsReceived}`}
              hint={text.t("tile.forfeitsHint")}
            />
          </div>
        </Group>

        <div>
          <Group id="stats-jeux" title={text.t("group.byGame")}>
            <SplitBars splits={stats.byGame} table="game" panel={panel} />
          </Group>
          <div style={{ marginTop: 22 }}>
            <Group id="stats-formats" title={text.t("group.byFormat")}>
              <SplitBars splits={stats.byFormat} table="formatShort" panel={panel} />
            </Group>
          </div>
        </div>
      </div>

      <Group id="stats-adversaires" title={text.t("group.opponents")}>
        <div className={s.opponents}>
          <OpponentCard
            title={text.t("opponent.favourite")}
            opponent={stats.favouriteOpponent}
            emptyLabel={text.t("opponent.favouriteEmpty")}
            text={text}
          />
          <OpponentCard
            title={text.t("opponent.nemesis")}
            opponent={stats.nemesis}
            emptyLabel={text.t("opponent.nemesisEmpty")}
            text={text}
          />
        </div>
      </Group>

      <Group id="stats-activite" title={text.t("group.activity")}>
        <ActivityChart stats={stats} panel={panel} />
        {hasPlayed && stats.firstMatchAt && stats.lastMatchAt ? (
          <p className={s.tileHint} style={{ marginTop: 10 }}>
            {text.t("activity.firstLast", {
              first: formatLocalDate(stats.firstMatchAt, locale),
              last: formatLocalDate(stats.lastMatchAt, locale),
            })}
          </p>
        ) : null}
      </Group>
    </div>
  );
}
