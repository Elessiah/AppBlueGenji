"use client";

import { type CSSProperties } from "react";
import type { BracketMatch, SwissMeta, SwissStandingRow } from "@/lib/shared/types";
import { formatPoints } from "@/lib/shared/swiss";
import { ScrollArea } from "@/components/cyber";
import { usePodiumTiers } from "@/components/podium-tiers";
import { standingNameWeight, teamPodiumTier } from "@/lib/shared/podium-tiers";
import { EntrantName } from "./EntrantName";
import {
  ACCENT,
  AMBER,
  BORDER,
  ChampionBanner,
  FORFEIT_BUTTON_STYLE,
  RoundColumns,
} from "./RoundColumns";
import styles from "./RankingViews.module.css";
import { useTournamentViewText } from "@/components/i18n/tournament-page-text";
import { FR_SWISS_TEXT } from "../_lib/swiss-text";
import { frenchBlockLang, type TournamentPageText } from "@/lib/shared/tournament-page-text";

interface SwissViewProps {
  swiss: SwissMeta;
  matches: BracketMatch[];
  allTournamentMatches: BracketMatch[];
  myTeamId: number | null;
  isFinished: boolean;
  adminResolvable: (m: BracketMatch) => boolean;
  onOpenAdminModal: (match: BracketMatch) => void;
  /** Le forfait de cette équipe peut-il être déclaré depuis le classement ? */
  canForfeit: (teamId: number) => boolean;
  onForfeit: (teamId: number, teamName: string) => void;
  /**
   * Ce qu'affiche la zone des manches quand il n'y en a aucune. La page le
   * calcule : un tournoi clos sans avoir été joué n'attend plus de match, et le
   * « pour l'instant » par défaut lui promettrait une suite qui ne viendra pas.
   */
  emptyLabel?: string;
}

/** Groupe ou ligne du classement : reprend les colonnes du tableau. */
const SUBGRID: CSSProperties = {
  display: "grid",
  gridColumn: "1 / -1",
  gridTemplateColumns: "subgrid",
};

const RIGHT: CSSProperties = { textAlign: "right" };
const SECONDARY: CSSProperties = { fontSize: 12, color: "var(--ink-quiet)" };

const STATUS_META: Record<SwissStandingRow["status"], { key: "ranking.active" | "ranking.forfeit"; color: string }> = {
  ACTIVE: { key: "ranking.active", color: ACCENT },
  FORFEIT: { key: "ranking.forfeit", color: AMBER },
};

