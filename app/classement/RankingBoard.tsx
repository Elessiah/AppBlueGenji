import { Crown } from "lucide-react";
import { TeamSigil } from "@/components/cyber";
import { TeamLink } from "@/components/entity-link";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { messagesFor } from "@/lib/server/i18n-messages";
import type { LandingLeaderboardRow } from "@/lib/shared/landing";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import {
  RANKING_FORM_LENGTH,
  RANKING_GAME_FILTERS,
  pointsBehind,
  rankingFilterHref,
  rankingMoreHref,
  rankingRowId,
  splitRankingPodium,
  type RankingGameFilter,
} from "@/lib/shared/ranking-page";
import { rankingText, type RankingText } from "@/lib/shared/ranking-text";
import { RankingMore } from "./RankingMore";
import styles from "./page.module.css";

type FormResult = "w" | "l" | "d";

export type RankingBoardProps = {
  rows: readonly LandingLeaderboardRow[];
  filter: RankingGameFilter;
  /** Forme par équipe — absente sur un onglet par jeu (elle couvre tous les jeux). */
  forms: ReadonlyMap<number, readonly FormResult[]> | null;
  /** Le chargement a échoué : on le dit plutôt qu'un « aucune équipe » trompeur. */
  unavailable?: boolean;
  /** Il reste des lignes au-delà de `rows` : le lien « Afficher plus » est rendu. */
  hasMore?: boolean;
  /**
   * Au moins une équipe du classement **entier** a un nul. Lu sur tout le
   * classement et non sur la page : sans quoi la colonne « N » apparaîtrait au
   * milieu d'un « Afficher plus » et décalerait toutes les lignes déjà lues.
   * Absent : déduit des lignes reçues.
   */
  anyDraws?: boolean;
  /** Langue de la page (`requestLocale()`) ; le français par défaut. */
  locale?: Locale;
};

/** Case de forme : victoire glacier, défaite dans sa teinte réservée, nul neutre. */
const FORM_CLASSES: Record<FormResult, string | undefined> = {
  w: styles.formWin,
  l: styles.formLoss,
  d: styles.formDraw,
};

const PLACE_KEYS = ["board.place.first", "board.place.second", "board.place.third"] as const;

/**
 * Marche du nom sur le podium, une par place et de plus en plus sobre : 1re
 * irisée, couronnée et balayée d'un reflet, 2e chrome glacier, 3e néon violet
 * (`.podium-tier-N`, `PODIUM_TIERS.md`). Posée **explicitement** depuis l'onglet
 * affiché : un onglet par jeu a son propre podium, que le contexte du site
 * (podium « Général ») ne connaît pas. Le nom reste du vrai texte dans son
 * `TeamLink` : l'effet n'est que de la peinture.
 */
const PODIUM_TIERS = [1, 2, 3] as const;

/** Textes du classement d'une langue (serveur : le catalogue complet est déjà en mémoire). */
function boardText(locale: Locale): RankingText {
  return rankingText(locale, messagesFor(locale).ranking);
}

/** Une défaite se lit dans sa couleur ; zéro défaite reste neutre (`DESIGN_SYSTEM.md`). */
function lossClass(losses: number): string {
  return losses > 0 ? "result-loss" : styles.neutral;
}

function trendText(row: LandingLeaderboardRow, text: RankingText): { symbol: string; label: string; className: string } {
  const value = String(row.trendValue);
  if (row.trend === "up") {
    return { symbol: `▲ ${value}`, label: text.t("board.trend.up", { value }), className: styles.trendUp };
  }
  if (row.trend === "down") {
    return { symbol: `▼ ${value}`, label: text.t("board.trend.down", { value }), className: styles.trendDown };
  }
  return { symbol: "—", label: text.t("board.trend.flat"), className: styles.trendFlat };
}

function FormStrip({ form, text }: Readonly<{ form: readonly FormResult[]; text: RankingText }>) {
  const recent = form.slice(0, RANKING_FORM_LENGTH);
  if (recent.length === 0) {
    return (
      <span className={styles.neutral}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{text.t("board.formNone")}</span>
      </span>
    );
  }
  const letter = (result: FormResult) => text.t(`board.formLetter.${result}`);
  const spoken = recent.map(letter).join(", ");
  return (
    <span className={styles.form} role="img" aria-label={text.t("board.formSpoken", { results: spoken })}>
      {recent.map((result, index) => (
        <span key={index} className={FORM_CLASSES[result]} aria-hidden="true">
          {letter(result)}
        </span>
      ))}
    </span>
  );
}

