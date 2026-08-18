"use client";

import Link from "next/link";
import { formatLocalDate } from "@/lib/shared/dates";
import {
  formatDiff,
  formatRate,
  formatStreak,
  type DeepStats,
  type StatsOpponent,
  type StatsSplit,
  type TeamRankingPosition,
} from "@/lib/shared/stats";
import s from "./StatsPanel.module.css";

interface StatsPanelProps {
  stats: DeepStats;
  /** Teinte d'accent : bleu côté joueur, orange côté équipe. */
  accent?: "blue" | "orange";
  /** Place au classement du site — réservé aux équipes. */
  ranking?: TeamRankingPosition | null;
}

const MONTH_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** Libellé court d'une clé `YYYY-MM` (`"2026-03"` → `"mars"`). */
function monthLabel(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return MONTH_SHORT[index] ?? month;
}

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className={s.tile}>
      <div className={s.tileLabel}>{label}</div>
      <div className={s.tileValue}>{value}</div>
      {hint ? <div className={s.tileHint}>{hint}</div> : null}
    </div>
  );
}

function SplitBars({ splits, emptyLabel }: { splits: StatsSplit[]; emptyLabel: string }) {
  if (splits.length === 0) return <p className={s.empty}>{emptyLabel}</p>;

  return (
    <div className={s.splits}>
      {splits.map((split) => {
        const total = Math.max(1, split.played);
        return (
          <div className={s.splitRow} key={split.key}>
            <span className={s.splitLabel}>{split.label}</span>
            <span
              className={s.splitTrack}
              role="img"
              aria-label={`${split.label} : ${split.won} victoires sur ${split.played} matchs`}
            >
              <span className={s.splitWin} style={{ width: `${(split.won / total) * 100}%` }} />
              <span className={s.splitLoss} style={{ width: `${(split.lost / total) * 100}%` }} />
            </span>
            <span className={s.splitValue}>
              {split.won}V / {split.lost}D · {formatRate(split.winRate)}
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
}: {
  title: string;
  opponent: StatsOpponent | null;
  emptyLabel: string;
}) {
  return (
    <div className={s.opponentCard}>
      <div className={s.tileLabel}>{title}</div>
      {opponent ? (
        <>
          <div className={s.opponentName}>
            <Link href={`/equipes/${opponent.teamId}`}>{opponent.teamName}</Link>
          </div>
          <div className={s.opponentMeta}>
            {opponent.played} confrontation{opponent.played > 1 ? "s" : ""} · {opponent.won}V / {opponent.lost}D
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

function ActivityChart({ stats }: { stats: DeepStats }) {
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
        aria-label={`Activité des ${points.length} derniers mois : ${stats.matchesPlayed} matchs joués au total`}
      >
        {points.map((point, index) => {
          const usable = height - paddingBottom;
          const playedHeight = (point.played / max) * usable;
          const wonHeight = (point.won / max) * usable;
          const x = index * slot + (slot - barWidth) / 2;
          return (
            <g key={point.month}>
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
                fontSize={10}
                style={{ fill: "var(--text-2)" }}
              >
                {monthLabel(point.month)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className={s.legend}>
        <span className={s.legendItem}>
          <span className={s.legendSwatch} style={{ background: "rgba(255,255,255,0.12)" }} />
          Matchs joués
        </span>
        <span className={s.legendItem}>
          <span className={s.legendSwatch} style={{ background: "rgba(var(--green-rgb), 0.75)" }} />
          Victoires
        </span>
      </div>
    </>
  );
}

/**
 * Bloc de statistiques approfondies, partagé par la fiche équipe et la fiche
 * joueur : les deux exposent le même `DeepStats`, donc la même lecture.
 */
export function StatsPanel({ stats, accent = "blue", ranking = null }: StatsPanelProps) {
  const hasPlayed = stats.matchesPlayed > 0;

  return (
    <div className={`${s.panel} ${accent === "orange" ? s.orange : ""}`}>
      <div>
        <div className={s.subhead}>Palmarès</div>
        <div className={s.grid}>
          <Tile label="Tournois joués" value={stats.tournamentsPlayed} />
          <Tile label="Tournois gagnés" value={stats.tournamentsWon} />
          <Tile label="Podiums" value={stats.podiums} hint="Top 3" />
          <Tile label="Meilleur rang" value={stats.bestRank ?? "—"} />
          <Tile label="Rang moyen" value={stats.averageRank ?? "—"} />
          {ranking ? (
            <Tile
              label="Classement du site"
              value={ranking.position ? `#${ranking.position}` : "—"}
              hint={ranking.position ? `sur ${ranking.total} équipes classées` : "Aucun match joué"}
            />
          ) : null}
        </div>
      </div>

      <div>
        <div className={s.subhead}>Bilan des matchs</div>
        <div className={s.grid}>
          <Tile label="Matchs joués" value={stats.matchesPlayed} />
          <Tile label="Victoires" value={stats.matchesWon} />
          <Tile label="Défaites" value={stats.matchesLost} />
          <Tile label="Ratio de victoires" value={formatRate(stats.winRate)} />
          <Tile
            label="Maps"
            value={`${stats.mapsWon} / ${stats.mapsLost}`}
            hint={`Diff. ${formatDiff(stats.mapDiff)} · ${formatRate(stats.mapWinRate)}`}
          />
          <Tile label="Points de classement" value={stats.rankingPoints} hint="100 par victoire, −20 par défaite" />
        </div>
      </div>

      <div className={s.columns}>
        <div>
          <div className={s.subhead}>Forme récente</div>
          {stats.form.length > 0 ? (
            <div className={s.form} aria-label="Cinq derniers résultats, du plus récent au plus ancien">
              {stats.form.map((result, index) => (
                <span
                  key={`${result}-${index}`}
                  className={`${s.formBadge} ${result === "W" ? s.formWin : s.formLoss}`}
                  title={result === "W" ? "Victoire" : "Défaite"}
                >
                  {result === "W" ? "V" : "D"}
                </span>
              ))}
              <span className={s.splitValue} style={{ marginLeft: 6 }}>
                {formatStreak(stats.currentStreak)}
              </span>
            </div>
          ) : (
            <p className={s.empty}>Aucun match terminé pour le moment.</p>
          )}
          <div className={s.grid} style={{ marginTop: 14 }}>
            <Tile label="Meilleure série" value={stats.bestWinStreak} hint="victoires consécutives" />
            <Tile label="Pire série" value={stats.worstLossStreak} hint="défaites consécutives" />
            <Tile
              label="Forfaits"
              value={`${stats.forfeitsGiven} / ${stats.forfeitsReceived}`}
              hint="donnés / reçus"
            />
          </div>
        </div>

        <div>
          <div className={s.subhead}>Répartition par jeu</div>
          <SplitBars splits={stats.byGame} emptyLabel="Aucun match terminé pour le moment." />
          <div className={s.subhead} style={{ marginTop: 22 }}>
            Répartition par format
          </div>
          <SplitBars splits={stats.byFormat} emptyLabel="Aucun match terminé pour le moment." />
        </div>
      </div>

      <div>
        <div className={s.subhead}>Adversaires</div>
        <div className={s.opponents}>
          <OpponentCard
            title="Adversaire favori"
            opponent={stats.favouriteOpponent}
            emptyLabel="Aucune victoire enregistrée."
          />
          <OpponentCard
            title="Bête noire"
            opponent={stats.nemesis}
            emptyLabel="Aucune défaite enregistrée."
          />
        </div>
      </div>

      <div>
        <div className={s.subhead}>Activité des 12 derniers mois</div>
        <ActivityChart stats={stats} />
        {hasPlayed && stats.firstMatchAt && stats.lastMatchAt ? (
          <p className={s.tileHint} style={{ marginTop: 10 }}>
            Premier match le {formatLocalDate(stats.firstMatchAt)} · dernier match le{" "}
            {formatLocalDate(stats.lastMatchAt)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
