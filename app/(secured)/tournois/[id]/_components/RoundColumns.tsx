"use client";

import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { BracketMatch, TournamentFormat } from "@/lib/shared/types";
import { MatchRow } from "./MatchRow";
import { RoundMatchSections } from "./RoundMatchSections";
import { isMatchScoreLocked } from "../_lib/score-lock";
import { ScrollArea } from "@/components/cyber";
import { EntrantName } from "./EntrantName";
import { SCROLL_REVEAL_ATTRIBUTE } from "@/lib/shared/scroll-reveal";

/**
 * Pièces communes aux vues à classement par manches — survie (`SurvivalView`)
 * et ronde suisse (`SwissView`) : teintes, bandeau de la championne, bouton
 * d'abandon et colonnes de manches. Chaque vue garde son classement et ses
 * marques de manche propres (barrage et coupes, dernière ronde).
 */

const COL_W = 276;
export const BORDER = "var(--border, #444)";
export const ACCENT = "var(--teal-400)";
export const AMBER = "rgba(255,157,46,0.9)";

/** Bouton « Abandonner » d'une ligne du classement. */
export const FORFEIT_BUTTON_STYLE: CSSProperties = {
  padding: "3px 8px",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  background: "rgba(255,157,46,0.12)",
  borderColor: "rgba(255,157,46,0.4)",
  color: AMBER,
};

/** Marque ambrée accolée à l'intitulé d'une manche (barrage, coupe, dernière). */
function RoundBadge({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <span
      style={{
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: AMBER,
        border: `1px solid ${AMBER}`,
        borderRadius: 5,
        padding: "1px 6px",
      }}
    >
      {children}
    </span>
  );
}

/** Bandeau de la championne d'un tournoi clos, nommée par un lien. */
export function ChampionBanner({ champion }: Readonly<{ champion: { teamId: number; teamName: string } }>) {
  return (
    <div
      style={{
        padding: "14px 18px",
        border: `1px solid ${ACCENT}`,
        borderRadius: 10,
        background: "rgba(79,224,162,0.08)",
        fontSize: 15,
      }}
    >
      🏆 Championne —{" "}
      <EntrantName teamId={champion.teamId} name={champion.teamName} logoSize={20}>
        <strong>{champion.teamName}</strong>
      </EntrantName>
    </div>
  );
}

export interface RoundColumnsProps {
  matches: BracketMatch[];
  allTournamentMatches: BracketMatch[];
  /** Format qui règle le verrou des scores. */
  format: TournamentFormat;
  /** Nom de la zone défilante (« Manches du tournoi — … »). */
  ariaLabel: string;
  /** Nom d'une colonne, suivi de son numéro : « Manche », « Ronde ». */
  roundNoun: string;
  /** Marques accolées à l'intitulé d'une manche, propres au format (« ⚖ Barrage »). */
  roundMarks: (roundNum: number) => string[];
  adminResolvable: (m: BracketMatch) => boolean;
  onOpenAdminModal: (match: BracketMatch) => void;
  emptyLabel: string;
}

/**
 * Manches en colonnes (même esprit que les arbres d'élimination), une carte
 * par match et une carte « Victoire d'office » par exemption.
 *
 * La zone s'ouvre sur la **dernière** manche : c'est celle qui se joue, et
 * posées côte à côte elle était hors champ à droite sur mobile.
 */
export function RoundColumns({
  matches,
  allTournamentMatches,
  format,
  ariaLabel,
  roundNoun,
  roundMarks,
  adminResolvable,
  onOpenAdminModal,
  emptyLabel,
}: Readonly<RoundColumnsProps>) {
  // Matchs par manche, mémorisés sur la liste reçue : `RoundMatchSections`
  // trie et découpe sous `useMemo` sur l'identité de ce tableau.
  const matchesByRound = useMemo(() => {
    const byRound = new Map<number, BracketMatch[]>();
    for (const match of matches) {
      const round = byRound.get(match.roundNumber);
      if (round) round.push(match);
      else byRound.set(match.roundNumber, [match]);
    }
    for (const round of byRound.values()) round.sort((a, b) => a.matchNumber - b.matchNumber);
    return byRound;
  }, [matches]);
  const roundNums = [...matchesByRound.keys()].sort((a, b) => a - b);
  const lastRound = roundNums.at(-1) ?? null;
  return (
    <ScrollArea
      ariaLabel={ariaLabel}
      style={{ flex: 1, minWidth: 0, paddingBottom: 12 }}
      revealKey={lastRound}
    >
      {roundNums.length === 0 ? (
        <p style={{ color: "var(--text-2)", fontSize: 14 }}>{emptyLabel}</p>
      ) : (
        <div style={{ display: "flex", gap: 16 }}>
          {roundNums.map((roundNum) => {
            const roundMatches = matchesByRound.get(roundNum) ?? [];
            return (
              <div
                key={roundNum}
                style={{ flexShrink: 0, width: COL_W }}
                {...(roundNum === lastRound ? { [SCROLL_REVEAL_ATTRIBUTE]: "" } : {})}
              >
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
                    {`${roundNoun} `}{roundNum}
                  </span>
                  {roundMarks(roundNum).map((mark) => (
                    <RoundBadge key={mark}>{mark}</RoundBadge>
                  ))}
                </div>
                <RoundMatchSections
                  matches={roundMatches}
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  {(match) => {
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
                          <EntrantName
                            teamId={byeTeamId}
                            name={match.team1Name}
                            title={match.team1Name ?? undefined}
                            truncate
                            style={{ display: "flex" }}
                            textStyle={{ color: "var(--text-0)", fontWeight: 600 }}
                          />
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
                        adminResolvable={adminResolvable(match)}
                        onOpenAdminModal={onOpenAdminModal}
                        scoreLocked={isMatchScoreLocked(match.id, allTournamentMatches, format)}
                        roundNumber={match.roundNumber}
                      />
                    );
                  }}
                </RoundMatchSections>
              </div>
            );
          })}
        </div>
      )}
    </ScrollArea>
  );
}