export function SwissView({
  swiss,
  matches,
  allTournamentMatches,
  myTeamId,
  isFinished,
  adminResolvable,
  onOpenAdminModal,
  canForfeit,
  onForfeit,
  emptyLabel,
}: Readonly<SwissViewProps>) {
  const text = useTournamentViewText(FR_SWISS_TEXT);
  const { t } = text;
  // L'abandon est un geste du lot 8b : resté français sous `/en`.
  const actionLang = frenchBlockLang(text);
  const emptyText = emptyLabel ?? t("page.noMatchesShort");
  // Une marche du podium porte sa propre graisse : ne pas l'écraser en ligne.
  const podiumTiers = usePodiumTiers();
  const activeCount = swiss.standings.filter((s) => s.status === "ACTIVE").length;
  const roundsLeft = Math.max(swiss.totalRounds - swiss.currentRound, 0);
  // Le statut compte autant que le rang : si toutes les équipes ont abandonné,
  // le rang 1 échoit à une équipe forfait — qu'il ne s'agit pas de sacrer.
  const champion = isFinished
    ? swiss.standings.find((s) => s.rank === 1 && s.status === "ACTIVE")
    : null;

  const isForfeitable = (team: SwissStandingRow) =>
    !isFinished && team.status === "ACTIVE" && canForfeit(team.teamId);
  // La colonne d'action n'existe que si une ligne au moins porte le bouton :
  // un en-tête « Action » au-dessus de cellules toutes vides n'annoncerait rien.
  const anyForfeitable = swiss.standings.some(isForfeitable);

  const scoreLabel = t("swiss.scoring", {
    win: swiss.pointsForWin,
    draw: String(swiss.pointsForDraw),
    loss: String(swiss.pointsForLoss),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {champion && <ChampionBanner champion={champion} />}

      {/* Bandeau récap : où en est-on dans les rondes prévues. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <span className="mono" style={{ fontSize: 13, color: "var(--ink-quiet)" }}>
          {t("swiss.summary", {
            round: swiss.currentRound ? String(swiss.currentRound) : "—",
            total: swiss.totalRounds ? String(swiss.totalRounds) : "—",
            count: activeCount,
          })}
        </span>
        <span className="mono" style={{ fontSize: 13, color: "var(--ink-quiet)" }}>
          {scoreLabel}
        </span>
        {!isFinished && roundsLeft > 0 && (
          <span className="mono" style={{ fontSize: 13, color: "var(--pink-400)" }}>
            {t("swiss.roundsLeft", { count: roundsLeft })}
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Classement aux points */}
        <div style={{ flex: "1 1 400px", minWidth: 300, maxWidth: 560 }}>
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--ink-quiet)",
              fontWeight: 600,
              marginBottom: 10,
            }}
          >
            {t("ranking.title")}
          </div>

          {/* Un **tableau**, et non une liste : l'en-tête de colonnes est ce qui
              rend « 9 · 3-0-1 · 24 » lisible, et une liste le laissait à l'œil
              seul (`aria-hidden`), chaque ligne répétant ses intitulés dans un
              `aria-label` qui écrasait son contenu ; vide, elle laissait en
              outre `aria-required-children` à vérifier.

              La mise en page est une **grille à sous-grilles** : chaque groupe
              et chaque ligne reprend les pistes du tableau (`subgrid`), si bien
              qu'une colonne prend d'elle-même la largeur de sa cellule la plus
              large — en-tête, statut ou bouton d'abandon compris, police agrandie
              par le menu d'accessibilité comprise. Des lignes en `flex`
              séparées devaient se caler sur des largeurs écrites à la main, et
              le nom, seule colonne élastique, était écrasé à zéro sur un écran
              étroit. Il garde désormais un plancher (en `em`, qui suit la
              police) ; en dessous, le tableau défile à l'horizontale — un
              tableau de données est l'exception que prévoit la règle de
              redistribution (WCAG 1.4.10). */}
          {swiss.standings.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-quiet)" }}>
              {isFinished ? t("swiss.empty") : t("swiss.emptyYet")}
            </p>
          ) : (
            <ScrollArea ariaLabel={t("swiss.scrollLabel")}>
              <div
                role="table"
                aria-label={t("swiss.tableLabel")}
                // Pistes dans la feuille : sous 720 px, l'action passe sous le
                // nom et sa colonne disparaît — un style en ligne l'emporterait
                // sur la requête média.
                className={styles.swissTable}
                data-with-action={anyForfeitable ? "" : undefined}
              >
                <div role="rowgroup" style={SUBGRID}>
                  <div
                    role="row"
                    style={{
                      ...SUBGRID,
                      padding: "4px 10px",
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--ink-quiet)",
                    }}
                  >
                    <span role="columnheader" aria-label={t("swiss.rank")}>
                      #
                    </span>
                    <span role="columnheader">{t("swiss.team")}</span>
                    <span role="columnheader" aria-label={t("swiss.points")} style={RIGHT} title={t("swiss.points")}>
                      {t("swiss.pointsShort")}
                    </span>
                    <span
                      role="columnheader"
                      aria-label={t("swiss.record")}
                      style={RIGHT}
                      title={t("swiss.record")}
                    >
                      {t("swiss.recordShort")}
                    </span>
                    <span
                      role="columnheader"
                      aria-label={t("swiss.tiebreakers.buchholz")}
                      style={RIGHT}
                      title={t("swiss.buchholzTitle")}
                    >
                      Bch
                    </span>
                    <span role="columnheader">
                      <span className="sr-only">{t("swiss.bye")}</span>
                    </span>
                    <span role="columnheader" style={RIGHT}>
                      {t("swiss.status")}
                    </span>
                    {anyForfeitable && (
                      <span role="columnheader" className={styles.swissAction}>
                        <span className="sr-only">{t("swiss.action")}</span>
                      </span>
                    )}
                  </div>
                </div>

                <div
                  role="rowgroup"
                  style={{
                    ...SUBGRID,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  {swiss.standings.map((team, idx) => {
                    // Tournoi clos : la tête du classement est championne, pas « en lice ».
                    const meta = standingMeta(team, isFinished, text);
                    const isMine = team.teamId === myTeamId;
                    const forfeitable = isForfeitable(team);
                    return (
                      <div
                        key={team.teamId}
                        role="row"
                        data-podium-muted={team.status === "FORFEIT" ? "" : undefined}
                        style={{
                          ...SUBGRID,
                          alignItems: "center",
                          padding: "7px 10px",
                          borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`,
                          background: isMine ? "rgba(89,212,255,0.06)" : undefined,
                          opacity: team.status === "FORFEIT" ? 0.55 : 1,
                          fontSize: 13,
                        }}
                      >
                        <span
                          role="cell"
                          className="num"
                          style={{ color: "var(--ink-quiet)", fontWeight: 600 }}
                        >
                          {team.rank}
                        </span>
                        {/* La cellule porte la place (piste élastique à
                            plancher), le nom s'y tronque d'une ellipse. */}
                        <span role="cell" style={{ display: "flex", minWidth: 0 }}>
                          <EntrantName
                            teamId={team.teamId}
                            name={team.teamName}
                            title={team.teamName}
                            truncate
                            textStyle={{ fontWeight: standingNameWeight(isMine, teamPodiumTier(podiumTiers, team.teamId) !== null, team.status === "FORFEIT") }}
                          />
                        </span>
                        <span role="cell" className="num" style={{ ...RIGHT, fontWeight: 700 }}>
                          {formatPoints(team.points)}
                        </span>
                        <span role="cell" className="mono" style={{ ...RIGHT, ...SECONDARY }}>
                          {team.wins}-{team.draws}-<span className="result-loss">{team.losses}</span>
                        </span>
                        <span role="cell" className="mono" style={{ ...RIGHT, ...SECONDARY }}>
                          {formatPoints(team.buchholz)}
                        </span>
                        {/* La coche est décorative, la cellule dit le fait en
                            toutes lettres. */}
                        <span
                          role="cell"
                          title={team.byes > 0 ? t("swiss.byeTitle") : undefined}
                          style={{ fontSize: 11, color: "var(--violet-300)" }}
                        >
                          {team.byes > 0 && (
                            <>
                              <span aria-hidden="true">✓</span>
                              <span className="sr-only">{t("swiss.yes")}</span>
                            </>
                          )}
                        </span>
                        <span
                          role="cell"
                          style={{
                            ...RIGHT,
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                            color: meta.color,
                          }}
                        >
                          {meta.label}
                        </span>
                        {anyForfeitable && (
                          <span role="cell" className={styles.swissAction} lang={actionLang}>
                            {forfeitable && (
                              <button
                                type="button"
                                onClick={() => onForfeit(team.teamId, team.teamName)}
                                className="btn tap-target"
                                title={
                                  isMine
                                    ? "Abandonner : votre équipe quitte définitivement le tournoi"
                                    : `Déclarer l'abandon de ${team.teamName}`
                                }
                                aria-label={
                                  isMine
                                    ? "Abandonner avec mon équipe"
                                    : `Abandonner : déclarer l'abandon de ${team.teamName}`
                                }
                                style={FORFEIT_BUTTON_STYLE}
                              >
                                Abandonner
                              </button>
                            )}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </ScrollArea>
          )}

          <p style={{ margin: "8px 2px 0", fontSize: 12, color: "var(--ink-quiet)" }}>
            {t("swiss.tiebreak", { list: swiss.tiebreakers.map((key) => t(`swiss.tiebreakers.${key}`)).join(", ") })}
          </p>
        </div>

        <SwissRounds
          matches={matches}
          allTournamentMatches={allTournamentMatches}
          totalRounds={swiss.totalRounds}
          adminResolvable={adminResolvable}
          onOpenAdminModal={onOpenAdminModal}
          emptyLabel={emptyText}
        />
      </div>
    </div>
  );
}

interface SwissRoundsProps {
  matches: BracketMatch[];
  allTournamentMatches: BracketMatch[];
  /** Rondes prévues, pour marquer la dernière ; `null` si on ne le sait pas. */
  totalRounds: number | null;
  adminResolvable: (m: BracketMatch) => boolean;
  onOpenAdminModal: (match: BracketMatch) => void;
  emptyLabel: string;
}

/**
 * Rondes d'une ronde suisse, en colonnes (même esprit que les arbres
 * d'élimination). Rendue seule pour une phase suisse **close** d'un tournoi
 * multi-phases : le serveur ne charge le classement suisse que de la phase en
 * cours, et celui d'une phase close s'affiche dessous (`PhaseStandingsBlock`) —
 * sans ce composant, ses rondes retombaient dans un arbre à élimination qui
 * les appelait « Quart de finale ». Colonnes communes : `RoundColumns`.
 */
export function SwissRounds({
  matches,
  allTournamentMatches,
  totalRounds,
  adminResolvable,
  onOpenAdminModal,
  emptyLabel,
}: Readonly<SwissRoundsProps>) {
  const { t } = useTournamentViewText(FR_SWISS_TEXT);
  return (
    <RoundColumns
      matches={matches}
      allTournamentMatches={allTournamentMatches}
      format="SWISS"
      ariaLabel={t("swiss.roundsLabel")}
      roundNoun={t("swiss.roundNoun")}
      roundMarks={(roundNum) => (roundNum === totalRounds ? [t("swiss.lastRound")] : [])}
      adminResolvable={adminResolvable}
      onOpenAdminModal={onOpenAdminModal}
      emptyLabel={emptyLabel}
    />
  );
}

/** Pastille d'une ligne du classement ; tournoi clos, une équipe en lice est classée. */
function standingMeta(
  team: SwissStandingRow,
  isFinished: boolean,
  text: TournamentPageText,
): { label: string; color: string } {
  if (isFinished && team.status === "ACTIVE") {
    return team.rank === 1
      ? { label: text.t("ranking.champion"), color: ACCENT }
      : { label: text.t("ranking.ranked"), color: "var(--ink-quiet)" };
  }
  const meta = STATUS_META[team.status];
  return { label: text.t(meta.key), color: meta.color };
}
