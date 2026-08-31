"use client";

import { FormEvent } from "react";
import Link from "next/link";
import type { BracketMatch, SurvivalMeta, SurvivalStandingRow } from "@/lib/shared/types";
import { isCutRound, nextCutRound, teamsToEliminate } from "@/lib/shared/survival";
import { MatchScoreDraft } from "./BracketTree";
import { MatchRow } from "./MatchRow";
import { ScrollArea } from "@/components/cyber";
import { useEntrantLink } from "../_lib/entrant-link";

const COL_W = 226;
const BORDER = "var(--border, #444)";
const ACCENT = "var(--accent-green, #4fe0a2)";
const AMBER = "rgba(255,157,46,0.9)";

interface SurvivalViewProps {
  survival: SurvivalMeta;
  matches: BracketMatch[];
  allTournamentMatches: BracketMatch[];
  myTeamId: number | null;
  isFinished: boolean;
  canReport: (m: BracketMatch) => boolean;
  adminResolvable: (m: BracketMatch) => boolean;
  drafts: MatchScoreDraft;
  onScoreChange: (matchId: number, field: "myScore" | "opponentScore", value: string) => void;
  onSubmit: (match: BracketMatch, e: FormEvent) => Promise<void>;
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

const STATUS_META: Record<SurvivalStandingRow["status"], { label: string; color: string }> = {
  ACTIVE: { label: "En lice", color: ACCENT },
  ELIMINATED: { label: "Éliminée", color: "var(--text-2)" },
  FORFEIT: { label: "Forfait", color: AMBER },
};

export function SurvivalView({
  survival,
  matches,
  allTournamentMatches,
  myTeamId,
  isFinished,
  canReport,
  adminResolvable,
  drafts,
  onScoreChange,
  onSubmit,
  onOpenAdminModal,
  canForfeit,
  onForfeit,
  emptyLabel = "Aucun match pour l'instant.",
}: SurvivalViewProps) {
  const entrantLink = useEntrantLink();
  const roundNums = [...new Set(matches.map((m) => m.roundNumber))].sort((a, b) => a - b);
  const activeCount = survival.standings.filter((s) => s.status === "ACTIVE").length;
  const barrageRounds = survival.barrageRounds ?? 0;
  // Pendant le barrage, le danger porte sur ses deux participants (le perdant
  // sort) et non sur la coupe à venir.
  const inBarrage = barrageRounds > 0 && survival.currentRound <= barrageRounds;
  const atRisk = inBarrage ? 2 : teamsToEliminate(activeCount);

  // Les équipes actives, classées, dont les `atRisk` dernières sont en danger.
  const activeSorted = survival.standings
    .filter((s) => s.status === "ACTIVE")
    .sort((a, b) => a.rank - b.rank);
  const dangerTeamIds = new Set(
    activeSorted.slice(activeSorted.length - atRisk).map((s) => s.teamId),
  );

  const cutSchedule = {
    roundsBeforeFirstCut: survival.roundsBeforeFirstCut,
    roundsPerCut: survival.roundsPerCut,
    barrageRounds,
  };
  // Échéance concrète plutôt que cadence abstraite : la première coupe peut être
  // repoussée bien après l'intervalle courant.
  const upcomingCut = nextCutRound(Math.max(survival.currentRound, 1), cutSchedule);
  // « toutes les 1 manche » ne se dit pas : au rythme d'une coupe par manche,
  // on écrit « à chaque manche ».
  const everyRounds =
    survival.roundsPerCut === 1
      ? "à chaque manche"
      : `toutes les ${survival.roundsPerCut} manches`;
  const cadenceLabel =
    survival.roundsBeforeFirstCut === survival.roundsPerCut
      ? `Coupe ${everyRounds}`
      : `1re coupe au round ${survival.roundsBeforeFirstCut + barrageRounds}, puis ${everyRounds}`;

  const champion = isFinished ? survival.standings.find((s) => s.rank === 1) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {champion && (
        <div
          style={{
            padding: "14px 18px",
            border: `1px solid ${ACCENT}`,
            borderRadius: 10,
            background: "rgba(79,224,162,0.08)",
            fontSize: 15,
          }}
        >
          🏆 Championne — <strong>{champion.teamName}</strong>
        </div>
      )}

      {/* Bandeau récap + action forfait */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <span className="mono" style={{ fontSize: 13, color: "var(--text-2)" }}>
          Round {survival.currentRound || "—"} · {activeCount} équipe{activeCount > 1 ? "s" : ""} en lice
        </span>
        <span className="mono" style={{ fontSize: 13, color: "var(--text-2)" }}>
          {cadenceLabel}
        </span>
        {!isFinished && upcomingCut > 0 && (
          <span className="mono" style={{ fontSize: 13, color: AMBER }}>
            Prochaine coupe : round {upcomingCut}
          </span>
        )}
        {barrageRounds > 0 && (
          <span className="mono" style={{ fontSize: 13, color: AMBER }}>
            Barrage d&apos;équilibrage au round 1
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Classement courant */}
        <div style={{ flex: "0 0 340px", minWidth: 280 }}>
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--text-2)",
              fontWeight: 600,
              marginBottom: 10,
            }}
          >
            Classement
          </div>
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: "hidden" }}>
            {survival.standings.map((team, idx) => {
              // Tournoi clos : la dernière équipe active est la championne, pas
              // une équipe « en lice ».
              const meta =
                isFinished && team.status === "ACTIVE"
                  ? { label: "Championne", color: ACCENT }
                  : STATUS_META[team.status];
              const inDanger = dangerTeamIds.has(team.teamId);
              const isMine = team.teamId === myTeamId;
              // Abandon : proposé sur les équipes encore en lice, à leurs
              // représentants comme à l'arbitrage (cf. `canForfeit` côté page).
              const forfeitable =
                !isFinished && team.status === "ACTIVE" && canForfeit(team.teamId);
              return (
                <div
                  key={team.teamId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 10px",
                    borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`,
                    borderLeft: inDanger ? `3px solid ${AMBER}` : "3px solid transparent",
                    background: isMine ? "rgba(89,212,255,0.06)" : undefined,
                    opacity: team.status === "ELIMINATED" ? 0.55 : 1,
                    fontSize: 13,
                  }}
                >
                  <span className="num" style={{ width: 22, color: "var(--text-2)", fontWeight: 600 }}>
                    {team.rank}
                  </span>
                  <Link
                    href={entrantLink(team.teamId)}
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      textDecoration: "none",
                      color: "inherit",
                      fontWeight: isMine ? 700 : 500,
                    }}
                  >
                    {team.teamName}
                  </Link>
                  <span className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
                    {team.wins}-{team.losses}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: meta.color,
                      minWidth: 58,
                      textAlign: "right",
                    }}
                  >
                    {meta.label}
                  </span>
                  {forfeitable && (
                    <button
                      type="button"
                      onClick={() => onForfeit(team.teamId, team.teamName)}
                      className="btn"
                      title={
                        isMine
                          ? "Abandonner : votre équipe quitte définitivement le tournoi"
                          : `Déclarer l'abandon de ${team.teamName}`
                      }
                      aria-label={
                        isMine
                          ? "Abandonner avec mon équipe"
                          : `Déclarer l'abandon de ${team.teamName}`
                      }
                      style={{
                        flexShrink: 0,
                        padding: "3px 8px",
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        background: "rgba(255,157,46,0.12)",
                        borderColor: "rgba(255,157,46,0.4)",
                        color: AMBER,
                      }}
                    >
                      Abandonner
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {atRisk > 0 && !isFinished && (
            <p style={{ margin: "8px 2px 0", fontSize: 12, color: AMBER }}>
              {inBarrage ? (
                <>⚖ Barrage : le perdant du match est éliminé.</>
              ) : (
                <>
                  ⚠ Bord de tableau : {atRisk} équipe{atRisk > 1 ? "s" : ""} éliminée
                  {atRisk > 1 ? "s" : ""} à la prochaine coupe.
                </>
              )}
            </p>
          )}
        </div>

        {/* Rounds en colonnes (même esprit que les arbres d'élimination) */}
        <ScrollArea
          ariaLabel="Rounds du tournoi — défilement horizontal"
          style={{ flex: 1, minWidth: 0, paddingBottom: 12 }}
        >
          {roundNums.length === 0 ? (
            <p style={{ color: "var(--text-2)", fontSize: 14 }}>{emptyLabel}</p>
          ) : (
            <div style={{ display: "flex", gap: 16 }}>
              {roundNums.map((roundNum) => {
                const roundMatches = matches
                  .filter((m) => m.roundNumber === roundNum)
                  .sort((a, b) => a.matchNumber - b.matchNumber);
                const isBarrageRound = barrageRounds > 0 && roundNum <= barrageRounds;
                const cut = isCutRound(roundNum, cutSchedule);
                return (
                  <div key={roundNum} style={{ flexShrink: 0, width: COL_W }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        height: 26,
                        marginBottom: 8,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                          color: "var(--text-2)",
                          fontWeight: 600,
                        }}
                      >
                        Round {roundNum}
                      </span>
                      {isBarrageRound && (
                        <span
                          style={{
                            fontSize: 10,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            color: AMBER,
                            border: `1px solid ${AMBER}`,
                            borderRadius: 5,
                            padding: "1px 6px",
                          }}
                        >
                          ⚖ Barrage
                        </span>
                      )}
                      {cut && (
                        <span
                          style={{
                            fontSize: 10,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            color: AMBER,
                            border: `1px solid ${AMBER}`,
                            borderRadius: 5,
                            padding: "1px 6px",
                          }}
                        >
                          ⚔ Coupe
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {roundMatches.map((match) => {
                        // L'exempté est la seule équipe posée sur la manche ;
                        // le lier demande un identifiant non nul.
                        const byeTeamId = match.team2Id === null ? match.team1Id : null;
                        if (byeTeamId !== null) {
                          return (
                            <div
                              key={match.id}
                              style={{
                                border: `1px dashed ${BORDER}`,
                                borderRadius: 6,
                                padding: "8px 10px",
                                fontSize: 13,
                                background: "var(--surface-1)",
                              }}
                            >
                              <Link
                                href={entrantLink(byeTeamId)}
                                style={{
                                  color: "var(--text-0)",
                                  textDecoration: "none",
                                  fontWeight: 600,
                                  display: "block",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {match.team1Name}
                              </Link>
                              <span style={{ fontSize: 11, color: ACCENT }}>
                                ✓ Victoire d&apos;office
                              </span>
                            </div>
                          );
                        }
                        return (
                          <MatchRow
                            key={match.id}
                            match={match}
                            reportable={canReport(match)}
                            adminResolvable={adminResolvable(match)}
                            onScoreChange={onScoreChange}
                            myScore={drafts[match.id]?.myScore || ""}
                            opponentScore={drafts[match.id]?.opponentScore || ""}
                            onSubmit={onSubmit}
                            onOpenAdminModal={onOpenAdminModal}
                            allMatches={allTournamentMatches}
                            roundNumber={match.roundNumber}
                            format="SURVIVAL"
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
