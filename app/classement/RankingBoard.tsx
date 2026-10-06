import Link from "next/link";
import { Crown } from "lucide-react";
import { TeamSigil } from "@/components/cyber";
import { TeamLink } from "@/components/entity-link";
import type { LandingLeaderboardRow } from "@/lib/shared/landing";
import {
  FORM_LETTERS,
  RANKING_FORM_LENGTH,
  RANKING_GAME_FILTERS,
  pointsBehind,
  rankingFilterHref,
  rankingMoreHref,
  rankingRowId,
  splitRankingPodium,
  type RankingGameFilter,
} from "@/lib/shared/ranking-page";
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
};

/** Case de forme : victoire glacier, défaite dans sa teinte réservée, nul neutre. */
const FORM_CLASSES: Record<FormResult, string | undefined> = {
  w: styles.formWin,
  l: styles.formLoss,
  d: styles.formDraw,
};

const PLACE_LABELS =["1re place", "2e place", "3e place"] as const;

/** Une défaite se lit dans sa couleur ; zéro défaite reste neutre (`DESIGN_SYSTEM.md`). */
function lossClass(losses: number): string {
  return losses > 0 ? "result-loss" : styles.neutral;
}

function trendText(row: LandingLeaderboardRow): { symbol: string; label: string; className: string } {
  if (row.trend === "up") {
    return { symbol: `▲ ${row.trendValue}`, label: `Monte de ${row.trendValue} sur 7 jours`, className: styles.trendUp };
  }
  if (row.trend === "down") {
    return { symbol: `▼ ${row.trendValue}`, label: `Descend de ${row.trendValue} sur 7 jours`, className: styles.trendDown };
  }
  return { symbol: "—", label: "Stable sur 7 jours", className: styles.trendFlat };
}

function FormStrip({ form }: Readonly<{ form: readonly FormResult[] }>) {
  const recent = form.slice(0, RANKING_FORM_LENGTH);
  if (recent.length === 0) {
    return (
      <span className={styles.neutral}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">Aucun résultat récent</span>
      </span>
    );
  }
  const spoken = recent.map((result) => FORM_LETTERS[result]).join(", ");
  return (
    <span className={styles.form} role="img" aria-label={`Forme récente, du plus récent au plus ancien : ${spoken}`}>
      {recent.map((result, index) => (
        <span key={index} className={FORM_CLASSES[result]} aria-hidden="true">
          {FORM_LETTERS[result]}
        </span>
      ))}
    </span>
  );
}

/** Ce qui sépare une marche du podium de la tête : l'envie de monter, chiffrée. */
export function podiumGapText(rows: readonly { points: number }[], index: number): string {
  if (index === 0) return "En tête du classement";
  const leaderGap = rows[0].points - rows[index].points;
  if (leaderGap <= 0) return "À égalité avec la tête";
  const gap = pointsBehind(rows, index);
  let above = "";
  if (gap === 0) above = " · à égalité avec le rang au-dessus";
  else if (gap !== null && gap !== leaderGap) above = ` · ${gap} du rang au-dessus`;
  return `À ${leaderGap} pts de la tête${above}`;
}

/**
 * Le podium porte aussi la forme et la tendance de ses trois équipes : elles
 * n'ont plus de ligne au tableau (qui commence à la 4e place), et ces deux
 * repères ne doivent pas disparaître avec.
 */