/** Ce qui sépare une marche du podium de la tête : l'envie de monter, chiffrée. */
export function podiumGapText(
  rows: readonly { points: number }[],
  index: number,
  text: RankingText = boardText(DEFAULT_LOCALE),
): string {
  if (index === 0) return text.t("board.gap.leader");
  const leaderGap = rows[0].points - rows[index].points;
  if (leaderGap <= 0) return text.t("board.gap.tiedWithLeader");
  const gap = pointsBehind(rows, index);
  // Chaînes, et non nombres : un écart reste « 1200 », jamais « 1 200 ».
  const values = { leaderGap: String(leaderGap), gap: String(gap) };
  if (gap === 0) return text.t("board.gap.behindLeaderTiedAbove", values);
  if (gap !== null && gap !== leaderGap) return text.t("board.gap.behindLeaderAndAbove", values);
  return text.t("board.gap.behindLeader", values);
}

/**
 * Le podium porte aussi la forme et la tendance de ses trois équipes : elles
 * n'ont plus de ligne au tableau (qui commence à la 4e place), et ces deux
 * repères ne doivent pas disparaître avec.
 */
function Podium({
  rows,
  forms,
  text,
}: Readonly<{ rows: readonly LandingLeaderboardRow[]; forms: RankingBoardProps["forms"]; text: RankingText }>) {
  const top = rows.slice(0, 3);
  return (
    <ol className={styles.podium} aria-label={text.t("board.podiumLabel")}>
      {top.map((row, index) => {
        const trend = trendText(row, text);
        return (
          <li key={row.teamId} className={styles.podiumCard} data-place={index + 1}>
            <div className={styles.podiumGlow} aria-hidden="true" />
            <div className={styles.podiumTop}>
              <span className={styles.podiumPlace}>
                {index === 0 ? <Crown className={styles.crown} aria-hidden="true" size={28} strokeWidth={1.8} /> : null}
                <span className={styles.podiumNumber} aria-hidden="true">{index + 1}</span>
                <span className="sr-only">{text.t(PLACE_KEYS[index])}</span>
              </span>
              <TeamSigil label={row.teamName.charAt(0)} size={40} logoUrl={row.logoUrl} />
            </div>
            <h3 className={styles.podiumName}>
              <TeamLink teamId={row.teamId} podiumTier={PODIUM_TIERS[index]} title={text.t("board.teamLinkTitle", { team: row.teamName })}>
                {row.teamName}
              </TeamLink>
            </h3>
            <p className={styles.podiumPoints}>
              <span className={styles.podiumPointsValue}>{row.points}</span>
              <span className={styles.podiumPointsUnit}>{` ${text.t("board.pointsUnit")}`}</span>
            </p>
            <p className={styles.podiumRecord}>
              <span className={styles.wins}>{text.t("board.record.wins", { count: String(row.wins) })}</span>
              <span className={styles.neutral} aria-hidden="true"> · </span>
              <span className={lossClass(row.losses)}>{text.t("board.record.losses", { count: String(row.losses) })}</span>
              {row.draws > 0 ? (
                <>
                  <span className={styles.neutral} aria-hidden="true"> · </span>
                  <span className={styles.neutral}>{text.t("board.record.draws", { count: String(row.draws) })}</span>
                </>
              ) : null}
            </p>
            <p className={styles.podiumMeta}>
              {forms !== null ? (
                <span className={styles.podiumMetaItem}>
                  <span className={styles.podiumMetaLabel} aria-hidden="true">{text.t("board.formLabel")}</span>
                  <FormStrip form={forms.get(row.teamId) ?? []} text={text} />
                </span>
              ) : null}
              <span className={`${styles.podiumMetaItem} ${styles.trend} ${trend.className}`}>
                <span className={styles.podiumMetaLabel} aria-hidden="true">{text.t("board.trendLabel")}</span>
                <span aria-hidden="true">{trend.symbol}</span>
                <span className="sr-only">{trend.label}</span>
              </span>
            </p>
            <p className={styles.podiumGap}>{podiumGapText(rows, index, text)}</p>
          </li>
        );
      })}
    </ol>
  );
}

type RankingTableProps = {
  rows: readonly LandingLeaderboardRow[];
  forms: RankingBoardProps["forms"];
  showDraws: boolean;
  /** Le podium précède le tableau : son libellé dit où il commence. */
  afterPodium: boolean;
  text: RankingText;
};

