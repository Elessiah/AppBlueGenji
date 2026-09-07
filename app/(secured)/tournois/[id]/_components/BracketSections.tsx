"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { BracketMatch, BracketType, TournamentFormat } from "@/lib/shared/types";
import { BracketTree, MatchScoreDraft, ScrollRequest } from "./BracketTree";
import { BoardPanel, PanelPill } from "./BoardPanel";
import { ACCENT, buildSections, defaultOpenKey, findMyNextMatch, qualifyDestinationMatchId } from "../_lib/bracket-sections";
import { useMatchAnchorTarget } from "../_lib/match-anchor-context";

interface BracketSectionsProps {
  bracketType: BracketType;
  bracketLabel: string;
  showBracketLabel: boolean;
  matches: BracketMatch[];
  allTournamentMatches: BracketMatch[];
  myTeamId: number | null;
  canReport: (m: BracketMatch) => boolean;
  adminResolvable: (m: BracketMatch) => boolean;
  drafts: MatchScoreDraft;
  onScoreChange: (matchId: number, field: "myScore" | "opponentScore", value: string) => void;
  onSubmit: (match: BracketMatch, e: FormEvent) => Promise<void>;
  onOpenAdminModal: (match: BracketMatch) => void;
  format: TournamentFormat;
  /**
   * Match d'arrivée du vainqueur, quand il ne se lit pas sur la ligne du match.
   * Voir {@link BracketTree} : seul l'arbre final de BlueGenji Survie s'en sert.
   */
  resolveNextMatchId?: (match: BracketMatch) => number | null;
  /**
   * Nombre de tours que ce tableau comptera **une fois complet**, quand il ne se
   * lit pas sur les matchs déjà posés.
   *
   * Un tableau à élimination naît entier : compter ses tours suffit. L'arbre
   * final de BlueGenji Survie pousse un tour à la fois — à l'ouverture des
   * play-offs, seuls les quarts existent, et les nommer d'après ce seul tour les
   * appelait « Finale ».
   */
  plannedRounds?: number;
}