function Podium({
  rows,
  forms,
}: Readonly<{ rows: readonly LandingLeaderboardRow[]; forms: RankingBoardProps["forms"] }>) {
  const top = rows.slice(0, 3);
  return (
    <ol className={styles.podium} aria-label="Podium">
      {top.map((row, index) => {
        const trend = trendText(row);
        return (
          <li key={row.teamId} className={styles.podiumCard} data-place={index + 1}>
            <div className={styles.podiumGlow} aria-hidden="true" />
            <div className={styles.podiumTop}>
              <span className={styles.podiumPlace}>
                {index === 0 ? <Crown className={styles.crown} aria-hidden="true" size={28} strokeWidth={1.8} /> : null}
                <span className={styles.podiumNumber} aria-hidden="true">{index + 1}</span>
                <span className="sr-only">{PLACE_LABELS[index]}</span>
              </span>
              <TeamSigil label={row.teamName.charAt(0)} size={40} logoUrl={row.logoUrl} />
            </div>
            <h3 className={styles.podiumName}>
              <TeamLink teamId={row.teamId} title={`Voir la fiche de ${row.teamName}`}>
                {row.teamName}
              </TeamLink>
            </h3>
            <p className={styles.podiumPoints}>
              <span className={styles.podiumPointsValue}>{row.points}</span>
              <span className={styles.podiumPointsUnit}> pts</span>
            </p>
            <p className={styles.podiumRecord}>
              <span className={styles.wins}>{row.wins} V</span>
              <span className={styles.neutral} aria-hidden="true"> · </span>
              <span className={lossClass(row.losses)}>{row.losses} D</span>
              {row.draws > 0 ? (
                <>
                  <span className={styles.neutral} aria-hidden="true"> · </span>
                  <span className={styles.neutral}>{row.draws} N</span>
                </>
              ) : null}
            </p>
            <p className={styles.podiumMeta}>
              {forms !== null ? (
                <span className={styles.podiumMetaItem}>
                  <span className={styles.podiumMetaLabel} aria-hidden="true">Forme</span>
                  <FormStrip form={forms.get(row.teamId) ?? []} />
                </span>
              ) : null}
              <span className={`${styles.podiumMetaItem} ${styles.trend} ${trend.className}`}>
                <span className={styles.podiumMetaLabel} aria-hidden="true">7 j</span>
                <span aria-hidden="true">{trend.symbol}</span>
                <span className="sr-only">{trend.label}</span>
              </span>
            </p>
            <p className={styles.podiumGap}>{podiumGapText(rows, index)}</p>
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
};

/** Le tableau des lignes hors podium — rangs absolus, une ligne par équipe. */
function RankingTable({ rows, forms, showDraws, afterPodium }: Readonly<RankingTableProps>) {
  const showForm = forms !== null;
  return (
    <div
      className={styles.table}
      role="table"
      aria-label={
        afterPodium
          ? "Tableau du classement des équipes, à partir de la 4e place"
          : "Tableau du classement des équipes"
      }
      data-draws={showDraws ? "true" : undefined}
      data-form={showForm ? "true" : undefined}
    >
      <div className={`${styles.row} ${styles.head}`} role="row">
        <span role="columnheader">Rang</span>
        <span role="columnheader">Équipe</span>
        <span role="columnheader">Cote</span>
        <span role="columnheader">V</span>
        <span role="columnheader">D</span>
        {showDraws ? <span role="columnheader">N</span> : null}
        {showForm ? <span role="columnheader">Forme</span> : null}
        <span role="columnheader">7 jours</span>
      </div>
      {rows.map((row) => {
        const trend = trendText(row);
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
              <TeamLink teamId={row.teamId} title={`Voir la fiche de ${row.teamName}`}>
                {row.teamName}
              </TeamLink>
            </span>
            <span className={styles.points} role="cell" data-label="Cote">{row.points}</span>
            <span className={styles.wins} role="cell" data-label="V">{row.wins}</span>
            <span className={lossClass(row.losses)} role="cell" data-label="D">{row.losses}</span>
            {showDraws ? (
              <span className={styles.neutral} role="cell" data-label="N">{row.draws}</span>
            ) : null}
            {showForm ? (
              <span className={styles.formCell} role="cell" data-label="Forme">
                <FormStrip form={forms.get(row.teamId) ?? []} />
              </span>
            ) : null}
            <span className={`${styles.trend} ${trend.className}`} role="cell" data-label="7 j">
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
 * l'adresse et s'affiche sans JavaScript.
 */
export function RankingBoard({
  rows,
  filter,
  forms,
  unavailable = false,
  hasMore = false,
  anyDraws,
}: Readonly<RankingBoardProps>) {
  const showDraws = anyDraws ?? rows.some((row) => row.draws > 0);
  // Le tableau commence à la 4e place dès qu'il y a un podium : pas de doublon.
  const { podium, table } = splitRankingPodium(rows);

  return (
    <>
      <nav className={styles.filters} aria-label="Filtrer par jeu">
        {RANKING_GAME_FILTERS.map((chip) => (
          <Link
            key={chip.id}
            href={rankingFilterHref(chip.id)}
            className={chip.id === filter ? styles.chipOn : styles.chip}
            aria-current={chip.id === filter ? "page" : undefined}
            scroll={false}
          >
            {chip.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className={styles.empty}>
          {unavailable
            ? "Le classement est momentanément indisponible. Réessaie dans un instant."
            : "Aucune équipe classée pour le moment : le premier match ouvrira le bal."}
        </p>
      ) : (
        <>
          {podium.length > 0 ? <Podium rows={podium} forms={forms} /> : null}
          {table.length > 0 ? (
            <RankingTable rows={table} forms={forms} showDraws={showDraws} afterPodium={podium.length > 0} />
          ) : null}
          {/* Remonté à chaque onglet : un « Afficher plus » resté en vol ne
              déplace pas le focus sur le classement d'un autre jeu. */}
          <RankingMore
            key={filter}
            shown={rows.length}
            href={hasMore ? rankingMoreHref(filter, rows.length) : null}
            hasMore={hasMore}
          />
        </>
      )}
    </>
  );
}
