"use client";

import { Fragment, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/cyber";
import type { BracketMatch, EnduranceMeta, EnduranceStandingRow } from "@/lib/shared/types";
import { useTournamentViewText } from "@/components/i18n/tournament-page-text";
import { useClientPower } from "@/lib/shared/hooks/useClientPower";
import { formatMatchStartAt, formatMatchStartAtFull } from "@/lib/shared/match-schedule";
import { participantText, type TournamentPageText } from "@/lib/shared/tournament-page-text";
import { FR_VIEWS_TEXT } from "../_lib/views-text";
import { useEntrantParticipantType } from "../_lib/entrant-link";
import {
  enduranceCurrentRound,
  enduranceRankingRows,
  enduranceRankingViews,
  enduranceRoundColumnCell,
  enduranceTabKey,
  enduranceViewBaseRound,
  enduranceViewColumnRound,
  enduranceViewKey,
  playoffCutIndex,
  resolveEnduranceViewIndex,
  type EnduranceRankingRow,
  type EnduranceRankingView,
  type EnduranceRoundColumnCell,
} from "../_lib/endurance-ranking-views";
import { EntrantName } from "./EntrantName";
import styles from "./EnduranceRankingViews.module.css";

/**
 * « Éliminée » et « Hors course » ne disent pas la même chose : la première a
 * vidé son capital, la seconde en garde mais ne peut plus rejoindre les
 * play-offs dans les manches restantes.
 */
const STATUS_KEYS = {
  ACTIVE: "ranking.active",
  ELIMINATED: "ranking.eliminated",
  OUT_OF_CONTENTION: "ranking.outOfContention",
  FORFEIT: "ranking.forfeit",
} as const satisfies Record<EnduranceStandingRow["status"], string>;

/**
 * Une ligne sortie s'estompe, mais pas toutes au même degré : « Hors course »
 * porte encore un capital à lire.
 */
// Plancher 0,9 : à 0,55 le texte discret (« S3 », dates, « Déjà sortie ») et le
// rouge (« Forfait — retirée », ▼) tombaient sous 4,5:1 sur le fond du plateau ;
// à 0,8, le chiffre de défaite (`--result-loss-ink`) y restait encore, vers
// 4,1:1 sur la ligne du lecteur (`.mine`).
const ROW_OPACITY: Record<EnduranceStandingRow["status"], number> = {
  ACTIVE: 1,
  OUT_OF_CONTENTION: 0.95,
  ELIMINATED: 0.9,
  FORFEIT: 0.9,
};

interface EnduranceRankingViewsProps {
  endurance: EnduranceMeta;
  matches: BracketMatch[];
  myTeamId: number | null;
  /**
   * Gestes d'une ligne (pénalité, forfait, annulation) — décidés par
   * `EnduranceView`, avec ses gardes. Ils ne s'affichent **que** dans la vue
   * « Général » : une vue passée est de l'histoire, aucun geste ne s'y applique.
   */
  renderActions?: (standing: EnduranceStandingRow) => ReactNode;
  /** Au moins une ligne porte un geste. */
  showActions: boolean;
  /**
   * Légende des gestes (« 🔒 Figé » et son « i »), dernière ligne du panneau
   * « Général » — seule vue qui porte les gestes —, au-dessus de la navigation.
   */
  actionsLegend?: ReactNode;
  /**
   * Légende des lignes « hors course », même pied de panneau que
   * `actionsLegend` : lue dans le panneau « Général », avant la navigation.
   */
  outLegend?: ReactNode;
  /** Une ligne porte deux gestes (arbitrage) : colonne élargie. */
  wideActions: boolean;
}

function viewTitle(view: EnduranceRankingView, text: TournamentPageText): string {
  if (view.kind === "GENERAL") return text.t("endurance.titleGeneral");
  if (view.kind === "CURRENT") return text.t("endurance.titleCurrent", { round: String(view.round) });
  return text.t("endurance.titleRound", { round: String(view.round) });
}

function tabLabel(view: EnduranceRankingView, text: TournamentPageText): string {
  if (view.kind === "GENERAL") return text.t("endurance.tabGeneral");
  if (view.kind === "CURRENT") return text.t("endurance.tabCurrent", { round: String(view.round) });
  return text.t("endurance.tabRound", { round: String(view.round) });
}

function navLabel(view: EnduranceRankingView, text: TournamentPageText): string {
  if (view.kind === "GENERAL") return text.t("endurance.tabGeneral");
  if (view.kind === "CURRENT") return text.t("endurance.navCurrent", { round: String(view.round) });
  return text.t("endurance.navRound", { round: String(view.round) });
}

/** Signe typographique d'une variation (« +2 », « −1 », « 0 »). */
function signed(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${-value}`;
  return "0";
}

function deltaClass(delta: number): string {
  if (delta > 0) return styles.deltaUp;
  if (delta < 0) return styles.deltaDown;
  return "";
}

/** Gabarit d'une ligne : la colonne d'action n'existe que dans « Général ». */
function rowClass(withActions: boolean, wideActions: boolean): string {
  if (!withActions) return `table-row ${styles.row}`;
  return `table-row ${wideActions ? styles.rowWithWideActions : styles.rowWithActions}`;
}

/** Glissement d'entrée d'une vue, seulement si le mouvement décoratif est permis. */
function slideClass(decorativeMotion: boolean, direction: "left" | "right" | null): string {
  if (!decorativeMotion || direction === null) return "";
  return direction === "left" ? styles.slideFromLeft : styles.slideFromRight;
}

function RankCell({ row, text }: Readonly<{ row: EnduranceRankingRow; text: TournamentPageText }>) {
  const move = row.move;
  return (
    <span className={`num ${styles.rank}`} data-label="#">
      {row.rank}
      {move !== null && move !== 0 && (
        <>
          <span aria-hidden="true" className={move > 0 ? styles.moveUp : styles.moveDown}>
            {move > 0 ? `▲${move}` : `▼${-move}`}
          </span>
          <span className="sr-only">
            {text.t(move > 0 ? "endurance.moveUp" : "endurance.moveDown", { count: Math.abs(move) })}
          </span>
        </>
      )}
    </span>
  );
}

function RoundColumn({
  cell,
  solo,
  label,
  text,
}: Readonly<{ cell: EnduranceRoundColumnCell; solo: boolean; label: string; text: TournamentPageText }>) {
  const { t } = text;
  if (cell.kind === "FORFEIT") {
    return (
      <span data-label={label} className={`mono ${styles.roundCell} ${styles.roundForfeit}`}>
        {t(solo ? "endurance.cellForfeitSolo" : "endurance.cellForfeitTeam")}
      </span>
    );
  }
  if (cell.kind === "BYE") {
    return (
      <span data-label={label} className={`${styles.roundCell} ${styles.roundQuiet}`}>
        {t("endurance.cellBye")}
      </span>
    );
  }
  if (cell.kind === "OUT") {
    return (
      <span data-label={label} className={`${styles.roundCell} ${styles.roundQuiet}`}>
        {t(solo ? "endurance.cellOutSolo" : "endurance.cellOutTeam")}
      </span>
    );
  }
  const date = formatMatchStartAt(cell.startAt, text.locale);
  const opponent = (
    <span className={styles.roundLine}>
      <span className={styles.roundQuiet}>{t("endurance.versus")}</span>
      <EntrantName teamId={cell.opponentId} name={cell.opponentName} truncate />
    </span>
  );
  if (cell.kind === "PENDING") {
    return (
      <span data-label={label} className={styles.roundCell}>
        <time dateTime={cell.startAt ?? undefined} title={formatMatchStartAtFull(cell.startAt, text.locale) ?? undefined}>
          {date ?? t("endurance.cellUnscheduled")}
        </time>
        {opponent}
      </span>
    );
  }
  return (
    <span data-label={label} className={styles.roundCell}>
      <span className={styles.roundLine}>
        <span className={`mono ${deltaClass(cell.delta)}`}>
          {signed(cell.delta)}
        </span>
        {/* La variation compte la pénalité de la manche : elle se dit à côté. */}
        {cell.penalty > 0 && (
          <span className={styles.penaltyBadge} title={t("endurance.penaltyBadgeTitle", { points: cell.penalty })}>
            {t("endurance.cellPenalty", { points: String(cell.penalty) })}
          </span>
        )}
        {cell.ownScore !== null && cell.opponentScore !== null && (
          <span className="num">
            {cell.ownScore}–{cell.opponentScore}
          </span>
        )}
        {date && (
          <time className={styles.roundQuiet} dateTime={cell.startAt ?? undefined}>
            {date}
          </time>
        )}
      </span>
      {opponent}
    </span>
  );
}

/**
 * Classement d'endurance **par vues** (`docs/features/ENDURANCE_RANKING_VIEWS.md`) :
 * « Manche 1 » … « Manche N-1 » (closes), « Manche N — matchs déjà joués », et
 * « Général » (vue par défaut). Il remplace l'ancien tableau « manche par
 * manche » : chaque manche se relit ici, avec son rang, ses ▲▼ et sa rencontre.
 */
export function EnduranceRankingViews({
  endurance,
  matches,
  myTeamId,
  renderActions,
  showActions,
  wideActions,
  actionsLegend,
  outLegend,
}: Readonly<EnduranceRankingViewsProps>) {
  const text = useTournamentViewText(FR_VIEWS_TEXT);
  const { t } = text;
  const participantType = useEntrantParticipantType();
  const solo = participantType === "SOLO";
  const { decorativeMotion } = useClientPower();
  const baseId = useId();

  const views = useMemo(() => enduranceRankingViews(endurance, matches), [endurance, matches]);
  // La vue suivie se retient par sa **clé** : une manche qui s'ajoute par le
  // flux décale les index, pas les clés. La manche en cours qui se clôt garde
  // le lecteur sur sa manche ; une autre clé disparue retombe sur « Général ».
  const [selectedKey, setSelectedKey] = useState("general");
  // Le glissement est lié à la vue que le lecteur a demandée : une clé changée
  // par le flux (manche close, repli sur « Général ») s'affiche sans glisser.
  const [slide, setSlide] = useState<{ key: string; direction: "left" | "right" } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Les flèches et la navigation du bas ne déplacent pas le focus : le titre
  // de la vue atteinte est annoncé ici (un onglet, lui, s'annonce de lui-même).
  const [announcement, setAnnouncement] = useState("");
  const index = resolveEnduranceViewIndex(views, selectedKey);
  const view = views[index];
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const rows = useMemo(() => enduranceRankingRows(view, endurance, matches), [view, endurance, matches]);
  const cutIndex = playoffCutIndex(rows, endurance.playoffSize);
  const columnRound = enduranceViewColumnRound(view, endurance);
  const columnLabel = columnRound === null ? "" : t("endurance.roundColumn", { round: String(columnRound) });
  const isGeneral = view.kind === "GENERAL";
  const withActions = isGeneral && showActions && renderActions !== undefined;
  const rowClassName = rowClass(withActions, wideActions);

  const hasDraws = endurance.standings.some((s) => s.draws > 0);
  const recordLabel = hasDraws ? t("endurance.recordDraws") : t("endurance.record");

  const go = (target: number, focus = false) => {
    if (target < 0 || target >= views.length || target === index) return;
    const targetKey = enduranceViewKey(views[target]);
    setSlide({ key: targetKey, direction: target < index ? "left" : "right" });
    setSelectedKey(targetKey);
    if (focus) tabRefs.current[target]?.focus();
    else setAnnouncement(viewTitle(views[target], text));
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const targets: Record<string, number> = {
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
      Home: 0,
      End: views.length - 1,
    };
    const target = targets[event.key];
    if (target === undefined) return;
    event.preventDefault();
    go(Math.max(0, Math.min(views.length - 1, target)), true);
  };

  const base = enduranceViewBaseRound(view, endurance, matches);
  const current = enduranceCurrentRound(matches);
  const sub = (() => {
    if (view.kind === "ROUND") {
      return base <= 0 ? t("endurance.subRoundFirst") : t("endurance.subRound", { base: String(base) });
    }
    if (view.kind === "CURRENT") {
      return t(solo ? "endurance.subCurrentSolo" : "endurance.subCurrentTeam", { count: rows.length });
    }
    if (current !== null) {
      const values = { round: String(current.round), played: String(current.played), total: String(current.total) };
      return base <= 0
        ? t("endurance.subGeneralRunningFirst", values)
        : t("endurance.subGeneralRunning", { ...values, base: String(base) });
    }
    return base <= 0 ? t("endurance.subGeneralStart") : t("endurance.subGeneral", { base: String(base) });
  })();

  const panelId = `${baseId}-panel`;
  const tabId = (key: string) => `${baseId}-tab-${key}`;
  const animationClass = slideClass(
    decorativeMotion,
    slide !== null && slide.key === enduranceViewKey(view) ? slide.direction : null,
  );

  /**
   * Navigation du bas : la vue atteinte peut être bien plus courte (16 lignes →
   * 4), le lecteur se retrouverait alors au-delà du tableau. On ramène le haut
   * du classement à l'écran — seulement s'il est passé sous l'en-tête du site
   * (la marge d'arrivée `scroll-padding-top`, qui le mesure).
   */
  const goFromBottom = (target: number) => {
    go(target);
    requestAnimationFrame(() => {
      const root = rootRef.current;
      if (root === null) return;
      const arrival = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop);
      if (root.getBoundingClientRect().top < (Number.isFinite(arrival) ? arrival : 0)) {
        root.scrollIntoView({ block: "start" });
      }
    });
  };
  const prev = index > 0 ? views[index - 1] : null;
  const next = index < views.length - 1 ? views[index + 1] : null;

  return (
    <div ref={rootRef} style={{ marginBottom: 8 }}>
      {views.length > 1 && (
        <div className={styles.bar}>
          {/* `aria-disabled` plutôt que `disabled` : arrivé au bout, le bouton
              garde le focus au lieu de le rendre au document ; `go` ignore
              déjà une cible hors des vues. */}
          <button
            type="button"
            className={`btn ghost ${styles.arrow}`}
            aria-label={t("endurance.viewPrev")}
            aria-disabled={prev === null}
            onClick={() => go(index - 1)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <div className={styles.barMiddle}>
            <div>
              <div className={styles.viewTitle}>{viewTitle(view, text)}</div>
              <div className={`mono ${styles.viewSub}`}>{sub}</div>
            </div>
            <ScrollArea fade ariaLabel={t("endurance.viewsTabsLabel")}>
              <div role="tablist" aria-label={t("endurance.viewsTabsLabel")} className={styles.tabs}>
                {views.map((candidate, candidateIndex) => {
                  const key = enduranceViewKey(candidate);
                  const selected = candidateIndex === index;
                  return (
                    <button
                      key={enduranceTabKey(candidate)}
                      ref={(node) => {
                        tabRefs.current[candidateIndex] = node;
                      }}
                      type="button"
                      role="tab"
                      id={tabId(key)}
                      aria-selected={selected}
                      aria-controls={panelId}
                      tabIndex={selected ? 0 : -1}
                      className={`btn ghost ${styles.tab}`}
                      onClick={() => go(candidateIndex, true)}
                      onKeyDown={onTabKeyDown}
                    >
                      {tabLabel(candidate, text)}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
          <button
            type="button"
            className={`btn ghost ${styles.arrow}`}
            aria-label={t("endurance.viewNext")}
            aria-disabled={next === null}
            onClick={() => go(index + 1)}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      {views.length <= 1 && <div className={`${styles.viewTitle}`} style={{ marginBottom: 8 }}>{viewTitle(view, text)}</div>}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>

      <div
        id={panelId}
        role={views.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={views.length > 1 ? tabId(enduranceViewKey(view)) : undefined}
        key={enduranceViewKey(view)}
        className={`table-like ${animationClass}`}
      >
        {/* La colonne des nuls n'apparaît que si le tournoi en a produit un. */}
        <div className={`${rowClassName} table-header`}>
          <span>#</span>
          <span>{participantText(text, participantType, "oneCapitalized")}</span>
          <span>{t("endurance.endurance")}</span>
          <span>{columnLabel}</span>
          <span>{recordLabel}</span>
          <span>{t("endurance.status")}</span>
          {withActions && <span className="sr-only">{t("endurance.actions")}</span>}
        </div>
        {rows.map((row, rowIndex) => {
          const { standing } = row;
          const isMine = myTeamId !== null && standing.teamId === myTeamId;
          return (
            <Fragment key={standing.teamId}>
              <div
                className={`${rowClassName} ${styles.fadable} ${isMine ? styles.mine : ""}`}
                data-row-focus={standing.teamId}
                data-podium-muted={ROW_OPACITY[row.status] < 1 ? "" : undefined}
                style={{ "--row-fade": ROW_OPACITY[row.status] } as CSSProperties}
              >
                <RankCell row={row} text={text} />
                <span className={styles.teamCell}>
                  <EntrantName
                    teamId={standing.teamId}
                    name={standing.teamName}
                    textStyle={{ fontWeight: isMine ? 700 : undefined, overflowWrap: "anywhere" }}
                  />
                  <span className={`mono ${styles.seed}`} title={t("endurance.seedTitle", { seed: String(standing.seed) })}>
                    <span aria-hidden="true">{t("endurance.seedShort", { seed: String(standing.seed) })}</span>
                    <span className="sr-only">{t("endurance.seedTitle", { seed: String(standing.seed) })}</span>
                  </span>
                </span>
                <span className="num" data-label={t("endurance.endurance")}>
                  {row.points}
                  {/* Le cumul des pénalités se lit à côté du capital, pas à sa place. */}
                  {row.penaltyPoints > 0 && (
                    <span
                      className={styles.penaltyBadge}
                      title={t("endurance.penaltyBadgeTitle", { points: row.penaltyPoints })}
                    >
                      <span aria-hidden="true">−{row.penaltyPoints}</span>
                      <span className="sr-only">{t("endurance.penaltyBadgeSr", { points: row.penaltyPoints })}</span>
                    </span>
                  )}
                </span>
                {columnRound === null ? (
                  <span data-label={columnLabel} />
                ) : (
                  <RoundColumn
                    cell={enduranceRoundColumnCell(standing, columnRound, matches, endurance.startPoints)}
                    solo={solo}
                    label={columnLabel}
                    text={text}
                  />
                )}
                <span data-label={recordLabel}>
                  {hasDraws ? `${row.wins} / ${row.draws} / ` : `${row.wins} / `}
                  <span className="result-loss">{row.losses}</span>
                </span>
                <span data-label={t("endurance.status")}>
                  {t(STATUS_KEYS[row.status])}
                  {row.eliminatedRound ? t("endurance.eliminatedRound", { round: String(row.eliminatedRound) }) : ""}
                </span>
                {withActions && <span className={styles.rowActions}>{renderActions?.(standing)}</span>}
              </div>
              {rowIndex === cutIndex && (
                <div className={`mono ${styles.cut}`}>
                  ▲ {t("endurance.cut", { size: String(endurance.playoffSize) })}
                </div>
              )}
            </Fragment>
          );
        })}
        {/* Dans le panneau « Général » qu'elle explique : lue avec lui. */}
        {isGeneral && ((withActions && actionsLegend) || outLegend) && (
          <div className={styles.legend}>
            {withActions && actionsLegend}
            {outLegend}
          </div>
        )}
      </div>

      {views.length > 1 && (
        <nav className={styles.bottomNav} aria-label={t("endurance.viewsTabsLabel")}>
          {prev && (
            <button type="button" className="btn ghost tap-target" onClick={() => goFromBottom(index - 1)}>
              <ChevronLeft size={14} aria-hidden="true" /> {navLabel(prev, text)}
            </button>
          )}
          {next && (
            <button type="button" className="btn ghost tap-target" onClick={() => goFromBottom(index + 1)}>
              {navLabel(next, text)} <ChevronRight size={14} aria-hidden="true" />
            </button>
          )}
        </nav>
      )}
    </div>
  );
}
