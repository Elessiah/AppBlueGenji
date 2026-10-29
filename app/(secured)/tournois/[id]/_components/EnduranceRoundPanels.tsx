"use client";

import { useEffect, useRef, useState } from "react";
import type { BracketMatch, TournamentFormat } from "@/lib/shared/types";
import { BoardPanel, PanelPill } from "./BoardPanel";
import { MatchRow } from "./MatchRow";
import { RoundMatchSections } from "./RoundMatchSections";
import { isMatchScoreLocked } from "../_lib/score-lock";
import { isMatchPlayed } from "@/lib/shared/match-outcome";
import {
  defaultOpenEnduranceRound,
  enduranceMatchCountLabel,
  enduranceProgressLabel,
  enduranceRoundOfMatch,
  enduranceRoundRegionLabel,
  enduranceRoundTitle,
  orderEnduranceRoundSections,
  type EnduranceRoundSection,
} from "../_lib/endurance-sections";
import { useTournamentViewText } from "@/components/i18n/tournament-page-text";
import { FR_VIEWS_TEXT } from "../_lib/views-text";
import { useMatchAnchorTarget } from "../_lib/match-anchor-context";
import styles from "./EnduranceRoundPanels.module.css";

interface EnduranceRoundPanelsProps {
  sections: EnduranceRoundSection[];
  /** Couleur d'accent du mode, commune aux volets et à l'arbre final. */
  accent: string;
  myTeamId: number | null;
  allTournamentMatches: BracketMatch[];
  adminResolvable: (match: BracketMatch) => boolean;
  onOpenAdminModal: (match: BracketMatch) => void;
  format: TournamentFormat;
}

/** Le lecteur a-t-il une rencontre à jouer dans cette manche ? */
function hasPendingMatchFor(section: EnduranceRoundSection, myTeamId: number | null): boolean {
  if (myTeamId === null) return false;
  return section.matches.some(
    (match) =>
      !isMatchPlayed(match) && (match.team1Id === myTeamId || match.team2Id === myTeamId),
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
 *
 * Ordre et ouverture : la manche en cours en tête et ouverte, les manches
 * closes ensuite, repliées, de la plus récente à la plus ancienne
 * (`orderEnduranceRoundSections`, `defaultOpenEnduranceRound`).
 */
export function EnduranceRoundPanels({
  sections,
  accent,
  myTeamId,
  allTournamentMatches,
  adminResolvable,
  onOpenAdminModal,
  format,
}: Readonly<EnduranceRoundPanelsProps>) {
  const text = useTournamentViewText(FR_VIEWS_TEXT);
  const autoOpen = defaultOpenEnduranceRound(sections);
  const ordered = orderEnduranceRoundSections(sections);

  const [openRounds, setOpenRounds] = useState<Set<number>>(
    () => new Set(autoOpen === null ? [] : [autoOpen]),
  );

  // Le volet à ouvrir d'office **change en cours de tournoi** : une manche
  // s'achève, la suivante arrive par le flux, et un état figé au montage
  // laisserait le lecteur sur une manche close. On ouvre donc la nouvelle
  // manche courante à chaque fois qu'elle change — et seulement alors, sinon
  // un volet refermé à la main se rouvrirait au prochain instantané. La manche
  // ouverte d'office qui se clôt se replie (une manche close est repliée), sauf
  // si le lecteur l'a lui-même rouverte : un soir de tournoi suivi en direct ne
  // finit pas avec toutes les manches dépliées. Elle se replie aussi quand rien
  // ne la remplace (`autoOpen` passe à `null` : dernière manche close, play-offs
  // lancés, suivante pas encore tirée) : un chargement frais la montre repliée.
  const lastAutoOpen = useRef(autoOpen);
  const openedByHand = useRef(new Set<number>());
  useEffect(() => {
    if (autoOpen === lastAutoOpen.current) return;
    const previous = lastAutoOpen.current;
    lastAutoOpen.current = autoOpen;
    setOpenRounds((prev) => {
      const next = new Set(prev);
      if (previous !== null && !openedByHand.current.has(previous)) next.delete(previous);
      if (autoOpen !== null) next.add(autoOpen);
      return next;
    });
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
      if (next.has(round)) {
        next.delete(round);
        openedByHand.current.delete(round);
      } else {
        next.add(round);
        openedByHand.current.add(round);
      }
      return next;
    });

  return (
    <div className={styles.stack}>
      {ordered.map((section) => {
        const mine = hasPendingMatchFor(section, myTeamId);
        return (
          <BoardPanel
            key={section.key}
            accent={accent}
            title={enduranceRoundTitle(section, text)}
            open={openRounds.has(section.round)}
            onToggle={() => toggle(section.round)}
            panelId={`endurance-${section.key}`}
            ariaLabel={enduranceRoundRegionLabel(section, text)}
            highlighted={mine}
            flag={mine ? text.t("bracket.yourMatch") : null}
            meta={
              <>
                <PanelPill>{enduranceMatchCountLabel(section.totalCount, text)}</PanelPill>
                {/* Une manche close le dit d'un mot ; une manche en cours
                    montre son avancement, qui est justement ce qu'on vient
                    regarder. */}
                <PanelPill done={section.isComplete}>
                  {section.isComplete ? text.t("endurance.roundDone") : enduranceProgressLabel(section, text)}
                </PanelPill>
              </>
            }
          >
            <RoundMatchSections matches={section.matches} className={styles.matchGrid}>
              {(match) => (
                <MatchRow
                  key={match.id}
                  match={match}
                  adminResolvable={adminResolvable(match)}
                  onOpenAdminModal={onOpenAdminModal}
                  scoreLocked={isMatchScoreLocked(match.id, allTournamentMatches, format)}
                  roundNumber={match.roundNumber}
                />
              )}
            </RoundMatchSections>
          </BoardPanel>
        );
      })}
    </div>
  );
}
