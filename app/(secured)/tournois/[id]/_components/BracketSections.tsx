"use client";

import { useEffect, useRef, useState } from "react";
import type { BracketMatch, BracketType, TournamentFormat } from "@/lib/shared/types";
import { BracketTree, ScrollRequest } from "./BracketTree";
import { BoardPanel, PanelPill } from "./BoardPanel";
import {
  ACCENT,
  buildSections,
  defaultOpenKey,
  findMyNextMatch,
  qualifyDestinationMatchId,
  type BracketSlotRef,
} from "../_lib/bracket-sections";
import { useMatchAnchorTarget } from "../_lib/match-anchor-context";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";

interface BracketSectionsProps {
  bracketType: BracketType;
  bracketLabel: string;
  showBracketLabel: boolean;
  matches: BracketMatch[];
  /**
   * Créneaux des tours **prévus mais pas encore posés**
   * (`endurancePlayoffGhostSlots`) : ils prennent place dans le découpage en
   * volets comme dans l'arbre, où ils se dessinent vides.
   *
   * Ils ne comptent nulle part ailleurs : la pastille d'un volet annonce ses
   * **rencontres**, et le volet ouvert d'office se décide sur elles.
   */
  ghostSlots?: readonly BracketSlotRef[];
  allTournamentMatches: BracketMatch[];
  myTeamId: number | null;
  adminResolvable: (m: BracketMatch) => boolean;
  onOpenAdminModal: (match: BracketMatch) => void;
  format: TournamentFormat;
  /**
   * Match d'arrivée du vainqueur, quand il ne se lit pas sur la ligne du match.
   * Voir {@link BracketTree} : seul l'arbre final de BlueGenji Survie s'en sert.
   */
  resolveNextMatchId?: (slot: BracketSlotRef) => number | null;
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
  ghostSlots,
  allTournamentMatches,
  myTeamId,
  adminResolvable,
  onOpenAdminModal,
  format,
  resolveNextMatchId,
  plannedRounds,
}: Readonly<BracketSectionsProps>) {
  // Les tours à pourvoir comptent dans le découpage : ils ont une colonne à
  // eux dans l'arbre, et un volet qui s'arrêterait aux tours posés la laisserait
  // dehors. C'est aussi ce qui fige le découpage pour de bon — l'arbre naît
  // avec tous ses tours, et plus aucune section ne se réorganise en route.
  const roundNums = [
    ...new Set([
      ...matches.map((m) => m.roundNumber),
      ...(ghostSlots ?? []).map((slot) => slot.roundNumber),
    ]),
  ].sort((a, b) => a - b);
  // Les stades se nomment à partir de la **fin** du tableau : sur un arbre qui
  // pousse un tour à la fois, ce repère ne peut pas venir des tours posés.
  const totalRounds = Math.max(plannedRounds ?? roundNums.length, roundNums.length);
  const text = useTournamentPageText();
  const sections = buildSections(roundNums, bracketType, totalRounds, text);
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
    // L'arrivée peut être un créneau **à pourvoir** : au-delà de trois tours, le
    // premier volet d'un arbre de BlueGenji Survie annonce « Qualifié en demi-
    // finale » alors que ce tour n'est pas encore posé. Chercher la destination
    // parmi les seules rencontres rendait le badge inerte, sans rien dire.
    const destRound =
      matches.find((m) => m.id === destId)?.roundNumber ??
      (ghostSlots ?? []).find((slot) => slot.id === destId)?.roundNumber;
    if (destRound === undefined) return;
    const destSection = sections.find((s) => s.rounds.includes(destRound));
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
          const sectionGhosts = (ghostSlots ?? []).filter((slot) =>
            section.rounds.includes(slot.roundNumber),
          );
          // La pastille compte les **créneaux**, cases à pourvoir comprises :
          // c'est la taille du volet, et c'est déjà ce qu'elle annonce sur un
          // tableau à élimination, dont les tours à venir sont de vraies
          // rencontres sans engagées. Ne compter que les rencontres posées
          // faisait annoncer « 0 match » à un volet qui en dessine sept — le
          // cas d'un plateau de plus de huit, dont le second volet naît
          // entièrement à pourvoir.
          const matchCount = sectionMatches.length + sectionGhosts.length;
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
              flag={hasMyMatch ? text.t("bracket.yourMatch") : null}
              meta={<PanelPill>{text.t("bracket.matchCount", { count: matchCount })}</PanelPill>}
            >
              <BracketTree
                matches={sectionMatches}
                ghostSlots={sectionGhosts}
                allTournamentMatches={allTournamentMatches}
                bracketType={bracketType}
                totalRoundsGlobal={totalRounds}
                roundIdxBase={section.roundIdxBase}
                qualifyLabel={section.qualifyLabel}
                accentColor={accent}
                scrollTargetMatchId={myNextMatchId}
                scrollRequest={scrollRequest}
                onQualifyClick={handleQualifyClick}
                adminResolvable={adminResolvable}
                format={format}
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