export function BracketSections({
  bracketType,
  bracketLabel,
  showBracketLabel,
  matches,
  allTournamentMatches,
  myTeamId,
  canReport,
  adminResolvable,
  drafts,
  onScoreChange,
  onSubmit,
  onOpenAdminModal,
  format,
  resolveNextMatchId,
  plannedRounds,
}: BracketSectionsProps) {
  const roundNums = [...new Set(matches.map((m) => m.roundNumber))].sort((a, b) => a - b);
  // Les stades se nomment à partir de la **fin** du tableau : sur un arbre qui
  // pousse un tour à la fois, ce repère ne peut pas venir des tours posés.
  const totalRounds = Math.max(plannedRounds ?? roundNums.length, roundNums.length);
  const sections = buildSections(roundNums, bracketType, totalRounds);
  const accent = ACCENT[bracketType];
  const myNext = findMyNextMatch(matches, myTeamId);
  const myNextMatchId = myNext?.id ?? null;
  const regionBaseId = `bracket-${bracketType.toLowerCase()}`;

  const autoOpen = defaultOpenKey(sections, matches, myNext);

  const [openKeys, setOpenKeys] = useState<Set<string>>(
    () => new Set(autoOpen ? [autoOpen] : []),
  );
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest | null>(null);

  // Le volet à ouvrir d'office **change en cours de tournoi** : le plateau
  // avance, et l'arbre final de BlueGenji Survie voit même son découpage se
  // réorganiser quand un tour s'ajoute (au-delà de trois tours, la « phase
  // finale » glisse d'une section à l'autre). Un état figé au montage laissait
  // alors naître repliée la section qui vient de recevoir le tour vivant, sans
  // que rien ne l'ouvre.
  //
  // On **ajoute** sans jamais refermer, et seulement quand le défaut change :
  // un volet replié à la main ne se rouvre pas au prochain instantané. Même
  // règle que les manches d'endurance (`EnduranceRoundPanels`), avec qui ce
  // composant partage déjà son chrome.
  const lastAutoOpen = useRef(autoOpen);
  useEffect(() => {
    if (autoOpen === null || autoOpen === lastAutoOpen.current) return;
    lastAutoOpen.current = autoOpen;
    setOpenKeys((prev) => (prev.has(autoOpen) ? prev : new Set(prev).add(autoOpen)));
  }, [autoOpen]);

  // Ancre `#match-[id]` : un gros tableau ne rend qu'un volet à la fois, et la
  // cible peut dormir dans un volet replié — le hook la chercherait alors dans
  // le DOM jusqu'à renoncer. Le volet qui la contient s'ouvre donc, et c'est le
  // seul endroit qui sache faire ce lien entre un match et un volet.
  //
  // On **ajoute** sans jamais refermer : le lecteur reste libre de replier ce
  // qu'il veut ensuite, et un état identique n'est pas réécrit — sans quoi
  // `sections` et `matches`, recréés à chaque rendu, boucleraient.
  const anchorTargetId = useMatchAnchorTarget();
  useEffect(() => {
    if (anchorTargetId === null) return;
    const target = matches.find((m) => m.id === anchorTargetId);
    if (!target) return;
    const section = sections.find((s) => s.rounds.includes(target.roundNumber));
    if (!section) return;
    setOpenKeys((prev) => (prev.has(section.key) ? prev : new Set(prev).add(section.key)));
  }, [anchorTargetId, matches, sections]);

  const toggle = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Clic sur un badge « Qualifié en X » : ouvre le volet du match d'arrivée et y défile.
  const handleQualifyClick = (sourceMatch: BracketMatch) => {
    const destId = resolveNextMatchId
      ? resolveNextMatchId(sourceMatch)
      : qualifyDestinationMatchId(sourceMatch);
    if (destId == null) return;
    const dest = matches.find((m) => m.id === destId);
    if (!dest) return;
    const destSection = sections.find((s) => s.rounds.includes(dest.roundNumber));
    if (!destSection) return;
    setOpenKeys((prev) => new Set(prev).add(destSection.key));
    setScrollRequest({ matchId: destId, nonce: Date.now() });
  };

  return (
    <div>
      {showBracketLabel && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ width: 3, height: 16, background: accent, borderRadius: 2 }} />
          <p
            style={{
              margin: 0,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: accent,
            }}
          >
            {bracketLabel}
          </p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sections.map((section) => {
          const open = openKeys.has(section.key);
          const sectionMatches = matches.filter((m) => section.rounds.includes(m.roundNumber));
          const matchCount = sectionMatches.length;
          const hasMyMatch = myNext !== null && section.rounds.includes(myNext.roundNumber);
          const panelId = `${regionBaseId}-${section.key.replace(/\s+/g, "-")}`;

          return (
            <BoardPanel
              key={section.key}
              accent={accent}
              title={section.title}
              open={open}
              onToggle={() => toggle(section.key)}
              panelId={panelId}
              highlighted={hasMyMatch}
              flag={hasMyMatch ? "Votre match" : null}
              meta={<PanelPill>{matchCount} match{matchCount > 1 ? "s" : ""}</PanelPill>}
            >
              <BracketTree
                matches={sectionMatches}
                allTournamentMatches={allTournamentMatches}
                bracketType={bracketType}
                totalRoundsGlobal={totalRounds}
                roundIdxBase={section.roundIdxBase}
                qualifyLabel={section.qualifyLabel}
                accentColor={accent}
                scrollTargetMatchId={myNextMatchId}
                scrollRequest={scrollRequest}
                onQualifyClick={handleQualifyClick}
                canReport={canReport}
                adminResolvable={adminResolvable}
                format={format}
                drafts={drafts}
                onScoreChange={onScoreChange}
                onSubmit={onSubmit}
                onOpenAdminModal={onOpenAdminModal}
                resolveNextMatchId={resolveNextMatchId}
              />
            </BoardPanel>
          );
        })}
      </div>
    </div>
  );
}