/** Le tableau des lignes hors podium — rangs absolus, une ligne par équipe. */
function RankingTable({ rows, forms, showDraws, afterPodium, text }: Readonly<RankingTableProps>) {
  const showForm = forms !== null;
  const column = {
    points: text.t("board.column.points"),
    wins: text.t("board.column.wins"),
    losses: text.t("board.column.losses"),
    draws: text.t("board.column.draws"),
    form: text.t("board.column.form"),
    trendShort: text.t("board.column.trendShort"),
  };
  return (
    <div
      className={styles.table}
      role="table"
      aria-label={afterPodium ? text.t("board.tableLabelAfterPodium") : text.t("board.tableLabel")}
      data-draws={showDraws ? "true" : undefined}
      data-form={showForm ? "true" : undefined}
    >
      <div className={`${styles.row} ${styles.head}`} role="row">
        <span role="columnheader">{text.t("board.column.rank")}</span>
        <span role="columnheader">{text.t("board.column.team")}</span>
        <span role="columnheader">{column.points}</span>
        <span role="columnheader">{column.wins}</span>
        <span role="columnheader">{column.losses}</span>
        {showDraws ? <span role="columnheader">{column.draws}</span> : null}
        {showForm ? <span role="columnheader">{column.form}</span> : null}
        <span role="columnheader">{text.t("board.column.trend")}</span>
      </div>
      {rows.map((row) => {
        const trend = trendText(row, text);
        return (
          <div
            key={row.teamId}
            id={rankingRowId(row.rank)}
            tabIndex={-1}
            className={styles.row}
            role="row"
            data-place={row.rank <= 3 ? row.rank : undefined}>
            <span className={styles.rank} role="cell">{String(row.rank).padStart(2, "0")}</span>
            <span className={styles.team} role="cell">
              <TeamSigil label={row.teamName.charAt(0)} size={32} logoUrl={row.logoUrl} />
              {/* Aucune marche au tableau : il suit le podium (rangs 4 et plus)
                  ou, sous trois équipes, il n'y a pas de podium du tout. */}
              <TeamLink
                teamId={row.teamId}
                podiumTier={null}
                title={text.t("board.teamLinkTitle", { team: row.teamName })}>
                {row.teamName}
              </TeamLink>
            </span>
            <span className={styles.points} role="cell" data-label={column.points}>{row.points}</span>
            <span className={styles.wins} role="cell" data-label={column.wins}>{row.wins}</span>
            <span className={lossClass(row.losses)} role="cell" data-label={column.losses}>{row.losses}</span>
            {showDraws ? (
              <span className={styles.neutral} role="cell" data-label={column.draws}>{row.draws}</span>
            ) : null}
            {showForm ? (
              <span className={styles.formCell} role="cell" data-label={column.form}>
                <FormStrip form={forms.get(row.teamId) ?? []} text={text} />
              </span>
            ) : null}
            <span className={`${styles.trend} ${trend.className}`} role="cell" data-label={column.trendShort}>
              <span aria-hidden="true">{trend.symbol}</span>
              <span className="sr-only">{trend.label}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Le classement : pastilles de jeu, podium des trois premières, puis le
 * tableau des lignes suivantes — à partir de la 4e place, sans répéter le
 * podium (`?n=` compte les rangs, par pages de `RANKING_PAGE_SIZE`) — et
 * « Afficher plus ». Composant serveur, sans état : tout se lit dans
 * l'adresse et s'affiche sans JavaScript. Textes dans la langue de la page
 * (`locale`) ; « Afficher plus », seul composant client, ne reçoit que les siens.
 */
export function RankingBoard({
  rows,
  filter,
  forms,
  unavailable = false,
  hasMore = false,
  anyDraws,
  locale = DEFAULT_LOCALE,
}: Readonly<RankingBoardProps>) {
  const showDraws = anyDraws ?? rows.some((row) => row.draws > 0);
  // Le tableau commence à la 4e place dès qu'il y a un podium : pas de doublon.
  const { podium, table } = splitRankingPodium(rows);
  const messages = messagesFor(locale).ranking;
  const text = rankingText(locale, messages);

  return (
    <>
      <nav className={styles.filters} aria-label={text.t("board.filtersLabel")}>
        {RANKING_GAME_FILTERS.map((chip) => (
          <LocaleLink
            key={chip.id}
            href={rankingFilterHref(chip.id)}
            className={chip.id === filter ? styles.chipOn : styles.chip}
            aria-current={chip.id === filter ? "page" : undefined}
            scroll={false}
          >
            {text.t(`board.filter.${chip.id}`)}
          </LocaleLink>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className={styles.empty}>
          {unavailable ? text.t("board.unavailable") : text.t("board.empty")}
        </p>
      ) : (
        <>
          {podium.length > 0 ? <Podium rows={podium} forms={forms} text={text} /> : null}
          {table.length > 0 ? (
            <RankingTable rows={table} forms={forms} showDraws={showDraws} afterPodium={podium.length > 0} text={text} />
          ) : null}
          {/* Remonté à chaque onglet : un « Afficher plus » resté en vol ne
              déplace pas le focus sur le classement d'un autre jeu. */}
          <RankingMore
            key={filter}
            shown={rows.length}
            href={hasMore ? rankingMoreHref(filter, rows.length) : null}
            hasMore={hasMore}
            messages={messages.more}
          />
        </>
      )}
    </>
  );
}
