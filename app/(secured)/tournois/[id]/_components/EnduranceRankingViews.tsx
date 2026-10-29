"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/cyber";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
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
  enduranceRoundMatchIndex,
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

/**
 * Gabarit d'une ligne : la colonne d'action n'existe que dans « Général », et la
 * colonne « Manche n » seulement une fois une manche tirée.
 */
function rowClass(withActions: boolean, wideActions: boolean, withRound: boolean): string {
  let base = styles.row;
  if (withActions) base = wideActions ? styles.rowWithWideActions : styles.rowWithActions;
  const roundless = withRound ? "" : styles.noRound;
  return `table-row ${base} ${roundless}`.trim();
}

/**
 * Glissement d'entrée d'une vue, seulement si le mouvement décoratif est permis.
 * Deux jeux de classes (`parity`) pour rejouer l'animation d'une vue à l'autre
 * **sans recréer** le panneau : une même classe ne relance pas une animation,
 * deux noms de mouvement alternés, si.
 */
function slideClass(decorativeMotion: boolean, slide: { direction: "left" | "right"; count: number } | null): string {
  if (!decorativeMotion || slide === null) return "";
  const odd = slide.count % 2 === 1;
  if (slide.direction === "left") return odd ? styles.slideFromLeftAlt : styles.slideFromLeft;
  return odd ? styles.slideFromRightAlt : styles.slideFromRight;
}

/**
 * Pénalité d'arbitrage posée sur le capital ou sur une case de manche : le
 * visible se masque au lecteur d'écran (le signe « − » se lit de façon
 * variable), qui entend la phrase complète à la place.
 */
