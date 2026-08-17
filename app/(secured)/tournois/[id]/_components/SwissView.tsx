"use client";

import { FormEvent } from "react";
import Link from "next/link";
import type { BracketMatch, SwissMeta, SwissStandingRow } from "@/lib/shared/types";
import { formatPoints } from "@/lib/shared/swiss";
import { MatchScoreDraft } from "./BracketTree";
import { MatchRow } from "./MatchRow";
import { ScrollArea } from "@/components/cyber";

const COL_W = 226;
const BORDER = "var(--border, #444)";
const ACCENT = "var(--accent-green, #4fe0a2)";
const AMBER = "rgba(255,157,46,0.9)";

interface SwissViewProps {
  swiss: SwissMeta;
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
}

const STATUS_META: Record<SwissStandingRow["status"], { label: string; color: string }> = {
  ACTIVE: { label: "En lice", color: ACCENT },
  FORFEIT: { label: "Forfait", color: AMBER },
};

/** Libellés courts des départages, dans l'ordre où ils sont appliqués. */
const TIEBREAKER_LABELS: Record<SwissMeta["tiebreakers"][number], string> = {
  buchholz: "Buchholz",
  "sonneborn-berger": "Sonneborn-Berger",
  "opponent-mwp": "% victoires adverses",
  "head-to-head": "confrontation directe",
};

export function SwissView({
  swiss,
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
}: SwissViewProps) {
  const roundNums = [...new Set(matches.map((m) => m.roundNumber))].sort((a, b) => a - b);
  const activeCount = swiss.standings.filter((s) => s.status === "ACTIVE").length;
  const roundsLeft = Math.max(swiss.totalRounds - swiss.currentRound, 0);
  const champion = isFinished ? swiss.standings.find((s) => s.rank === 1) : null;

  const scoreLabel = `Victoire ${swiss.pointsForWin} pt${swiss.pointsForWin > 1 ? "s" : ""} · Nul ${swiss.pointsForDraw} · Défaite ${swiss.pointsForLoss}`;

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

      {/* Bandeau récap : où en est-on dans les rondes prévues. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <span className="mono" style={{ fontSize: 13, color: "var(--text-2)" }}>
          Ronde {swiss.currentRound || "—"}/{swiss.totalRounds || "—"} ·{" "}
          {activeCount} équipe{activeCount > 1 ? "s" : ""} en lice
        </span>
        <span className="mono" style={{ fontSize: 13, color: "var(--text-2)" }}>
          {scoreLabel}
        </span>
        {!isFinished && roundsLeft > 0 && (
          <span className="mono" style={{ fontSize: 13, color: AMBER }}>
            {roundsLeft} ronde{roundsLeft > 1 ? "s" : ""} restante{roundsLeft > 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Classement aux points */}
        <div style={{ flex: "0 0 400px", minWidth: 300 }}>
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

          {/* En-tête de colonnes : sans elle, « 9 · 3-0-1 · 24 » est illisible. La
              colonne de statut y est réservée elle aussi, sinon les chiffres
              dérivent d'un cran vers la droite sous leur intitulé. */}
          <div
            aria-hidden="true"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "4px 10px",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--text-2)",
            }}
          >
            <span style={{ width: 22 }}>#</span>
            <span style={{ flex: 1 }}>Équipe</span>
            <span style={{ width: 34, textAlign: "right" }} title="Points">
              Pts
            </span>
            <span style={{ width: 52, textAlign: "right" }} title="Victoires-Nuls-Défaites">
              V-N-D
            </span>
            <span
              style={{ width: 38, textAlign: "right" }}
              title="Buchholz : somme des points des adversaires rencontrés"
            >
              Bch
            </span>
            <span style={{ width: 10 }} />
            <span style={{ minWidth: 62, textAlign: "right" }}>Statut</span>
          </div>

          <div
            role="list"
            aria-label="Classement du tournoi"
            style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: "hidden" }}
          >
            {swiss.standings.map((team, idx) => {
              // Tournoi clos : la tête du classement est championne, pas « en lice ».
              const meta =
                isFinished && team.status === "ACTIVE" && team.rank === 1
                  ? { label: "Championne", color: ACCENT }
                  : isFinished && team.status === "ACTIVE"
                    ? { label: "Classée", color: "var(--text-2)" }
                    : STATUS_META[team.status];
              const isMine = team.teamId === myTeamId;
              const forfeitable =
                !isFinished && team.status === "ACTIVE" && canForfeit(team.teamId);
              return (
                <div
                  key={team.teamId}
                  role="listitem"
                  aria-label={`${team.rank}. ${team.teamName}, ${formatPoints(team.points)} points, ${team.wins} victoires ${team.draws} nuls ${team.losses} défaites`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 10px",
                    borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`,
                    background: isMine ? "rgba(89,212,255,0.06)" : undefined,
                    opacity: team.status === "FORFEIT" ? 0.55 : 1,
                    fontSize: 13,
                  }}
                >
                  <span
                    className="num"
                    style={{ width: 22, color: "var(--text-2)", fontWeight: 600 }}
                  >
                    {team.rank}
                  </span>
                  <Link
                    href={`/equipes/${team.teamId}`}
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
                  <span
                    className="num"
                    style={{ width: 34, textAlign: "right", fontWeight: 700 }}
                  >
                    {formatPoints(team.points)}
                  </span>
                  <span
                    className="mono"
                    style={{ width: 52, textAlign: "right", fontSize: 12, color: "var(--text-2)" }}
                  >
                    {team.wins}-{team.draws}-{team.losses}
                  </span>
                  <span
                    className="mono"
                    style={{ width: 38, textAlign: "right", fontSize: 12, color: "var(--text-2)" }}
                    title="Buchholz"
                  >
                    {formatPoints(team.buchholz)}
                  </span>
                  {/* Emplacement réservé même sans bye : sinon la colonne de
                      statut se décale d'une ligne à l'autre. */}
                  <span
                    aria-hidden={team.byes === 0}
                    title={team.byes > 0 ? "Victoire d'office reçue (effectif impair)" : undefined}
                    style={{ width: 10, fontSize: 10, color: AMBER, flexShrink: 0 }}
                  >
                    {team.byes > 0 ? "✓" : ""}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: meta.color,
                      minWidth: 62,
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

          <p style={{ margin: "8px 2px 0", fontSize: 12, color: "var(--text-2)" }}>
            À points égaux :{" "}
            {swiss.tiebreakers.map((t) => TIEBREAKER_LABELS[t]).join(", ")}.
          </p>
        </div>

        {/* Rondes en colonnes (même esprit que les arbres d'élimination) */}
        <ScrollArea
          ariaLabel="Rondes du tournoi — défilement horizontal"
          style={{ flex: 1, minWidth: 0, paddingBottom: 12 }}
        >
          {roundNums.length === 0 ? (
            <p style={{ color: "var(--text-2)", fontSize: 14 }}>Aucun match pour l&apos;instant.</p>
          ) : (
            <div style={{ display: "flex", gap: 16 }}>
              {roundNums.map((roundNum) => {
                const roundMatches = matches
                  .filter((m) => m.roundNumber === roundNum)
                  .sort((a, b) => a.matchNumber - b.matchNumber);
                const isFinalRound = roundNum === swiss.totalRounds;
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
                        Ronde {roundNum}
                      </span>
                      {isFinalRound && (
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
                          ⚑ Dernière
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {roundMatches.map((match) => {
                        const isBye = match.team2Id === null && match.team1Id !== null;
                        if (isBye) {
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
                                href={`/equipes/${match.team1Id}`}
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
                            format="SWISS"
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
