"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { BracketMatch, TournamentFormat } from "@/lib/shared/types";
import { BoardPanel, PanelPill } from "./BoardPanel";
import { MatchRow } from "./MatchRow";
import type { MatchScoreDraft } from "./BracketTree";
import {
  defaultOpenEnduranceRound,
  enduranceRoundOfMatch,
  type EnduranceRoundSection,
} from "../_lib/endurance-sections";
import { useMatchAnchorTarget } from "../_lib/match-anchor-context";
import styles from "./EnduranceRoundPanels.module.css";

interface EnduranceRoundPanelsProps {
  sections: EnduranceRoundSection[];
  /** Couleur d'accent du mode, commune aux volets et à l'arbre final. */
  accent: string;
  myTeamId: number | null;
  /** L'arbre final est-il lancé ? Décide du volet ouvert par défaut. */
  playoffsStarted: boolean;
  allTournamentMatches: BracketMatch[];
  canReport: (match: BracketMatch) => boolean;
  adminResolvable: (match: BracketMatch) => boolean;
  drafts: MatchScoreDraft;
  onScoreChange: (matchId: number, field: "myScore" | "opponentScore", value: string) => void;
  onSubmit: (match: BracketMatch, e: FormEvent) => Promise<void>;
  onOpenAdminModal: (match: BracketMatch) => void;
  format: TournamentFormat;
}

/**
 * Nom accessible du corps d'un volet. Le titre seul (« Manche 3 ») ne porte ni
 * la taille de la manche ni son avancement — deux choses que les pastilles
 * donnent à l'œil et qui, sans cela, ne seraient annoncées à personne.
 */
function roundRegionLabel(section: EnduranceRoundSection): string {
  const size = `${section.totalCount} match${section.totalCount > 1 ? "s" : ""}`;
  const progress = section.isComplete
    ? "terminée"
    : `${section.playedCount} sur ${section.totalCount} jouées`;
  return `${section.title}, ${size}, ${progress}`;
}

/** Le lecteur a-t-il une rencontre à jouer dans cette manche ? */
function hasPendingMatchFor(section: EnduranceRoundSection, myTeamId: number | null): boolean {
  if (myTeamId === null) return false;
  return section.matches.some(
    (match) =>
      match.winnerTeamId === null && (match.team1Id === myTeamId || match.team2Id === myTeamId),
  );
}

/**
 * Manches qualificatives de BlueGenji Survie, une par volet.
 *
 * Le mode empilait toutes ses manches à la file : dix manches à seize équipes
 * font quatre-vingts cartes en une colonne, où plus rien ne dit où commence la
 * manche courante. Les volets sont ceux des tableaux à élimination
 * (`BoardPanel`), et les cartes d'une manche s'y rangent en grille — une manche
 * de huit rencontres tient alors sur deux ou trois lignes au lieu de huit.
 */
export function EnduranceRoundPanels({
  sections,
  accent,
  myTeamId,
  playoffsStarted,
  allTournamentMatches,
  canReport,
  adminResolvable,
  drafts,
  onScoreChange,
  onSubmit,
  onOpenAdminModal,
  format,
}: EnduranceRoundPanelsProps) {
  const autoOpen = defaultOpenEnduranceRound(sections, myTeamId, playoffsStarted);

  const [openRounds, setOpenRounds] = useState<Set<number>>(
    () => new Set(autoOpen === null ? [] : [autoOpen]),
  );

  // Le volet à ouvrir d'office **change en cours de tournoi** : une manche
  // s'achève, la suivante arrive par le flux, et un état figé au montage
  // laisserait le lecteur sur une manche close. On ouvre donc la nouvelle
  // manche courante à chaque fois qu'elle change — et seulement alors, sinon
  // un volet refermé à la main se rouvrirait au prochain instantané.
  const lastAutoOpen = useRef(autoOpen);
  useEffect(() => {
    if (autoOpen === null || autoOpen === lastAutoOpen.current) return;
    lastAutoOpen.current = autoOpen;
    setOpenRounds((prev) => (prev.has(autoOpen) ? prev : new Set(prev).add(autoOpen)));
  }, [autoOpen]);

  // Ancre `#match-[id]` : la cible peut dormir dans un volet replié, que le hook
  // chercherait alors dans le DOM jusqu'à renoncer. Même règle que
  // `BracketSections` — on ajoute sans jamais refermer.
  const anchorTargetId = useMatchAnchorTarget();
  useEffect(() => {
    if (anchorTargetId === null) return;
    const round = enduranceRoundOfMatch(sections, anchorTargetId);
    if (round === null) return;
    setOpenRounds((prev) => (prev.has(round) ? prev : new Set(prev).add(round)));
  }, [anchorTargetId, sections]);

  const toggle = (round: number) =>
    setOpenRounds((prev) => {
      const next = new Set(prev);
      if (next.has(round)) next.delete(round);
      else next.add(round);
      return next;
    });

  return (
    <div className={styles.stack}>
      {sections.map((section) => {
        const mine = hasPendingMatchFor(section, myTeamId);
        return (
          <BoardPanel
            key={section.key}
            accent={accent}
            title={section.title}
            open={openRounds.has(section.round)}
            onToggle={() => toggle(section.round)}
            panelId={`endurance-${section.key}`}
            ariaLabel={roundRegionLabel(section)}
            highlighted={mine}
            flag={mine ? "Votre match" : null}
            meta={
              <>
                <PanelPill>
                  {section.totalCount} match{section.totalCount > 1 ? "s" : ""}
                </PanelPill>
                {/* Une manche close le dit d'un mot ; une manche en cours
                    montre son avancement, qui est justement ce qu'on vient
                    regarder. */}
                <PanelPill done={section.isComplete}>
                  {section.isComplete
                    ? "Terminée"
                    : `${section.playedCount}/${section.totalCount} jouées`}
                </PanelPill>
              </>
            }
          >
            <div className={styles.matchGrid}>
              {section.matches.map((match) => (
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
                  format={format}
                />
              ))}
            </div>
          </BoardPanel>
        );
      })}
    </div>
  );
}