function PenaltyBadge({ points, visible, text }: Readonly<{ points: number; visible: string; text: TournamentPageText }>) {
  return (
    <span className={styles.penaltyBadge} title={text.t("endurance.penaltyBadgeTitle", { points })}>
      <span aria-hidden="true">{visible}</span>
      <span className="sr-only">{text.t("endurance.penaltyBadgeSr", { points })}</span>
    </span>
  );
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
    // Exemptée mais sanctionnée : son capital et son rang ont baissé, la case le dit.
    return (
      <span data-label={label} className={`${styles.roundCell} ${styles.roundQuiet}`}>
        <span className={styles.roundLine}>
          {t("endurance.cellBye")}
          {cell.penalty > 0 && (
            <PenaltyBadge points={cell.penalty} visible={t("endurance.cellPenalty", { points: String(cell.penalty) })} text={text} />
          )}
        </span>
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
        <span className={styles.roundLine}>
          <time dateTime={cell.startAt ?? undefined} title={formatMatchStartAtFull(cell.startAt, text.locale) ?? undefined}>
            {date ?? t("endurance.cellUnscheduled")}
          </time>
          {/* Une pénalité posée avant le match baisse déjà le capital. */}
          {cell.penalty > 0 && (
            <PenaltyBadge points={cell.penalty} visible={t("endurance.cellPenalty", { points: String(cell.penalty) })} text={text} />
          )}
        </span>
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
          <PenaltyBadge points={cell.penalty} visible={t("endurance.cellPenalty", { points: String(cell.penalty) })} text={text} />
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
  const [slide, setSlide] = useState<{ key: string; direction: "left" | "right"; count: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Barre collée sous l'en-tête du site : en carte mobile elle se compacte.
  const [stuck, setStuck] = useState(false);
  // Les flèches et la navigation du bas ne déplacent pas le focus : le titre
  // de la vue atteinte est annoncé ici (un onglet, lui, s'annonce de lui-même).
  const [announcement, setAnnouncement] = useState("");
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const index = resolveEnduranceViewIndex(views, selectedKey);
  const view = views[index];
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const bottomPrevRef = useRef<HTMLButtonElement>(null);
  const bottomNextRef = useRef<HTMLButtonElement>(null);

  const rows = useMemo(() => enduranceRankingRows(view, endurance, matches), [view, endurance, matches]);
  const cutIndex = playoffCutIndex(rows, endurance.playoffSize);
  const columnRound = enduranceViewColumnRound(view, endurance);
  const columnLabel = columnRound === null ? "" : t("endurance.roundColumn", { round: String(columnRound) });
  // Une seule fois par rendu de vue : la case de chaque ligne se lit dans un
  // index teamId → rencontre de la manche, pas dans tous les matchs.
  const columnCells = useMemo(() => {
    if (columnRound === null) return null;
    const roundMatches = enduranceRoundMatchIndex(matches, columnRound);
    return new Map(
      rows.map((row) => [
        row.standing.teamId,
        enduranceRoundColumnCell(row.standing, columnRound, matches, endurance.startPoints, roundMatches),
      ]),
    );
  }, [rows, columnRound, matches, endurance.startPoints]);
  const isGeneral = view.kind === "GENERAL";
  const withActions = isGeneral && showActions && renderActions !== undefined;
  const rowClassName = rowClass(withActions, wideActions, columnRound !== null);

  const hasDraws = endurance.standings.some((s) => s.draws > 0);
  const recordLabel = hasDraws ? t("endurance.recordDraws") : t("endurance.record");

  // La région est **vidée** avant d'y écrire : la même vue atteinte deux fois de
  // suite redonnerait le même texte, que le lecteur d'écran ne réannoncerait pas.
  const announce = (title: string) => {
    setAnnouncement("");
    if (announceTimer.current !== null) clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => setAnnouncement(title), 60);
  };
  useEffect(
    () => () => {
      if (announceTimer.current !== null) clearTimeout(announceTimer.current);
    },
    [],
  );

  const hasBar = views.length > 1;
  // Hauteur réelle de la barre collée : une ligne atteinte par Tab ne doit pas
  // s'arrêter dessous (WCAG 2.4.11) ; `scroll-padding-top` ne compte que
  // l'en-tête du site. La hauteur change (sous-titre masqué une fois collée) :
  // elle est relue à chaque redimensionnement, sans rendu React.
  useEffect(() => {
    const bar = barRef.current;
    const root = rootRef.current;
    if (!hasBar || bar === null || root === null || typeof ResizeObserver === "undefined") return;
    const publish = () => root.style.setProperty("--endurance-bar-h", `${bar.getBoundingClientRect().height}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--endurance-bar-h");
    };
  }, [hasBar]);
  // « Collée » = le repère posé juste au-dessus est passé sous l'en-tête du site.
  useEffect(() => {
    const bar = barRef.current;
    const sentinel = sentinelRef.current;
    if (!hasBar || bar === null || sentinel === null || typeof IntersectionObserver === "undefined") return;
    let observer: IntersectionObserver | null = null;
    let observedTop = Number.NaN;
    // La hauteur de l'en-tête (`--sticky-header-h`, posée sur <html>) change à la
    // rotation ou au redimensionnement : le seuil est relu, l'observateur refait
    // seulement si la valeur a bougé.
    const observe = () => {
      const top = Number.parseFloat(getComputedStyle(bar).top) || 0;
      if (top === observedTop) return;
      observedTop = top;
      observer?.disconnect();
      observer = new IntersectionObserver(
        ([entry]) => setStuck(!entry.isIntersecting && entry.boundingClientRect.top < top),
        { rootMargin: `-${Math.ceil(top)}px 0px 0px 0px` },
      );
      observer.observe(sentinel);
    };
    observe();
    window.addEventListener("resize", observe);
    const mutations = typeof MutationObserver === "undefined" ? null : new MutationObserver(observe);
    mutations?.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => {
      window.removeEventListener("resize", observe);
      mutations?.disconnect();
      observer?.disconnect();
    };
  }, [hasBar]);

  const go = (target: number, focus = false) => {
    if (target < 0 || target >= views.length || target === index) return;
    const targetKey = enduranceViewKey(views[target]);
    setSlide((previous) => ({
      key: targetKey,
      direction: target < index ? "left" : "right",
      count: (previous?.count ?? 0) + 1,
    }));
    setSelectedKey(targetKey);
    if (focus) {
      // Un onglet s'annonce de lui-même : une annonce encore en attente
      // (navigation du bas, < 60 ms) dirait une vue qui n'est plus affichée.
      if (announceTimer.current !== null) clearTimeout(announceTimer.current);
      setAnnouncement("");
      tabRefs.current[target]?.focus();
    } else announce(viewTitle(views[target], text));
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
      // Les ▲▼ de cette vue se lisent depuis la dernière manche close : le dire,
      // comme le font toutes les autres vues.
      const reference = base <= 0 ? t("endurance.subGeneralStart") : t("endurance.subGeneral", { base: String(base) });
      return `${t(solo ? "endurance.subCurrentSolo" : "endurance.subCurrentTeam", { count: rows.length })} · ${reference}`;
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
  const animationClass = slideClass(decorativeMotion, slide !== null && slide.key === enduranceViewKey(view) ? slide : null);

  /**
   * Navigation du bas : la vue atteinte peut être bien plus courte (16 lignes →
   * 4), le lecteur se retrouverait alors au-delà du tableau. On ramène le haut
   * du classement à l'écran — seulement s'il est passé sous l'en-tête du site
   * (la marge d'arrivée `scroll-padding-top`, qui le mesure).
   */
  const goFromBottom = (target: number) => {
    go(target);
    requestAnimationFrame(() => {
      // Arrivé à la première ou à la dernière vue, le bouton cliqué disparaît :
      // le focus clavier passe à l'autre bouton plutôt que de retomber sur le document.
      if (target === 0) bottomNextRef.current?.focus({ preventScroll: true });
      else if (target === views.length - 1) bottomPrevRef.current?.focus({ preventScroll: true });
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
      {hasBar && <div ref={sentinelRef} aria-hidden="true" className={styles.sentinel} />}
      {hasBar && (
        <div ref={barRef} className={`${styles.bar} ${stuck ? styles.barStuck : ""}`}>
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
            <ScrollArea fade ariaLabel={t("endurance.viewsScrollLabel")} revealKey={enduranceViewKey(view)}>
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
                      data-scroll-reveal={selected ? "" : undefined}
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
      {/* Sans barre des vues, le sous-titre qui nomme la référence des ▲▼ se rend
          aussi : les lignes en montrent dès qu'une pénalité tombe en manche 1. */}
      {!hasBar && (
        <div style={{ marginBottom: 8 }}>
          <div className={styles.viewTitle}>{viewTitle(view, text)}</div>
          <div className={`mono ${styles.viewSub}`}>{sub}</div>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>

      <div
        id={panelId}
        role={views.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={views.length > 1 ? tabId(enduranceViewKey(view)) : undefined}
        className={`table-like ${animationClass}`}
      >
        {/* La colonne des nuls n'apparaît que si le tournoi en a produit un. */}
        <div className={`${rowClassName} table-header`}>
          <span>#</span>
          <span>{participantText(text, participantType, "oneCapitalized")}</span>
          <span>{t("endurance.endurance")}</span>
          {columnRound !== null && <span>{columnLabel}</span>}
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
                    <PenaltyBadge points={row.penaltyPoints} visible={`−${row.penaltyPoints}`} text={text} />
                  )}
                </span>
                {/* Avant la première manche tirée, rien à y lire : ni cellule ni
                    en-tête, pas de ligne blanche en carte mobile. */}
                {columnCells !== null && (
                  <RoundColumn cell={columnCells.get(standing.teamId)!} solo={solo} label={columnLabel} text={text} />
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

      {/* « S3 » ne s'explique ni au survol ni au toucher : un « i » le dit. */}
      {rows.length > 0 && (
        <InfoHintRow>
          <span className={`mono ${styles.seedHintLabel}`}>{t("endurance.seedHintLabel")}</span>
          <InfoHint id={`${baseId}-seed-hint`} subject={t("endurance.seedHintSubject")}>
            {t("endurance.seedHint")}
          </InfoHint>
        </InfoHintRow>
      )}

      {hasBar && (
        <nav className={styles.bottomNav} aria-label={t("endurance.viewsNavLabel")}>
          {prev && (
            <button ref={bottomPrevRef} type="button" className="btn ghost tap-target" onClick={() => goFromBottom(index - 1)}>
              <ChevronLeft size={14} aria-hidden="true" /> {navLabel(prev, text)}
            </button>
          )}
          {next && (
            <button ref={bottomNextRef} type="button" className="btn ghost tap-target" onClick={() => goFromBottom(index + 1)}>
              {navLabel(next, text)} <ChevronRight size={14} aria-hidden="true" />
            </button>
          )}
        </nav>
      )}
    </div>
  );
}
