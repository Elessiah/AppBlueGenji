"use client";

import type { BracketMatch, SurvivalMeta, SurvivalStandingRow } from "@/lib/shared/types";
import {
  isCutRound,
  nextCutRound,
  teamsToEliminate,
  type SurvivalCutSchedule,
} from "@/lib/shared/survival";
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

interface SurvivalViewProps {
  survival: SurvivalMeta;
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

const STATUS_META: Record<SurvivalStandingRow["status"], { label: string; color: string }> = {
  ACTIVE: { label: "En lice", color: ACCENT },
  ELIMINATED: { label: "Éliminée", color: "var(--ink-quiet)" },
  FORFEIT: { label: "Forfait", color: AMBER },
};

export function SurvivalView({
  survival,
  matches,
  allTournamentMatches,
  myTeamId,
  isFinished,
  adminResolvable,
  onOpenAdminModal,
  canForfeit,
  onForfeit,
  emptyLabel = "Aucun match pour l'instant.",
}: Readonly<SurvivalViewProps>) {
  // Une marche du podium porte sa propre graisse : ne pas l'écraser en ligne.
  const podiumTiers = usePodiumTiers();
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

  const cutSchedule: SurvivalCutSchedule = {
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
      : `1re coupe à la manche ${survival.roundsBeforeFirstCut + barrageRounds}, puis ${everyRounds}`;

  const champion = isFinished ? survival.standings.find((s) => s.rank === 1) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {champion && <ChampionBanner champion={champion} />}

      {/* Bandeau récap + action forfait */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <span className="mono" style={{ fontSize: 13, color: "var(--ink-quiet)" }}>
          Manche {survival.currentRound || "—"} · {activeCount} équipe{activeCount > 1 ? "s" : ""} en lice
        </span>
        <span className="mono" style={{ fontSize: 13, color: "var(--ink-quiet)" }}>
          {cadenceLabel}
        </span>
        {!isFinished && upcomingCut > 0 && (
          <span className="mono" style={{ fontSize: 13, color: "var(--pink-400)" }}>
            Prochaine coupe : round {upcomingCut}
          </span>
        )}
        {barrageRounds > 0 && (
          <span className="mono" style={{ fontSize: 13, color: "var(--pink-400)" }}>
            Barrage d&apos;équilibrage au round 1
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Classement courant */}
        <div style={{ flex: "1 1 340px", minWidth: 280, maxWidth: 520 }}>
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
                  className={styles.survivalRow}
                  data-podium-muted={team.status === "ACTIVE" ? undefined : ""}
                  style={{
                    padding: "7px 10px",
                    borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`,
                    borderLeft: inDanger ? `3px solid ${AMBER}` : "3px solid transparent",
                    background: isMine ? "rgba(89,212,255,0.06)" : undefined,
                    opacity: team.status === "ELIMINATED" ? 0.55 : 1,
                    fontSize: 13,
                  }}
                >
                  <span className="num" style={{ width: 22, color: "var(--ink-quiet)", fontWeight: 600 }}>
                    {team.rank}
                  </span>
                  <EntrantName
                    teamId={team.teamId}
                    name={team.teamName}
                    title={team.teamName}
                    truncate
                    // Base non nulle : avec `flex: 1` (base 0), le nom ne pesait
                    // rien dans la negociation d'espace et se faisait rogner a
                    // quelques pixels par les colonnes fixes et le bouton
                    // d'abandon. Il retrecit desormais comme les autres.
                    style={{ flex: "1 1 72px" }}
                    textStyle={{ fontWeight: standingNameWeight(isMine, teamPodiumTier(podiumTiers, team.teamId) !== null, team.status !== "ACTIVE") }}
                  />
                  <span className="mono" style={{ fontSize: 12, color: "var(--ink-quiet)" }}>
                    {team.wins}-<span className="result-loss">{team.losses}</span>
                  </span>
                  <span
                    style={{
                      fontSize: 11,
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
                    // Sous 720 px, l'action passe sous le nom : à côté, elle
                    // l'écrasait à « Test - … ».
                    <span className={styles.survivalAction}>
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
                          : `Déclarer l'abandon de ${team.teamName}`
                      }
                      style={FORFEIT_BUTTON_STYLE}
                    >
                      Abandonner
                    </button>
                    </span>
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

        <SurvivalRounds
          matches={matches}
          allTournamentMatches={allTournamentMatches}
          cutSchedule={cutSchedule}
          adminResolvable={adminResolvable}
          onOpenAdminModal={onOpenAdminModal}
          emptyLabel={emptyLabel}
        />
      </div>
    </div>
  );
}

interface SurvivalRoundsProps {
  matches: BracketMatch[];
  allTournamentMatches: BracketMatch[];
  /**
   * Cadence des coupes, pour marquer barrage et coupes ; `null` quand on ne la
   * connaît pas — les manches s'affichent alors sans ces marques.
   */
  cutSchedule: SurvivalCutSchedule | null;
  adminResolvable: (m: BracketMatch) => boolean;
  onOpenAdminModal: (match: BracketMatch) => void;
  emptyLabel: string;
}

/**
 * Manches d'une survie, en colonnes (même esprit que les arbres
 * d'élimination). Rendue seule pour une phase survie **close** d'un tournoi
 * multi-phases : le serveur ne charge les métadonnées survie (classement,
 * barrage) que de la phase en cours, et le classement d'une phase close
 * s'affiche dessous (`PhaseStandingsBlock`). Sans ce composant, ses manches
 * s'affichaient sous le classement de la phase en cours, ou retombaient dans
 * un arbre à élimination. Colonnes communes : `RoundColumns`.
 */
export function SurvivalRounds({
  matches,
  allTournamentMatches,
  cutSchedule,
  adminResolvable,
  onOpenAdminModal,
  emptyLabel,
}: Readonly<SurvivalRoundsProps>) {
  const barrageRounds = cutSchedule?.barrageRounds ?? 0;
  return (
    <RoundColumns
      matches={matches}
      allTournamentMatches={allTournamentMatches}
      format="SURVIVAL"
      ariaLabel="Manches du tournoi — défilement horizontal"
      roundNoun="Manche"
      roundMarks={(roundNum) => [
        ...(barrageRounds > 0 && roundNum <= barrageRounds ? ["⚖ Barrage"] : []),
        ...(cutSchedule !== null && isCutRound(roundNum, cutSchedule) ? ["⚔ Coupe"] : []),
      ]}
      adminResolvable={adminResolvable}
      onOpenAdminModal={onOpenAdminModal}
      emptyLabel={emptyLabel}
    />
  );
}
